import { createLogger } from "@prontiq/shared";

import { env } from "../../../../../lib/env.js";
import {
  applyDemoSessionCookie,
  buildDemoUpstreamUrl,
  consumeDemoRouteRateLimits,
  getClientIdentifier,
  sanitizeDemoQuery,
  throttleResponse,
  upstreamFailureResponse,
} from "../../../../../lib/demo-proxy.js";
import { serverEnv } from "../../../../../lib/server-env.js";

const logger = createLogger("landing-demo-route");

export async function GET(request: Request) {
  const clientIdentity = getClientIdentifier(new Headers(request.headers), request.url);
  const rateLimit = consumeDemoRouteRateLimits(clientIdentity.clientKey);
  if (!rateLimit.allowed) {
    return applyDemoSessionCookie(
      throttleResponse(rateLimit.rejectedKey, rateLimit.retryAfterSeconds),
      clientIdentity.setCookieHeader,
    );
  }

  if (!serverEnv.PRONTIQ_LANDING_DEMO_API_KEY) {
    logger.warn("Landing demo request rejected because demo key is missing", {
      client_key: clientIdentity.clientKey,
    });
    return applyDemoSessionCookie(
      upstreamFailureResponse(),
      clientIdentity.setCookieHeader,
    );
  }

  let query;
  try {
    query = sanitizeDemoQuery(new URL(request.url).searchParams);
  } catch (error) {
    if (error instanceof Response) {
      return applyDemoSessionCookie(error, clientIdentity.setCookieHeader);
    }
    throw error;
  }

  const upstreamUrl = buildDemoUpstreamUrl(env.NEXT_PUBLIC_API_URL, query);

  try {
    const upstream = await fetch(upstreamUrl, {
      cache: "no-store",
      headers: {
        Accept: "application/json",
        "X-Api-Key": serverEnv.PRONTIQ_LANDING_DEMO_API_KEY,
      },
      signal: AbortSignal.timeout(2500),
    });

    if (!upstream.ok) {
      logger.warn("Landing demo upstream returned a non-ok status", {
        client_key: clientIdentity.clientKey,
        status: upstream.status,
        upstream_url: upstreamUrl.toString(),
      });
      return applyDemoSessionCookie(
        upstreamFailureResponse(upstream.status === 429 ? 503 : upstream.status),
        clientIdentity.setCookieHeader,
      );
    }

    const payload = await upstream.json();
    return applyDemoSessionCookie(
      Response.json(payload, {
        headers: {
          "cache-control": "no-store",
        },
        status: 200,
      }),
      clientIdentity.setCookieHeader,
    );
  } catch (error) {
    logger.error("Landing demo upstream fetch failed", {
      client_key: clientIdentity.clientKey,
      error,
      upstream_url: upstreamUrl.toString(),
    });
    return applyDemoSessionCookie(
      upstreamFailureResponse(),
      clientIdentity.setCookieHeader,
    );
  }
}
