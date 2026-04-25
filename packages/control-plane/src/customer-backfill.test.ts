import test from "node:test";
import assert from "node:assert/strict";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { GetCommand, PutCommand, QueryCommand, ScanCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { backfillCustomers } from "./customer-backfill.js";

interface CommandLog {
  type: "Get" | "Put" | "Query" | "Scan" | "Update";
  input: Record<string, unknown>;
}

function makeDdbStub(options: {
  customers?: Record<string, Record<string, unknown>>;
  keysByOrg?: Record<string, Record<string, unknown>[]>;
  raceCustomersOnPut?: Record<string, Record<string, unknown>>;
  scanItems: Record<string, unknown>[];
}): {
  client: DynamoDBDocumentClient;
  log: CommandLog[];
  state: {
    customers: Record<string, Record<string, unknown>>;
    keysByOrg: Record<string, Record<string, unknown>[]>;
    scanItems: Record<string, unknown>[];
  };
} {
  const log: CommandLog[] = [];
  const customers = { ...options.customers };
  const raceCustomersOnPut = { ...options.raceCustomersOnPut };
  const keysByOrg = Object.fromEntries(
    Object.entries(options.keysByOrg ?? {}).map(([orgId, keys]) => [
      orgId,
      keys.map((key) => ({ ...key })),
    ]),
  );
  const scanItems = options.scanItems.map((item) => ({ ...item }));

  function conditionalCheckFailed(): Error {
    const error = new Error("ConditionalCheckFailedException");
    error.name = "ConditionalCheckFailedException";
    return error;
  }

  function setCustomerAttribute(
    customer: Record<string, unknown>,
    names: Record<string, string>,
    values: Record<string, unknown>,
    nameKey: string,
    valueKey: string,
    options: { ifNotExists?: boolean } = {},
  ): void {
    const attribute = names[nameKey];
    if (!attribute) return;
    if (options.ifNotExists && Object.hasOwn(customer, attribute)) return;
    customer[attribute] = values[valueKey];
  }

  function applyCustomerUpdate(input: Record<string, unknown>): void {
    const key = input.Key as { orgId?: string } | undefined;
    if (!key?.orgId) return;
    const names = input.ExpressionAttributeNames as Record<string, string>;
    const values = input.ExpressionAttributeValues as Record<string, unknown>;
    const customer = customers[key.orgId] ?? { orgId: key.orgId };
    setCustomerAttribute(customer, names, values, "#customerId", ":customerId", { ifNotExists: true });
    setCustomerAttribute(customer, names, values, "#lagoExternalCustomerId", ":customerId", {
      ifNotExists: true,
    });
    setCustomerAttribute(customer, names, values, "#lagoCustomerId", ":null", { ifNotExists: true });
    setCustomerAttribute(customer, names, values, "#stripeCustomerId", ":stripeCustomerId", {
      ifNotExists: true,
    });
    setCustomerAttribute(customer, names, values, "#ownerEmail", ":ownerEmail", { ifNotExists: true });
    setCustomerAttribute(customer, names, values, "#status", ":status");
    setCustomerAttribute(customer, names, values, "#conflictReason", ":reason");
    setCustomerAttribute(customer, names, values, "#updatedAt", ":updatedAt");
    setCustomerAttribute(customer, names, values, "#createdAt", ":createdAt", { ifNotExists: true });
    setCustomerAttribute(customer, names, values, "#backfilledAt", ":backfilledAt", {
      ifNotExists: true,
    });
    customers[key.orgId] = customer;
  }

  function applyKeyUpdate(input: Record<string, unknown>): void {
    const key = input.Key as { apiKeyHash?: string } | undefined;
    if (!key?.apiKeyHash) return;
    const values = input.ExpressionAttributeValues as { ":customerId"?: string };
    const customerId = values[":customerId"];
    for (const item of scanItems) {
      if (item.apiKeyHash === key.apiKeyHash) item.customerId = customerId;
    }
    for (const keys of Object.values(keysByOrg)) {
      for (const item of keys) {
        if (item.apiKeyHash === key.apiKeyHash) item.customerId = customerId;
      }
    }
  }

  const client = {
    async send(command: unknown) {
      if (command instanceof ScanCommand) {
        log.push({ type: "Scan", input: command.input as Record<string, unknown> });
        return {
          Items:
            command.input.TableName === "customers"
              ? Object.values(customers).map((customer) => ({ ...customer }))
              : scanItems,
        };
      }
      if (command instanceof GetCommand) {
        log.push({ type: "Get", input: command.input as Record<string, unknown> });
        const key = (command.input.Key as { orgId?: string } | undefined)?.orgId;
        return { Item: key ? customers[key] : undefined };
      }
      if (command instanceof QueryCommand) {
        log.push({ type: "Query", input: command.input as Record<string, unknown> });
        const orgId = (command.input.ExpressionAttributeValues as { ":orgId"?: string })[":orgId"];
        return { Items: orgId ? keysByOrg[orgId] ?? [] : [] };
      }
      if (command instanceof PutCommand) {
        log.push({ type: "Put", input: command.input as Record<string, unknown> });
        const item = command.input.Item as Record<string, unknown>;
        const orgId = item.orgId;
        if (typeof orgId === "string") {
          if (command.input.ConditionExpression === "attribute_not_exists(orgId)" && raceCustomersOnPut[orgId]) {
            customers[orgId] = { ...raceCustomersOnPut[orgId] };
            delete raceCustomersOnPut[orgId];
            throw conditionalCheckFailed();
          }
          if (command.input.ConditionExpression === "attribute_not_exists(orgId)" && customers[orgId]) {
            throw conditionalCheckFailed();
          }
          customers[orgId] = { ...item };
        }
        return {};
      }
      if (command instanceof UpdateCommand) {
        log.push({ type: "Update", input: command.input as Record<string, unknown> });
        if (command.input.TableName === "customers") {
          applyCustomerUpdate(command.input as Record<string, unknown>);
        } else {
          applyKeyUpdate(command.input as Record<string, unknown>);
        }
        return {};
      }
      throw new Error("Unhandled command");
    },
  } as unknown as DynamoDBDocumentClient;
  return { client, log, state: { customers, keysByOrg, scanItems } };
}

test("dry run reports customer and denormalization work without writes", async () => {
  const { client, log } = makeDdbStub({
    scanItems: [
      {
        apiKeyHash: "ORG#org_1",
        ownerEmail: "owner@example.com",
        stripeCustomerId: "cus_1",
      },
    ],
    keysByOrg: {
      org_1: [{ apiKeyHash: "hash_1", keyPrefix: "pq_test", orgId: "org_1" }],
    },
  });

  const stats = await backfillCustomers(client, "keys", "customers", {
    now: new Date("2026-04-25T00:00:00.000Z"),
  });

  assert.equal(stats.dryRun, true);
  assert.equal(stats.activeCustomers, 1);
  assert.equal(stats.orgEnvelopesUpdated, 1);
  assert.equal(stats.apiKeysUpdated, 1);
  assert.equal(log.some((entry) => entry.type === "Put"), false);
  assert.equal(log.some((entry) => entry.type === "Update"), false);
});

test("apply writes an active customer and denormalizes envelope plus api key", async () => {
  const { client, log } = makeDdbStub({
    scanItems: [
      {
        apiKeyHash: "ORG#org_1",
        ownerEmail: "owner@example.com",
        stripeCustomerId: "cus_1",
      },
    ],
    keysByOrg: {
      org_1: [{ apiKeyHash: "hash_1", keyPrefix: "pq_test", orgId: "org_1" }],
    },
  });

  const stats = await backfillCustomers(client, "keys", "customers", {
    apply: true,
    now: new Date("2026-04-25T00:00:00.000Z"),
  });

  assert.equal(stats.dryRun, false);
  assert.equal(stats.activeCustomers, 1);
  assert.equal(log.filter((entry) => entry.type === "Put").length, 1);
  assert.equal(log.filter((entry) => entry.type === "Update").length, 2);
});

test("apply can be rerun against the same active record without creating a second customer", async () => {
  const { client, log, state } = makeDdbStub({
    scanItems: [
      {
        apiKeyHash: "ORG#org_1",
        ownerEmail: "owner@example.com",
        stripeCustomerId: "cus_1",
      },
    ],
    keysByOrg: {
      org_1: [{ apiKeyHash: "hash_1", keyPrefix: "pq_test", orgId: "org_1" }],
    },
  });
  const options = {
    apply: true,
    now: new Date("2026-04-25T00:00:00.000Z"),
  };

  const first = await backfillCustomers(client, "keys", "customers", options);
  const second = await backfillCustomers(client, "keys", "customers", options);

  assert.equal(first.activeCustomers, 1);
  assert.equal(second.activeCustomers, 0);
  assert.equal(state.customers.org_1?.status, "active");
  assert.equal(log.filter((entry) => entry.type === "Put").length, 1);
});

test("concurrent active customer creation denormalizes the reloaded customerId", async () => {
  const concurrentCustomerId = "pq_cust_01H00000000000000000000099";
  const { client, state } = makeDdbStub({
    raceCustomersOnPut: {
      org_1: {
        orgId: "org_1",
        customerId: concurrentCustomerId,
        lagoExternalCustomerId: concurrentCustomerId,
        lagoCustomerId: null,
        stripeCustomerId: "cus_1",
        ownerEmail: "owner@example.com",
        status: "active",
        createdAt: "2026-04-25T00:00:00.000Z",
        updatedAt: "2026-04-25T00:00:00.000Z",
      },
    },
    scanItems: [
      {
        apiKeyHash: "ORG#org_1",
        ownerEmail: "owner@example.com",
        stripeCustomerId: "cus_1",
      },
    ],
    keysByOrg: {
      org_1: [{ apiKeyHash: "hash_1", keyPrefix: "pq_test", orgId: "org_1" }],
    },
  });

  const stats = await backfillCustomers(client, "keys", "customers", {
    apply: true,
    now: new Date("2026-04-25T00:00:00.000Z"),
  });

  assert.equal(stats.activeCustomers, 1);
  assert.equal(state.scanItems[0]?.customerId, concurrentCustomerId);
  assert.equal(state.keysByOrg.org_1?.[0]?.customerId, concurrentCustomerId);
});

test("duplicate Stripe linkage is marked as migration conflict and skips denormalization", async () => {
  const { client, log } = makeDdbStub({
    scanItems: [
      {
        apiKeyHash: "ORG#org_1",
        ownerEmail: "one@example.com",
        stripeCustomerId: "cus_dup",
      },
      {
        apiKeyHash: "ORG#org_2",
        ownerEmail: "two@example.com",
        stripeCustomerId: "cus_dup",
      },
    ],
  });

  const stats = await backfillCustomers(client, "keys", "customers", {
    apply: true,
    now: new Date("2026-04-25T00:00:00.000Z"),
  });

  assert.equal(stats.conflicts, 2);
  assert.equal(log.filter((entry) => entry.type === "Put").length, 0);
  assert.equal(log.filter((entry) => entry.type === "Update").length, 2);
});

test("apply can be rerun against the same conflict records without aborting", async () => {
  const { client, log, state } = makeDdbStub({
    scanItems: [
      {
        apiKeyHash: "ORG#org_1",
        ownerEmail: "one@example.com",
        stripeCustomerId: "cus_dup",
      },
      {
        apiKeyHash: "ORG#org_2",
        ownerEmail: "two@example.com",
        stripeCustomerId: "cus_dup",
      },
    ],
  });
  const options = {
    apply: true,
    now: new Date("2026-04-25T00:00:00.000Z"),
  };

  const first = await backfillCustomers(client, "keys", "customers", options);
  const second = await backfillCustomers(client, "keys", "customers", options);

  assert.equal(first.conflicts, 2);
  assert.equal(second.conflicts, 2);
  assert.equal(state.customers.org_1?.status, "migration_conflict");
  assert.equal(state.customers.org_2?.status, "migration_conflict");
  assert.equal(log.filter((entry) => entry.type === "Update").length, 4);
});

test("existing customer rows participate in duplicate Stripe linkage detection", async () => {
  const existingCustomerId = "pq_cust_01H00000000000000000000001";
  const { client, log, state } = makeDdbStub({
    customers: {
      org_existing: {
        orgId: "org_existing",
        customerId: existingCustomerId,
        lagoExternalCustomerId: existingCustomerId,
        lagoCustomerId: null,
        ownerEmail: "existing@example.com",
        status: "active",
        stripeCustomerId: "cus_dup",
      },
    },
    scanItems: [
      {
        apiKeyHash: "ORG#org_legacy",
        ownerEmail: "legacy@example.com",
        stripeCustomerId: "cus_dup",
      },
    ],
    keysByOrg: {
      org_legacy: [{ apiKeyHash: "hash_legacy", keyPrefix: "pq_test", orgId: "org_legacy" }],
    },
  });

  const stats = await backfillCustomers(client, "keys", "customers", {
    apply: true,
    now: new Date("2026-04-25T00:00:00.000Z"),
  });

  assert.equal(stats.conflicts, 2);
  assert.equal(stats.activeCustomers, 0);
  assert.equal(stats.orgEnvelopesUpdated, 0);
  assert.equal(stats.apiKeysUpdated, 0);
  assert.equal(state.customers.org_existing?.status, "migration_conflict");
  assert.equal(state.customers.org_legacy?.status, "migration_conflict");
  assert.equal(state.scanItems[0]?.customerId, undefined);
  assert.equal(state.keysByOrg.org_legacy?.[0]?.customerId, undefined);
  assert.equal(log.filter((entry) => entry.type === "Put").length, 0);
  assert.equal(
    log.filter(
      (entry) =>
        entry.type === "Update" &&
        (entry.input.ExpressionAttributeValues as Record<string, unknown>)[":reason"] ===
          "duplicate_stripe_customer_id",
    ).length,
    2,
  );
});

test("matching existing customer and envelope Stripe linkage is not a duplicate", async () => {
  const customerId = "pq_cust_01H00000000000000000000001";
  const { client, state } = makeDdbStub({
    customers: {
      org_1: {
        orgId: "org_1",
        customerId,
        lagoExternalCustomerId: customerId,
        lagoCustomerId: null,
        ownerEmail: "owner@example.com",
        status: "active",
        stripeCustomerId: "cus_1",
      },
    },
    scanItems: [
      {
        apiKeyHash: "ORG#org_1",
        ownerEmail: "owner@example.com",
        stripeCustomerId: "cus_1",
      },
    ],
    keysByOrg: {
      org_1: [{ apiKeyHash: "hash_1", keyPrefix: "pq_test", orgId: "org_1" }],
    },
  });

  const stats = await backfillCustomers(client, "keys", "customers", {
    apply: true,
    now: new Date("2026-04-25T00:00:00.000Z"),
  });

  assert.equal(stats.conflicts, 0);
  assert.equal(state.scanItems[0]?.customerId, customerId);
  assert.equal(state.keysByOrg.org_1?.[0]?.customerId, customerId);
});

test("existing mismatched customer is marked as migration conflict", async () => {
  const { client, log } = makeDdbStub({
    customers: {
      org_1: {
        orgId: "org_1",
        customerId: "pq_cust_01H00000000000000000000000",
        status: "active",
      },
    },
    scanItems: [
      {
        apiKeyHash: "ORG#org_1",
        customerId: "pq_cust_01H00000000000000000000001",
        ownerEmail: "owner@example.com",
        stripeCustomerId: "cus_1",
      },
    ],
  });

  const stats = await backfillCustomers(client, "keys", "customers", {
    apply: true,
    now: new Date("2026-04-25T00:00:00.000Z"),
  });

  assert.equal(stats.conflicts, 1);
  assert.equal(log.some((entry) => entry.type === "Put"), false);
  const conflictUpdate = log.find((entry) => entry.type === "Update");
  assert.deepEqual(conflictUpdate?.input.Key, { orgId: "org_1" });
  const values = conflictUpdate?.input.ExpressionAttributeValues as Record<string, unknown>;
  assert.equal(values[":reason"], "customer_id_mismatch");
  assert.equal(values[":status"], "migration_conflict");
  assert.equal(values[":updatedAt"], "2026-04-25T00:00:00.000Z");
});

test("api key customerId mismatch marks mapping as conflict before denormalization", async () => {
  const { client, log } = makeDdbStub({
    scanItems: [
      {
        apiKeyHash: "ORG#org_1",
        ownerEmail: "owner@example.com",
        stripeCustomerId: "cus_1",
      },
    ],
    keysByOrg: {
      org_1: [
        {
          apiKeyHash: "hash_1",
          customerId: "pq_cust_01H00000000000000000000001",
          keyPrefix: "pq_test",
          orgId: "org_1",
        },
      ],
    },
  });

  const stats = await backfillCustomers(client, "keys", "customers", {
    apply: true,
    now: new Date("2026-04-25T00:00:00.000Z"),
  });

  assert.equal(stats.conflicts, 1);
  assert.equal(stats.activeCustomers, 0);
  assert.equal(stats.orgEnvelopesUpdated, 0);
  assert.equal(stats.apiKeysUpdated, 0);
  const conflictUpdate = log.find((entry) => entry.type === "Update");
  assert.deepEqual(conflictUpdate?.input.Key, { orgId: "org_1" });
  assert.equal(
    ((conflictUpdate?.input.ExpressionAttributeValues as Record<string, unknown> | undefined) ?? {})[
      ":reason"
    ],
    "api_key_customer_id_mismatch",
  );
  assert.equal(log.filter((entry) => entry.type === "Update").length, 1);
});

test("null Stripe linkage still creates customer mappings and ignores duplicate detection", async () => {
  const { client, state } = makeDdbStub({
    scanItems: [
      {
        apiKeyHash: "ORG#org_1",
        ownerEmail: "one@example.com",
        stripeCustomerId: null,
      },
      {
        apiKeyHash: "ORG#org_2",
        ownerEmail: "two@example.com",
        stripeCustomerId: null,
      },
    ],
    keysByOrg: {
      org_1: [{ apiKeyHash: "hash_1", keyPrefix: "pq_test", orgId: "org_1" }],
      org_2: [{ apiKeyHash: "hash_2", keyPrefix: "pq_test", orgId: "org_2" }],
    },
  });

  const stats = await backfillCustomers(client, "keys", "customers", {
    apply: true,
    now: new Date("2026-04-25T00:00:00.000Z"),
  });

  assert.equal(stats.conflicts, 0);
  assert.equal(stats.activeCustomers, 2);
  assert.equal(state.customers.org_1?.stripeCustomerId, null);
  assert.equal(state.customers.org_2?.stripeCustomerId, null);
});

test("absent Stripe linkage still creates customer mappings", async () => {
  const { client, state } = makeDdbStub({
    scanItems: [
      {
        apiKeyHash: "ORG#org_1",
        ownerEmail: "owner@example.com",
      },
    ],
    keysByOrg: {
      org_1: [{ apiKeyHash: "hash_1", keyPrefix: "pq_test", orgId: "org_1" }],
    },
  });

  const stats = await backfillCustomers(client, "keys", "customers", {
    apply: true,
    now: new Date("2026-04-25T00:00:00.000Z"),
  });

  assert.equal(stats.conflicts, 0);
  assert.equal(stats.activeCustomers, 1);
  assert.equal(state.customers.org_1?.stripeCustomerId, null);
});

test("malformed org envelopes are counted instead of silently ignored", async () => {
  const { client } = makeDdbStub({
    scanItems: [
      {
        apiKeyHash: "ORG#org_1",
        stripeCustomerId: "cus_1",
      },
      {
        apiKeyHash: "ORG#org_2",
        ownerEmail: "",
        stripeCustomerId: "cus_2",
      },
      {
        apiKeyHash: "ORG#org_3",
        ownerEmail: "owner@example.com",
        stripeCustomerId: 123,
      },
      {
        apiKeyHash: "key_hash",
        keyPrefix: "pq_test",
        orgId: "org_3",
      },
    ],
  });

  const stats = await backfillCustomers(client, "keys", "customers", {
    now: new Date("2026-04-25T00:00:00.000Z"),
  });

  assert.equal(stats.envelopesScanned, 0);
  assert.equal(stats.invalidEnvelopesSkipped, 3);
});
