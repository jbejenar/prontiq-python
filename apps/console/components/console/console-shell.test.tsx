import { render, screen } from "@testing-library/react";

import { ConsoleShell, getConsoleNavTargets } from "./console-shell.js";

test("console shell renders the prototype-derived structure", () => {
  render(<ConsoleShell clerkEnabled={false} />);

  expect(screen.getByText("Authenticated developer shell")).toBeInTheDocument();
  expect(screen.getByText("Quickstart shape")).toBeInTheDocument();
  expect(screen.getByText("Protected destructive actions")).toBeInTheDocument();
});

test("every visible nav target resolves to an existing in-page section", () => {
  const { container } = render(<ConsoleShell clerkEnabled={false} />);

  for (const target of getConsoleNavTargets()) {
    expect(container.querySelector(`#${target}`)).not.toBeNull();
  }
});
