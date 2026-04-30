import test from "node:test";
import assert from "node:assert/strict";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import {
  GetCommand,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { deriveLagoExternalSubscriptionIdForOrg } from "@prontiq/shared";
import {
  HttpLagoProvisioningClient,
  createProvisioningService,
  type EmailSender,
} from "./provisioning.js";

interface CommandLog {
  type: "Get" | "Query" | "TransactWrite" | "Update";
  args: unknown;
}

type GetBehaviour = Record<string, unknown> | undefined | Error;

function makeDdbStub(
  options: {
    getResponses?: GetBehaviour[];
    queryResponses?: unknown[][];
    transactWriteBehaviours?: ("ok" | Error)[];
    updateBehaviours?: ("ok" | Error)[];
  } = {},
): {
  client: DynamoDBDocumentClient;
  log: CommandLog[];
} {
  const log: CommandLog[] = [];
  const getQueue = [...(options.getResponses ?? [])];
  const queryQueue = [...(options.queryResponses ?? [])];
  const txQueue = [...(options.transactWriteBehaviours ?? [])];
  const updateQueue = [...(options.updateBehaviours ?? [])];
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
        return { Items: queryQueue.shift() ?? [] };
      }
      if (command instanceof TransactWriteCommand) {
        log.push({ type: "TransactWrite", args: command.input });
        const next = txQueue.shift() ?? "ok";
        if (next instanceof Error) throw next;
        return {};
      }
      if (command instanceof UpdateCommand) {
        log.push({ type: "Update", args: command.input });
        const next = updateQueue.shift() ?? "ok";
        if (next instanceof Error) throw next;
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

const legacyCustomerId = "pq_cust_01HYZ6Q4X6DJP2X9Q9FQKX4T7A";
const legacySubscriptionId = "pq_sub_01HYZ6Q4X6DJP2X9Q9FQKX4T7A";

const completeEnvelope = (orgId: string) => ({
  apiKeyHash: `ORG#${orgId}`,
  orgId,
  stripeCustomerId: null,
  ownerEmail: "owner@example.com",
  ownerUserId: "user_owner",
  paymentOverdue: false,
  stripeSubscriptionId: null,
  subscriptionItems: {},
  tier: "free",
  products: ["address"],
  hasFirstKey: false,
  completedAt: "2026-04-17T00:00:00.000Z",
});

const incompleteProductlessEnvelope = (orgId: string) => ({
  ...completeEnvelope(orgId),
  products: [],
});

const legacyEnvelope = (orgId: string) => ({
  ...completeEnvelope(orgId),
  customerId: legacyCustomerId,
});

const lagoBootstrappedEnvelope = (orgId: string) => ({
  ...completeEnvelope(orgId),
  billingPeriodEndingAt: "2026-05-26T00:00:00.000Z",
  billingPeriodKey: "2026-04-26T00:00:00.000Z__2026-05-26T00:00:00.000Z",
  billingPeriodStartedAt: "2026-04-26T00:00:00.000Z",
  enforcementMode: "hard_cap",
  lagoEntitlementsHash: "hash_test",
  lagoLastSyncError: null,
  lagoLastSyncStatus: "synced",
  lagoLastSyncedAt: "2026-04-26T00:00:00.000Z",
  lagoPaymentOverdueInvoiceId: null,
  lagoPlanCode: "free",
  lagoSubscriptionExternalId: deriveLagoExternalSubscriptionIdForOrg(orgId),
  lagoSubscriptionStatus: "active",
  maxKeys: 2,
  quotaPerProduct: 10_000,
  rateLimit: 10,
});

const legacyLagoBootstrappedEnvelope = (orgId: string) => ({
  ...legacyEnvelope(orgId),
  billingPeriodEndingAt: "2026-05-26T00:00:00.000Z",
  billingPeriodKey: "2026-04-26T00:00:00.000Z__2026-05-26T00:00:00.000Z",
  billingPeriodStartedAt: "2026-04-26T00:00:00.000Z",
  lagoPaymentOverdueInvoiceId: null,
  lagoPlanCode: "free",
  lagoSubscriptionExternalId: legacySubscriptionId,
  lagoSubscriptionStatus: "active",
});

function makeLagoProvisioningClient(
  options: {
    getSubscriptionResponses?: Array<"snapshot" | null>;
    omitRateLimitEntitlement?: boolean;
    snapshotPlanCode?: string;
    snapshotStatus?: string;
    throwIfCalled?: boolean;
  } = {},
) {
  const calls: { method: string; args: unknown }[] = [];
  const getSubscriptionResponses = [...(options.getSubscriptionResponses ?? ["snapshot"])];
  let lastExternalCustomerId: string | undefined;
  return {
    calls,
    client: {
      async upsertCustomer(args: unknown) {
        if (options.throwIfCalled) throw new Error("Lago must not be called");
        calls.push({ method: "upsertCustomer", args });
        if (typeof args === "object" && args && "orgId" in args) {
          const maybeOrgId = (args as { orgId?: unknown }).orgId;
          if (typeof maybeOrgId === "string") lastExternalCustomerId = maybeOrgId;
        }
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
          externalCustomerId: lastExternalCustomerId ?? "org_unknown",
          externalSubscriptionId: String(args),
          planCode: options.snapshotPlanCode ?? "free",
          status: options.snapshotStatus ?? "active",
        };
      },
      async getSubscriptionCharges() {
        return [
          {
            billableMetricCode: "prontiq_address_requests",
            chargeModel: "package",
            properties: { free_units: 10_000 },
          },
        ];
      },
      async getSubscriptionEntitlements() {
        return [
          { featureCode: "api_keys", privileges: { max: 2 } },
          {
            featureCode: "address_api",
            privileges: {
              enabled: true,
              monthly_quota: 10_000,
              ...(options.omitRateLimitEntitlement ? {} : { rate_limit_per_second: 10 }),
              enforcement_mode: "hard_cap",
            },
          },
        ];
      },
    },
  };
}

const noopLogger = { error: () => {}, info: () => {}, warn: () => {} };
const noopSleep = async () => {};
const noopEmail: EmailSender = async () => true;

const baseDeps = {
  keysTableName: "keys",
  auditTableName: "audit",
  lagoPaymentProviderCode: "stripe-main",
  logger: noopLogger,
  sleep: noopSleep,
  sendWelcomeEmail: noopEmail,
};

test("Lago customer upsert requests Stripe provider sync through Lago", async () => {
  const requests: Array<{ body: unknown; path: string }> = [];
  const fetchMock = (async (url: string | URL | Request, init?: RequestInit) => {
    requests.push({
      body: init?.body ? JSON.parse(String(init.body)) : null,
      path: String(url),
    });
    return new Response(JSON.stringify({ customer: { external_id: "org_abc" } }), {
      status: 200,
    });
  }) as typeof fetch;
  const client = new HttpLagoProvisioningClient({
    apiKey: "test-key",
    baseUrl: "https://billing-dev.prontiq.dev",
    fetchImpl: fetchMock,
  });

  await client.upsertCustomer({
    email: "owner@example.com",
    name: "Owner Person",
    orgId: "org_abc",
    paymentProviderCode: "stripe-main",
  });

  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.path, "https://billing-dev.prontiq.dev/api/v1/customers");
  assert.deepEqual(requests[0]?.body, {
    customer: {
      billing_configuration: {
        invoice_grace_period: 0,
        payment_provider: "stripe",
        payment_provider_code: "stripe-main",
        provider_payment_methods: ["card", "link"],
        sync: true,
        sync_with_provider: true,
      },
      currency: "AUD",
      email: "owner@example.com",
      external_id: "org_abc",
      name: "Owner Person",
    },
  });
});

