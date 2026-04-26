import test from "node:test";
import assert from "node:assert/strict";
import { createBillingCronService } from "./billing-cron.js";
import { createMonthCloseService } from "./month-close.js";

function makeLogger() {
  const info: Array<{ message: string; context: unknown }> = [];
  return {
    info,
    logger: {
      error() {},
      info(message: string, context: unknown) {
        info.push({ message, context });
      },
      warn() {},
    },
  };
}

test("legacy Stripe billing cron disabled mode performs no dependency resolution", async () => {
  const logs = makeLogger();
  const service = createBillingCronService({
    legacyStripeRuntimeEnabled: false,
    logger: logs.logger,
  });

  const summary = await service.handleTick(new Date("2026-04-26T00:00:00.000Z"));

  assert.deepEqual(summary, {
    disabled: true,
    keysProcessed: 0,
    meterEventsSent: 0,
    negativeDeltas: 0,
    scopesSkipped: 0,
  });
  assert.equal(logs.info.length, 1);
  assert.match(logs.info[0]?.message ?? "", /legacy Stripe runtime is retired/);
});

test("legacy Stripe month-close disabled mode performs no dependency resolution", async () => {
  const logs = makeLogger();
  const service = createMonthCloseService({
    legacyStripeRuntimeEnabled: false,
    logger: logs.logger,
  });

  const summary = await service.handleTick(new Date("2026-04-26T00:00:00.000Z"));

  assert.deepEqual(summary, {
    closedScopes: 0,
    disabled: true,
    keysProcessed: 0,
    meterEventsSent: 0,
    negativeDeltas: 0,
    scopesSkipped: 0,
  });
  assert.equal(logs.info.length, 1);
  assert.match(logs.info[0]?.message ?? "", /legacy Stripe runtime is retired/);
});
