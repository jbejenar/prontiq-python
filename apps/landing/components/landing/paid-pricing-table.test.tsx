import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, vi } from "vitest";

import { PaidPricingTable } from "./paid-pricing-table.js";

afterEach(() => {
  cleanup();
  window.__prontiqStripePricingTableScript = undefined;
  vi.restoreAllMocks();
});

test("paid pricing table renders a deterministic fallback when env is absent", () => {
  render(<PaidPricingTable />);

  expect(screen.getByText("Stripe pricing unavailable")).toBeInTheDocument();
});

test("paid pricing table renders the Stripe custom element when env is present", () => {
  const { container } = render(
    <PaidPricingTable pricingTableId="prctbl_123" publishableKey="pk_test_123" />,
  );

  expect(container.querySelector("stripe-pricing-table")).not.toBeNull();
});

test("paid pricing table retries after an initial Stripe script load failure", async () => {
  const scripts: HTMLScriptElement[] = [];
  const appendChild = vi.spyOn(document.head, "appendChild").mockImplementation((node) => {
    const script = node as HTMLScriptElement;
    scripts.push(script);
    return node;
  });

  const firstRender = render(
    <PaidPricingTable pricingTableId="prctbl_123" publishableKey="pk_test_123" />,
  );

  await waitFor(() => {
    expect(appendChild).toHaveBeenCalledTimes(1);
  });

  scripts[0]?.onerror?.(new Event("error"));
  await Promise.resolve();
  firstRender.unmount();

  render(<PaidPricingTable pricingTableId="prctbl_123" publishableKey="pk_test_123" />);

  await waitFor(() => {
    expect(appendChild).toHaveBeenCalledTimes(2);
  });
});