test("Lago customer upsert falls back to email when display name is blank", async () => {
  const requests: Array<{ body: unknown; path: string }> = [];
  const fetchMock = (async (url: string | URL | Request, init?: RequestInit) => {
    requests.push({
      body: init?.body ? JSON.parse(String(init.body)) : null,
      path: String(url),
    });
    return new Response(JSON.stringify({ customer: { external_id: "org_abc" } }), {
      status: 200,
    });
  }) as typeof fetch;
  const client = new HttpLagoProvisioningClient({
    apiKey: "test-key",
    baseUrl: "https://billing-dev.prontiq.dev",
    fetchImpl: fetchMock,
  });

  await client.upsertCustomer({
    email: "owner@example.com",
    name: "   ",
    orgId: "org_abc",
    paymentProviderCode: "stripe-main",
  });

  assert.equal(
    (requests[0]?.body as { customer?: { name?: string } } | undefined)?.customer?.name,
    "owner@example.com",
  );
});

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
  assert.equal(result.orgEnvelope?.orgId, "org_abc");
  assert.equal(result.orgEnvelope?.lagoSubscriptionExternalId, "lago_sub_org_abc");
  assert.equal(result.stripeCustomerId, null);
  assert.equal(log.length, 1);
});

test("syncOwnerEmail upserts Lago customer and updates envelope plus key owner emails", async () => {
  const keyRows = [
    {
      apiKeyHash: "hash_1",
      keyPrefix: "pq_live_1111",
      orgId: "org_email",
      ownerEmail: "old@example.com",
    },
    {
      apiKeyHash: "hash_2",
      keyPrefix: "pq_live_2222",
      orgId: "org_email",
      ownerEmail: "old@example.com",
    },
    {
      apiKeyHash: "ORG#org_email",
      orgId: "org_email",
      ownerEmail: "old@example.com",
    },
  ];
  const { client, log } = makeDdbStub({
    getResponses: [lagoBootstrappedEnvelope("org_email")],
    queryResponses: [keyRows],
  });
  const lago = makeLagoProvisioningClient();
  const service = createProvisioningService({ ...baseDeps, ddb: client, lagoClient: lago.client });

  const result = await service.syncOwnerEmail({
    orgId: "org_email",
    ownerEmail: "new@example.com",
    ownerName: "New Owner",
    actorId: "user_owner",
    source: "clerk-user-updated",
  });

  assert.equal(result.status, "updated");
  assert.equal(result.orgEnvelope?.ownerEmail, "new@example.com");
  assert.equal(result.keysUpdated, 2);
  assert.deepEqual(lago.calls[0], {
    method: "upsertCustomer",
    args: {
      orgId: "org_email",
      email: "new@example.com",
      name: "New Owner",
      paymentProviderCode: "stripe-main",
    },
  });
  const updateInputs = log
    .filter((entry) => entry.type === "Update")
    .map((entry) => entry.args as { Key?: Record<string, unknown> });
  assert.deepEqual(
    updateInputs.map((input) => input.Key?.apiKeyHash),
    ["ORG#org_email", "hash_1", "hash_2"],
  );
});

