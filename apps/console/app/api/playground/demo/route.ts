import publicOpenApiSpec from "../../../../../../packages/docs/openapi.json";

import { env } from "../../../../lib/env.js";
import { getPlaygroundServerEnv } from "../../../../lib/server-env.js";
import {
  getBillingPrincipal,
  requireSameOrigin,
} from "../../../../lib/billing-auth.js";
import {
  assertSafeTemplatePath,
  buildDemoUpstreamRequest,
  parseDemoProxyPayload,
  validateDemoProxyPayloadForOperation,
} from "../../../../features/playground/lib/demo-proxy.js";
import {
  findPublicOperation,
  parsePublicOpenApiOperations,
} from "../../../../features/playground/lib/openapi.js";
import { filterSafeResponseHeaders } from "../../../../features/playground/lib/safe-headers.js";

export const dynamic = "force-dynamic";

const MAX_DEMO_PROXY_REQUEST_BYTES = 32_768;
const DEMO_PROXY_UPSTREAM_TIMEOUT_MS = 15_000;

function jsonError(code: string, message: string, status: number, headers?: HeadersInit) {
  return Response.json({ error: { code, message, status } }, { status, headers });
}

function contentLengthExceedsLimit(request: Request) {
  const raw = request.headers.get("content-length");
  if (!raw) return false;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > MAX_DEMO_PROXY_REQUEST_BYTES;
}

async function readJsonPayload(request: Request): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) return null;

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > MAX_DEMO_PROXY_REQUEST_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new Error("DEMO_PROXY_REQUEST_TOO_LARGE");
    }
    chunks.push(value);
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(body);
  } catch {
    throw new Error("INVALID_DEMO_PROXY_UTF8");
  }

  if (text.trim().length === 0) {
    return null;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error("INVALID_DEMO_PROXY_JSON");
  }
}

function isTimeoutError(error: unknown) {
  return (
    error instanceof DOMException &&
    (error.name === "AbortError" || error.name === "TimeoutError")
  );
}

export async function POST(request: Request) {
  if (!request.headers.get("origin")) {
    return jsonError(
      "PLAYGROUND_ORIGIN_REQUIRED",
      "Playground demo requests must come from the console origin.",
      403,
    );
  }

  const originError = requireSameOrigin(request);
  if (originError) return originError;

  if (request.headers.has("x-api-key")) {
    return jsonError(
      "DEMO_PROXY_REJECTED_USER_KEY",
      "Demo mode does not accept browser-supplied API keys.",
      400,
    );
  }
  if (contentLengthExceedsLimit(request)) {
    return jsonError(
      "DEMO_PROXY_REQUEST_TOO_LARGE",
      "Demo request payload is too large.",
      413,
    );
  }

  const principal = await getBillingPrincipal();
  if (principal instanceof Response) return principal;

  let rawPayload: unknown;
  try {
    rawPayload = await readJsonPayload(request);
  } catch (error) {
    if (error instanceof Error && error.message === "DEMO_PROXY_REQUEST_TOO_LARGE") {
      return jsonError(
        "DEMO_PROXY_REQUEST_TOO_LARGE",
        "Demo request payload is too large.",
        413,
      );
    }
    return jsonError("INVALID_DEMO_REQUEST", "Demo request payload is invalid.", 400);
  }

  const payload = parseDemoProxyPayload(rawPayload);
  if (!payload) {
    return jsonError("INVALID_DEMO_REQUEST", "Demo request payload is invalid.", 400);
  }
  if (!assertSafeTemplatePath(payload.path)) {
    return jsonError("UNSUPPORTED_DEMO_PATH", "This path is not available in demo mode.", 400);
  }

  const operation = findPublicOperation(
    parsePublicOpenApiOperations(publicOpenApiSpec),
    payload.method,
    payload.path,
  );
  if (!operation) {
    return jsonError(
      "UNSUPPORTED_DEMO_OPERATION",
      "This method and path are not declared in the public API spec.",
      400,
    );
  }
  const validationError = validateDemoProxyPayloadForOperation(operation, payload);
  if (validationError) {
    return jsonError(validationError.code, validationError.message, 400);
  }

  let serverEnv: ReturnType<typeof getPlaygroundServerEnv>;
  try {
    serverEnv = getPlaygroundServerEnv();
  } catch {
    return jsonError(
      "DEMO_KEY_NOT_CONFIGURED",
      "Demo mode is not configured for this deployment.",
      503,
    );
  }
  if (!serverEnv.demoBackendPolicyConfirmed) {
    return jsonError(
      "DEMO_BACKEND_POLICY_NOT_CONFIRMED",
      "Demo execution is disabled until the demo key is governed by backend quota and rate controls.",
      503,
    );
  }

  let upstream: ReturnType<typeof buildDemoUpstreamRequest>;
  try {
    upstream = buildDemoUpstreamRequest({
      apiBaseUrl: env.NEXT_PUBLIC_API_URL,
      demoApiKey: serverEnv.demoApiKey,
      operation,
      payload,
    });
  } catch {
    return jsonError("INVALID_JSON_BODY", "Request body must be valid JSON.", 400);
  }

  let upstreamResponse: Response;
  try {
    upstreamResponse = await fetch(upstream.url, {
      method: upstream.method,
      headers: upstream.headers,
      ...(upstream.body ? { body: upstream.body } : {}),
      cache: "no-store",
      signal: AbortSignal.timeout(DEMO_PROXY_UPSTREAM_TIMEOUT_MS),
    });
  } catch (error) {
    if (isTimeoutError(error)) {
      return jsonError(
        "DEMO_UPSTREAM_TIMEOUT",
        "The demo API request timed out before the backend responded.",
        504,
      );
    }
    return jsonError(
      "DEMO_UPSTREAM_UNAVAILABLE",
      "The demo API request could not reach the backend.",
      502,
    );
  }

  return new Response(await upstreamResponse.text(), {
    status: upstreamResponse.status,
    statusText: upstreamResponse.statusText,
    headers: filterSafeResponseHeaders(upstreamResponse.headers),
  });
}
