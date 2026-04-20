import type { Metadata } from "next";
import type { ReactNode } from "react";

import "@prontiq/tokens/tokens.css";
import "./globals.css";

import { ConditionalClerkProvider } from "../components/landing/conditional-clerk-provider.js";
import { env } from "../lib/env.js";
import { getLandingClerkRuntime } from "../lib/clerk.js";
import { serverEnv } from "../lib/server-env.js";
import { ThemeProvider } from "../lib/theme-provider.js";

export const metadata: Metadata = {
  title: "Prontiq",
  description: "Australian address validation for developers.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  const clerkRuntime = getLandingClerkRuntime({
    allowKeyless: serverEnv.PRONTIQ_ALLOW_KEYLESS_CLERK === "1",
    publishableKey: env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
  });

  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <ConditionalClerkProvider
          clerkEnabled={clerkRuntime.clerkEnabled}
          publishableKey={clerkRuntime.publishableKey}
        >
          <ThemeProvider>{children}</ThemeProvider>
        </ConditionalClerkProvider>
      </body>
    </html>
  );
}
