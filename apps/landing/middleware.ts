import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { serverEnv } from "./lib/server-env.js";
import {
  LANDING_UNLOCK_COOKIE_MAX_AGE_SECONDS,
  LANDING_UNLOCK_COOKIE_NAME,
  LANDING_UNLOCK_QUERY_PARAM,
  createLockedPageHtml,
  evaluateLandingUnlock,
} from "./lib/unlock.js";

export default function middleware(request: NextRequest): NextResponse {
  const configuredToken = serverEnv.PRONTIQ_LANDING_UNLOCK_TOKEN;
  const decision = evaluateLandingUnlock({
    configuredToken,
    cookieToken: request.cookies.get(LANDING_UNLOCK_COOKIE_NAME)?.value,
    queryToken: request.nextUrl.searchParams.get(LANDING_UNLOCK_QUERY_PARAM),
  });

  if (decision.kind === "allow") {
    return NextResponse.next();
  }

  if (decision.kind === "redirect") {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.search = "";

    const response = NextResponse.redirect(redirectUrl);

    if (decision.shouldSetCookie && configuredToken) {
      response.cookies.set(LANDING_UNLOCK_COOKIE_NAME, configuredToken, {
        httpOnly: true,
        maxAge: LANDING_UNLOCK_COOKIE_MAX_AGE_SECONDS,
        path: "/",
        sameSite: "lax",
        secure: request.nextUrl.protocol === "https:",
      });
    }

    return response;
  }

  return new NextResponse(createLockedPageHtml(), {
    headers: {
      "cache-control": "private, no-store, max-age=0",
      "content-type": "text/html; charset=utf-8",
      "x-robots-tag": "noindex, nofollow",
    },
    status: 200,
  });
}

export const config = {
  matcher: ["/"],
};
