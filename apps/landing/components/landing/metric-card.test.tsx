import { render, screen } from "@testing-library/react";

import { MetricCard } from "./metric-card.js";

test("metric card renders the slash-prefixed heading and meta", () => {
  render(
    <MetricCard heading="endpoint usage" meta="6 live endpoints">
      <p>body</p>
    </MetricCard>,
  );

  expect(screen.getByText("endpoint usage")).toBeInTheDocument();
  expect(screen.getByText("6 live endpoints")).toBeInTheDocument();
  expect(screen.getByText("/")).toBeInTheDocument();
  expect(screen.getByText("body")).toBeInTheDocument();
});

test("metric card omits the meta cell when none is provided", () => {
  render(
    <MetricCard heading="health">
      <p>body</p>
    </MetricCard>,
  );

  expect(screen.getByText("health")).toBeInTheDocument();
  expect(screen.queryByText("6 live endpoints")).not.toBeInTheDocument();
});
