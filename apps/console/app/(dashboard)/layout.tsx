import type { ReactNode } from "react";

import { ConsoleShell } from "../../components/console/console-shell.js";
import { DisabledAuthState } from "../../components/console/disabled-auth-state.js";
import { env } from "../../lib/env.js";
import { serverEnv } from "../../lib/server-env.js";
import { getClerkRuntime } from "../../lib/clerk.js";

export default function DashboardLayout({ children }: { children: ReactNode }) {
  const clerkRuntime = getClerkRuntime({
    allowKeyless: serverEnv.PRONTIQ_ALLOW_KEYLESS_CLERK === "1",
    publishableKey: env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
    secretKey: serverEnv.CLERK_SECRET_KEY,
  });

  if (clerkRuntime.mode === "misconfigured") {
    return (
      <main className="flex min-h-screen items-center justify-center px-6 py-12">
        <DisabledAuthState missingKeys={clerkRuntime.missingKeys} mode={clerkRuntime.mode} />
      </main>
    );
  }

  return <ConsoleShell clerkEnabled={clerkRuntime.clerkEnabled}>{children}</ConsoleShell>;
}
