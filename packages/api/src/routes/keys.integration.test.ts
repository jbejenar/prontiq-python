/**
 * `/v1/account/keys/*` integration tests (P1C.03 PR 1 DoD).
 *
 * Exercises the full request → middleware → route → service → DDB
 * stack against a real DDB Local with a stubbed JWT verifier. Pins:
 *   - 201 + envelope.activeKeyCount=1 + 1 audit row + raw never persisted
 *   - List excludes ORG envelope (sentinel) and revoked keys (active flag)
 *   - Concurrent under-limit: both succeed
 *   - Concurrent at-limit: exactly one 201, exactly one 403
 *   - Sequential at-limit: third create rejected
 *   - Per-route gates: member denied on create, allowed on list
 *
 * Run locally:
 *   docker run -p 8000:8000 amazon/dynamodb-local:2.5.2
 *   pnpm --filter @prontiq/api test:integration
 */
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import {
  DynamoDBClient,
  CreateTableCommand,
  DeleteTableCommand,
  DescribeTableCommand,
} from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  ScanCommand,
} from "@aws-sdk/lib-dynamodb";
import { OpenAPIHono } from "@hono/zod-openapi";
import { createKeyManagementService, getOrgEnvelopeKey } from "@prontiq/control-plane";
import type { OrgEnvelopeRecord } from "@prontiq/shared";
import { hashKey } from "@prontiq/shared";
import { clerkJwt, type ClerkVerifier } from "../middleware/clerk-jwt.js";
import { requestId } from "../middleware/request-id.js";
import { createKeysRoutes } from "./keys.js";

const DDB_URL = process.env.DYNAMODB_TEST_URL ?? "http://localhost:8000";
const SUFFIX = `${Date.now()}-keys`;
const KEYS_TABLE = `prontiq-keys-test-${SUFFIX}`;
const AUDIT_TABLE = `prontiq-audit-test-${SUFFIX}`;

const ddbRaw = new DynamoDBClient({
  endpoint: DDB_URL,
  region: "ap-southeast-2",
  credentials: { accessKeyId: "test", secretAccessKey: "test" },
});
const ddb = DynamoDBDocumentClient.from(ddbRaw);

before(async () => {
  await ddbRaw.send(
    new CreateTableCommand({
      TableName: KEYS_TABLE,
      AttributeDefinitions: [
        { AttributeName: "apiKeyHash", AttributeType: "S" },
        { AttributeName: "orgId", AttributeType: "S" },
      ],
      KeySchema: [{ AttributeName: "apiKeyHash", KeyType: "HASH" }],
      GlobalSecondaryIndexes: [
        {
          IndexName: "orgId-index",
          KeySchema: [{ AttributeName: "orgId", KeyType: "HASH" }],
          Projection: { ProjectionType: "ALL" },
        },
      ],
      BillingMode: "PAY_PER_REQUEST",
    }),
  );
  await ddbRaw.send(
    new CreateTableCommand({
      TableName: AUDIT_TABLE,
      AttributeDefinitions: [
        { AttributeName: "orgId", AttributeType: "S" },
        { AttributeName: "timestamp#eventId", AttributeType: "S" },
      ],
      KeySchema: [
        { AttributeName: "orgId", KeyType: "HASH" },
        { AttributeName: "timestamp#eventId", KeyType: "RANGE" },
      ],
      BillingMode: "PAY_PER_REQUEST",
    }),
  );
  for (const tableName of [KEYS_TABLE, AUDIT_TABLE]) {
    for (let i = 0; i < 20; i++) {
      const { Table } = await ddbRaw.send(new DescribeTableCommand({ TableName: tableName }));
      if (Table?.TableStatus === "ACTIVE") break;
      await new Promise((r) => setTimeout(r, 100));
    }
  }
});

after(async () => {
  await ddbRaw.send(new DeleteTableCommand({ TableName: KEYS_TABLE }));
  await ddbRaw.send(new DeleteTableCommand({ TableName: AUDIT_TABLE }));
});

interface BuildAppOpts {
  orgId: string;
  userId?: string;
  /** `org:admin` (default), `org:member`, or `null` to omit. */
  orgRole?: string | null;
  /**
   * If provided, every logger call made by the service is appended to
   * this array as a single concatenated string. Lets the redaction
   * test scan log output for the raw key.
   */
  logSink?: string[];
}

