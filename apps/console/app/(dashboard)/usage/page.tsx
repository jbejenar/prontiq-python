import { DisabledAuthState } from "../../../components/console/disabled-auth-state.js";
import { getClerkRuntime } from "../../../lib/clerk.js";
import { env } from "../../../lib/env.js";
import { serverEnv } from "../../../lib/server-env.js";
import { UsagePanel } from "./usage-panel.js";

export default function UsagePage() {
  const clerkRuntime = getClerkRuntime({
    allowKeyless: serverEnv.PRONTIQ_ALLOW_KEYLESS_CLERK === "1",
    publishableKey: env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
    secretKey: serverEnv.CLERK_SECRET_KEY,
  });

  if (!clerkRuntime.clerkEnabled) {
    return <DisabledAuthState missingKeys={clerkRuntime.missingKeys} mode={clerkRuntime.mode} />;
  }

  return <UsagePanel />;
}
