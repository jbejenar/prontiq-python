import type { Metadata } from "next";
import type { ReactNode } from "react";

import "@prontiq/tokens/tokens.css";
import "./globals.css";

import { ConditionalClerkProvider } from "../components/console/conditional-clerk-provider.js";
import { env } from "../lib/env.js";
import { ThemeProvider } from "../lib/theme-provider.js";
import { serverEnv } from "../lib/server-env.js";
import { getClerkRuntime } from "../lib/clerk.js";

export const metadata: Metadata = {
  title: "Prontiq Console",
  description: "Authenticated customer console for Prontiq.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  const clerkRuntime = getClerkRuntime({
    allowKeyless: serverEnv.PRONTIQ_ALLOW_KEYLESS_CLERK === "1",
    publishableKey: env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
    secretKey: serverEnv.CLERK_SECRET_KEY,
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
