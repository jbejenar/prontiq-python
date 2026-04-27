import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import { vi } from "vitest";

vi.mock("@clerk/nextjs", () => ({
  ClerkProvider: ({ children }: { children: ReactNode }) => (
    <div data-testid="clerk-provider">{children}</div>
  ),
  SignUpButton: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("../../lib/account-url.js", () => ({
  useLandingAccountUrl: () => ({
    accountUrl: "https://console.prontiq.dev",
    isResolved: true,
  }),
}));

import { TerminalTopbar } from "./terminal-topbar.js";

test("TerminalTopbar renders brand, version chip, status pills, and CTA", () => {
  render(
    <TerminalTopbar
      brandLabel="prontiq"
      ctaLabel="Get Started Free"
      clerkMode="enabled"
      domainLabel="prontiq.dev"
      links={[{ href: "#pricing", label: "Pricing" }]}
      topbar={{
        versionLabel: "v0.8.2",
        statusPill: { label: "live · ap-southeast-2", tone: "ok" },
        secondaryPill: { label: "p95 38ms · within sla", tone: "neutral" },
      }}
    />,
  );

  expect(screen.getByText("prontiq")).toBeInTheDocument();
  expect(screen.getByText("v0.8.2")).toBeInTheDocument();
  expect(screen.getByText("prontiq.dev")).toBeInTheDocument();
  expect(screen.getByText("live · ap-southeast-2")).toBeInTheDocument();
  expect(screen.getByText("p95 38ms · within sla")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Pricing" })).toHaveAttribute("href", "#pricing");
  expect(screen.getByRole("button", { name: "Get Started Free" })).toBeInTheDocument();
});

test("TerminalTopbar omits status pills and version chip when no topbar is provided", () => {
  render(
    <TerminalTopbar
      brandLabel="prontiq"
      ctaLabel="Get Started Free"
      clerkMode="enabled"
      links={[]}
    />,
  );

  expect(screen.getByText("prontiq")).toBeInTheDocument();
  expect(screen.queryByText("v0.8.2")).not.toBeInTheDocument();
  expect(screen.queryByText("live · ap-southeast-2")).not.toBeInTheDocument();
});
