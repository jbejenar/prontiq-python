export type LandingClerkRuntimeMode = "disabled" | "enabled" | "misconfigured";

function hasValue(value: string | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function getLandingClerkRuntime(args: {
  allowKeyless?: boolean;
  publishableKey?: string;
}) {
  const allowKeyless = args.allowKeyless === true;
  const publishableKey = hasValue(args.publishableKey) ? args.publishableKey : undefined;
  const hasPublishableKey = Boolean(publishableKey);
  const missingKeys = hasPublishableKey ? [] : ["NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY"];

  let mode: LandingClerkRuntimeMode;
  if (hasPublishableKey) {
    mode = "enabled";
  } else if (allowKeyless) {
    mode = "disabled";
  } else {
    mode = "misconfigured";
  }

  return {
    clerkEnabled: mode === "enabled",
    missingKeys,
    mode,
    publishableKey,
  };
}

export function getLandingClerkRuntimeMessage(
  mode: LandingClerkRuntimeMode,
  missingKeys: string[],
) {
  if (mode === "enabled") {
    return "Landing signup is configured.";
  }

  if (mode === "misconfigured") {
    return `Landing signup is misconfigured. Add the missing Clerk key(s): ${missingKeys.join(", ")}.`;
  }

  return "Landing signup is in explicit helper-managed keyless local/CI mode.";
}
