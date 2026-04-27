import { render, screen } from "@testing-library/react";

import { HealthPanel } from "./health-panel.js";

test("HealthPanel renders one definition row per entry", () => {
  render(
    <HealthPanel
      rows={[
        { label: "API host", value: "https://api.prontiq.dev" },
        { label: "Billing", value: "Lago-backed account billing." },
      ]}
    />,
  );

  expect(screen.getByText("API host")).toBeInTheDocument();
  expect(screen.getByText("https://api.prontiq.dev")).toBeInTheDocument();
  expect(screen.getByText("Billing")).toBeInTheDocument();
  expect(screen.getByText("Lago-backed account billing.")).toBeInTheDocument();
});

test("HealthPanel renders an optional caption beneath the value", () => {
  render(
    <HealthPanel rows={[{ label: "API host", value: "value", caption: "no live numerics" }]} />,
  );

  expect(screen.getByText("no live numerics")).toBeInTheDocument();
});