function buildApp(opts: BuildAppOpts) {
  const verifier: ClerkVerifier = async () => {
    const claims: Record<string, unknown> = {
      sub: opts.userId ?? "user_keys_test",
      org_id: opts.orgId,
    };
    const role = opts.orgRole === undefined ? "org:admin" : opts.orgRole;
    if (role !== null) {
      claims.org_role = role;
    }
    return claims;
  };

  const sinkLogger = opts.logSink
    ? {
        error: (...args: unknown[]) => opts.logSink?.push(JSON.stringify(args)),
        warn: (...args: unknown[]) => opts.logSink?.push(JSON.stringify(args)),
        info: (...args: unknown[]) => opts.logSink?.push(JSON.stringify(args)),
      }
    : undefined;

  const service = createKeyManagementService({
    ddb,
    keysTableName: KEYS_TABLE,
    auditTableName: AUDIT_TABLE,
    ...(sinkLogger ? { logger: sinkLogger } : {}),
  });

  const keysRoutes = createKeysRoutes({ service });

  const app = new OpenAPIHono();
  app.use("*", requestId());
  app.onError((err, c) => {
    return c.json(
      {
        error: {
          code: "INTERNAL_ERROR",
          message: err.message,
          status: 500,
          request_id: c.get("requestId"),
        },
      },
      500,
    );
  });
  // Mirror production: identity-only Lambda-wide; per-route admin gate
  // lives inside the keys factory.
  app.use("/v1/account/*", clerkJwt({ verifier }));
  app.route("/v1/account", keysRoutes);
  return app;
}

async function seedEnvelope(orgId: string, overrides: Partial<OrgEnvelopeRecord> = {}) {
  const envelope: OrgEnvelopeRecord = {
    apiKeyHash: getOrgEnvelopeKey(orgId),
    completedAt: "2026-04-01T00:00:00.000Z",
    hasFirstKey: false,
    activeKeyCount: 0,
    orgId,
    ownerEmail: `${orgId}@example.com`,
    paymentOverdue: false,
    products: ["address"],
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    subscriptionItems: {},
    tier: "free",
    ...overrides,
  };
  await ddb.send(new PutCommand({ TableName: KEYS_TABLE, Item: envelope }));
  return envelope;
}

async function getEnvelope(orgId: string): Promise<OrgEnvelopeRecord | undefined> {
  const result = await ddb.send(
    new GetCommand({ TableName: KEYS_TABLE, Key: { apiKeyHash: getOrgEnvelopeKey(orgId) } }),
  );
  return result.Item as OrgEnvelopeRecord | undefined;
}

