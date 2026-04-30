import { expect, test } from "vitest";

import { requireSameOrigin } from "./billing-auth.js";

test("billing same-origin guard allows browser requests from the deployed host", () => {
  const request = new Request("https://console.prontiq.dev/api/billing/checkout", {
    headers: {
      host: "console.prontiq.dev",
      origin: "https://console.prontiq.dev",
    },
    method: "POST",
  });

  expect(requireSameOrigin(request)).toBeNull();
});

test("billing same-origin guard allows non-browser requests without an Origin header", () => {
  const request = new Request("https://console.prontiq.dev/api/billing/summary");

  expect(requireSameOrigin(request)).toBeNull();
});

test("billing same-origin guard rejects cross-origin mutation attempts", async () => {
  const request = new Request("https://console.prontiq.dev/api/billing/checkout", {
    headers: {
      host: "console.prontiq.dev",
      origin: "https://attacker.example",
    },
    method: "POST",
  });

  const response = requireSameOrigin(request);

  expect(response?.status).toBe(403);
  await expect(response?.json()).resolves.toMatchObject({
    error: { code: "BILLING_ORIGIN_CHECK_FAILED" },
  });
});
