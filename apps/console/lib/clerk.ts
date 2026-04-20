export const CONSOLE_SIGN_IN_PATH = "/sign-in";

export type ClerkRuntimeMode = "disabled" | "enabled" | "misconfigured";

function hasValue(value: string | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function getClerkRuntime(args: {
  allowKeyless?: boolean;
  publishableKey?: string;
  secretKey?: string;
}) {
  const allowKeyless = args.allowKeyless === true;
  const publishableKey = hasValue(args.publishableKey) ? args.publishableKey : undefined;
  const secretKey = hasValue(args.secretKey) ? args.secretKey : undefined;
  const hasPublishableKey = Boolean(publishableKey);
  const hasSecretKey = Boolean(secretKey);
  const missingKeys = [
    ...(hasPublishableKey ? [] : ["NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY"]),
    ...(hasSecretKey ? [] : ["CLERK_SECRET_KEY"]),
  ];

  let mode: ClerkRuntimeMode;
  if (hasPublishableKey && hasSecretKey) {
    mode = "enabled";
  } else if (!hasPublishableKey && !hasSecretKey && allowKeyless) {
    mode = "disabled";
  } else {
    mode = "misconfigured";
  }

  return {
    clerkEnabled: mode === "enabled",
    mode,
    missingKeys,
    publishableKey,
    secretKey,
  };
}

export function getClerkRuntimeMessage(mode: ClerkRuntimeMode, missingKeys: string[]) {
  if (mode === "misconfigured") {
    return `Console auth is misconfigured. Add the missing Clerk key(s): ${missingKeys.join(", ")}.`;
  }

  return "Console auth is in explicit keyless local/CI mode.";
}

export function isConsolePublicRoute(pathname: string) {
  return pathname === CONSOLE_SIGN_IN_PATH || pathname.startsWith(`${CONSOLE_SIGN_IN_PATH}/`);
}
