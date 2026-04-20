import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import { vi } from "vitest";

vi.mock("@clerk/nextjs", () => ({
  SignIn: ({ children }: { children?: ReactNode }) => <div data-testid="clerk-sign-in">{children}</div>,
}));

import { SignInSurface } from "./sign-in-surface.js";

test("sign-in surface renders disabled fallback when Clerk is fully absent", () => {
  render(
    <SignInSurface
      missingKeys={["NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "CLERK_SECRET_KEY"]}
      mode="disabled"
    />,
  );

  expect(screen.getByText("Clerk disabled")).toBeInTheDocument();
  expect(screen.queryByTestId("clerk-sign-in")).not.toBeInTheDocument();
});

test("sign-in surface renders explicit configuration error when Clerk is partially configured", () => {
  render(<SignInSurface missingKeys={["CLERK_SECRET_KEY"]} mode="misconfigured" />);

  expect(screen.getByText("Clerk misconfigured")).toBeInTheDocument();
  expect(screen.getByText(/Missing Clerk key\(s\): CLERK_SECRET_KEY\./)).toBeInTheDocument();
  expect(screen.queryByTestId("clerk-sign-in")).not.toBeInTheDocument();
});

test("sign-in surface renders Clerk UI when both Clerk keys are present", () => {
  render(<SignInSurface missingKeys={[]} mode="enabled" />);

  expect(screen.getByTestId("clerk-sign-in")).toBeInTheDocument();
});
