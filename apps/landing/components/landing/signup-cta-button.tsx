"use client";

import type { ReactNode } from "react";
import { SignUpButton } from "@clerk/nextjs";
import { DEFAULT_ACCOUNT_URL } from "@prontiq/shared/constants";

import { Button, type ButtonProps } from "../ui/button.js";
import type { LandingClerkRuntimeMode } from "../../lib/clerk.js";

interface SignupCTAButtonProps extends Omit<ButtonProps, "children"> {
  children: ReactNode;
  mode: LandingClerkRuntimeMode;
}

export function SignupCTAButton({ children, mode, ...buttonProps }: SignupCTAButtonProps) {
  if (mode === "enabled") {
    return (
      <SignUpButton
        fallbackRedirectUrl={DEFAULT_ACCOUNT_URL}
        forceRedirectUrl={DEFAULT_ACCOUNT_URL}
        mode="modal"
        signInFallbackRedirectUrl={DEFAULT_ACCOUNT_URL}
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
        mode === "misconfigured"
          ? "Landing signup is misconfigured. Add NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY."
          : "Landing signup is disabled in helper-managed keyless mode."
      }
    >
      {children}
    </Button>
  );
}