test("syncOwnerEmail still upserts Lago when local ownerEmail is already current", async () => {
  const { client, log } = makeDdbStub({
    getResponses: [lagoBootstrappedEnvelope("org_same")],
    queryResponses: [
      [
        {
          apiKeyHash: "hash_same",
          keyPrefix: "pq_live_same",
          orgId: "org_same",
          ownerEmail: "owner@example.com",
        },
      ],
    ],
  });
  const lago = makeLagoProvisioningClient();
  const service = createProvisioningService({ ...baseDeps, ddb: client, lagoClient: lago.client });

  const result = await service.syncOwnerEmail({
    orgId: "org_same",
    ownerEmail: "owner@example.com",
    ownerName: "Owner Person",
    actorId: "user_owner",
    source: "clerk-user-updated",
  });

  assert.equal(result.status, "already_current");
  assert.equal(result.keysUpdated, 0);
  assert.deepEqual(lago.calls[0], {
    method: "upsertCustomer",
    args: {
      orgId: "org_same",
      email: "owner@example.com",
      name: "Owner Person",
      paymentProviderCode: "stripe-main",
    },
  });
  assert.equal(log.filter((entry) => entry.type === "Update").length, 0);
});

test("syncOwnerEmail repairs stale key owner emails even when envelope is already current", async () => {
  const { client, log } = makeDdbStub({
    getResponses: [lagoBootstrappedEnvelope("org_keystale")],
    queryResponses: [
      [
        {
          apiKeyHash: "hash_stale",
          keyPrefix: "pq_live_stale",
          orgId: "org_keystale",
          ownerEmail: "old@example.com",
        },
        {
          apiKeyHash: "hash_current",
          keyPrefix: "pq_live_current",
          orgId: "org_keystale",
          ownerEmail: "owner@example.com",
        },
      ],
    ],
  });
  const lago = makeLagoProvisioningClient();
  const service = createProvisioningService({ ...baseDeps, ddb: client, lagoClient: lago.client });

  const result = await service.syncOwnerEmail({
    orgId: "org_keystale",
    ownerEmail: "owner@example.com",
    actorId: "user_owner",
    source: "clerk-user-updated",
  });

  assert.equal(result.status, "updated");
  assert.equal(result.keysUpdated, 1);
  const updateInputs = log
    .filter((entry) => entry.type === "Update")
    .map((entry) => entry.args as { Key?: Record<string, unknown> });
  assert.deepEqual(
    updateInputs.map((input) => input.Key?.apiKeyHash),
    ["hash_stale"],
  );
});

