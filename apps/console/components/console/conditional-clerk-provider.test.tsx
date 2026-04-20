import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import { vi } from "vitest";

vi.mock("@clerk/nextjs", () => ({
  ClerkProvider: ({ children }: { children: ReactNode }) => <div data-testid="clerk-provider">{children}</div>,
}));

import { ConditionalClerkProvider } from "./conditional-clerk-provider.js";

test("conditional clerk provider bypasses Clerk when auth env is disabled", () => {
  render(
    <ConditionalClerkProvider clerkEnabled={false}>
      <div>child content</div>
    </ConditionalClerkProvider>,
  );

  expect(screen.getByText("child content")).toBeInTheDocument();
  expect(screen.queryByTestId("clerk-provider")).not.toBeInTheDocument();
});

test("conditional clerk provider renders ClerkProvider when auth env is enabled", () => {
  render(
    <ConditionalClerkProvider clerkEnabled publishableKey="pk_test_123">
      <div>child content</div>
    </ConditionalClerkProvider>,
  );

  expect(screen.getByTestId("clerk-provider")).toBeInTheDocument();
});
