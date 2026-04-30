import { expect, test } from "vitest";

import { requireBillingReverification, requireSameOrigin } from "./billing-auth.js";

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

test("billing reverification fails loud when Clerk JWT lacks fva", async () => {
  const response = requireBillingReverification({
    canManageBilling: true,
    orgId: "org_123",
    orgRole: "org:admin",
    userId: "user_123",
  });

  expect(response?.status).toBe(500);
  await expect(response?.json()).resolves.toMatchObject({
    error: { code: "STEP_UP_MISCONFIGURED" },
  });
});

test("billing reverification returns Clerk-native shape for stale first factor", async () => {
  const response = requireBillingReverification({
    canManageBilling: true,
    fva: [11, -1],
    orgId: "org_123",
    orgRole: "org:admin",
    userId: "user_123",
  });

  expect(response?.status).toBe(403);
  await expect(response?.json()).resolves.toEqual({
    clerk_error: {
      type: "forbidden",
      reason: "reverification-error",
      metadata: {
        reverification: {
          level: "first_factor",
          afterMinutes: 10,
        },
      },
    },
  });
});

test("billing reverification accepts fresh first factor without requiring MFA", () => {
  expect(
    requireBillingReverification({
      canManageBilling: true,
      fva: [1, -1],
      orgId: "org_123",
      orgRole: "org:admin",
      userId: "user_123",
    }),
  ).toBeNull();
});
