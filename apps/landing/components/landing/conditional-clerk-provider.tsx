"use client";

import type { ReactNode } from "react";
import { ClerkProvider } from "@clerk/nextjs";

interface ConditionalClerkProviderProps {
  children: ReactNode;
  clerkEnabled: boolean;
  publishableKey?: string;
}

export function ConditionalClerkProvider({
  children,
  clerkEnabled,
  publishableKey,
}: ConditionalClerkProviderProps) {
  if (!clerkEnabled || !publishableKey) {
    return <>{children}</>;
  }

  return <ClerkProvider publishableKey={publishableKey}>{children}</ClerkProvider>;
}
