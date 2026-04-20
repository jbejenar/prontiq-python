import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import { waitFor } from "@testing-library/react";
import { vi } from "vitest";

const signUpButtonMock = vi.fn(({ children }: { children: ReactNode }) => <div data-testid="clerk-sign-up">{children}</div>);

vi.mock("@clerk/nextjs", () => ({
  SignUpButton: (props: { children: ReactNode }) => signUpButtonMock(props),
}));

vi.mock("../../lib/account-url.js", () => ({
  useLandingAccountUrl: () => ({
    accountUrl: "https://prontiq-web-console-jqmzq3cip-jbejenar-2089s-projects.vercel.app",
    isResolved: true,
  }),
}));

import { SignupCTAButton } from "./signup-cta-button.js";

test("signup cta wraps its child in Clerk when landing auth is enabled", () => {
  render(
    <SignupCTAButton mode="enabled">
      Get started free
    </SignupCTAButton>,
  );

  expect(screen.getByTestId("clerk-sign-up")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Get started free" })).toBeInTheDocument();
  return waitFor(() =>
    expect(signUpButtonMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        fallbackRedirectUrl: "https://prontiq-web-console-jqmzq3cip-jbejenar-2089s-projects.vercel.app",
        forceRedirectUrl: "https://prontiq-web-console-jqmzq3cip-jbejenar-2089s-projects.vercel.app",
        mode: "modal",
        signInFallbackRedirectUrl: "https://prontiq-web-console-jqmzq3cip-jbejenar-2089s-projects.vercel.app",
      }),
    ),
  );
});

test("signup cta disables itself when landing auth is in helper-managed keyless mode", () => {
  render(
    <SignupCTAButton mode="disabled">
      Get started free
    </SignupCTAButton>,
  );

  expect(screen.queryByTestId("clerk-sign-up")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Get started free" })).toBeDisabled();
});

test("signup cta stays disabled while the account destination is unresolved", async () => {
  vi.resetModules();
  vi.doMock("@clerk/nextjs", () => ({
    SignUpButton: (props: { children: ReactNode }) => signUpButtonMock(props),
  }));
  vi.doMock("../../lib/account-url.js", () => ({
    useLandingAccountUrl: () => ({
      accountUrl: null,
      isResolved: false,
    }),
  }));

  const { SignupCTAButton: UnresolvedSignupCTAButton } = await import("./signup-cta-button.js");
  render(
    <UnresolvedSignupCTAButton mode="enabled">
      Get started free
    </UnresolvedSignupCTAButton>,
  );

  expect(screen.queryByTestId("clerk-sign-up")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Get started free" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Get started free" })).toHaveAttribute(
    "title",
    "Landing signup is resolving the console destination.",
  );
});
