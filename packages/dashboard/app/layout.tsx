import { ClerkProvider } from "@clerk/nextjs";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Prontiq — Developer Dashboard",
  description: "Manage your API keys, usage, and billing",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // Clerk requires publishableKey at build time. Skip provider if not configured.
  const clerkKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

  return (
    <html lang="en">
      <body>
        {clerkKey ? <ClerkProvider publishableKey={clerkKey}>{children}</ClerkProvider> : children}
      </body>
    </html>
  );
}
