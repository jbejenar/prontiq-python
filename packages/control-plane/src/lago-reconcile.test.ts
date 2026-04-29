import assert from "node:assert/strict";
import test from "node:test";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { GetCommand, QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import type { ApiKeyRecord, OrgEnvelopeRecord } from "@prontiq/shared";
import type { HttpLagoEntitlementsClient } from "./lago-entitlements.js";
import { reconcileLagoEntitlements } from "./lago-reconcile.js";

interface CommandLog {
  type: "Get" | "Query" | "Update";
  args: unknown;
}

const snapshot = {
  externalCustomerId: "pq_cust_test",
  externalSubscriptionId: "pq_sub_test",
  planCode: "payg_aud",
  status: "active",
  billingPeriodStartedAt: "2026-04-01T00:00:00Z",
  billingPeriodEndingAt: "2026-05-01T00:00:00Z",
};

function makeEnvelope(): OrgEnvelopeRecord {
  return {
    activeKeyCount: 1,
    apiKeyHash: "ORG#org_test",
    completedAt: "2026-04-01T00:00:00.000Z",
    hasFirstKey: true,
    lagoSubscriptionExternalId: "pq_sub_test",
    orgId: "org_test",
    ownerEmail: "owner@example.com",
    paymentOverdue: false,
    products: ["address"],
    quotaPerProduct: 5_000,
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    subscriptionItems: {},
    tier: "free",
  };
}

function makeStaleKey(): ApiKeyRecord {
  return {
    active: true,
    apiKeyHash: "hash_test",
    createdAt: "2026-04-01T00:00:00.000Z",
    keyId: "key_01HXTESTKEY00000000000000",
    keyPrefix: "pq_live_test",
    lastUsedAt: null,
    orgId: "org_test",
    ownerEmail: "owner@example.com",
    paymentOverdue: false,
    products: ["address"],
    quotaPerProduct: 5_000,
    rateLimit: 10,
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    subscriptionItems: {},
    tier: "free",
  };
}

function makeDdbStub(envelope: OrgEnvelopeRecord, keys: ApiKeyRecord[]): {
  client: DynamoDBDocumentClient;
  log: CommandLog[];
} {
  const log: CommandLog[] = [];
  const client = {
    async send(command: unknown) {
      if (command instanceof GetCommand) {
        log.push({ type: "Get", args: command.input });
        return { Item: envelope };
      }
      if (command instanceof QueryCommand) {
        log.push({ type: "Query", args: command.input });
        return { Items: keys };
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

function makeLagoStub(): HttpLagoEntitlementsClient {
  return {
    async getSubscription() {
      return snapshot;
    },
    async getSubscriptionCharges() {
      return [
        {
          billableMetricCode: "prontiq_address_requests",
          chargeModel: "standard",
          properties: { amount: "0.0015" },
        },
      ];
    },
    async getSubscriptionEntitlements() {
      return [
        { featureCode: "api_keys", privileges: { max: 3 } },
        {
          featureCode: "address_api",
          privileges: {
            enabled: true,
            enforcement_mode: "uncapped_tracked",
            rate_limit_per_second: 25,
          },
        },
      ];
    },
  } as unknown as HttpLagoEntitlementsClient;
}

test("reconcileLagoEntitlements repairs active key rows because auth reads keys on the hot path", async () => {
  const { client, log } = makeDdbStub(makeEnvelope(), [makeStaleKey()]);

  const stats = await reconcileLagoEntitlements({
    apply: true,
    ddb: client,
    keysTableName: "keys",
    lagoClient: makeLagoStub(),
    logger: console,
    now: () => new Date("2026-04-29T00:00:00.000Z"),
    orgId: "org_test",
  });

  assert.deepEqual(stats, { changed: 1, drift: 0, errors: 0, projected: 0, scanned: 1 });

  const updates = log.filter((entry) => entry.type === "Update");
  assert.equal(updates.length, 2, "expected envelope and active key projection updates");

  const keyUpdate = updates.find((entry) => {
    const args = entry.args as { Key?: { apiKeyHash?: string } };
    return args.Key?.apiKeyHash === "hash_test";
  });
  assert.ok(keyUpdate, "active key row must be repaired");
  const input = keyUpdate.args as {
    ExpressionAttributeValues: Record<string, unknown>;
  };
  assert.equal(input.ExpressionAttributeValues[":tier"], "payg_aud");
  assert.equal(input.ExpressionAttributeValues[":quotaPerProduct"], null);
  assert.equal(input.ExpressionAttributeValues[":enforcementMode"], "uncapped_tracked");
  assert.equal(input.ExpressionAttributeValues[":rateLimit"], 25);
});

test("reconcileLagoEntitlements updates billing-period envelope projection even with zero active keys", async () => {
  const envelope = {
    ...makeEnvelope(),
    activeKeyCount: 0,
    hasFirstKey: false,
    products: ["address"],
    quotaPerProduct: null,
    enforcementMode: "uncapped_tracked",
    rateLimit: 25,
    maxKeys: 3,
    tier: "payg_aud",
    lagoPlanCode: "payg_aud",
    lagoSubscriptionStatus: "active",
    billingPeriodStartedAt: "2026-03-01T00:00:00Z",
    billingPeriodEndingAt: "2026-04-01T00:00:00Z",
    billingPeriodKey: "2026-03-01_2026-04-01",
  } satisfies OrgEnvelopeRecord;
  const { client, log } = makeDdbStub(envelope, []);

  const stats = await reconcileLagoEntitlements({
    apply: true,
    ddb: client,
    keysTableName: "keys",
    lagoClient: makeLagoStub(),
    logger: console,
    now: () => new Date("2026-04-29T00:00:00.000Z"),
    orgId: "org_test",
  });

  assert.deepEqual(stats, { changed: 1, drift: 0, errors: 0, projected: 0, scanned: 1 });
  const updates = log.filter((entry) => entry.type === "Update");
  assert.equal(updates.length, 1, "expected envelope-only update when no active keys exist");
  const update = updates[0];
  assert.ok(update);
  const input = update.args as {
    Key?: { apiKeyHash?: string };
    ExpressionAttributeValues: Record<string, unknown>;
  };
  assert.equal(input.Key?.apiKeyHash, "ORG#org_test");
  assert.equal(input.ExpressionAttributeValues[":periodStart"], "2026-04-01T00:00:00Z");
  assert.equal(input.ExpressionAttributeValues[":periodEnd"], "2026-05-01T00:00:00Z");
  assert.equal(input.ExpressionAttributeValues[":periodKey"], "2026-04-01_2026-05-01");
  assert.equal(input.ExpressionAttributeValues[":tier"], "payg_aud");
  assert.equal(input.ExpressionAttributeValues[":subscriptionStatus"], "active");
});

test("reconcileLagoEntitlements treats missing Lago rate limit as drift and preserves rows", async () => {
  const { client, log } = makeDdbStub(makeEnvelope(), [makeStaleKey()]);
  const lagoClient = {
    ...makeLagoStub(),
    async getSubscriptionEntitlements() {
      return [
        { featureCode: "api_keys", privileges: { max: 3 } },
        {
          featureCode: "address_api",
          privileges: {
            enabled: true,
            enforcement_mode: "uncapped_tracked",
          },
        },
      ];
    },
  } as unknown as HttpLagoEntitlementsClient;

  const stats = await reconcileLagoEntitlements({
    apply: true,
    ddb: client,
    keysTableName: "keys",
    lagoClient,
    logger: console,
    now: () => new Date("2026-04-29T00:00:00.000Z"),
    orgId: "org_test",
  });

  assert.deepEqual(stats, { changed: 0, drift: 1, errors: 0, projected: 0, scanned: 1 });
  const updates = log.filter((entry) => entry.type === "Update");
  assert.equal(updates.length, 1, "drift should only mark the envelope sync status");
  const input = updates[0]?.args as {
    Key?: { apiKeyHash?: string };
    ExpressionAttributeValues: Record<string, unknown>;
  };
  assert.equal(input.Key?.apiKeyHash, "ORG#org_test");
  assert.equal(input.ExpressionAttributeValues[":status"], "drift");
  assert.match(String(input.ExpressionAttributeValues[":error"]), /rate_limit_per_second/);
});
