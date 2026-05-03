import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyTransition,
  classifyTransitionFromUnknown,
  generatePreviewMessage,
  isTransitionError,
  type CappedPlan,
  type CurrentState,
  type FreePlan,
  type PaygPlan,
  type TransitionOutcome,
  type TransitionResult,
} from "./billing-transition-engine.js";
import * as exportedEngine from "@prontiq/shared/billing-transition-engine";

const free: FreePlan = {
  code: "free",
  archetype: "FREE",
  priceCents: 0,
  creditAllowance: 100,
};

const cappedSmall: CappedPlan = {
  code: "capped-small",
  archetype: "CAPPED",
  priceCents: 2_000,
  creditAllowance: 1_000,
};

const cappedLarge: CappedPlan = {
  code: "capped-large",
  archetype: "CAPPED",
  priceCents: 5_000,
  creditAllowance: 3_000,
};

const payg: PaygPlan = {
  code: "payg",
  archetype: "PAYG",
  priceCents: 0,
  creditAllowance: 0,
};

const periodEnd = new Date("2026-06-01T00:00:00.000Z");

function state(overrides: Partial<CurrentState> = {}): CurrentState {
  return {
    plan: free,
    creditsRemaining: 25,
    periodEnd,
    hasPaymentMethod: true,
    hasScheduledChange: false,
    accruedPaygUsageCents: 0,
    ...overrides,
  };
}

function ok(outcome: TransitionOutcome): TransitionResult {
  assert.equal(isTransitionError(outcome), false, JSON.stringify(outcome));
  const result = outcome as TransitionResult;
  assert.equal(result.refundCents, 0);
  assert.equal(result.keysRevoked, false);
  assert.ok(Array.isArray(result.lagoActions));
  assert.ok(result.lagoActions.length > 0);
  assert.equal("lagoAction" in result, false);
  assert.equal("totalCreditsAfter" in result, false);
  assert.equal(typeof result.fromPlanCode, "string");
  assert.equal(typeof result.toPlanCode, "string");
  assert.equal(typeof result.creditsAvailableNow, "number");
  assert.equal(typeof result.creditsAvailableAfterEffectiveChange, "number");
  return result;
}

function expectError(outcome: TransitionOutcome, errorCode: string): void {
  assert.equal(isTransitionError(outcome), true, JSON.stringify(outcome));
  assert.equal((outcome as { error: string }).error, errorCode);
}

test("billing transition engine exposes immutable ordered result contract", () => {
  const result = ok(
    classifyTransition(state({ plan: free, creditsRemaining: 40 }), {
      action: "change_plan",
      targetPlan: cappedSmall,
    }),
  );

  assert.equal(result.tableRow, 1);
  assert.equal(result.timing, "NOW");
  assert.equal(result.effectiveAt.kind, "NOW");
  assert.equal(result.chargeTodayCents, 2_000);
  assert.equal(result.creditsCarried, 40);
  assert.equal(result.creditsAvailableNow, 1_040);
  assert.deepEqual(result.lagoActions, [
    "TERMINATE_CURRENT_SUBSCRIPTION",
    "CREATE_SUBSCRIPTION_NOW",
  ]);
});

test("billing transition engine package export exposes the immutable ordered contract", () => {
  const result = ok(
    exportedEngine.classifyTransition(state({ plan: free, creditsRemaining: 40 }), {
      action: "change_plan",
      targetPlan: cappedSmall,
    }),
  );

  assert.equal(result.tableRow, 1);
  assert.deepEqual(result.lagoActions, [
    "TERMINATE_CURRENT_SUBSCRIPTION",
    "CREATE_SUBSCRIPTION_NOW",
  ]);
});

test("billing transition engine pins the canonical 11-row matrix", () => {
  assert.equal(
    ok(
      classifyTransition(state({ plan: cappedSmall, creditsRemaining: 300, hasScheduledChange: true }), {
        action: "change_plan",
        targetPlan: cappedLarge,
      }),
    ).tableRow,
    2,
  );
  assert.equal(
    ok(classifyTransition(state({ plan: cappedLarge }), { action: "change_plan", targetPlan: cappedSmall }))
      .tableRow,
    3,
  );
  assert.equal(
    ok(classifyTransition(state({ plan: cappedSmall }), { action: "change_plan", targetPlan: free }))
      .tableRow,
    4,
  );
  assert.equal(ok(classifyTransition(state({ plan: free }), { action: "change_plan", targetPlan: payg })).tableRow, 5);
  assert.equal(
    ok(classifyTransition(state({ plan: cappedSmall }), { action: "change_plan", targetPlan: payg })).tableRow,
    6,
  );
  assert.equal(
    ok(
      classifyTransition(state({ plan: payg, accruedPaygUsageCents: 900 }), {
        action: "change_plan",
        targetPlan: cappedSmall,
      }),
    ).tableRow,
    7,
  );
  assert.equal(
    ok(
      classifyTransition(state({ plan: payg, accruedPaygUsageCents: 450, hasPaymentMethod: false }), {
        action: "change_plan",
        targetPlan: free,
      }),
    ).tableRow,
    8,
  );
  assert.equal(ok(classifyTransition(state({ plan: cappedSmall }), { action: "cancel", freePlan: free })).tableRow, 9);
  assert.equal(
    ok(
      classifyTransition(state({ plan: payg, accruedPaygUsageCents: 1_111 }), {
        action: "cancel",
        freePlan: free,
      }),
    ).tableRow,
    10,
  );
  assert.equal(
    ok(classifyTransition(state({ plan: cappedSmall, hasScheduledChange: true }), { action: "cancel_scheduled_change" }))
      .tableRow,
    11,
  );
});

test("billing transition engine rejects unsupported or unsafe policy states", () => {
  expectError(
    classifyTransition(state({ plan: cappedSmall }), {
      action: "change_plan",
      targetPlan: {
        code: "strange-plan",
        archetype: "CAPPED",
        priceCents: 1_500,
        creditAllowance: 2_000,
      },
    }),
    "NON_MONOTONIC_PLAN_CHANGE",
  );
  expectError(
    classifyTransition(state({ plan: free, hasPaymentMethod: false }), {
      action: "change_plan",
      targetPlan: payg,
    }),
    "PAYMENT_METHOD_REQUIRED",
  );
  expectError(
    classifyTransitionFromUnknown(state({ creditsRemaining: -1 }), {
      action: "change_plan",
      targetPlan: cappedSmall,
    }),
    "INVALID_CURRENT_STATE",
  );
});

test("billing transition preview copy preserves no-refund and key-preservation policy", () => {
  const upgrade = ok(
    classifyTransition(state({ plan: cappedSmall, creditsRemaining: 88 }), {
      action: "change_plan",
      targetPlan: payg,
    }),
  );
  assert.match(
    generatePreviewMessage(upgrade, { targetPlanName: "PAYG", periodEndLabel: "1 June 2026" }),
    /No refund/,
  );

  const cancel = ok(
    classifyTransition(state({ plan: cappedSmall, creditsRemaining: 501 }), {
      action: "cancel",
      freePlan: free,
    }),
  );
  assert.match(
    generatePreviewMessage(cancel, { targetPlanName: "Free", periodEndLabel: "1 June 2026" }),
    /API keys will keep working/,
  );
});
