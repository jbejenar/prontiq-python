import test from "node:test";
import assert from "node:assert/strict";
import { isLagoPlanVisible } from "./lago-plans.js";

test("Lago plan visibility requires prontiq_console_visible=true", () => {
  assert.equal(isLagoPlanVisible({ catalogEnv: "dev", metadata: {} }), false);
  assert.equal(
    isLagoPlanVisible({ catalogEnv: "dev", metadata: { prontiq_console_visible: "true" } }),
    true,
  );
  assert.equal(
    isLagoPlanVisible({ catalogEnv: "dev", metadata: { prontiq_console_visible: true } }),
    true,
  );
});

test("Lago plan visibility excludes test and internal plans", () => {
  assert.equal(
    isLagoPlanVisible({
      catalogEnv: "dev",
      metadata: { prontiq_console_visible: true, prontiq_test: true },
    }),
    false,
  );
  assert.equal(
    isLagoPlanVisible({
      catalogEnv: "dev",
      metadata: { prontiq_console_visible: true, prontiq_internal: "true" },
    }),
    false,
  );
});

test("Lago plan visibility respects environment metadata", () => {
  assert.equal(
    isLagoPlanVisible({
      catalogEnv: "dev",
      metadata: { prontiq_console_visible: true, prontiq_environment: "dev" },
    }),
    true,
  );
  assert.equal(
    isLagoPlanVisible({
      catalogEnv: "prod",
      metadata: { prontiq_console_visible: true, prontiq_environment: "dev" },
    }),
    false,
  );
  assert.equal(
    isLagoPlanVisible({
      catalogEnv: "prod",
      metadata: { prontiq_console_visible: true, prontiq_environment: "all" },
    }),
    true,
  );
  assert.equal(
    isLagoPlanVisible({
      catalogEnv: "all",
      metadata: { prontiq_console_visible: true, prontiq_environment: "prod" },
    }),
    true,
  );
});
