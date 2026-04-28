import test from "node:test";
import assert from "node:assert/strict";
import { QueryCommand, ScanCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import type { ApiKeyRecord, OrgEnvelopeRecord } from "@prontiq/shared";
import { repairCommercialIdentity } from "./commercial-identity-repair.js";
import type { LagoProvisioningClient } from "./provisioning.js";

interface FakeDdbCommand {
  input?: {
    ExpressionAttributeValues?: Record<string, unknown>;
    Key?: Record<string, unknown>;
  };
}

function makeOrgEnvelope(input: {
  apiKeyHash: string;
  orgId?: string;
  lagoSubscriptionExternalId?: string | null;
}): OrgEnvelopeRecord {
  return {
    apiKeyHash: input.apiKeyHash,
    completedAt: "2026-04-27T00:00:00.000Z",
    hasFirstKey: true,
    lagoSubscriptionExternalId: input.lagoSubscriptionExternalId,
    orgId: input.orgId,
    ownerEmail: "owner@example.com",
    paymentOverdue: false,
    products: ["address"],
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    subscriptionItems: {},
    tier: "free",
  };
}

function makeApiKey(input: {
  apiKeyHash: string;
  lagoSubscriptionExternalId?: string | null;
  orgId: string;
}): ApiKeyRecord {
  return {
    active: true,
    apiKeyHash: input.apiKeyHash,
    keyId: "key_01TESTKEYIDREPAIR0000000001",
    createdAt: "2026-04-27T00:00:00.000Z",
    keyPrefix: "pq_test",
    lagoSubscriptionExternalId: input.lagoSubscriptionExternalId,
    lastUsedAt: null,
    orgId: input.orgId,
    ownerEmail: "owner@example.com",
    paymentOverdue: false,
    products: ["address"],
    quotaPerProduct: 1000,
    rateLimit: null,
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    subscriptionItems: {},
    tier: "free",
  };
}

function makeLagoClient(): LagoProvisioningClient & {
  customers: string[];
  subscriptions: string[];
} {
  const client = {
    customers: [] as string[],
    subscriptions: [] as string[],
    async getSubscription() {
      return null;
    },
    async upsertCustomer(input) {
      client.customers.push(input.orgId);
    },
    async upsertSubscription(input) {
      client.subscriptions.push(input.externalSubscriptionId);
    },
  } satisfies LagoProvisioningClient & {
    customers: string[];
    subscriptions: string[];
  };
  return client;
}

test("commercial identity repair skips retained non-Clerk ORG envelopes and continues scanning", async () => {
  const validOrgId = "org_3CtIYMeNMZQF9A9iQqBxkHkV03K";
  const invalidOrgId = "org_prontiq_platform_lago_smoke_dev";
  const validKey = makeApiKey({
    apiKeyHash: "hash_valid_key",
    lagoSubscriptionExternalId: null,
    orgId: validOrgId,
  });
  const updates: Array<Record<string, unknown> | undefined> = [];
  const ddb = {
    async send(command: FakeDdbCommand) {
      if (command instanceof ScanCommand) {
        return {
          Items: [
            makeOrgEnvelope({
              apiKeyHash: `ORG#${invalidOrgId}`,
              orgId: invalidOrgId,
            }),
            makeOrgEnvelope({
              apiKeyHash: `ORG#${validOrgId}`,
              orgId: validOrgId,
              lagoSubscriptionExternalId: null,
            }),
          ],
        };
      }
      if (command instanceof QueryCommand) {
        assert.equal(command.input?.ExpressionAttributeValues?.[":orgId"], validOrgId);
        return { Items: [validKey] };
      }
      if (command instanceof UpdateCommand) {
        updates.push(command.input?.Key);
        return {};
      }
      throw new Error(`Unexpected command: ${command.constructor.name}`);
    },
  } as unknown as DynamoDBDocumentClient;
  const lagoClient = makeLagoClient();

  const result = await repairCommercialIdentity({
    apply: true,
    ddb,
    keysTableName: "keys",
    lagoClient,
    lagoPaymentProviderCode: "stripe",
  });

  assert.equal(result.dryRun, false);
  assert.equal(result.orgsScanned, 2);
  assert.equal(result.orgsSkippedInvalid, 1);
  assert.deepEqual(result.invalidOrgEnvelopes, [
    {
      apiKeyHash: `ORG#${invalidOrgId}`,
      orgId: invalidOrgId,
      reason: "orgId is not a Clerk organization id",
    },
  ]);
  assert.equal(result.orgsUpdated, 1);
  assert.equal(result.keysUpdated, 1);
  assert.deepEqual(lagoClient.customers, [validOrgId]);
  assert.deepEqual(lagoClient.subscriptions, [`lago_sub_${validOrgId}`]);
  assert.deepEqual(updates, [{ apiKeyHash: `ORG#${validOrgId}` }, { apiKeyHash: "hash_valid_key" }]);
});

test("commercial identity repair dry run reports invalid ORG envelopes without mutating", async () => {
  const invalidOrgId = "org_prontiq_platform_lago_smoke_prod";
  let updateCount = 0;
  const ddb = {
    async send(command: FakeDdbCommand) {
      if (command instanceof ScanCommand) {
        return {
          Items: [
            makeOrgEnvelope({
              apiKeyHash: `ORG#${invalidOrgId}`,
              orgId: invalidOrgId,
            }),
          ],
        };
      }
      if (command instanceof UpdateCommand) {
        updateCount += 1;
        return {};
      }
      throw new Error(`Unexpected command: ${command.constructor.name}`);
    },
  } as unknown as DynamoDBDocumentClient;

  const result = await repairCommercialIdentity({
    ddb,
    keysTableName: "keys",
  });

  assert.equal(result.dryRun, true);
  assert.equal(result.orgsScanned, 1);
  assert.equal(result.orgsSkippedInvalid, 1);
  assert.equal(result.orgsUpdated, 0);
  assert.equal(result.keysUpdated, 0);
  assert.equal(updateCount, 0);
  assert.equal(result.invalidOrgEnvelopes[0]?.orgId, invalidOrgId);
});
