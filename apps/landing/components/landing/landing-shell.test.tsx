import { render, screen } from "@testing-library/react";

import { LandingShell } from "./landing-shell.js";

test("landing shell renders the token-aware site frame", () => {
  render(<LandingShell />);

  expect(screen.getByText("prontiq.dev")).toBeInTheDocument();
  expect(
    screen.getByRole("heading", { name: "Australian address validation" }),
  ).toBeInTheDocument();
  expect(screen.getByText("Shell baseline")).toBeInTheDocument();
});
