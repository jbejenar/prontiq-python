import test from "node:test";
import assert from "node:assert/strict";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import {
  GetCommand,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { createProvisioningService, type EmailSender } from "./provisioning.js";

interface CommandLog {
  type: "Get" | "Query" | "TransactWrite" | "Update";
  args: unknown;
}

type GetBehaviour = Record<string, unknown> | undefined | Error;

function makeDdbStub(
  options: {
    getResponses?: GetBehaviour[];
    transactWriteBehaviours?: ("ok" | Error)[];
  } = {},
): {
  client: DynamoDBDocumentClient;
  log: CommandLog[];
} {
  const log: CommandLog[] = [];
  const getQueue = [...(options.getResponses ?? [])];
  const txQueue = [...(options.transactWriteBehaviours ?? [])];
  const client = {
    async send(command: unknown) {
      if (command instanceof GetCommand) {
        log.push({ type: "Get", args: command.input });
        const next = getQueue.shift();
        if (next instanceof Error) throw next;
        return { Item: next };
      }
      if (command instanceof QueryCommand) {
        log.push({ type: "Query", args: command.input });
        return { Items: [] };
      }
      if (command instanceof TransactWriteCommand) {
        log.push({ type: "TransactWrite", args: command.input });
        const next = txQueue.shift() ?? "ok";
        if (next instanceof Error) throw next;
        return {};
      }
      if (command instanceof UpdateCommand) {
        log.push({ type: "Update", args: command.input });
        return {};
      }
      throw new Error(
        `Unhandled command in stub: ${(command as { constructor: { name: string } }).constructor.name}`,
      );
    },
  } as unknown as DynamoDBDocumentClient;
  return { client, log };
}

function makeAwsTransientReadError(): Error {
  const err = new Error("Rate of requests exceeds the allowed throughput");
  err.name = "ProvisionedThroughputExceededException";
  return err;
}

function makeAwsFatalReadError(): Error {
  const err = new Error("Cannot do operations on a non-existent table");
  err.name = "ResourceNotFoundException";
  return err;
}

function makeTransactionCanceledException(reasonCodes: (string | "None")[]): Error {
  const err = new Error(
    "Transaction cancelled, please refer to cancellation reasons for specific reasons",
  );
  err.name = "TransactionCanceledException";
  (err as { CancellationReasons?: { Code: string }[] }).CancellationReasons = reasonCodes.map(
    (code) => ({ Code: code }),
  );
  return err;
}

const customerId = "pq_cust_01HYZ6Q4X6DJP2X9Q9FQKX4T7A";
const subscriptionId = "pq_sub_01HYZ6Q4X6DJP2X9Q9FQKX4T7A";

const completeEnvelope = (orgId: string) => ({
  apiKeyHash: `ORG#${orgId}`,
  customerId,
  stripeCustomerId: null,
  ownerEmail: "owner@example.com",
  paymentOverdue: false,
  stripeSubscriptionId: null,
  subscriptionItems: {},
  tier: "free",
  products: ["address"],
  hasFirstKey: false,
  completedAt: "2026-04-17T00:00:00.000Z",
});

const completeEnvelopeWithoutCustomerId = (orgId: string) => {
  const { customerId: _unused, ...record } = completeEnvelope(orgId);
  return record;
};

const lagoBootstrappedEnvelope = (orgId: string) => ({
  ...completeEnvelope(orgId),
  billingPeriodEndingAt: "2026-05-26T00:00:00.000Z",
  billingPeriodKey: "2026-04-26T00:00:00.000Z__2026-05-26T00:00:00.000Z",
  billingPeriodStartedAt: "2026-04-26T00:00:00.000Z",
  lagoPaymentOverdueInvoiceId: null,
  lagoPlanCode: "free",
  lagoSubscriptionExternalId: subscriptionId,
  lagoSubscriptionStatus: "active",
});

function makeLagoProvisioningClient(
  options: {
    getSubscriptionResponses?: Array<"snapshot" | null>;
    throwIfCalled?: boolean;
  } = {},
) {
  const calls: { method: string; args: unknown }[] = [];
  const getSubscriptionResponses = [...(options.getSubscriptionResponses ?? ["snapshot"])];
  return {
    calls,
    client: {
      async upsertCustomer(args: unknown) {
        if (options.throwIfCalled) throw new Error("Lago must not be called");
        calls.push({ method: "upsertCustomer", args });
      },
      async upsertSubscription(args: unknown) {
        if (options.throwIfCalled) throw new Error("Lago must not be called");
        calls.push({ method: "upsertSubscription", args });
      },
      async getSubscription(args: unknown) {
        if (options.throwIfCalled) throw new Error("Lago must not be called");
        calls.push({ method: "getSubscription", args });
        const next =
          getSubscriptionResponses.length > 0 ? getSubscriptionResponses.shift() : "snapshot";
        if (next === null) return null;
        return {
          billingPeriodEndingAt: "2026-05-26T00:00:00.000Z",
          billingPeriodStartedAt: "2026-04-26T00:00:00.000Z",
          externalCustomerId: customerId,
          externalSubscriptionId: subscriptionId,
          planCode: "free",
          status: "active",
        };
      },
    },
  };
}

const noopLogger = { error: () => {}, info: () => {}, warn: () => {} };
const noopSleep = async () => {};
const noopEmail: EmailSender = async () => true;

const baseDeps = {
  keysTableName: "keys",
  customersTableName: "customers",
  auditTableName: "audit",
  generateCustomerId: () => customerId,
  lagoPaymentProviderCode: "stripe-main",
  logger: noopLogger,
  sleep: noopSleep,
  sendWelcomeEmail: noopEmail,
};

test("returns already_exists when complete Lago ORG envelope is already present", async () => {
  const { client, log } = makeDdbStub({
    getResponses: [lagoBootstrappedEnvelope("org_abc")],
  });
  const lago = makeLagoProvisioningClient({ throwIfCalled: true });
  const service = createProvisioningService({ ...baseDeps, ddb: client, lagoClient: lago.client });

  const result = await service.provisionOrg({
    orgId: "org_abc",
    ownerEmail: "owner@example.com",
    actorId: "user_x",
    source: "clerk-webhook",
  });

  assert.equal(result.status, "already_exists");
  assert.equal(result.customerId, customerId);
  assert.equal(result.stripeCustomerId, null);
  assert.equal(log.length, 1);
});

test("legacy envelopes without customerId replay without Lago side effects", async () => {
  const { client, log } = makeDdbStub({
    getResponses: [completeEnvelopeWithoutCustomerId("org_legacy")],
  });
  const lago = makeLagoProvisioningClient({ throwIfCalled: true });
  const service = createProvisioningService({ ...baseDeps, ddb: client, lagoClient: lago.client });

  const result = await service.provisionOrg({
    orgId: "org_legacy",
    ownerEmail: "owner@example.com",
    actorId: "user_x",
    source: "clerk-webhook",
  });

  assert.equal(result.status, "already_exists");
  assert.equal(result.customerId, undefined);
  assert.equal(result.stripeCustomerId, null);
  assert.equal(log.length, 1);
});

test("existing incomplete Lago envelope is bootstrapped before replay returns", async () => {
  const { client, log } = makeDdbStub({
    getResponses: [completeEnvelope("org_bootstrap"), lagoBootstrappedEnvelope("org_bootstrap")],
  });
  const lago = makeLagoProvisioningClient({ getSubscriptionResponses: [null, "snapshot"] });
  const service = createProvisioningService({ ...baseDeps, ddb: client, lagoClient: lago.client });

  const result = await service.provisionOrg({
    orgId: "org_bootstrap",
    ownerEmail: "owner@example.com",
    actorId: "user_x",
    source: "account-setup",
  });

  assert.equal(result.status, "already_exists");
  assert.equal(result.customerId, customerId);
  assert.deepEqual(
    lago.calls.map((call) => call.method),
    ["upsertCustomer", "getSubscription", "upsertSubscription", "getSubscription"],
  );
  assert.equal(log.filter((entry) => entry.type === "Update").length, 1);
});

test("creates org envelope and bootstraps Lago Free subscription", async () => {
  const { client, log } = makeDdbStub({
    getResponses: [undefined, completeEnvelope("org_new"), lagoBootstrappedEnvelope("org_new")],
  });
  const lago = makeLagoProvisioningClient();
  const service = createProvisioningService({ ...baseDeps, ddb: client, lagoClient: lago.client });
  const previousFrom = process.env.WELCOME_EMAIL_FROM;
  process.env.WELCOME_EMAIL_FROM = "noreply@prontiq.dev";

  const result = await service
    .provisionOrg({
      orgId: "org_new",
      ownerEmail: "owner@example.com",
      actorId: "user_x",
      source: "clerk-webhook",
    })
    .finally(() => {
      if (previousFrom === undefined) {
        delete process.env.WELCOME_EMAIL_FROM;
      } else {
        process.env.WELCOME_EMAIL_FROM = previousFrom;
      }
    });

  assert.equal(result.status, "created");
  assert.equal(result.customerId, customerId);
  assert.equal(result.stripeCustomerId, null);
  assert.equal(result.emailSent, true);
  assert.equal(log.filter((entry) => entry.type === "TransactWrite").length, 1);
  assert.equal(log.filter((entry) => entry.type === "Update").length, 1);
  assert.deepEqual(
    lago.calls.map((call) => call.method),
    ["upsertCustomer", "getSubscription"],
  );
});

test("post-commit Lago bootstrap failure is retryable after durable envelope commit", async () => {
  const { client } = makeDdbStub({
    getResponses: [undefined, completeEnvelope("org_retry")],
  });
  const lago = makeLagoProvisioningClient({ throwIfCalled: true });
  const service = createProvisioningService({ ...baseDeps, ddb: client, lagoClient: lago.client });

  const result = await service.provisionOrg({
    orgId: "org_retry",
    ownerEmail: "owner@example.com",
    actorId: "user_x",
    source: "clerk-webhook",
  });

  assert.equal(result.status, "retryable_failure");
  assert.equal(result.customerId, customerId);
  assert.equal(result.stripeCustomerId, null);
});

test("transient preflight read returns retryable failure", async () => {
  const { client } = makeDdbStub({
    getResponses: [makeAwsTransientReadError()],
  });
  const lago = makeLagoProvisioningClient({ throwIfCalled: true });
  const service = createProvisioningService({ ...baseDeps, ddb: client, lagoClient: lago.client });

  const result = await service.provisionOrg({
    orgId: "org_transient",
    ownerEmail: "owner@example.com",
    actorId: "user_x",
    source: "clerk-webhook",
  });

  assert.equal(result.status, "retryable_failure");
});

test("fatal preflight read returns fatal failure", async () => {
  const { client } = makeDdbStub({
    getResponses: [makeAwsFatalReadError()],
  });
  const lago = makeLagoProvisioningClient({ throwIfCalled: true });
  const service = createProvisioningService({ ...baseDeps, ddb: client, lagoClient: lago.client });

  const result = await service.provisionOrg({
    orgId: "org_fatal",
    ownerEmail: "owner@example.com",
    actorId: "user_x",
    source: "clerk-webhook",
  });

  assert.equal(result.status, "fatal_failure");
});

test("transient transaction conflicts are retried", async () => {
  const { client, log } = makeDdbStub({
    getResponses: [
      undefined,
      undefined,
      completeEnvelope("org_tx"),
      lagoBootstrappedEnvelope("org_tx"),
    ],
    transactWriteBehaviours: [makeTransactionCanceledException(["TransactionConflict"]), "ok"],
  });
  const lago = makeLagoProvisioningClient();
  const service = createProvisioningService({ ...baseDeps, ddb: client, lagoClient: lago.client });

  const result = await service.provisionOrg({
    orgId: "org_tx",
    ownerEmail: "owner@example.com",
    actorId: "user_x",
    source: "clerk-webhook",
  });

  assert.equal(result.status, "created");
  assert.equal(log.filter((entry) => entry.type === "TransactWrite").length, 2);
});

test("welcome email remains best-effort after successful Lago bootstrap", async () => {
  const { client } = makeDdbStub({
    getResponses: [undefined, completeEnvelope("org_email"), lagoBootstrappedEnvelope("org_email")],
  });
  const lago = makeLagoProvisioningClient();
  const throwingEmail: EmailSender = async () => {
    throw new Error("ses down");
  };
  const service = createProvisioningService({
    ...baseDeps,
    ddb: client,
    lagoClient: lago.client,
    sendWelcomeEmail: throwingEmail,
  });

  const result = await service.provisionOrg({
    orgId: "org_email",
    ownerEmail: "owner@example.com",
    actorId: "user_x",
    source: "clerk-webhook",
  });

  assert.equal(result.status, "created");
  assert.equal(result.emailSent, false);
});
