import test from "node:test";
import assert from "node:assert/strict";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { GetCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import Stripe from "stripe";
import { createProvisioningService, type EmailSender } from "./provisioning.js";

interface CommandLog {
  type: "Get" | "TransactWrite";
  args: unknown;
}

type GetBehaviour = Record<string, unknown> | undefined | Error;

interface DdbStubOptions {
  getResponses?: GetBehaviour[];
  transactWriteBehaviours?: ("ok" | Error)[];
}

function makeDdbStub(options: DdbStubOptions = {}): {
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
        if (next instanceof Error) {
          throw next;
        }
        return { Item: next };
      }
      if (command instanceof TransactWriteCommand) {
        log.push({ type: "TransactWrite", args: command.input });
        const next = txQueue.shift() ?? "ok";
        if (next instanceof Error) {
          throw next;
        }
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
  // Mirrors the shape of throttling errors the AWS SDK raises on
  // GetItem under capacity pressure or service blip.
  const err = new Error("Rate of requests exceeds the allowed throughput");
  err.name = "ProvisionedThroughputExceededException";
  return err;
}

function makeAwsFatalReadError(): Error {
  // Mirrors a configuration/schema error like a missing table or
  // disallowed action.
  const err = new Error("Cannot do operations on a non-existent table");
  err.name = "ResourceNotFoundException";
  return err;
}

function makeStripeStub(options: {
  customerId?: string;
  throwOnCreate?: Error;
}): { stripe: Stripe; createCalls: unknown[] } {
  const createCalls: unknown[] = [];
  const stripe = {
    customers: {
      async create(args: unknown, opts: unknown) {
        createCalls.push({ args, opts });
        if (options.throwOnCreate) {
          throw options.throwOnCreate;
        }
        return { id: options.customerId ?? "cus_test_123" };
      },
    },
  } as unknown as Stripe;
  return { stripe, createCalls };
}

/**
 * Construct a TransactionCanceledException matching what the AWS SDK
 * surfaces for TransactWriteItems failures. Reason codes per the AWS
 * DynamoDB API reference: TransactionConflict, ConditionalCheckFailed,
 * ProvisionedThroughputExceeded, ThrottlingError, ValidationError,
 * ItemCollectionSizeLimitExceeded, None.
 */
function makeTransactionCanceledException(
  reasonCodes: (string | "None")[],
): Error {
  const err = new Error("Transaction cancelled, please refer to cancellation reasons for specific reasons");
  err.name = "TransactionCanceledException";
  (err as { CancellationReasons?: { Code: string }[] }).CancellationReasons =
    reasonCodes.map((code) => ({ Code: code }));
  return err;
}

const completeEnvelope = (orgId: string, customerId = "cus_existing") => ({
  apiKeyHash: `ORG#${orgId}`,
  stripeCustomerId: customerId,
  ownerEmail: "owner@example.com",
  paymentOverdue: false,
  stripeSubscriptionId: null,
  subscriptionItems: {},
  tier: "free",
  products: ["address"],
  hasFirstKey: false,
  completedAt: "2026-04-17T00:00:00.000Z",
});

const noopLogger = { error: () => {}, warn: () => {} };
const noopSleep = async () => {};
const noopEmail: EmailSender = async () => true;

const baseDeps = {
  keysTableName: "keys",
  auditTableName: "audit",
  logger: noopLogger,
  sleep: noopSleep,
  sendWelcomeEmail: noopEmail,
};

test("returns already_exists when ORG envelope is already present", async () => {
  const { client, log } = makeDdbStub({
    getResponses: [completeEnvelope("org_abc")],
  });
  const { stripe, createCalls } = makeStripeStub({});
  const service = createProvisioningService({ ...baseDeps, ddb: client, stripe });
  const result = await service.provisionOrg({
    orgId: "org_abc",
    ownerEmail: "owner@example.com",
    actorId: "user_x",
    source: "clerk-webhook",
  });
  assert.equal(result.status, "already_exists");
  assert.equal(result.stripeCustomerId, "cus_existing");
  assert.equal(createCalls.length, 0, "Stripe must not be called when envelope exists");
  assert.equal(log.length, 1, "only one Get is needed");
});

test("ALL ORG envelope reads use ConsistentRead: true (Bug 1 regression)", async () => {
  const orgId = "org_consistency";
  const conflict = makeTransactionCanceledException(["TransactionConflict"]);
  const { client, log } = makeDdbStub({
    getResponses: [
      undefined, // preflight idempotency check
      undefined, // post-failure reconciliation read after conflict
      completeEnvelope(orgId, "cus_consist"), // post-commit confirmation
    ],
    transactWriteBehaviours: [conflict, "ok"],
  });
  const { stripe } = makeStripeStub({ customerId: "cus_consist" });
  const service = createProvisioningService({ ...baseDeps, ddb: client, stripe });
  await service.provisionOrg({
    orgId,
    ownerEmail: "c@example.com",
    actorId: "u",
    source: "clerk-webhook",
  });
  const gets = log.filter((e) => e.type === "Get");
  assert.equal(gets.length, 3, "preflight + post-failure + post-commit = 3 reads");
  for (const g of gets) {
    assert.equal(
      (g.args as { ConsistentRead?: boolean }).ConsistentRead,
      true,
      "every ORG envelope read must be strongly consistent",
    );
  }
});

test("happy path: creates Stripe customer and writes envelope + audit transactionally", async () => {
  const orgId = "org_new";
  const { client, log } = makeDdbStub({
    getResponses: [undefined, completeEnvelope(orgId, "cus_new_456")],
  });
  const { stripe, createCalls } = makeStripeStub({ customerId: "cus_new_456" });
  const service = createProvisioningService({ ...baseDeps, ddb: client, stripe });
  const result = await service.provisionOrg({
    orgId,
    ownerEmail: "new@example.com",
    actorId: "user_y",
    source: "clerk-webhook",
  });
  assert.equal(result.status, "created");
  assert.equal(result.stripeCustomerId, "cus_new_456");
  assert.equal(createCalls.length, 1);
  const call = createCalls[0] as {
    args: { email: string; metadata: Record<string, string> };
    opts: { idempotencyKey: string };
  };
  assert.equal(call.args.email, "new@example.com");
  assert.equal(call.args.metadata.orgId, orgId);
  assert.equal(call.opts.idempotencyKey, `clerk-provision-${orgId}`);
  const txEntries = log.filter((e) => e.type === "TransactWrite");
  assert.equal(txEntries.length, 1);
  const tx = txEntries[0]?.args as {
    TransactItems: { Put: { TableName: string; ConditionExpression: string } }[];
  };
  assert.equal(tx.TransactItems.length, 2);
  assert.equal(tx.TransactItems[0]?.Put.TableName, "keys");
  assert.equal(tx.TransactItems[0]?.Put.ConditionExpression, "attribute_not_exists(apiKeyHash)");
  assert.equal(tx.TransactItems[1]?.Put.TableName, "audit");
});

test("Stripe network/5xx errors (StripeAPIError, StripeConnectionError, StripeRateLimitError) are retryable_failure", async () => {
  const cases = [
    new Stripe.errors.StripeAPIError({ message: "5xx" } as never),
    new Stripe.errors.StripeConnectionError({ message: "ECONNRESET" } as never),
    new Stripe.errors.StripeRateLimitError({ message: "rate limited" } as never),
  ];
  for (const err of cases) {
    const { client } = makeDdbStub({ getResponses: [undefined] });
    const { stripe } = makeStripeStub({ throwOnCreate: err });
    const service = createProvisioningService({ ...baseDeps, ddb: client, stripe });
    const result = await service.provisionOrg({
      orgId: `org_${err.constructor.name}`,
      ownerEmail: "x@example.com",
      actorId: "u",
      source: "clerk-webhook",
    });
    assert.equal(
      result.status,
      "retryable_failure",
      `${err.constructor.name} should be retryable`,
    );
  }
});

test("Stripe 4xx errors (StripeInvalidRequestError, StripeCardError, StripeAuthenticationError) are fatal_failure", async () => {
  const cases = [
    new Stripe.errors.StripeInvalidRequestError({ message: "email_invalid" } as never),
    new Stripe.errors.StripeCardError({ message: "card declined" } as never),
    new Stripe.errors.StripeAuthenticationError({ message: "bad key" } as never),
    new Stripe.errors.StripePermissionError({ message: "no perm" } as never),
    new Stripe.errors.StripeIdempotencyError({ message: "key reuse" } as never),
  ];
  for (const err of cases) {
    const { client } = makeDdbStub({ getResponses: [undefined] });
    const { stripe } = makeStripeStub({ throwOnCreate: err });
    const service = createProvisioningService({ ...baseDeps, ddb: client, stripe });
    const result = await service.provisionOrg({
      orgId: `org_${err.constructor.name}`,
      ownerEmail: "bad",
      actorId: "u",
      source: "clerk-webhook",
    });
    assert.equal(
      result.status,
      "fatal_failure",
      `${err.constructor.name} should be fatal`,
    );
  }
});

test("TransactionCanceledException with TransactionConflict reason → retry succeeds (Bug 2 regression)", async () => {
  const orgId = "org_retry";
  const { client, log } = makeDdbStub({
    getResponses: [
      undefined,
      undefined,
      completeEnvelope(orgId, "cus_retry"),
    ],
    transactWriteBehaviours: [
      makeTransactionCanceledException(["TransactionConflict"]),
      "ok",
    ],
  });
  const { stripe } = makeStripeStub({ customerId: "cus_retry" });
  const service = createProvisioningService({ ...baseDeps, ddb: client, stripe });
  const result = await service.provisionOrg({
    orgId,
    ownerEmail: "retry@example.com",
    actorId: "user_z",
    source: "clerk-webhook",
  });
  assert.equal(result.status, "created");
  const txEntries = log.filter((e) => e.type === "TransactWrite");
  assert.equal(txEntries.length, 2, "should retry once after the transient conflict");
});

test("TransactionCanceledException with ProvisionedThroughputExceeded reason is transient (Bug 2 regression)", async () => {
  const orgId = "org_throttle";
  const { client, log } = makeDdbStub({
    getResponses: [undefined, undefined, completeEnvelope(orgId, "cus_t")],
    transactWriteBehaviours: [
      makeTransactionCanceledException(["ProvisionedThroughputExceeded"]),
      "ok",
    ],
  });
  const { stripe } = makeStripeStub({ customerId: "cus_t" });
  const service = createProvisioningService({ ...baseDeps, ddb: client, stripe });
  const result = await service.provisionOrg({
    orgId,
    ownerEmail: "t@example.com",
    actorId: "u",
    source: "clerk-webhook",
  });
  assert.equal(result.status, "created");
  assert.equal(log.filter((e) => e.type === "TransactWrite").length, 2);
});

test("TransactionCanceledException with ThrottlingError reason is transient (Bug 2 regression)", async () => {
  const orgId = "org_throttle2";
  const { client, log } = makeDdbStub({
    getResponses: [undefined, undefined, completeEnvelope(orgId, "cus_t2")],
    transactWriteBehaviours: [
      makeTransactionCanceledException(["ThrottlingError"]),
      "ok",
    ],
  });
  const { stripe } = makeStripeStub({ customerId: "cus_t2" });
  const service = createProvisioningService({ ...baseDeps, ddb: client, stripe });
  const result = await service.provisionOrg({
    orgId,
    ownerEmail: "t2@example.com",
    actorId: "u",
    source: "clerk-webhook",
  });
  assert.equal(result.status, "created");
  assert.equal(log.filter((e) => e.type === "TransactWrite").length, 2);
});

test("ConditionalCheckFailed during a race → reconciliation read finds envelope → already_exists", async () => {
  const orgId = "org_race";
  const { client } = makeDdbStub({
    getResponses: [
      undefined, // preflight: nothing yet
      completeEnvelope(orgId), // reconciliation after ConditionalCheckFailed: competing writer won
    ],
    transactWriteBehaviours: [
      makeTransactionCanceledException(["ConditionalCheckFailed", "None"]),
    ],
  });
  const { stripe } = makeStripeStub({ customerId: "cus_race" });
  const service = createProvisioningService({ ...baseDeps, ddb: client, stripe });
  const result = await service.provisionOrg({
    orgId,
    ownerEmail: "race@example.com",
    actorId: "user_z",
    source: "clerk-webhook",
  });
  assert.equal(result.status, "already_exists");
  assert.equal(result.stripeCustomerId, "cus_existing");
});

test("TransactionCanceledException with ValidationError reason is fatal_failure", async () => {
  const orgId = "org_fatal";
  const { client } = makeDdbStub({
    getResponses: [undefined, undefined],
    transactWriteBehaviours: [makeTransactionCanceledException(["ValidationError"])],
  });
  const { stripe } = makeStripeStub({ customerId: "cus_fatal" });
  const service = createProvisioningService({ ...baseDeps, ddb: client, stripe });
  const result = await service.provisionOrg({
    orgId,
    ownerEmail: "fatal@example.com",
    actorId: "user_z",
    source: "clerk-webhook",
  });
  assert.equal(result.status, "fatal_failure");
  assert.equal(result.stripeCustomerId, "cus_fatal");
});

test("standalone top-level ProvisionedThroughputExceededException is transient", async () => {
  const orgId = "org_pte";
  const standalone = new Error("throughput exceeded");
  standalone.name = "ProvisionedThroughputExceededException";
  const { client, log } = makeDdbStub({
    getResponses: [undefined, undefined, completeEnvelope(orgId, "cus_pte")],
    transactWriteBehaviours: [standalone, "ok"],
  });
  const { stripe } = makeStripeStub({ customerId: "cus_pte" });
  const service = createProvisioningService({ ...baseDeps, ddb: client, stripe });
  const result = await service.provisionOrg({
    orgId,
    ownerEmail: "p@example.com",
    actorId: "u",
    source: "clerk-webhook",
  });
  assert.equal(result.status, "created");
  assert.equal(log.filter((e) => e.type === "TransactWrite").length, 2);
});

test("MAX_ATTEMPTS reached on persistent transient error → retryable_failure", async () => {
  const orgId = "org_persistent";
  const { client, log } = makeDdbStub({
    getResponses: [undefined, undefined, undefined, undefined],
    transactWriteBehaviours: [
      makeTransactionCanceledException(["TransactionConflict"]),
      makeTransactionCanceledException(["TransactionConflict"]),
      makeTransactionCanceledException(["TransactionConflict"]),
    ],
  });
  const { stripe } = makeStripeStub({ customerId: "cus_p" });
  const service = createProvisioningService({ ...baseDeps, ddb: client, stripe });
  const result = await service.provisionOrg({
    orgId,
    ownerEmail: "p@example.com",
    actorId: "user_z",
    source: "clerk-webhook",
  });
  assert.equal(result.status, "retryable_failure");
  assert.equal(result.stripeCustomerId, "cus_p");
  const txEntries = log.filter((e) => e.type === "TransactWrite");
  assert.equal(txEntries.length, 3, "exactly MAX_ATTEMPTS attempts");
});

test("post-commit confirmation read returning undefined → fatal_failure (defensive guard)", async () => {
  // Strong reads should make this impossible. But if it does happen
  // (table deleted mid-flight, IAM lost, schema drift), we MUST fail
  // loud rather than returning `created` with `orgEnvelope: undefined`
  // (which would misrepresent durability).
  const orgId = "org_phantom";
  const { client } = makeDdbStub({
    getResponses: [undefined, undefined], // preflight + post-commit both miss
    transactWriteBehaviours: ["ok"], // commit "succeeds" but read won't see it
  });
  const { stripe } = makeStripeStub({ customerId: "cus_phantom" });
  const service = createProvisioningService({ ...baseDeps, ddb: client, stripe });
  const result = await service.provisionOrg({
    orgId,
    ownerEmail: "ph@example.com",
    actorId: "u",
    source: "clerk-webhook",
  });
  assert.equal(result.status, "fatal_failure");
  assert.equal(result.stripeCustomerId, "cus_phantom");
  assert.equal(result.orgEnvelope, undefined);
});

// ---------------------------------------------------------------------------
// Bug 4 regression — read failures must not escape provisionOrg
// ---------------------------------------------------------------------------

test("Bug 4: preflight read transient failure → retryable_failure (no Stripe call)", async () => {
  const { client } = makeDdbStub({
    getResponses: [makeAwsTransientReadError()],
  });
  const { stripe, createCalls } = makeStripeStub({});
  const service = createProvisioningService({ ...baseDeps, ddb: client, stripe });
  const result = await service.provisionOrg({
    orgId: "org_pre_t",
    ownerEmail: "p@example.com",
    actorId: "u",
    source: "clerk-webhook",
  });
  assert.equal(result.status, "retryable_failure");
  assert.equal(result.stripeCustomerId, undefined);
  assert.equal(createCalls.length, 0, "Stripe must not be called when preflight read fails");
});

test("Bug 4: preflight read fatal failure → fatal_failure (no Stripe call)", async () => {
  const { client } = makeDdbStub({
    getResponses: [makeAwsFatalReadError()],
  });
  const { stripe, createCalls } = makeStripeStub({});
  const service = createProvisioningService({ ...baseDeps, ddb: client, stripe });
  const result = await service.provisionOrg({
    orgId: "org_pre_f",
    ownerEmail: "p@example.com",
    actorId: "u",
    source: "clerk-webhook",
  });
  assert.equal(result.status, "fatal_failure");
  assert.equal(createCalls.length, 0);
});

test("Bug 4: post-commit read transient failure → retryable_failure preserving stripeCustomerId", async () => {
  // TransactWrite succeeded but the confirmation read got throttled.
  // The envelope is likely committed; caller should retry to confirm.
  // stripeCustomerId MUST be preserved so the Svix retry hits the
  // idempotency-key cache and doesn't create a duplicate customer.
  const { client } = makeDdbStub({
    getResponses: [undefined, makeAwsTransientReadError()],
    transactWriteBehaviours: ["ok"],
  });
  const { stripe } = makeStripeStub({ customerId: "cus_post_t" });
  const service = createProvisioningService({ ...baseDeps, ddb: client, stripe });
  const result = await service.provisionOrg({
    orgId: "org_post_t",
    ownerEmail: "p@example.com",
    actorId: "u",
    source: "clerk-webhook",
  });
  assert.equal(result.status, "retryable_failure");
  assert.equal(result.stripeCustomerId, "cus_post_t");
});

test("Bug 4: post-commit read fatal failure → fatal_failure preserving stripeCustomerId", async () => {
  const { client } = makeDdbStub({
    getResponses: [undefined, makeAwsFatalReadError()],
    transactWriteBehaviours: ["ok"],
  });
  const { stripe } = makeStripeStub({ customerId: "cus_post_f" });
  const service = createProvisioningService({ ...baseDeps, ddb: client, stripe });
  const result = await service.provisionOrg({
    orgId: "org_post_f",
    ownerEmail: "p@example.com",
    actorId: "u",
    source: "clerk-webhook",
  });
  assert.equal(result.status, "fatal_failure");
  assert.equal(result.stripeCustomerId, "cus_post_f");
});

test("Bug 4: reconciliation read failure after a TransactWrite cancellation → retryable_failure (caller retries; idempotency-key keeps Stripe safe)", async () => {
  // After a TransactionCanceledException, we read to check whether a
  // competing writer won the race. If the read itself fails, we cannot
  // distinguish — return retryable so Svix redelivers. The
  // idempotency-key on the next Stripe.create call prevents duplicate
  // customers; the envelope's attribute_not_exists prevents duplicate
  // envelopes.
  const { client } = makeDdbStub({
    getResponses: [
      undefined, // preflight
      makeAwsTransientReadError(), // reconciliation read after cancel
    ],
    transactWriteBehaviours: [
      makeTransactionCanceledException(["TransactionConflict"]),
    ],
  });
  const { stripe } = makeStripeStub({ customerId: "cus_rec" });
  const service = createProvisioningService({ ...baseDeps, ddb: client, stripe });
  const result = await service.provisionOrg({
    orgId: "org_rec",
    ownerEmail: "p@example.com",
    actorId: "u",
    source: "clerk-webhook",
  });
  assert.equal(result.status, "retryable_failure");
  assert.equal(result.stripeCustomerId, "cus_rec");
});

test("Bug 4: reconciliation read fatal failure after a TransactWrite error → fatal_failure preserving stripeCustomerId", async () => {
  const { client } = makeDdbStub({
    getResponses: [
      undefined,
      makeAwsFatalReadError(),
    ],
    transactWriteBehaviours: [
      makeTransactionCanceledException(["TransactionConflict"]),
    ],
  });
  const { stripe } = makeStripeStub({ customerId: "cus_rec_f" });
  const service = createProvisioningService({ ...baseDeps, ddb: client, stripe });
  const result = await service.provisionOrg({
    orgId: "org_rec_f",
    ownerEmail: "p@example.com",
    actorId: "u",
    source: "clerk-webhook",
  });
  assert.equal(result.status, "fatal_failure");
  assert.equal(result.stripeCustomerId, "cus_rec_f");
});

test("Bug 4: provisionOrg never throws — every error path returns a typed ProvisioningResult", async () => {
  // Smoke test that the contract holds across the three failure modes.
  // If a future change reintroduces an uncaught throw, this test
  // surfaces it before it reaches prod.
  const failureModes: { name: string; opts: DdbStubOptions; tx?: ("ok" | Error)[] }[] = [
    { name: "preflight transient", opts: { getResponses: [makeAwsTransientReadError()] } },
    { name: "preflight fatal", opts: { getResponses: [makeAwsFatalReadError()] } },
    {
      name: "post-commit transient",
      opts: {
        getResponses: [undefined, makeAwsTransientReadError()],
        transactWriteBehaviours: ["ok"],
      },
    },
    {
      name: "post-commit fatal",
      opts: {
        getResponses: [undefined, makeAwsFatalReadError()],
        transactWriteBehaviours: ["ok"],
      },
    },
  ];
  for (const mode of failureModes) {
    const { client } = makeDdbStub(mode.opts);
    const { stripe } = makeStripeStub({ customerId: "cus_smoke" });
    const service = createProvisioningService({ ...baseDeps, ddb: client, stripe });
    let threw = false;
    let result: Awaited<ReturnType<typeof service.provisionOrg>> | undefined;
    try {
      result = await service.provisionOrg({
        orgId: `org_smoke_${mode.name}`,
        ownerEmail: "s@example.com",
        actorId: "u",
        source: "clerk-webhook",
      });
    } catch {
      threw = true;
    }
    assert.equal(threw, false, `${mode.name}: provisionOrg must not throw`);
    assert.ok(result, `${mode.name}: result must be defined`);
    assert.ok(
      ["retryable_failure", "fatal_failure"].includes(result.status),
      `${mode.name}: status must be one of retryable_failure / fatal_failure, got ${result.status}`,
    );
  }
});

// ---------------------------------------------------------------------------
// Bug 7 regression — unified DDB error classification across reads and writes
// ---------------------------------------------------------------------------

function makeNamedError(name: string, message: string = name): Error {
  const err = new Error(message);
  err.name = name;
  return err;
}

function makeSmithyRetryableError(message = "unknown retryable"): Error {
  const err = new Error(message);
  err.name = "UnknownAwsError";
  (err as unknown as { $retryable: { throttling: boolean } }).$retryable = {
    throttling: false,
  };
  return err;
}

test("Bug 7: TransactWrite TimeoutError on post-Stripe path → retryable_failure (not fatal)", async () => {
  // The canonical ambiguous case: the write call timed out after the
  // Stripe customer was already created. We don't know if the envelope
  // committed. Safe response: retryable (idempotency-key + envelope
  // attribute_not_exists make retries safe). Previously classified as
  // fatal because TimeoutError wasn't in the transient set for writes.
  const orgId = "org_timeout";
  const { client } = makeDdbStub({
    getResponses: [undefined, undefined, undefined, undefined],
    transactWriteBehaviours: [
      makeNamedError("TimeoutError", "Request timed out after 3000ms"),
      makeNamedError("TimeoutError"),
      makeNamedError("TimeoutError"),
    ],
  });
  const { stripe } = makeStripeStub({ customerId: "cus_timeout" });
  const service = createProvisioningService({ ...baseDeps, ddb: client, stripe });
  const result = await service.provisionOrg({
    orgId,
    ownerEmail: "t@example.com",
    actorId: "u",
    source: "clerk-webhook",
  });
  assert.equal(result.status, "retryable_failure");
  assert.equal(result.stripeCustomerId, "cus_timeout");
});

test("Bug 7: TransactWrite AbortError → retryable_failure", async () => {
  const { client } = makeDdbStub({
    getResponses: [undefined, undefined, undefined, undefined],
    transactWriteBehaviours: [
      makeNamedError("AbortError", "Request aborted"),
      makeNamedError("AbortError"),
      makeNamedError("AbortError"),
    ],
  });
  const { stripe } = makeStripeStub({ customerId: "cus_abort" });
  const service = createProvisioningService({ ...baseDeps, ddb: client, stripe });
  const result = await service.provisionOrg({
    orgId: "org_abort",
    ownerEmail: "a@example.com",
    actorId: "u",
    source: "clerk-webhook",
  });
  assert.equal(result.status, "retryable_failure");
  assert.equal(result.stripeCustomerId, "cus_abort");
});

test("Bug 7: TransactWrite NetworkingError → retryable_failure", async () => {
  const { client } = makeDdbStub({
    getResponses: [undefined, undefined, undefined, undefined],
    transactWriteBehaviours: [
      makeNamedError("NetworkingError", "ECONNRESET"),
      makeNamedError("NetworkingError"),
      makeNamedError("NetworkingError"),
    ],
  });
  const { stripe } = makeStripeStub({ customerId: "cus_net" });
  const service = createProvisioningService({ ...baseDeps, ddb: client, stripe });
  const result = await service.provisionOrg({
    orgId: "org_net",
    ownerEmail: "n@example.com",
    actorId: "u",
    source: "clerk-webhook",
  });
  assert.equal(result.status, "retryable_failure");
});

test("Bug 7: TransactWrite with Smithy $retryable trait → retryable_failure", async () => {
  // Smithy v3 sets $retryable on errors the SDK considered retryable.
  // Use as a fallback when we don't recognise the name.
  const { client } = makeDdbStub({
    getResponses: [undefined, undefined, undefined, undefined],
    transactWriteBehaviours: [
      makeSmithyRetryableError("unknown retryable 1"),
      makeSmithyRetryableError("unknown retryable 2"),
      makeSmithyRetryableError("unknown retryable 3"),
    ],
  });
  const { stripe } = makeStripeStub({ customerId: "cus_sm" });
  const service = createProvisioningService({ ...baseDeps, ddb: client, stripe });
  const result = await service.provisionOrg({
    orgId: "org_sm",
    ownerEmail: "s@example.com",
    actorId: "u",
    source: "clerk-webhook",
  });
  assert.equal(result.status, "retryable_failure");
});

test("Bug 7: TransactWrite ValidationException → fatal_failure (provably terminal)", async () => {
  const { client } = makeDdbStub({
    getResponses: [undefined, undefined],
    transactWriteBehaviours: [makeNamedError("ValidationException", "Item size exceeded")],
  });
  const { stripe } = makeStripeStub({ customerId: "cus_val" });
  const service = createProvisioningService({ ...baseDeps, ddb: client, stripe });
  const result = await service.provisionOrg({
    orgId: "org_val",
    ownerEmail: "v@example.com",
    actorId: "u",
    source: "clerk-webhook",
  });
  assert.equal(result.status, "fatal_failure");
  assert.equal(result.stripeCustomerId, "cus_val");
});

test("Bug 7: TransactWrite ResourceNotFoundException → fatal_failure (table missing)", async () => {
  const { client } = makeDdbStub({
    getResponses: [undefined, undefined],
    transactWriteBehaviours: [
      makeNamedError("ResourceNotFoundException", "Cannot do operations on a non-existent table"),
    ],
  });
  const { stripe } = makeStripeStub({ customerId: "cus_nf" });
  const service = createProvisioningService({ ...baseDeps, ddb: client, stripe });
  const result = await service.provisionOrg({
    orgId: "org_nf",
    ownerEmail: "nf@example.com",
    actorId: "u",
    source: "clerk-webhook",
  });
  assert.equal(result.status, "fatal_failure");
});

test("Bug 7: TransactWrite unknown-name error (no $retryable) → retryable_failure (ambiguous defaults to safe)", async () => {
  // The safe-default policy: on post-Stripe paths, an unknown error
  // name with no $retryable trait is ambiguous, but a retry is safe
  // (idempotency-key + attribute_not_exists). We MUST NOT silently
  // classify ambiguous-after-Stripe as fatal.
  const { client } = makeDdbStub({
    getResponses: [undefined, undefined, undefined, undefined],
    transactWriteBehaviours: [
      makeNamedError("SomeBrandNewAwsError", "unknown error"),
      makeNamedError("SomeBrandNewAwsError"),
      makeNamedError("SomeBrandNewAwsError"),
    ],
  });
  const { stripe } = makeStripeStub({ customerId: "cus_unknown" });
  const service = createProvisioningService({ ...baseDeps, ddb: client, stripe });
  const result = await service.provisionOrg({
    orgId: "org_unknown",
    ownerEmail: "u@example.com",
    actorId: "u",
    source: "clerk-webhook",
  });
  assert.equal(result.status, "retryable_failure");
  assert.equal(result.stripeCustomerId, "cus_unknown");
});

test("Bug 7: read TimeoutError still classifies as transient (parity with prior Bug 4 behaviour)", async () => {
  // Sanity: the classifier refactor must NOT regress the Bug 4 fix
  // that made TimeoutError on reads transient. Unified classifier
  // must preserve this.
  const { client } = makeDdbStub({
    getResponses: [makeNamedError("TimeoutError", "Request timed out")],
  });
  const { stripe, createCalls } = makeStripeStub({});
  const service = createProvisioningService({ ...baseDeps, ddb: client, stripe });
  const result = await service.provisionOrg({
    orgId: "org_read_to",
    ownerEmail: "r@example.com",
    actorId: "u",
    source: "clerk-webhook",
  });
  assert.equal(result.status, "retryable_failure");
  assert.equal(createCalls.length, 0, "no Stripe call on preflight failure");
});

test("Bug 7: read with unknown-name error (ambiguous) → retryable (safe default on read path)", async () => {
  // On the read path (no side-effect yet) we default ambiguous to
  // transient. The caller's exhaustive switch maps transient →
  // retryable_failure.
  const { client } = makeDdbStub({
    getResponses: [makeNamedError("FutureSdkError", "didn't exist when this was written")],
  });
  const { stripe } = makeStripeStub({});
  const service = createProvisioningService({ ...baseDeps, ddb: client, stripe });
  const result = await service.provisionOrg({
    orgId: "org_read_u",
    ownerEmail: "ru@example.com",
    actorId: "u",
    source: "clerk-webhook",
  });
  assert.equal(result.status, "retryable_failure");
});

test("Bug 7: read with Smithy $retryable trait classifies as transient", async () => {
  const { client } = makeDdbStub({
    getResponses: [makeSmithyRetryableError("novel retryable read error")],
  });
  const { stripe } = makeStripeStub({});
  const service = createProvisioningService({ ...baseDeps, ddb: client, stripe });
  const result = await service.provisionOrg({
    orgId: "org_sm_read",
    ownerEmail: "sm@example.com",
    actorId: "u",
    source: "clerk-webhook",
  });
  assert.equal(result.status, "retryable_failure");
});

test("Bug 7: read with ValidationException classifies as fatal (parity with write path)", async () => {
  const { client } = makeDdbStub({
    getResponses: [makeNamedError("ValidationException", "bad key shape")],
  });
  const { stripe, createCalls } = makeStripeStub({});
  const service = createProvisioningService({ ...baseDeps, ddb: client, stripe });
  const result = await service.provisionOrg({
    orgId: "org_read_val",
    ownerEmail: "v@example.com",
    actorId: "u",
    source: "clerk-webhook",
  });
  assert.equal(result.status, "fatal_failure");
  assert.equal(createCalls.length, 0);
});

// ---------------------------------------------------------------------------
// Bug 6 regression — best-effort email failures must not throw out of provisionOrg
// ---------------------------------------------------------------------------

test("Bug 6: rejecting injected sender after envelope commit → created + emailSent: false (no throw)", async () => {
  // Real failure mode: an injected sender (custom SES client, Postmark
  // adapter, in-process queue, anything) rejects AFTER the envelope is
  // durably committed. The default sender catches its own errors, but
  // `EmailSender` is a public interface — injected implementations
  // are not contractually required to be exception-free. The boundary
  // guard in provisionOrg must translate the throw into emailSent:
  // false rather than letting it escape and turn a durable success
  // into a 500.
  const orgId = "org_email_throw";
  const { client } = makeDdbStub({
    getResponses: [undefined, completeEnvelope(orgId, "cus_email_throw")],
  });
  const { stripe } = makeStripeStub({ customerId: "cus_email_throw" });
  let senderCalled = false;
  const rejectingSender: EmailSender = async () => {
    senderCalled = true;
    throw new Error("simulated SES outage / Postmark 502 / network reset");
  };
  const previous = process.env.WELCOME_EMAIL_FROM;
  process.env.WELCOME_EMAIL_FROM = "noreply@prontiq.dev";
  let result: Awaited<ReturnType<ReturnType<typeof createProvisioningService>["provisionOrg"]>> | undefined;
  let threw = false;
  try {
    const service = createProvisioningService({
      ...baseDeps,
      ddb: client,
      stripe,
      sendWelcomeEmail: rejectingSender,
    });
    try {
      result = await service.provisionOrg({
        orgId,
        ownerEmail: "x@example.com",
        actorId: "u",
        source: "clerk-webhook",
      });
    } catch {
      threw = true;
    }
  } finally {
    if (previous === undefined) {
      delete process.env.WELCOME_EMAIL_FROM;
    } else {
      process.env.WELCOME_EMAIL_FROM = previous;
    }
  }
  assert.equal(threw, false, "provisionOrg MUST NOT throw when an injected sender rejects post-commit");
  assert.ok(result, "result must be defined");
  assert.equal(result.status, "created", "org IS provisioned — status must be created");
  assert.equal(result.emailSent, false, "rejecting sender → emailSent: false");
  assert.equal(result.stripeCustomerId, "cus_email_throw");
  assert.ok(result.orgEnvelope, "envelope must be returned");
  assert.equal(senderCalled, true, "sender was actually invoked (verify the guard caught it, not the env-var early-out)");
});

test("Bug 6: synchronously-throwing sender (not a promise rejection) is also caught", async () => {
  // Defensive: a sender that throws before its await — e.g. constructor
  // error in a builder pattern, mistyped destructuring — would normally
  // synchronously throw out of `await sender(...)`. `await` on a
  // synchronous throw still propagates the exception. Verify the
  // try/catch in the boundary guard handles this too.
  const orgId = "org_email_sync_throw";
  const { client } = makeDdbStub({
    getResponses: [undefined, completeEnvelope(orgId, "cus_email_sync")],
  });
  const { stripe } = makeStripeStub({ customerId: "cus_email_sync" });
  const syncThrowingSender = (() => {
    throw new Error("constructor exploded");
  }) as unknown as EmailSender;
  const previous = process.env.WELCOME_EMAIL_FROM;
  process.env.WELCOME_EMAIL_FROM = "noreply@prontiq.dev";
  let result: Awaited<ReturnType<ReturnType<typeof createProvisioningService>["provisionOrg"]>> | undefined;
  let threw = false;
  try {
    const service = createProvisioningService({
      ...baseDeps,
      ddb: client,
      stripe,
      sendWelcomeEmail: syncThrowingSender,
    });
    try {
      result = await service.provisionOrg({
        orgId,
        ownerEmail: "y@example.com",
        actorId: "u",
        source: "clerk-webhook",
      });
    } catch {
      threw = true;
    }
  } finally {
    if (previous === undefined) {
      delete process.env.WELCOME_EMAIL_FROM;
    } else {
      process.env.WELCOME_EMAIL_FROM = previous;
    }
  }
  assert.equal(threw, false, "synchronous throws from injected senders must also be caught");
  assert.ok(result);
  assert.equal(result.status, "created");
  assert.equal(result.emailSent, false);
});

// ---------------------------------------------------------------------------
// Existing happy-path tests below
// ---------------------------------------------------------------------------

test("welcome email is sent through injected sender when WELCOME_EMAIL_FROM is set", async () => {
  const orgId = "org_email";
  const { client } = makeDdbStub({
    getResponses: [undefined, completeEnvelope(orgId, "cus_e")],
  });
  const { stripe } = makeStripeStub({ customerId: "cus_e" });
  const calls: unknown[] = [];
  const sender: EmailSender = async (input) => {
    calls.push(input);
    return true;
  };
  const previous = process.env.WELCOME_EMAIL_FROM;
  process.env.WELCOME_EMAIL_FROM = "noreply@prontiq.dev";
  try {
    const service = createProvisioningService({
      ...baseDeps,
      ddb: client,
      stripe,
      sendWelcomeEmail: sender,
    });
    const result = await service.provisionOrg({
      orgId,
      ownerEmail: "e@example.com",
      actorId: "user_z",
      source: "clerk-webhook",
    });
    assert.equal(result.status, "created");
    assert.equal(result.emailSent, true);
    assert.equal(calls.length, 1);
  } finally {
    if (previous === undefined) {
      delete process.env.WELCOME_EMAIL_FROM;
    } else {
      process.env.WELCOME_EMAIL_FROM = previous;
    }
  }
});

test("welcome email is skipped silently when WELCOME_EMAIL_FROM is unset", async () => {
  const orgId = "org_nomail";
  const { client } = makeDdbStub({
    getResponses: [undefined, completeEnvelope(orgId, "cus_n")],
  });
  const { stripe } = makeStripeStub({ customerId: "cus_n" });
  const calls: unknown[] = [];
  const sender: EmailSender = async (input) => {
    calls.push(input);
    return true;
  };
  const previous = process.env.WELCOME_EMAIL_FROM;
  delete process.env.WELCOME_EMAIL_FROM;
  try {
    const service = createProvisioningService({
      ...baseDeps,
      ddb: client,
      stripe,
      sendWelcomeEmail: sender,
    });
    const result = await service.provisionOrg({
      orgId,
      ownerEmail: "n@example.com",
      actorId: "user_z",
      source: "clerk-webhook",
    });
    assert.equal(result.status, "created");
    assert.equal(result.emailSent, false);
    assert.equal(calls.length, 0);
  } finally {
    if (previous !== undefined) {
      process.env.WELCOME_EMAIL_FROM = previous;
    }
  }
});