test("syncOwnerEmail skips invited admins who are not the recorded owner", async () => {
  const { client, log } = makeDdbStub({
    getResponses: [lagoBootstrappedEnvelope("org_invitedadmin")],
  });
  const lago = makeLagoProvisioningClient({ throwIfCalled: true });
  const service = createProvisioningService({ ...baseDeps, ddb: client, lagoClient: lago.client });

  const result = await service.syncOwnerEmail({
    orgId: "org_invitedadmin",
    ownerEmail: "invited-admin@example.com",
    actorId: "user_invited_admin",
    source: "clerk-user-updated",
  });

  assert.equal(result.status, "not_owner");
  assert.equal(log.filter((entry) => entry.type === "Update").length, 0);
});

test("syncOwnerEmail requires ownerUserId on existing envelopes before updating Lago", async () => {
  const envelope = lagoBootstrappedEnvelope("org_missingowner");
  delete (envelope as { ownerUserId?: string }).ownerUserId;
  const { client, log } = makeDdbStub({
    getResponses: [envelope],
  });
  const lago = makeLagoProvisioningClient({ throwIfCalled: true });
  const service = createProvisioningService({ ...baseDeps, ddb: client, lagoClient: lago.client });

  const result = await service.syncOwnerEmail({
    orgId: "org_missingowner",
    ownerEmail: "new@example.com",
    actorId: "user_owner",
    source: "clerk-user-updated",
  });

  assert.equal(result.status, "owner_identity_missing");
  assert.equal(log.filter((entry) => entry.type === "Update").length, 0);
});

test("syncOwnerEmail always uses Clerk orgId for Lago customer external id", async () => {
  const { client } = makeDdbStub({
    getResponses: [legacyLagoBootstrappedEnvelope("org_legacy_email")],
    queryResponses: [[]],
  });
  const lago = makeLagoProvisioningClient();
  const service = createProvisioningService({ ...baseDeps, ddb: client, lagoClient: lago.client });

  const result = await service.syncOwnerEmail({
    orgId: "org_legacy_email",
    ownerEmail: "new@example.com",
    actorId: "user_owner",
    source: "clerk-user-updated",
  });

  assert.equal(result.status, "updated");
  assert.deepEqual(lago.calls[0], {
    method: "upsertCustomer",
    args: {
      orgId: "org_legacy_email",
      email: "new@example.com",
      paymentProviderCode: "stripe-main",
    },
  });
});

