"use client";

import { SignIn } from "@clerk/nextjs";

import { DisabledAuthState } from "./disabled-auth-state.js";
import type { ClerkRuntimeMode } from "../../lib/clerk.js";

interface SignInSurfaceProps {
  mode: ClerkRuntimeMode;
  missingKeys: string[];
}

export function SignInSurface({ mode, missingKeys }: SignInSurfaceProps) {
  if (mode !== "enabled") {
    return <DisabledAuthState missingKeys={missingKeys} mode={mode} />;
  }

  return <SignIn path="/sign-in" routing="path" />;
}
