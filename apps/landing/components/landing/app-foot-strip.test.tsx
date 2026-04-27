import { render, screen } from "@testing-library/react";

import { AppFootStrip } from "./app-foot-strip.js";

test("AppFootStrip renders each item with separators between them", () => {
  render(
    <AppFootStrip
      items={["prontiq · v0.8.2", "region ap-southeast-2 · sydney", "p95 38ms"]}
    />,
  );

  expect(screen.getByText("prontiq · v0.8.2")).toBeInTheDocument();
  expect(screen.getByText("region ap-southeast-2 · sydney")).toBeInTheDocument();
  expect(screen.getByText("p95 38ms")).toBeInTheDocument();

  // Two separators between three items.
  expect(screen.getAllByText("·")).toHaveLength(2);
});

test("AppFootStrip renders nothing when given no items and no trailing slot", () => {
  const { container } = render(<AppFootStrip items={[]} />);
  expect(container).toBeEmptyDOMElement();
});
