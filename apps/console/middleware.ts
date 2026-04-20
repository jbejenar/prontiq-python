import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

import { CONSOLE_SIGN_IN_PATH, getClerkRuntime, isConsolePublicRoute } from "./lib/clerk.js";

const isPublicRoute = createRouteMatcher([`${CONSOLE_SIGN_IN_PATH}(.*)`]);

export default clerkMiddleware(async (auth, request) => {
  const runtime = getClerkRuntime({
    allowKeyless: process.env.PRONTIQ_ALLOW_KEYLESS_CLERK === "1",
    publishableKey: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
    secretKey: process.env.CLERK_SECRET_KEY,
  });

  if (runtime.mode === "disabled" || isConsolePublicRoute(request.nextUrl.pathname)) {
    return NextResponse.next();
  }

  if (runtime.mode === "misconfigured") {
    return new NextResponse(
      `Console auth is misconfigured. Missing Clerk key(s): ${runtime.missingKeys.join(", ")}.`,
      { status: 503 },
    );
  }

  if (!isPublicRoute(request)) {
    await auth.protect();
  }

  return NextResponse.next();
});

export const config = {
  matcher: ["/((?!_next|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