async function postCreate(
  app: OpenAPIHono,
  body: { label?: string } = {},
  headers: Record<string, string> = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await app.request("/v1/account/keys/create", {
    method: "POST",
    headers: {
      Authorization: "Bearer good_token",
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as Record<string, unknown>;
  return { status: res.status, body: json };
}

async function getList(
  app: OpenAPIHono,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await app.request("/v1/account/keys", {
    method: "GET",
    headers: { Authorization: "Bearer good_token" },
  });
  const json = (await res.json()) as Record<string, unknown>;
  return { status: res.status, body: json };
}

test("(a) admin create: 201 + key row + envelope.activeKeyCount=1 + 1 audit row + ip/UA captured + raw not persisted", async () => {
  const orgId = `org_KeysA${SUFFIX}`;
  await seedEnvelope(orgId);
  const app = buildApp({ orgId });

  const { status, body } = await postCreate(
    app,
    { label: "first key" },
    { "x-forwarded-for": "203.0.113.7, 10.0.0.1", "user-agent": "test-runner/1.0" },
  );
  assert.equal(status, 201);
  assert.match(body.keyId as string, /^key_[0-9A-Z]{26}$/, "keyId is `key_<26-char-ulid>`");
  assert.match(body.raw as string, /^pq_live_[0-9a-f]{48}$/, "raw matches generateKey shape");
  assert.equal(body.label, "first key");
  const rawValue = body.raw as string;

  const envelope = await getEnvelope(orgId);
  assert.equal(envelope?.hasFirstKey, true);
  assert.equal(envelope?.activeKeyCount, 1);

  const keyRow = await ddb.send(
    new GetCommand({ TableName: KEYS_TABLE, Key: { apiKeyHash: hashKey(rawValue) } }),
  );
  assert.ok(keyRow.Item, "key row was written");
  assert.equal(keyRow.Item?.keyId, body.keyId);
  assert.equal(keyRow.Item?.active, true);
  assert.equal(keyRow.Item?.label, "first key");
  assert.equal(keyRow.Item?.createdByActorId, "user_keys_test");

  const audit = await ddb.send(
    new QueryCommand({
      TableName: AUDIT_TABLE,
      KeyConditionExpression: "orgId = :o",
      ExpressionAttributeValues: { ":o": orgId },
    }),
  );
  assert.equal(audit.Count, 1);
  assert.equal(audit.Items?.[0]?.action, "CREATE");
  assert.equal(audit.Items?.[0]?.apiKeyHash, hashKey(rawValue));
  assert.equal(audit.Items?.[0]?.actorId, "user_keys_test");
  assert.equal(audit.Items?.[0]?.ip, "203.0.113.7");
  assert.equal(audit.Items?.[0]?.userAgent, "test-runner/1.0");
  const meta = audit.Items?.[0]?.metadata as Record<string, unknown>;
  assert.equal(meta.keyId, body.keyId);
  assert.equal(meta.label, "first key");

  // Raw key never persisted to ANY row in either table.
  const allKeys = await ddb.send(new ScanCommand({ TableName: KEYS_TABLE }));
  for (const item of allKeys.Items ?? []) {
    const serialised = JSON.stringify(item);
    assert.equal(serialised.includes(rawValue), false, "raw must not appear in keys table");
  }
  const allAudit = await ddb.send(new ScanCommand({ TableName: AUDIT_TABLE }));
  for (const item of allAudit.Items ?? []) {
    const serialised = JSON.stringify(item);
    assert.equal(serialised.includes(rawValue), false, "raw must not appear in audit table");
  }
});

test("(b) list: excludes ORG envelope (sentinel) and revoked keys (active flag)", async () => {
  const orgId = `org_KeysList${SUFFIX}`;
  await seedEnvelope(orgId);
  const app = buildApp({ orgId });

  const created1 = await postCreate(app, { label: "active-1" });
  assert.equal(created1.status, 201);
  const created2 = await postCreate(app, { label: "active-2" });
  assert.equal(created2.status, 201);

  // Manually flip one key to inactive — simulates a future revoke.
  const inactiveHash = hashKey(created2.body.raw as string);
  await ddb.send(
    new PutCommand({
      TableName: KEYS_TABLE,
      Item: {
        ...(
          await ddb.send(
            new GetCommand({ TableName: KEYS_TABLE, Key: { apiKeyHash: inactiveHash } }),
          )
        ).Item,
        active: false,
      },
    }),
  );

  const { status, body } = await getList(app);
  assert.equal(status, 200);
  const keys = body.keys as Array<Record<string, unknown>>;
  assert.equal(keys.length, 1, "only the still-active key is returned");
  assert.equal(keys[0]?.keyId, created1.body.keyId);
  assert.equal(keys[0]?.active, true);
  assert.equal(
    keys.find((k) => (k.keyId as string).startsWith("ORG#")),
    undefined,
    "envelope must not appear",
  );
  // No apiKeyHash in the listing — defense against accidental leakage.
  assert.equal(
    Object.keys(keys[0] ?? {}).includes("apiKeyHash"),
    false,
    "apiKeyHash must not be returned",
  );
});

test("(c) concurrent under-limit: max=2, two parallel creates → both 201, activeKeyCount=2", async () => {
  const orgId = `org_KeysConc${SUFFIX}`;
  await seedEnvelope(orgId);
  const app = buildApp({ orgId });

  const [r1, r2] = await Promise.all([postCreate(app, { label: "c1" }), postCreate(app, { label: "c2" })]);
  assert.equal(r1.status, 201);
  assert.equal(r2.status, 201);
  assert.notEqual(r1.body.keyId, r2.body.keyId);
  assert.notEqual(r1.body.raw, r2.body.raw);

  const envelope = await getEnvelope(orgId);
  assert.equal(envelope?.activeKeyCount, 2);
  assert.equal(envelope?.hasFirstKey, true);
});

test("(d) concurrent at-limit: max=2, activeKeyCount=1, two parallel creates → exactly one 201, one 403", async () => {
  const orgId = `org_KeysAtLimit${SUFFIX}`;
  // Pre-seed at activeKeyCount=1 so the next create hits the boundary.
  await seedEnvelope(orgId, { activeKeyCount: 1, hasFirstKey: true });
  const app = buildApp({ orgId });

  const [r1, r2] = await Promise.all([postCreate(app, { label: "race-a" }), postCreate(app, { label: "race-b" })]);
  const statuses = [r1.status, r2.status].sort((a, b) => a - b);
  assert.deepEqual(statuses, [201, 403], "exactly one 201 and one 403");

  const losing = r1.status === 403 ? r1 : r2;
  const losingError = losing.body.error as { code: string };
  assert.equal(losingError.code, "KEY_LIMIT_EXCEEDED");

  const envelope = await getEnvelope(orgId);
  assert.equal(envelope?.activeKeyCount, 2, "envelope must end at exactly the cap");
});

test("(e) free-tier sequential limit: third create after activeKeyCount=2 → 403 KEY_LIMIT_EXCEEDED", async () => {
  const orgId = `org_KeysSeqLimit${SUFFIX}`;
  await seedEnvelope(orgId, { activeKeyCount: 2, hasFirstKey: true });
  const app = buildApp({ orgId });

  const { status, body } = await postCreate(app, { label: "third" });
  assert.equal(status, 403);
  const error = body.error as { code: string };
  assert.equal(error.code, "KEY_LIMIT_EXCEEDED");

  const envelope = await getEnvelope(orgId);
  assert.equal(envelope?.activeKeyCount, 2, "envelope unchanged on rejection");
});

test("(f) per-route gates: member token rejected on /keys/create (403); allowed on /keys (200)", async () => {
  const orgId = `org_KeysMember${SUFFIX}`;
  await seedEnvelope(orgId);
  const app = buildApp({ orgId, orgRole: "org:member" });

  const create = await postCreate(app, { label: "should-fail" });
  assert.equal(create.status, 403);
  assert.equal((create.body.error as { code: string }).code, "INSUFFICIENT_ROLE");

  const list = await getList(app);
  assert.equal(list.status, 200);
  assert.deepEqual(list.body.keys, []);

  const envelope = await getEnvelope(orgId);
  assert.equal(envelope?.activeKeyCount, 0, "no key written by member");
});

test("(g) ORG_NOT_PROVISIONED: create without prior /setup → 404", async () => {
  const orgId = `org_KeysNoEnv${SUFFIX}`;
  const app = buildApp({ orgId });

  const { status, body } = await postCreate(app);
  assert.equal(status, 404);
  assert.equal((body.error as { code: string }).code, "ORG_NOT_PROVISIONED");
});

test("(h) body validation: label > 64 chars → 400 INVALID_PARAMETERS (Zod schema honoured)", async () => {
  const orgId = `org_KeysBadLabel${SUFFIX}`;
  await seedEnvelope(orgId);
  const app = buildApp({ orgId });

  const { status, body } = await postCreate(app, { label: "x".repeat(65) });
  assert.equal(status, 400);
  assert.equal((body.error as { code: string }).code, "INVALID_PARAMETERS");

  // Wrong type also gets rejected.
  const wrongType = await app.request("/v1/account/keys/create", {
    method: "POST",
    headers: { Authorization: "Bearer good_token", "Content-Type": "application/json" },
    body: JSON.stringify({ label: 12345 }),
  });
  assert.equal(wrongType.status, 400);

  const envelope = await getEnvelope(orgId);
  assert.equal(envelope?.activeKeyCount, 0, "envelope unchanged on validation rejection");
});

test("(i) raw key never appears in any logger call (redaction regression)", async () => {
  const orgId = `org_KeysRedact${SUFFIX}`;
  await seedEnvelope(orgId);
  const sink: string[] = [];
  const app = buildApp({ orgId, logSink: sink });

  const { status, body } = await postCreate(app, { label: "redaction-test" });
  assert.equal(status, 201);
  const rawValue = body.raw as string;

  // Force a downstream log line by triggering at least one operation
  // that would naturally log. Then scan everything captured.
  await getList(app);

  for (const line of sink) {
    assert.equal(
      line.includes(rawValue),
      false,
      `logger captured the raw key — leak in line: ${line.slice(0, 200)}`,
    );
    assert.equal(
      line.includes("pq_live_"),
      false,
      `logger captured a 'pq_live_' prefix — likely raw-key fragment in: ${line.slice(0, 200)}`,
    );
  }
});
