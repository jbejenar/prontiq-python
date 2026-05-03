import { expect, test } from "vitest";

import { getPlaygroundDemoStatusFromConfig } from "./server-env.js";

test("playground demo status is reference-only when the demo key is missing", () => {
  expect(getPlaygroundDemoStatusFromConfig({})).toMatchObject({
    execution: "reference_only",
    reasonCode: "DEMO_KEY_NOT_CONFIGURED",
  });
});

test("playground demo status is reference-only until backend policy is confirmed", () => {
  expect(getPlaygroundDemoStatusFromConfig({ demoApiKey: "demo_key" })).toMatchObject({
    execution: "reference_only",
    reasonCode: "DEMO_BACKEND_POLICY_NOT_CONFIRMED",
  });
});

test("playground demo status is enabled only when key and backend policy are configured", () => {
  expect(
    getPlaygroundDemoStatusFromConfig({
      demoApiKey: "demo_key",
      demoBackendPolicyConfirmed: "1",
    }),
  ).toEqual({ execution: "enabled" });
});
