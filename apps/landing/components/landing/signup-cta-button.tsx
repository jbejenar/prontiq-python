"use client";

import type { ReactNode } from "react";
import { SignUpButton } from "@clerk/nextjs";

import { useLandingAccountUrl } from "../../lib/account-url.js";
import { Button, type ButtonProps } from "../ui/button.js";
import type { LandingClerkRuntimeMode } from "../../lib/clerk.js";

interface SignupCTAButtonProps extends Omit<ButtonProps, "children"> {
  children: ReactNode;
  mode: LandingClerkRuntimeMode;
}

export function SignupCTAButton({ children, mode, ...buttonProps }: SignupCTAButtonProps) {
  const { accountUrl, isResolved } = useLandingAccountUrl();

  if (mode === "enabled" && isResolved && accountUrl) {
    return (
      <SignUpButton
        fallbackRedirectUrl={accountUrl}
        forceRedirectUrl={accountUrl}
        mode="modal"
        signInFallbackRedirectUrl={accountUrl}
      >
        <Button {...buttonProps}>{children}</Button>
      </SignUpButton>
    );
  }

  return (
    <Button
      {...buttonProps}
      aria-disabled
      disabled
      title={
        mode === "enabled" && !isResolved
          ? "Landing signup is resolving the console destination."
        : mode === "misconfigured"
          ? "Landing signup is misconfigured. Add NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY."
          : "Landing signup is disabled in helper-managed keyless mode."
      }
    >
      {children}
    </Button>
  );
}