test("syncOwnerEmail returns not_found for unprovisioned org and does not call Lago", async () => {
  const { client } = makeDdbStub({ getResponses: [undefined] });
  const lago = makeLagoProvisioningClient({ throwIfCalled: true });
  const service = createProvisioningService({ ...baseDeps, ddb: client, lagoClient: lago.client });

  const result = await service.syncOwnerEmail({
    orgId: "org_missing",
    ownerEmail: "new@example.com",
    actorId: "user_owner",
    source: "clerk-user-updated",
  });

  assert.equal(result.status, "not_found");
});

test("syncOwnerEmail returns retryable_failure when Lago customer upsert fails", async () => {
  const { client, log } = makeDdbStub({
    getResponses: [lagoBootstrappedEnvelope("org_lagodown")],
  });
  const lago = makeLagoProvisioningClient({ throwIfCalled: true });
  const service = createProvisioningService({ ...baseDeps, ddb: client, lagoClient: lago.client });

  const result = await service.syncOwnerEmail({
    orgId: "org_lagodown",
    ownerEmail: "new@example.com",
    actorId: "user_owner",
    source: "clerk-user-updated",
  });

  assert.equal(result.status, "retryable_failure");
  assert.equal(log.filter((entry) => entry.type === "Update").length, 0);
});

