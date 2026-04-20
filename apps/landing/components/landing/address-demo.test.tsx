import { act, render, screen } from "@testing-library/react";
import { vi } from "vitest";

vi.mock("@prontiq/web-component", () => ({}));

import { AddressDemo } from "./address-demo.js";

test("address demo renders the custom element host and empty-state payload area", () => {
  const { container } = render(
    <AddressDemo
      autocompleteEndpoint="/api/demo/address/autocomplete"
      heading="Type an address. Watch it resolve."
      inputLabel="Live demo"
      kicker="Try it"
      limit={5}
      placeholder="Try: 9 endeavour"
      resultHeading="Selected suggestion"
      stateFilter="VIC"
    />,
  );

  expect(screen.getByText("Live demo")).toBeInTheDocument();
  expect(screen.getByText("Try it")).toBeInTheDocument();
  expect(container.querySelector("prontiq-address")).not.toBeNull();
  expect(screen.getByText(/Choose a suggestion to inspect the structured payload/i)).toBeInTheDocument();
});

test("address demo clears the selected payload when the widget query changes", () => {
  const { container } = render(
    <AddressDemo
      autocompleteEndpoint="/api/demo/address/autocomplete"
      heading="Type an address. Watch it resolve."
      inputLabel="Live demo"
      kicker="Try it"
      limit={5}
      placeholder="Try: 9 endeavour"
      resultHeading="Selected suggestion"
      stateFilter="VIC"
    />,
  );

  const host = container.querySelector("prontiq-address");
  expect(host).not.toBeNull();

  act(() => {
    host?.dispatchEvent(
      new CustomEvent("select", {
        bubbles: true,
        composed: true,
        detail: {
          addressLabel: "9 Endeavour Street",
          id: "addr_123",
          localityName: "Docklands",
          postcode: "3008",
          state: "VIC",
        },
      }),
    );
  });

  expect(screen.getByText(/"id": "addr_123"/)).toBeInTheDocument();

  act(() => {
    host?.dispatchEvent(
      new CustomEvent("querychange", {
        bubbles: true,
        composed: true,
        detail: {
          query: "9 endea",
        },
      }),
    );
  });

  expect(screen.getByText(/Choose a suggestion to inspect the structured payload/i)).toBeInTheDocument();
});
