import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import { vi } from "vitest";

vi.mock("@clerk/nextjs", () => ({
  SignUpButton: ({ children }: { children: ReactNode }) => <div data-testid="clerk-sign-up">{children}</div>,
}));

import { SignupCTAButton } from "./signup-cta-button.js";

test("signup cta wraps its child in Clerk when landing auth is enabled", () => {
  render(<SignupCTAButton mode="enabled">Get started free</SignupCTAButton>);

  expect(screen.getByTestId("clerk-sign-up")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Get started free" })).toBeInTheDocument();
});

test("signup cta disables itself when landing auth is in helper-managed keyless mode", () => {
  render(<SignupCTAButton mode="disabled">Get started free</SignupCTAButton>);

  expect(screen.queryByTestId("clerk-sign-up")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Get started free" })).toBeDisabled();
});
