import { render, screen } from "@testing-library/react";
import { vi } from "vitest";

import { ConsoleShell, getConsoleNavTargets } from "./console-shell.js";

const routeState = vi.hoisted(() => ({
  pathname: "/",
}));

vi.mock("next/navigation", () => ({
  usePathname: () => routeState.pathname,
}));

beforeEach(() => {
  routeState.pathname = "/";
});

test("console shell renders the prototype-derived structure", () => {
  render(
    <ConsoleShell clerkEnabled={false}>
      <section id="overview">Overview content</section>
      <section id="usage">Usage content</section>
      <section id="billing">Billing content</section>
      <section id="playground">Playground content</section>
      <section id="danger-zone">Danger content</section>
    </ConsoleShell>,
  );

  expect(screen.getByText("Authenticated developer shell")).toBeInTheDocument();
  expect(screen.getByText("Overview content")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /keys/i })).toHaveAttribute("href", "/keys");
});

test("dashboard anchors route back to the dashboard when rendered from keys page", () => {
  routeState.pathname = "/keys";

  render(<ConsoleShell clerkEnabled={false}>Keys content</ConsoleShell>);

  expect(screen.getAllByRole("link", { name: /overview/i })[0]).toHaveAttribute("href", "/#overview");
  expect(screen.getAllByRole("link", { name: /usage/i })[0]).toHaveAttribute("href", "/#usage");
  expect(screen.getAllByRole("link", { name: /billing/i })[0]).toHaveAttribute("href", "/#billing");
  expect(screen.getAllByRole("link", { name: /playground/i })[0]).toHaveAttribute("href", "/#playground");
  expect(screen.getAllByRole("link", { name: /danger zone/i })[0]).toHaveAttribute("href", "/#danger-zone");
});

test("every visible nav target resolves to an existing in-page section", () => {
  const { container } = render(
    <ConsoleShell clerkEnabled={false}>
      <section id="overview">Overview content</section>
      <section id="usage">Usage content</section>
      <section id="billing">Billing content</section>
      <section id="playground">Playground content</section>
      <section id="danger-zone">Danger content</section>
    </ConsoleShell>,
  );

  for (const target of getConsoleNavTargets()) {
    expect(container.querySelector(`#${target}`)).not.toBeNull();
  }
});
