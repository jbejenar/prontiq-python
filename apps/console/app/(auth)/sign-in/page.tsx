import { SignInSurface } from "../../../components/console/sign-in-surface.js";
import { env } from "../../../lib/env.js";
import { serverEnv } from "../../../lib/server-env.js";
import { getClerkRuntime } from "../../../lib/clerk.js";

export default function SignInPage() {
  const clerkRuntime = getClerkRuntime({
    allowKeyless: serverEnv.PRONTIQ_ALLOW_KEYLESS_CLERK === "1",
    publishableKey: env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
    secretKey: serverEnv.CLERK_SECRET_KEY,
  });

  return (
    <main className="flex min-h-screen items-center justify-center px-6 py-12">
      <SignInSurface missingKeys={clerkRuntime.missingKeys} mode={clerkRuntime.mode} />
    </main>
  );
}
