import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import { vi } from "vitest";

const signUpButtonMock = vi.fn(({ children }: { children: ReactNode }) => <div data-testid="clerk-sign-up">{children}</div>);

vi.mock("@clerk/nextjs", () => ({
  SignUpButton: (props: { children: ReactNode }) => signUpButtonMock(props),
}));

import { SignupCTAButton } from "./signup-cta-button.js";

test("signup cta wraps its child in Clerk when landing auth is enabled", () => {
  render(
    <SignupCTAButton accountUrl="https://preview.prontiq.dev" mode="enabled">
      Get started free
    </SignupCTAButton>,
  );

  expect(screen.getByTestId("clerk-sign-up")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Get started free" })).toBeInTheDocument();
  expect(signUpButtonMock).toHaveBeenCalledWith(
    expect.objectContaining({
      fallbackRedirectUrl: "https://preview.prontiq.dev",
      forceRedirectUrl: "https://preview.prontiq.dev",
      mode: "modal",
      signInFallbackRedirectUrl: "https://preview.prontiq.dev",
    }),
  );
});

test("signup cta disables itself when landing auth is in helper-managed keyless mode", () => {
  render(
    <SignupCTAButton accountUrl="https://preview.prontiq.dev" mode="disabled">
      Get started free
    </SignupCTAButton>,
  );

  expect(screen.queryByTestId("clerk-sign-up")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Get started free" })).toBeDisabled();
});
