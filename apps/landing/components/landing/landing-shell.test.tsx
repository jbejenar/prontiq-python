import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import { afterEach } from "vitest";
import { vi } from "vitest";

vi.mock("@clerk/nextjs", () => ({
  ClerkProvider: ({ children }: { children: ReactNode }) => (
    <div data-testid="clerk-provider">{children}</div>
  ),
  SignUpButton: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("@prontiq/web-component", () => ({}));
vi.mock("../../lib/account-url.js", () => ({
  useLandingAccountUrl: () => ({
    accountUrl: "https://prontiq-web-console-jqmzq3cip-jbejenar-2089s-projects.vercel.app",
    isResolved: true,
  }),
}));

import { LandingShell } from "./landing-shell.js";

afterEach(() => {
  vi.resetModules();
});

test("landing shell renders the real landing sections", () => {
  render(<LandingShell />);

  expect(screen.getByRole("heading", { name: /One address endpoint/i })).toBeInTheDocument();
  expect(
    screen.getByRole("heading", { name: /Type an address\. Watch it resolve\./i }),
  ).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: /Usage-based\. No seats\./i })).toBeInTheDocument();
  expect(screen.getByText("Try it")).toBeInTheDocument();
  expect(screen.getByText("prontiq.dev")).toBeInTheDocument();
  expect(screen.getByText("Stripe pricing unavailable")).toBeInTheDocument();
  expect(screen.getByText("Paid pricing")).toBeInTheDocument();
  expect(screen.queryByText("Starter · Growth")).not.toBeInTheDocument();
  expect(screen.getAllByText("10,000 credits per month")).toHaveLength(1);
  expect(screen.getByRole("link", { name: "Console" })).toHaveAttribute(
    "href",
    "https://prontiq-web-console-jqmzq3cip-jbejenar-2089s-projects.vercel.app",
  );
});

test("landing shell does not render a live console link before the account URL resolves", async () => {
  vi.resetModules();
  vi.doMock("@clerk/nextjs", () => ({
    ClerkProvider: ({ children }: { children: ReactNode }) => (
      <div data-testid="clerk-provider">{children}</div>
    ),
    SignUpButton: ({ children }: { children: ReactNode }) => <>{children}</>,
  }));
  vi.doMock("@prontiq/web-component", () => ({}));
  vi.doMock("../../lib/account-url.js", () => ({
    useLandingAccountUrl: () => ({
      accountUrl: null,
      isResolved: false,
    }),
  }));

  const { LandingShell: UnresolvedLandingShell } = await import("./landing-shell.js");
  render(<UnresolvedLandingShell />);

  expect(screen.queryByRole("link", { name: "Console" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Console" })).toBeDisabled();
});

test("landing shell reports Clerk as configured when the publishable key is present", async () => {
  vi.resetModules();
  vi.doMock("@clerk/nextjs", () => ({
    ClerkProvider: ({ children }: { children: ReactNode }) => (
      <div data-testid="clerk-provider">{children}</div>
    ),
    SignUpButton: ({ children }: { children: ReactNode }) => <>{children}</>,
  }));
  vi.doMock("@prontiq/web-component", () => ({}));
  vi.doMock("../../lib/env.js", () => ({
    env: {
      NEXT_PUBLIC_API_URL: "https://api.prontiq.dev",
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_123",
      NEXT_PUBLIC_STRIPE_PRICING_TABLE_ID: undefined,
      NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: undefined,
    },
  }));
  vi.doMock("../../lib/server-env.js", () => ({
    serverEnv: {
      PRONTIQ_ALLOW_KEYLESS_CLERK: undefined,
      PRONTIQ_LANDING_DEMO_API_KEY: "demo_key",
    },
  }));

  const { LandingShell: ConfiguredLandingShell } = await import("./landing-shell.js");
  render(<ConfiguredLandingShell />);

  expect(screen.getByText("Landing signup is configured.")).toBeInTheDocument();
});
