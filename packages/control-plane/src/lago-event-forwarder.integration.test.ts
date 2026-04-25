import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import {
  CreateTableCommand,
  DeleteTableCommand,
  DescribeTableCommand,
  DynamoDBClient,
} from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import {
  DynamoBillingEventDeliveryLedger,
  hashBillingEventPayload,
} from "./lago-event-forwarder.js";
import {
  deriveBillingUsageEventId,
  deriveLagoExternalSubscriptionId,
  type BillingUsageEventV1,
} from "@prontiq/shared";

const DDB_URL = process.env.DYNAMODB_TEST_URL ?? "http://localhost:8000";
const SUFFIX = Date.now().toString();
const DELIVERIES_TABLE = `prontiq-billing-event-deliveries-test-${SUFFIX}`;

const ddbRaw = new DynamoDBClient({
  endpoint: DDB_URL,
  region: "ap-southeast-2",
  credentials: { accessKeyId: "test", secretAccessKey: "test" },
});
const ddb = DynamoDBDocumentClient.from(ddbRaw);

before(async () => {
  await ddbRaw.send(
    new CreateTableCommand({
      TableName: DELIVERIES_TABLE,
      AttributeDefinitions: [
        { AttributeName: "eventId", AttributeType: "S" },
        { AttributeName: "customerId", AttributeType: "S" },
        { AttributeName: "acceptedAt", AttributeType: "S" },
      ],
      KeySchema: [{ AttributeName: "eventId", KeyType: "HASH" }],
      GlobalSecondaryIndexes: [
        {
          IndexName: "customerId-acceptedAt-index",
          KeySchema: [
            { AttributeName: "customerId", KeyType: "HASH" },
            { AttributeName: "acceptedAt", KeyType: "RANGE" },
          ],
          Projection: { ProjectionType: "ALL" },
        },
      ],
      BillingMode: "PAY_PER_REQUEST",
    }),
  );
  for (let i = 0; i < 20; i += 1) {
    const described = await ddbRaw.send(new DescribeTableCommand({ TableName: DELIVERIES_TABLE }));
    if (described.Table?.TableStatus === "ACTIVE") break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
});

after(async () => {
  await ddbRaw.send(new DeleteTableCommand({ TableName: DELIVERIES_TABLE }));
});

function makeEvent(overrides: Partial<BillingUsageEventV1> = {}): BillingUsageEventV1 {
  const idInput = {
    apiKeyHash: "c".repeat(64),
    billingEndpointKey: "address.reverse",
    creditDelta: 2,
    customerId: "pq_cust_01HYZ6Q4X6DJP2X9Q9FQKX4T7A",
    requestCountAfterIncrement: 7,
    usageScope: "address#2026-04",
  };
  return {
    version: 1,
    eventId: deriveBillingUsageEventId(idInput),
    occurredAt: "2026-04-25T00:00:00.000Z",
    customerId: idInput.customerId,
    orgId: "org_integration",
    apiKeyHash: idInput.apiKeyHash,
    keyPrefix: "pq_test_xyz",
    product: "address",
    billingEndpointKey: idInput.billingEndpointKey,
    meterEventName: "prontiq_address_requests",
    creditDelta: idInput.creditDelta,
    usageScope: idInput.usageScope,
    requestCountAfterIncrement: idInput.requestCountAfterIncrement,
    source: {
      requestId: "req_integration",
      method: "GET",
      path: "/v1/address/reverse",
      stage: "test",
    },
    ...overrides,
  };
}

test("delivery ledger records attempt and accepted state idempotently", async () => {
  const ledger = new DynamoBillingEventDeliveryLedger({ ddb, tableName: DELIVERIES_TABLE });
  const event = makeEvent();
  const input = {
    event,
    eventPayloadHash: hashBillingEventPayload(event),
    externalSubscriptionId: deriveLagoExternalSubscriptionId(event.customerId),
    now: new Date("2026-04-25T00:00:00.000Z"),
  };

  assert.equal(await ledger.recordAttempt(input), "ok");
  await ledger.markAccepted(input);
  assert.equal(await ledger.recordAttempt(input), "accepted_same_hash");

  const row = await ledger.get(event.eventId);
  assert.equal(row?.status, "accepted");
  assert.equal(row?.creditDelta, 2);
  assert.equal(row?.externalSubscriptionId, "pq_sub_01HYZ6Q4X6DJP2X9Q9FQKX4T7A");
});

test("delivery ledger rejects same event id with different payload hash", async () => {
  const ledger = new DynamoBillingEventDeliveryLedger({ ddb, tableName: DELIVERIES_TABLE });
  const first = makeEvent({
    eventId: "bevt_22222222222222222222222222222222",
    requestCountAfterIncrement: 10,
  });
  const second = { ...first, creditDelta: 3 };
  const baseInput = {
    event: first,
    eventPayloadHash: hashBillingEventPayload(first),
    externalSubscriptionId: deriveLagoExternalSubscriptionId(first.customerId),
    now: new Date("2026-04-25T00:00:00.000Z"),
  };

  assert.equal(await ledger.recordAttempt(baseInput), "ok");
  assert.equal(
    await ledger.recordAttempt({
      ...baseInput,
      event: second,
      eventPayloadHash: hashBillingEventPayload(second),
    }),
    "hash_conflict",
  );
});

test("delivery ledger does not reopen permanent failures or double-count failed sends", async () => {
  const ledger = new DynamoBillingEventDeliveryLedger({ ddb, tableName: DELIVERIES_TABLE });
  const event = makeEvent({
    eventId: "bevt_33333333333333333333333333333333",
    requestCountAfterIncrement: 11,
  });
  const input = {
    event,
    eventPayloadHash: hashBillingEventPayload(event),
    externalSubscriptionId: deriveLagoExternalSubscriptionId(event.customerId),
    now: new Date("2026-04-25T00:00:00.000Z"),
  };

  assert.equal(await ledger.recordAttempt(input), "ok");
  await ledger.markFailure({
    ...input,
    countAttempt: false,
    error: "Lago usage event rejected with HTTP 422",
    status: "failed_permanent",
  });
  assert.equal(await ledger.recordAttempt(input), "permanent_failure_same_hash");

  const row = await ledger.get(event.eventId);
  assert.equal(row?.status, "failed_permanent");
  assert.equal(row?.attempts, 1);
});

test("delivery ledger does not downgrade accepted rows when a late duplicate fails", async () => {
  const ledger = new DynamoBillingEventDeliveryLedger({ ddb, tableName: DELIVERIES_TABLE });
  const event = makeEvent({
    eventId: "bevt_44444444444444444444444444444444",
    requestCountAfterIncrement: 12,
  });
  const input = {
    event,
    eventPayloadHash: hashBillingEventPayload(event),
    externalSubscriptionId: deriveLagoExternalSubscriptionId(event.customerId),
    now: new Date("2026-04-25T00:00:00.000Z"),
  };

  assert.equal(await ledger.recordAttempt(input), "ok");
  await ledger.markAccepted(input);
  await ledger.markFailure({
    ...input,
    countAttempt: false,
    error: "late duplicate failure",
    status: "failed_retryable",
  });

  const row = await ledger.get(event.eventId);
  assert.equal(row?.status, "accepted");
  assert.equal(row?.attempts, 1);
});

test("delivery ledger does not overwrite permanent failures when a late duplicate accepts", async () => {
  const ledger = new DynamoBillingEventDeliveryLedger({ ddb, tableName: DELIVERIES_TABLE });
  const event = makeEvent({
    eventId: "bevt_55555555555555555555555555555555",
    requestCountAfterIncrement: 13,
  });
  const input = {
    event,
    eventPayloadHash: hashBillingEventPayload(event),
    externalSubscriptionId: deriveLagoExternalSubscriptionId(event.customerId),
    now: new Date("2026-04-25T00:00:00.000Z"),
  };

  assert.equal(await ledger.recordAttempt(input), "ok");
  await ledger.markFailure({
    ...input,
    countAttempt: false,
    error: "Lago usage event rejected with HTTP 422",
    status: "failed_permanent",
  });
  assert.equal(await ledger.markAccepted(input), "terminal_same_hash");

  const row = await ledger.get(event.eventId);
  assert.equal(row?.status, "failed_permanent");
  assert.equal(row?.attempts, 1);
  assert.equal(row?.acceptedAt, undefined);
  assert.equal(row?.lastError, "Lago usage event rejected with HTTP 422");
});
