import { render, screen } from "@testing-library/react";

import { KpiRow } from "./kpi-row.js";

const fixture = [
  {
    label: "endpoints",
    value: "6",
    unit: "live",
    delta: "+1 vs q3",
    sparkline: [21, 19, 20, 17, 15, 16, 13, 11, 9, 8, 6, 5, 4],
  },
  {
    label: "p95",
    value: "38",
    unit: "ms",
    delta: "within 50ms target",
    sparkline: [11, 13, 10, 14, 12, 13, 11, 14, 12, 13, 11, 10, 12],
  },
];

test("KpiRow renders one tile per kpi with label, value, unit, and delta", () => {
  render(<KpiRow kpis={fixture} />);

  expect(screen.getByText("endpoints")).toBeInTheDocument();
  expect(screen.getByText("6")).toBeInTheDocument();
  expect(screen.getByText("live")).toBeInTheDocument();
  expect(screen.getByText("+1 vs q3")).toBeInTheDocument();

  expect(screen.getByText("p95")).toBeInTheDocument();
  expect(screen.getByText("38")).toBeInTheDocument();
  expect(screen.getByText("ms")).toBeInTheDocument();
  expect(screen.getByText("within 50ms target")).toBeInTheDocument();
});

test("KpiRow renders a sparkline polyline with one point per data value", () => {
  const { container } = render(<KpiRow kpis={fixture} />);

  const polylines = container.querySelectorAll("svg polyline");
  expect(polylines).toHaveLength(2);

  const points = polylines[0]?.getAttribute("points")?.split(" ") ?? [];
  expect(points).toHaveLength(13);
  expect(points[0]).toMatch(/^0\.00,/);
});

test("KpiRow renders nothing when kpis is empty", () => {
  const { container } = render(<KpiRow kpis={[]} />);
  expect(container).toBeEmptyDOMElement();
});
