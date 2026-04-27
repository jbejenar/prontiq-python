import { render, screen } from "@testing-library/react";

import { EndpointsTable } from "./endpoints-table.js";

const fixture = [
  { method: "GET" as const, path: "/v1/address/autocomplete", cost: 1, p95: 24 },
  { method: "GET" as const, path: "/v1/address/enrich", cost: 3, p95: 58 },
];

test("EndpointsTable renders one row per endpoint with verb, path, cost, and p95", () => {
  render(<EndpointsTable endpoints={fixture} />);

  expect(screen.getByText("/v1/address/autocomplete")).toBeInTheDocument();
  expect(screen.getByText("/v1/address/enrich")).toBeInTheDocument();
  expect(screen.getAllByText("GET")).toHaveLength(2);
  expect(screen.getByText("1")).toBeInTheDocument();
  expect(screen.getByText("3")).toBeInTheDocument();
  expect(screen.getByText("credit")).toBeInTheDocument();
  expect(screen.getByText("credits")).toBeInTheDocument();
  expect(screen.getByText("24")).toBeInTheDocument();
  expect(screen.getByText("58")).toBeInTheDocument();
});

test("EndpointsTable shows an empty-state when no endpoints are provided", () => {
  render(<EndpointsTable endpoints={[]} />);
  expect(screen.getByText(/no endpoints configured/i)).toBeInTheDocument();
});
