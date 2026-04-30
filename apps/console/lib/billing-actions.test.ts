import { expect, test, vi } from "vitest";

import {
  buildBillingActionId,
  buildBillingActionRequestHash,
  DynamoBillingActionStore,
  type BillingActionInput,
  type BillingActionRecord,
} from "./billing-actions.js";

interface CommandLike {
  constructor: { name: string };
  input?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function inputOf(command: unknown) {
  return isRecord(command) && "input" in command ? command.input : undefined;
}

function baseInput(overrides: Partial<BillingActionInput> = {}): BillingActionInput {
  return {
    actorUserId: "user_123",
    externalSubscriptionId: "lago_sub_org_123",
    idempotencyKey: "idem_123",
    orgId: "org_123",
    targetPlanCode: "starter",
    ...overrides,
  };
}

function actionRecord(input: BillingActionInput = baseInput()): BillingActionRecord {
  return {
    actionId: buildBillingActionId(input),
    actorUserId: input.actorUserId,
    attemptToken: "attempt_123",
    createdAt: "2026-04-30T00:00:00.000Z",
    externalSubscriptionId: input.externalSubscriptionId,
    idempotencyKeyHash: "idempotency_hash",
    leaseExpiresAt: Date.parse("2026-04-30T00:01:00.000Z"),
    orgId: input.orgId,
    requestHash: buildBillingActionRequestHash(input),
    route: "billing.plan-change",
    status: "processing",
    targetPlanCode: input.targetPlanCode,
    ttl: 1_809_000_000,
    updatedAt: "2026-04-30T00:00:00.000Z",
  };
}

test("billing action store claims a new action and writes an org lock transactionally", async () => {
  const commands: CommandLike[] = [];
  const send = vi.fn(async (command: CommandLike) => {
    commands.push(command);
    if (command.constructor.name === "GetCommand") return {};
    if (command.constructor.name === "TransactWriteCommand") return {};
    throw new Error(`Unexpected command ${command.constructor.name}`);
  });
  const store = new DynamoBillingActionStore({
    ddb: { send } as never,
    now: () => new Date("2026-04-30T00:00:00.000Z"),
    tableName: "billing-actions-test",
  });

  await expect(store.claim(baseInput())).resolves.toMatchObject({ kind: "claimed" });

  const transaction = commands.find((command) => command.constructor.name === "TransactWriteCommand");
  expect(inputOf(transaction)).toMatchObject({
    TransactItems: [
      { Put: { ConditionExpression: "attribute_not_exists(actionId)" } },
      {
        Put: {
          ConditionExpression: "attribute_not_exists(actionId) OR leaseExpiresAt < :nowMs",
          Item: {
            actionId: "LOCK#billing.plan-change#org_123",
            lockOwnerAttemptToken: expect.any(String),
            lockOwnerActionId: buildBillingActionId(baseInput()),
          },
        },
      },
    ],
  });
});

test("billing action store treats reused idempotency keys with different bodies as conflicts", async () => {
  const original = baseInput({ targetPlanCode: "starter" });
  const replayAttempt = baseInput({ targetPlanCode: "payg_aud" });
  const send = vi.fn(async (command: CommandLike) => {
    if (command.constructor.name === "GetCommand") return { Item: actionRecord(original) };
    throw new Error(`Unexpected command ${command.constructor.name}`);
  });
  const store = new DynamoBillingActionStore({
    ddb: { send } as never,
    tableName: "billing-actions-test",
  });

  await expect(store.inspect(replayAttempt)).resolves.toEqual({ kind: "conflict" });
  await expect(store.claim(replayAttempt)).resolves.toEqual({ kind: "conflict" });
});

test("billing action store reacquires the org lock when retrying retryable actions", async () => {
  const retryable = { ...actionRecord(), status: "failed_retryable" as const };
  const commands: CommandLike[] = [];
  const send = vi.fn(async (command: CommandLike) => {
    commands.push(command);
    if (command.constructor.name === "GetCommand") return { Item: retryable };
    if (command.constructor.name === "TransactWriteCommand") return {};
    throw new Error(`Unexpected command ${command.constructor.name}`);
  });
  const store = new DynamoBillingActionStore({
    ddb: { send } as never,
    now: () => new Date("2026-04-30T00:02:00.000Z"),
    tableName: "billing-actions-test",
  });

  await expect(store.claim(baseInput())).resolves.toMatchObject({ kind: "claimed" });

  const transaction = commands.find((command) => command.constructor.name === "TransactWriteCommand");
  expect(inputOf(transaction)).toMatchObject({
    TransactItems: [
      {
        Update: {
          ConditionExpression:
            "#requestHash = :requestHash AND (#status = :retryable OR (#status = :processing AND #leaseExpiresAt < :nowMs))",
        },
      },
      {
        Put: {
          ConditionExpression:
            "attribute_not_exists(actionId) OR leaseExpiresAt < :nowMs OR lockOwnerActionId = :ownerActionId",
          Item: {
            actionId: "LOCK#billing.plan-change#org_123",
            lockOwnerAttemptToken: expect.any(String),
            lockOwnerActionId: retryable.actionId,
          },
        },
      },
    ],
  });
});

test("billing action store finalizes failures and releases the org lock atomically", async () => {
  const action = actionRecord();
  const commands: CommandLike[] = [];
  const send = vi.fn(async (command: CommandLike) => {
    commands.push(command);
    if (command.constructor.name === "TransactWriteCommand") return {};
    throw new Error(`Unexpected command ${command.constructor.name}`);
  });
  const store = new DynamoBillingActionStore({
    ddb: { send } as never,
    now: () => new Date("2026-04-30T00:03:00.000Z"),
    tableName: "billing-actions-test",
  });

  await expect(
    store.finalizeFailure({
      action,
      errorCode: "TARGET_PLAN_NOT_AVAILABLE",
      errorMessage: "Selected plan is not available.",
      errorStatus: 400,
      status: "failed_permanent",
    }),
  ).resolves.toBeUndefined();

  expect(inputOf(commands[0])).toMatchObject({
    TransactItems: [
      {
        Update: {
          ConditionExpression:
            "#requestHash = :requestHash AND #status = :providerInFlight AND #attemptToken = :attemptToken",
          Key: { actionId: action.actionId },
          UpdateExpression:
            "SET #status = :status, #errorCode = :errorCode, #errorMessage = :errorMessage, #errorStatus = :errorStatus, #updatedAt = :updatedAt",
        },
      },
      {
        Delete: {
          Key: { actionId: "LOCK#billing.plan-change#org_123" },
          ConditionExpression:
            "attribute_not_exists(actionId) OR (lockOwnerActionId = :ownerActionId AND lockOwnerAttemptToken = :attemptToken)",
        },
      },
    ],
  });
});

test("billing action store fences the provider mutation boundary before calling Lago", async () => {
  const action = actionRecord();
  const commands: CommandLike[] = [];
  const send = vi.fn(async (command: CommandLike) => {
    commands.push(command);
    if (command.constructor.name === "TransactWriteCommand") return {};
    throw new Error(`Unexpected command ${command.constructor.name}`);
  });
  const store = new DynamoBillingActionStore({
    ddb: { send } as never,
    now: () => new Date("2026-04-30T00:03:00.000Z"),
    tableName: "billing-actions-test",
  });

  await expect(store.markProviderMutationStarted({ action })).resolves.toMatchObject({
    actionId: action.actionId,
    status: "provider_in_flight",
  });

  expect(inputOf(commands[0])).toMatchObject({
    TransactItems: [
      {
        Update: {
          ConditionExpression:
            "#requestHash = :requestHash AND #status = :processing AND #attemptToken = :attemptToken",
          Key: { actionId: action.actionId },
        },
      },
      {
        Update: {
          ConditionExpression:
            "lockOwnerActionId = :ownerActionId AND lockOwnerAttemptToken = :attemptToken",
          Key: { actionId: "LOCK#billing.plan-change#org_123" },
        },
      },
    ],
  });
});

test("billing action store uses strongly consistent reads for idempotency decisions", async () => {
  const commands: CommandLike[] = [];
  const send = vi.fn(async (command: CommandLike) => {
    commands.push(command);
    if (command.constructor.name === "GetCommand") return {};
    throw new Error(`Unexpected command ${command.constructor.name}`);
  });
  const store = new DynamoBillingActionStore({
    ddb: { send } as never,
    tableName: "billing-actions-test",
  });

  await expect(store.inspect(baseInput())).resolves.toEqual({ kind: "none" });

  expect(inputOf(commands[0])).toMatchObject({ ConsistentRead: true });
});

test("billing action store treats terminal rows as immutable replays even after lease expiry", async () => {
  const terminal = {
    ...actionRecord(),
    responseBody: {
      currentPlanCode: "starter",
      downgradePlanDate: null,
      nextPlanCode: null,
      reconciliationState: "pending_lago_webhook" as const,
      status: "accepted" as const,
      targetPlanCode: "starter",
    },
    status: "provider_accepted" as const,
  };
  const send = vi.fn(async (command: CommandLike) => {
    if (command.constructor.name === "GetCommand") return { Item: terminal };
    throw new Error(`Unexpected command ${command.constructor.name}`);
  });
  const store = new DynamoBillingActionStore({
    ddb: { send } as never,
    now: () => new Date("2026-04-30T00:30:00.000Z"),
    tableName: "billing-actions-test",
  });

  await expect(store.claim(baseInput())).resolves.toEqual({ action: terminal, kind: "replay" });
  expect(send).toHaveBeenCalledOnce();
});

test("billing action store treats provider-in-flight rows as manual-reconcile replays after lease expiry", async () => {
  const inFlight = {
    ...actionRecord(),
    leaseExpiresAt: Date.parse("2026-04-30T00:01:00.000Z"),
    status: "provider_in_flight" as const,
  };
  const send = vi.fn(async (command: CommandLike) => {
    if (command.constructor.name === "GetCommand") return { Item: inFlight };
    throw new Error(`Unexpected command ${command.constructor.name}`);
  });
  const store = new DynamoBillingActionStore({
    ddb: { send } as never,
    now: () => new Date("2026-04-30T00:30:00.000Z"),
    tableName: "billing-actions-test",
  });

  await expect(store.claim(baseInput())).resolves.toEqual({ action: inFlight, kind: "replay" });
  expect(send).toHaveBeenCalledOnce();
});
