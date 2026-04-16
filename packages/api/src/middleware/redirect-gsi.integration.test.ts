/**
 * REDIRECT GSI smoke test (P1B.04 DoD).
 *
 * Proves that `prontiq-usage` table's `newHash-redirect-index` GSI:
 *   1. Indexes REDIRECT items by `newHash`
 *   2. Is sparse — counter items (SK = "{product}#{yearMonth}") have no
 *      `newHash` attribute and are excluded from the index
 *   3. Returns exactly one item when queried by the new hash
 *
 * The billing cron (P1B.10, ARCHITECTURE.MD §5.6.2) depends on this GSI
 * to attribute rotated-out usage to the current billable hash without
 * scanning the whole usage table.
 *
 * Run locally:
 *   docker run -p 8000:8000 amazon/dynamodb-local:2.5.2
 *   pnpm --filter @prontiq/api test:integration
 *
 * In CI: runs as a service container (see .github/workflows/ci.yml).
 *
 * Schema mirrors `sst.config.ts` (PqAuthUsage component). If you change
 * one, change the other — the whole point of this test is to catch
 * drift before it reaches AWS.
 */
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import {
  DynamoDBClient,
  CreateTableCommand,
  DeleteTableCommand,
  PutItemCommand,
  QueryCommand,
  DescribeTableCommand,
} from "@aws-sdk/client-dynamodb";

const DDB_URL = process.env.DYNAMODB_TEST_URL ?? "http://localhost:8000";
const TEST_TABLE = `prontiq-usage-test-${Date.now()}`;

const client = new DynamoDBClient({
  endpoint: DDB_URL,
  region: "ap-southeast-2",
  credentials: { accessKeyId: "test", secretAccessKey: "test" },
});

before(async () => {
  await client.send(
    new CreateTableCommand({
      TableName: TEST_TABLE,
      AttributeDefinitions: [
        { AttributeName: "apiKeyHash", AttributeType: "S" },
        { AttributeName: "scope", AttributeType: "S" },
        { AttributeName: "newHash", AttributeType: "S" },
      ],
      KeySchema: [
        { AttributeName: "apiKeyHash", KeyType: "HASH" },
        { AttributeName: "scope", KeyType: "RANGE" },
      ],
      GlobalSecondaryIndexes: [
        {
          IndexName: "newHash-redirect-index",
          KeySchema: [{ AttributeName: "newHash", KeyType: "HASH" }],
          Projection: { ProjectionType: "KEYS_ONLY" },
        },
      ],
      BillingMode: "PAY_PER_REQUEST",
    }),
  );

  // Wait for table to become ACTIVE (DDB Local is usually instant,
  // but newer versions return CREATING briefly).
  for (let i = 0; i < 20; i++) {
    const { Table } = await client.send(
      new DescribeTableCommand({ TableName: TEST_TABLE }),
    );
    if (Table?.TableStatus === "ACTIVE") return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`Table ${TEST_TABLE} never became ACTIVE`);
});

after(async () => {
  await client.send(new DeleteTableCommand({ TableName: TEST_TABLE }));
});

test("REDIRECT GSI returns exactly one item keyed by newHash", async () => {
  const oldHash = "a".repeat(64);
  const newHash = "b".repeat(64);

  // Seed: one REDIRECT record (indexed) + one counter record (sparse, excluded)
  await client.send(
    new PutItemCommand({
      TableName: TEST_TABLE,
      Item: {
        apiKeyHash: { S: oldHash },
        scope: { S: "REDIRECT" },
        newHash: { S: newHash },
        authValidUntil: { N: String(Math.floor(Date.now() / 1000) + 300) },
        ttl: { N: String(Math.floor(Date.now() / 1000) + 90 * 86400) },
        revokedByRotateAt: { S: new Date().toISOString() },
      },
    }),
  );

  await client.send(
    new PutItemCommand({
      TableName: TEST_TABLE,
      Item: {
        apiKeyHash: { S: oldHash },
        scope: { S: "address#2026-04" },
        requestCount: { N: "1" },
        ttl: { N: String(Math.floor(Date.now() / 1000) + 90 * 86400) },
      },
    }),
  );

  const { Items, Count } = await client.send(
    new QueryCommand({
      TableName: TEST_TABLE,
      IndexName: "newHash-redirect-index",
      KeyConditionExpression: "newHash = :nh",
      ExpressionAttributeValues: { ":nh": { S: newHash } },
    }),
  );

  assert.equal(Count, 1, "GSI should return exactly 1 item for newHash");
  assert.equal(Items?.[0]?.apiKeyHash?.S, oldHash);
  // KEYS_ONLY projection — only key attrs returned.
  assert.equal(Items?.[0]?.authValidUntil, undefined);
});

test("REDIRECT GSI returns zero items for unknown newHash", async () => {
  const { Count } = await client.send(
    new QueryCommand({
      TableName: TEST_TABLE,
      IndexName: "newHash-redirect-index",
      KeyConditionExpression: "newHash = :nh",
      ExpressionAttributeValues: { ":nh": { S: "does-not-exist" } },
    }),
  );
  assert.equal(Count, 0);
});
