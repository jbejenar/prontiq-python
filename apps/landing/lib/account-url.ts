import { DEFAULT_ACCOUNT_URL } from "@prontiq/shared/constants";

import { env } from "./env.js";

const PRODUCTION_LANDING_HOSTS = new Set(["prontiq.dev", "www.prontiq.dev"]);

function hasValue(value: string | null | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function resolveLandingAccountUrl(currentOrigin?: string): string {
  if (hasValue(env.NEXT_PUBLIC_ACCOUNT_URL)) {
    return env.NEXT_PUBLIC_ACCOUNT_URL;
  }

  if (!hasValue(currentOrigin)) {
    return DEFAULT_ACCOUNT_URL;
  }

  try {
    const origin = new URL(currentOrigin);
    if (PRODUCTION_LANDING_HOSTS.has(origin.hostname)) {
      return DEFAULT_ACCOUNT_URL;
    }

    return origin.origin;
  } catch {
    return DEFAULT_ACCOUNT_URL;
  }
}

function resolveOriginFromHeaders(requestHeaders: Headers): string | undefined {
  const forwardedHost = requestHeaders.get("x-forwarded-host");
  const host = forwardedHost ?? requestHeaders.get("host");
  if (!hasValue(host)) {
    return undefined;
  }

  const forwardedProto = requestHeaders.get("x-forwarded-proto");
  const protocol = hasValue(forwardedProto)
    ? forwardedProto
    : host.startsWith("localhost") || host.startsWith("127.0.0.1")
      ? "http"
      : "https";

  return `${protocol}://${host}`;
}

export function resolveLandingAccountUrlFromHeaders(requestHeaders: Headers): string {
  return resolveLandingAccountUrl(resolveOriginFromHeaders(requestHeaders));
}