test("existing incomplete active Lago envelope is bootstrapped before replay returns", async () => {
  const { client, log } = makeDdbStub({
    getResponses: [
      incompleteProductlessEnvelope("org_bootstrap"),
      lagoBootstrappedEnvelope("org_bootstrap"),
    ],
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
  assert.equal(result.orgEnvelope?.orgId, "org_bootstrap");
  assert.deepEqual(result.orgEnvelope?.products, ["address"]);
  assert.equal(result.orgEnvelope?.quotaPerProduct, 10_000);
  assert.equal(result.orgEnvelope?.rateLimit, 10);
  assert.equal(result.orgEnvelope?.maxKeys, 2);
  assert.equal(result.orgEnvelope?.lagoSubscriptionExternalId, "lago_sub_org_bootstrap");
  assert.deepEqual(
    lago.calls.map((call) => call.method),
    ["upsertCustomer", "getSubscription", "upsertSubscription", "getSubscription"],
  );
  assert.equal(log.filter((entry) => entry.type === "Update").length, 1);
});

test("creates org envelope and bootstraps Lago Free subscription", async () => {
  const { client, log } = makeDdbStub({
    getResponses: [undefined, lagoBootstrappedEnvelope("org_new")],
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
  assert.equal(result.orgEnvelope?.orgId, "org_new");
  assert.deepEqual(result.orgEnvelope?.products, ["address"]);
  assert.equal(result.orgEnvelope?.quotaPerProduct, 10_000);
  assert.equal(result.orgEnvelope?.rateLimit, 10);
  assert.equal(result.orgEnvelope?.maxKeys, 2);
  assert.equal(result.orgEnvelope?.lagoSubscriptionExternalId, "lago_sub_org_new");
  assert.equal(result.stripeCustomerId, null);
  assert.equal(result.emailSent, true);
  assert.equal(log.filter((entry) => entry.type === "TransactWrite").length, 1);
  assert.equal(log.filter((entry) => entry.type === "Update").length, 0);
  const tx = log.find((entry) => entry.type === "TransactWrite")?.args as {
    TransactItems?: Array<{ Put?: { Item?: Record<string, unknown> } }>;
  };
  const envelopeItem = tx.TransactItems?.[0]?.Put?.Item;
  assert.deepEqual(envelopeItem?.products, ["address"]);
  assert.equal(envelopeItem?.quotaPerProduct, 10_000);
  assert.equal(envelopeItem?.rateLimit, 10);
  assert.equal(envelopeItem?.maxKeys, 2);
  assert.equal(envelopeItem?.lagoLastSyncStatus, "synced");
  assert.equal(envelopeItem?.ownerUserId, "user_x");
  assert.deepEqual(
    lago.calls.map((call) => call.method),
    ["upsertCustomer", "getSubscription"],
  );
});

test("pre-commit Lago bootstrap failure does not create a productless envelope", async () => {
  const { client, log } = makeDdbStub({
    getResponses: [undefined],
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
  assert.equal(result.orgEnvelope, undefined);
  assert.equal(result.stripeCustomerId, null);
  assert.equal(log.filter((entry) => entry.type === "TransactWrite").length, 0);
});

test("pre-commit Lago projection drift does not create a productless envelope", async () => {
  const { client, log } = makeDdbStub({
    getResponses: [undefined],
  });
  const lago = makeLagoProvisioningClient({ omitRateLimitEntitlement: true });
  const service = createProvisioningService({ ...baseDeps, ddb: client, lagoClient: lago.client });

  const result = await service.provisionOrg({
    orgId: "org_drift",
    ownerEmail: "owner@example.com",
    actorId: "user_x",
    source: "clerk-webhook",
  });

  assert.equal(result.status, "retryable_failure");
  assert.equal(result.orgEnvelope, undefined);
  assert.equal(log.filter((entry) => entry.type === "TransactWrite").length, 0);
  assert.deepEqual(
    lago.calls.map((call) => call.method),
    ["upsertCustomer", "getSubscription"],
  );
});

test("pre-commit existing paid Lago subscription does not create a local envelope", async () => {
  const { client, log } = makeDdbStub({
    getResponses: [undefined],
  });
  const lago = makeLagoProvisioningClient({ snapshotPlanCode: "payg_aud" });
  const service = createProvisioningService({ ...baseDeps, ddb: client, lagoClient: lago.client });

  const result = await service.provisionOrg({
    orgId: "org_paidlago",
    ownerEmail: "owner@example.com",
    actorId: "user_x",
    source: "account-setup",
  });

  assert.equal(result.status, "retryable_failure");
  assert.equal(result.orgEnvelope, undefined);
  assert.equal(log.filter((entry) => entry.type === "TransactWrite").length, 0);
  assert.deepEqual(
    lago.calls.map((call) => call.method),
    ["upsertCustomer", "getSubscription"],
  );
});

test("pre-commit existing inactive Lago subscription does not create a local envelope", async () => {
  for (const status of ["canceled", "terminated", "pending"] as const) {
    const { client, log } = makeDdbStub({
      getResponses: [undefined],
    });
    const lago = makeLagoProvisioningClient({ snapshotStatus: status });
    const service = createProvisioningService({
      ...baseDeps,
      ddb: client,
      lagoClient: lago.client,
    });

    const result = await service.provisionOrg({
      orgId: `org_${status}lago`,
      ownerEmail: "owner@example.com",
      actorId: "user_x",
      source: "account-setup",
    });

    assert.equal(result.status, "retryable_failure", status);
    assert.equal(result.orgEnvelope, undefined, status);
    assert.equal(log.filter((entry) => entry.type === "TransactWrite").length, 0, status);
    assert.deepEqual(
      lago.calls.map((call) => call.method),
      ["upsertCustomer", "getSubscription"],
      status,
    );
  }
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

test("existing complete legacy Lago ORG envelope still replays without migration side effects", async () => {
  const { client, log } = makeDdbStub({
    getResponses: [legacyLagoBootstrappedEnvelope("org_legacy_complete")],
  });
  const lago = makeLagoProvisioningClient({ throwIfCalled: true });
  const service = createProvisioningService({ ...baseDeps, ddb: client, lagoClient: lago.client });

  const result = await service.provisionOrg({
    orgId: "org_legacy_complete",
    ownerEmail: "owner@example.com",
    actorId: "user_x",
    source: "clerk-webhook",
  });

  assert.equal(result.status, "already_exists");
  assert.equal(result.orgEnvelope?.customerId, legacyCustomerId);
  assert.equal(result.orgEnvelope?.lagoSubscriptionExternalId, legacySubscriptionId);
  assert.equal(log.length, 1);
});

test("welcome email remains best-effort after successful Lago bootstrap", async () => {
  const { client } = makeDdbStub({
    getResponses: [undefined, lagoBootstrappedEnvelope("org_email")],
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
