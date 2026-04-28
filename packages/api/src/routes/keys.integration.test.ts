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
  UpdateCommand,
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
const USAGE_TABLE = `prontiq-usage-test-${SUFFIX}`;

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
  // Usage table — REDIRECT rows live here on rotate. Schema mirrors
  // production: PK apiKeyHash, SK scope, plus newHash-redirect-index
  // GSI used by the auth middleware to resolve old → new on grace.
  await ddbRaw.send(
    new CreateTableCommand({
      TableName: USAGE_TABLE,
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
  for (const tableName of [KEYS_TABLE, AUDIT_TABLE, USAGE_TABLE]) {
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
  await ddbRaw.send(new DeleteTableCommand({ TableName: USAGE_TABLE }));
});

interface BuildAppOpts {
  orgId: string;
  userId?: string;
  /** `org:admin` (default), `org:member`, or `null` to omit. */
  orgRole?: string | null;
  /**
   * Clerk's `fva: [first_factor_age_minutes, second_factor_age_minutes]`
   * claim. When provided, the verifier emits it; when `null`, the
   * claim is OMITTED entirely (used to test the
   * `STEP_UP_MISCONFIGURED` 500 path). When `undefined` (default),
   * the verifier emits `[0, 0]` so step-up gates pass — most tests
   * don't care about reverification and shouldn't have to think
   * about it.
   */
  fva?: number[] | null;
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
    // Default to a fresh second-factor age so tests that don't care
    // about reverification get a passing step-up gate. Only suppress
    // when explicitly opted-in via `fva: null` (for the
    // STEP_UP_MISCONFIGURED test).
    const fva = opts.fva === undefined ? [0, 0] : opts.fva;
    if (fva !== null) {
      claims.fva = fva;
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
    usageTableName: USAGE_TABLE,
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

async function postRotate(
  app: OpenAPIHono,
  body: { keyId: string },
  headers: Record<string, string> = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await app.request("/v1/account/keys/rotate", {
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

async function postRevoke(
  app: OpenAPIHono,
  body: { keyId: string },
  headers: Record<string, string> = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await app.request("/v1/account/keys/revoke", {
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

// ────────────────────────────────────────────────────────────────────
// PR 2: rotate + revoke + reverification gates
// ────────────────────────────────────────────────────────────────────

test("(j) rotate: 200 + new key row + REDIRECT row + audit + activeKeyCount unchanged + createdAt preserved + keyId preserved + rotatedAt set", async () => {
  const orgId = `org_KeysRotate${SUFFIX}`;
  await seedEnvelope(orgId);
  const app = buildApp({ orgId });

  // Seed: create key A
  const created = await postCreate(app, { label: "to-rotate" });
  assert.equal(created.status, 201);
  const aKeyId = created.body.keyId as string;
  const aRaw = created.body.raw as string;
  const aHash = hashKey(aRaw);
  const aCreatedAt = created.body.createdAt as string;

  const beforeEnv = await getEnvelope(orgId);
  assert.equal(beforeEnv?.activeKeyCount, 1);

  // Rotate A → B
  const rotated = await postRotate(
    app,
    { keyId: aKeyId },
    { "x-forwarded-for": "203.0.113.42", "user-agent": "rotate-test/1.0" },
  );
  assert.equal(rotated.status, 200);
  assert.equal(rotated.body.keyId, aKeyId, "keyId preserved across rotation");
  assert.equal(rotated.body.createdAt, aCreatedAt, "createdAt preserved across rotation");
  assert.match(rotated.body.raw as string, /^pq_live_[0-9a-f]{48}$/);
  assert.notEqual(rotated.body.raw, aRaw, "fresh raw value");
  assert.notEqual(rotated.body.keyPrefix, created.body.keyPrefix, "fresh prefix");
  assert.match(rotated.body.rotatedAt as string, /^\d{4}-\d{2}-\d{2}T/);

  const bRaw = rotated.body.raw as string;
  const bHash = hashKey(bRaw);

  // Old key row deleted
  const aRow = await ddb.send(
    new GetCommand({ TableName: KEYS_TABLE, Key: { apiKeyHash: aHash } }),
  );
  assert.equal(aRow.Item, undefined, "old key row deleted");

  // New key row written with preserved keyId + createdAt + new rotatedAt
  const bRow = await ddb.send(
    new GetCommand({ TableName: KEYS_TABLE, Key: { apiKeyHash: bHash } }),
  );
  assert.ok(bRow.Item);
  assert.equal(bRow.Item?.keyId, aKeyId);
  assert.equal(bRow.Item?.createdAt, aCreatedAt);
  assert.equal(bRow.Item?.rotatedAt, rotated.body.rotatedAt);
  assert.equal(bRow.Item?.active, true);
  assert.equal(bRow.Item?.label, "to-rotate", "label preserved");

  // REDIRECT row written: old hash → new hash, authValidUntil ~ now+300s
  const redirectRow = await ddb.send(
    new GetCommand({
      TableName: USAGE_TABLE,
      Key: { apiKeyHash: aHash, scope: "REDIRECT" },
    }),
  );
  assert.ok(redirectRow.Item, "REDIRECT row written");
  assert.equal(redirectRow.Item?.newHash, bHash);
  const nowSec = Math.floor(Date.now() / 1000);
  const authValidUntil = redirectRow.Item?.authValidUntil as number;
  assert.ok(
    authValidUntil >= nowSec + 295 && authValidUntil <= nowSec + 305,
    `authValidUntil ${authValidUntil} should be ~now+300s (got drift ${authValidUntil - nowSec})`,
  );
  const ttl = redirectRow.Item?.ttl as number;
  assert.ok(ttl > nowSec + 7_700_000, "ttl should be ~now + 90 days");
  assert.match(redirectRow.Item?.revokedByRotateAt as string, /^\d{4}-\d{2}-\d{2}T/);

  // activeKeyCount unchanged (delete + put cancel)
  const afterEnv = await getEnvelope(orgId);
  assert.equal(afterEnv?.activeKeyCount, 1, "rotate doesn't change activeKeyCount");

  // Audit ROTATE row with ip/UA + metadata
  const audit = await ddb.send(
    new QueryCommand({
      TableName: AUDIT_TABLE,
      KeyConditionExpression: "orgId = :o",
      ExpressionAttributeValues: { ":o": orgId },
    }),
  );
  const rotateAudit = audit.Items?.find((row) => row.action === "ROTATE");
  assert.ok(rotateAudit, "ROTATE audit row exists");
  assert.equal(rotateAudit?.apiKeyHash, bHash, "audit references the NEW hash");
  assert.equal(rotateAudit?.ip, "203.0.113.42");
  assert.equal(rotateAudit?.userAgent, "rotate-test/1.0");
  const meta = rotateAudit?.metadata as Record<string, unknown>;
  assert.equal(meta.keyId, aKeyId);
  assert.equal(meta.oldApiKeyHash, aHash);

  // Raw never persisted
  const allRows = await ddb.send(new ScanCommand({ TableName: KEYS_TABLE }));
  for (const item of allRows.Items ?? []) {
    const ser = JSON.stringify(item);
    assert.equal(ser.includes(bRaw), false, "new raw must not appear in keys table");
    assert.equal(ser.includes(aRaw), false, "old raw must not appear in keys table");
  }
});

test("(k) rotate: KEY_NOT_FOUND when keyId doesn't exist in this org → 404", async () => {
  const orgId = `org_KeysRotate404${SUFFIX}`;
  await seedEnvelope(orgId);
  const app = buildApp({ orgId });

  const { status, body } = await postRotate(app, { keyId: "key_01HXMISSING000000000000000" });
  assert.equal(status, 404);
  assert.equal((body.error as { code: string }).code, "KEY_NOT_FOUND");
});

test("(l) rotate: KEY_NOT_FOUND when target key was already revoked", async () => {
  const orgId = `org_KeysRotateRevoked${SUFFIX}`;
  await seedEnvelope(orgId);
  const app = buildApp({ orgId });

  const created = await postCreate(app, { label: "to-revoke-then-rotate" });
  const keyId = created.body.keyId as string;

  // Revoke first
  const revoked = await postRevoke(app, { keyId });
  assert.equal(revoked.status, 200);

  // Now rotate the revoked key — should fail with key_not_found (we
  // deliberately conflate "revoked" with "not found" at this layer
  // to avoid leaking revocation history through admin UIs).
  const { status, body } = await postRotate(app, { keyId });
  assert.equal(status, 404);
  assert.equal((body.error as { code: string }).code, "KEY_NOT_FOUND");
});

test("(m) revoke: 200 + key row.active=false + revokedAt set + envelope.activeKeyCount decremented + audit REVOKE row", async () => {
  const orgId = `org_KeysRevoke${SUFFIX}`;
  await seedEnvelope(orgId);
  const app = buildApp({ orgId });

  const created = await postCreate(app, { label: "to-revoke" });
  const keyId = created.body.keyId as string;
  const rawValue = created.body.raw as string;
  const keyHash = hashKey(rawValue);

  const beforeEnv = await getEnvelope(orgId);
  assert.equal(beforeEnv?.activeKeyCount, 1);

  const revoked = await postRevoke(
    app,
    { keyId },
    { "x-forwarded-for": "198.51.100.5", "user-agent": "revoke-test/1.0" },
  );
  assert.equal(revoked.status, 200);
  assert.equal(revoked.body.keyId, keyId);
  assert.match(revoked.body.revokedAt as string, /^\d{4}-\d{2}-\d{2}T/);

  const keyRow = await ddb.send(
    new GetCommand({ TableName: KEYS_TABLE, Key: { apiKeyHash: keyHash } }),
  );
  assert.equal(keyRow.Item?.active, false);
  assert.equal(keyRow.Item?.revokedAt, revoked.body.revokedAt);

  const afterEnv = await getEnvelope(orgId);
  assert.equal(afterEnv?.activeKeyCount, 0, "envelope counter decremented atomically");

  const audit = await ddb.send(
    new QueryCommand({
      TableName: AUDIT_TABLE,
      KeyConditionExpression: "orgId = :o",
      ExpressionAttributeValues: { ":o": orgId },
    }),
  );
  const revokeAudit = audit.Items?.find((row) => row.action === "REVOKE");
  assert.ok(revokeAudit, "REVOKE audit row exists");
  assert.equal(revokeAudit?.apiKeyHash, keyHash);
  assert.equal(revokeAudit?.ip, "198.51.100.5");
  assert.equal(revokeAudit?.userAgent, "revoke-test/1.0");

  // No REDIRECT row written by revoke (per ARCH §5.5.2). Targeted
  // lookup — usage table is shared across tests, so a full scan would
  // include unrelated REDIRECT rows from rotate tests.
  const redirectAfterRevoke = await ddb.send(
    new GetCommand({
      TableName: USAGE_TABLE,
      Key: { apiKeyHash: keyHash, scope: "REDIRECT" },
    }),
  );
  assert.equal(redirectAfterRevoke.Item, undefined, "revoke must not write a REDIRECT row");
});

test("(n) revoke: KEY_ALREADY_REVOKED on second revoke of the same key → 409", async () => {
  const orgId = `org_KeysRevokeIdempotent${SUFFIX}`;
  await seedEnvelope(orgId);
  const app = buildApp({ orgId });

  const created = await postCreate(app, { label: "double-revoke" });
  const keyId = created.body.keyId as string;

  const first = await postRevoke(app, { keyId });
  assert.equal(first.status, 200);

  const second = await postRevoke(app, { keyId });
  assert.equal(second.status, 409);
  assert.equal((second.body.error as { code: string }).code, "KEY_ALREADY_REVOKED");

  // Counter must NOT decrement twice on the second call.
  const env = await getEnvelope(orgId);
  assert.equal(env?.activeKeyCount, 0, "counter unchanged on second revoke");
});

test("(o) revoke: KEY_NOT_FOUND when keyId doesn't exist → 404", async () => {
  const orgId = `org_KeysRevoke404${SUFFIX}`;
  await seedEnvelope(orgId);
  const app = buildApp({ orgId });

  const { status, body } = await postRevoke(app, {
    keyId: "key_01HXMISSING000000000000000",
  });
  assert.equal(status, 404);
  assert.equal((body.error as { code: string }).code, "KEY_NOT_FOUND");
});

test("(p) reverification: missing fva claim → 500 STEP_UP_MISCONFIGURED on /keys/rotate", async () => {
  const orgId = `org_KeysRotateNoFva${SUFFIX}`;
  await seedEnvelope(orgId);
  // First, create a key WITH fva so we have a target keyId.
  const setup = buildApp({ orgId });
  const created = await postCreate(setup, { label: "step-up-target" });
  const keyId = created.body.keyId as string;

  // Now build a second app with NO fva claim — simulates a Clerk
  // tenant whose JWT template doesn't emit `fva`. Step-up MUST fail
  // loud, not 403.
  const noFvaApp = buildApp({ orgId, fva: null });
  const { status, body } = await postRotate(noFvaApp, { keyId });
  assert.equal(status, 500);
  assert.equal((body.error as { code: string }).code, "STEP_UP_MISCONFIGURED");
});

test("(q) reverification: stale fva[1] (> 10 min) → 403 with Clerk-native body shape", async () => {
  const orgId = `org_KeysRotateStaleFva${SUFFIX}`;
  await seedEnvelope(orgId);
  const setup = buildApp({ orgId });
  const created = await postCreate(setup, { label: "stale-fva-target" });
  const keyId = created.body.keyId as string;

  // fva[1] = 11 min — exceeds the default 10-min strict threshold.
  const staleApp = buildApp({ orgId, fva: [0, 11] });
  const res = await staleApp.request("/v1/account/keys/rotate", {
    method: "POST",
    headers: { Authorization: "Bearer good_token", "Content-Type": "application/json" },
    body: JSON.stringify({ keyId }),
  });
  assert.equal(res.status, 403);
  const body = (await res.json()) as {
    clerk_error?: {
      type: string;
      reason: string;
      metadata: { level: string; afterMinutes: number };
    };
    error?: unknown;
  };
  // Body must be the Clerk-native shape — NOT our standard error envelope.
  assert.ok(body.clerk_error, "body must use Clerk-native shape so useReverification() recognises it");
  assert.equal(body.error, undefined, "must NOT use the standard error envelope");
  assert.equal(body.clerk_error?.type, "forbidden");
  assert.equal(body.clerk_error?.reason, "reverification-error");
  assert.equal(body.clerk_error?.metadata.level, "second_factor");
  assert.equal(body.clerk_error?.metadata.afterMinutes, 10);
});

test("(r) reverification: -1 fva (factor never used) → 403 with Clerk-native body", async () => {
  const orgId = `org_KeysRotateNeverFva${SUFFIX}`;
  await seedEnvelope(orgId);
  const setup = buildApp({ orgId });
  const created = await postCreate(setup, { label: "never-fva-target" });
  const keyId = created.body.keyId as string;

  // fva[1] = -1 (never verified) is treated as stale by design.
  const neverApp = buildApp({ orgId, fva: [0, -1] });
  const res = await neverApp.request("/v1/account/keys/rotate", {
    method: "POST",
    headers: { Authorization: "Bearer good_token", "Content-Type": "application/json" },
    body: JSON.stringify({ keyId }),
  });
  assert.equal(res.status, 403);
  const body = (await res.json()) as {
    clerk_error?: { reason: string };
  };
  assert.equal(body.clerk_error?.reason, "reverification-error");
});

test("(s) per-route gates: member rotate → 403 INSUFFICIENT_ROLE (admin gate runs before reverify)", async () => {
  const orgId = `org_KeysRotateMember${SUFFIX}`;
  await seedEnvelope(orgId);
  // Create with admin to seed a key
  const adminApp = buildApp({ orgId });
  const created = await postCreate(adminApp, { label: "admin-created" });
  const keyId = created.body.keyId as string;

  // Member can't rotate — should get clean 403 INSUFFICIENT_ROLE
  // (NOT a step-up reverification body), because admin gate runs first.
  const memberApp = buildApp({ orgId, orgRole: "org:member" });
  const { status, body } = await postRotate(memberApp, { keyId });
  assert.equal(status, 403);
  assert.equal((body.error as { code: string }).code, "INSUFFICIENT_ROLE");
});

test("(t) per-route gates: member revoke → 403 INSUFFICIENT_ROLE", async () => {
  const orgId = `org_KeysRevokeMember${SUFFIX}`;
  await seedEnvelope(orgId);
  const adminApp = buildApp({ orgId });
  const created = await postCreate(adminApp, { label: "admin-revoke-target" });
  const keyId = created.body.keyId as string;

  const memberApp = buildApp({ orgId, orgRole: "org:member" });
  const { status, body } = await postRevoke(memberApp, { keyId });
  assert.equal(status, 403);
  assert.equal((body.error as { code: string }).code, "INSUFFICIENT_ROLE");
});

test("(u) body validation: rotate with malformed keyId → 400 INVALID_PARAMETERS (Zod regex)", async () => {
  const orgId = `org_KeysRotateBadId${SUFFIX}`;
  await seedEnvelope(orgId);
  const app = buildApp({ orgId });

  const { status, body } = await postRotate(app, { keyId: "not_a_key_id" });
  assert.equal(status, 400);
  assert.equal((body.error as { code: string }).code, "INVALID_PARAMETERS");
});

// ────────────────────────────────────────────────────────────────────
// PR 2 holistic-fix: rotate must migrate UsageCounterRecord rows
// from the OLD apiKeyHash partition to the NEW one in the same atomic
// transaction. Without this, customers can rotate to dodge quota,
// Lago metering loses its `lastPushedCumulativeCount` anchor, and
// threshold-email idempotency flags reset. (Bot review on PR #175.)
// ────────────────────────────────────────────────────────────────────

test("(v) rotate migrates usage rows: requestCount + lastPushedCumulativeCount + pendingMeterEventIdentifier + warningEmailSent preserved on NEW partition; OLD partition rows gone", async () => {
  const orgId = `org_KeysRotateUsage${SUFFIX}`;
  await seedEnvelope(orgId);
  const app = buildApp({ orgId });

  const created = await postCreate(app, { label: "with-usage" });
  assert.equal(created.status, 201);
  const keyId = created.body.keyId as string;
  const oldRaw = created.body.raw as string;
  const oldHash = hashKey(oldRaw);

  // Seed two usage rows under OLD partition: one mid-period counter
  // (carrying Lago + email state, with a non-zero `version` so we
  // can verify it propagates) and a second product to prove the
  // migration handles N>1 rows correctly.
  const oldUsageRowAddress = {
    apiKeyHash: oldHash,
    scope: "address#2026-04",
    requestCount: 950,
    ttl: 9999999999,
    lastUsedAt: "2026-04-27T12:00:00.000Z",
    lastPushedCumulativeCount: 900,
    pendingMeterEventIdentifier: "evt_lago_pending_xyz",
    pendingMeterTargetCumulativeCount: 950,
    warningEmailSent: true,
    version: 47, // simulates a row that's been mutated 47 times
  };
  const oldUsageRowAuth = {
    apiKeyHash: oldHash,
    scope: "auth#2026-04",
    requestCount: 12,
    ttl: 9999999999,
    lastUsedAt: "2026-04-27T11:30:00.000Z",
    lastPushedCumulativeCount: 10,
    version: 12,
  };
  await ddb.send(new PutCommand({ TableName: USAGE_TABLE, Item: oldUsageRowAddress }));
  await ddb.send(new PutCommand({ TableName: USAGE_TABLE, Item: oldUsageRowAuth }));

  const rotated = await postRotate(app, { keyId });
  assert.equal(rotated.status, 200);
  const newRaw = rotated.body.raw as string;
  const newHash = hashKey(newRaw);

  // OLD partition: counter rows must be GONE (REDIRECT row stays).
  const oldAddress = await ddb.send(
    new GetCommand({
      TableName: USAGE_TABLE,
      Key: { apiKeyHash: oldHash, scope: "address#2026-04" },
    }),
  );
  assert.equal(oldAddress.Item, undefined, "OLD address counter row must be deleted");
  const oldAuth = await ddb.send(
    new GetCommand({
      TableName: USAGE_TABLE,
      Key: { apiKeyHash: oldHash, scope: "auth#2026-04" },
    }),
  );
  assert.equal(oldAuth.Item, undefined, "OLD auth counter row must be deleted");

  // OLD REDIRECT row IS present (rotate writes it).
  const oldRedirect = await ddb.send(
    new GetCommand({ TableName: USAGE_TABLE, Key: { apiKeyHash: oldHash, scope: "REDIRECT" } }),
  );
  assert.ok(oldRedirect.Item, "REDIRECT row written by rotate stays under OLD hash");

  // NEW partition: full counter state migrated, including Lago +
  // email idempotency fields. Quota dodge prevented, Lago anchor
  // preserved, no duplicate warning emails.
  const newAddress = await ddb.send(
    new GetCommand({
      TableName: USAGE_TABLE,
      Key: { apiKeyHash: newHash, scope: "address#2026-04" },
    }),
  );
  assert.ok(newAddress.Item, "NEW address counter row must exist");
  assert.equal(newAddress.Item?.requestCount, 950, "requestCount preserved");
  assert.equal(
    newAddress.Item?.lastPushedCumulativeCount,
    900,
    "lastPushedCumulativeCount preserved (Lago anchor)",
  );
  assert.equal(
    newAddress.Item?.pendingMeterEventIdentifier,
    "evt_lago_pending_xyz",
    "pendingMeterEventIdentifier preserved (Lago idempotency key)",
  );
  assert.equal(
    newAddress.Item?.pendingMeterTargetCumulativeCount,
    950,
    "pendingMeterTargetCumulativeCount preserved",
  );
  assert.equal(
    newAddress.Item?.warningEmailSent,
    true,
    "warningEmailSent flag preserved (no duplicate email on next 80% crossing)",
  );
  assert.equal(newAddress.Item?.lastUsedAt, "2026-04-27T12:00:00.000Z", "lastUsedAt preserved");
  assert.equal(newAddress.Item?.version, 47, "version sentinel preserved across migration");

  const newAuth = await ddb.send(
    new GetCommand({
      TableName: USAGE_TABLE,
      Key: { apiKeyHash: newHash, scope: "auth#2026-04" },
    }),
  );
  assert.ok(newAuth.Item, "NEW auth counter row must exist");
  assert.equal(newAuth.Item?.requestCount, 12, "auth scope migrated independently");
});

test("(w) rotate retries on concurrent hot-path increment (version sentinel catches the race)", async () => {
  const orgId = `org_KeysRotateRace${SUFFIX}`;
  await seedEnvelope(orgId);

  // Step 1: create the key normally so we have a real keyId + OLD hash.
  const seedApp = buildApp({ orgId });
  const created = await postCreate(seedApp, { label: "race-target" });
  assert.equal(created.status, 201);
  const keyId = created.body.keyId as string;
  const oldRaw = created.body.raw as string;
  const oldHash = hashKey(oldRaw);

  // Step 2: seed a usage row on the OLD partition at requestCount=950
  // with version=5 (simulating five prior writes from the various
  // version-bumping writers).
  await ddb.send(
    new PutCommand({
      TableName: USAGE_TABLE,
      Item: {
        apiKeyHash: oldHash,
        scope: "address#2026-04",
        requestCount: 950,
        ttl: 9999999999,
        lastPushedCumulativeCount: 900,
        version: 5,
      },
    }),
  );

  // Step 3: build a proxied DDB that, on the FIRST TransactWriteCommand
  // hitting the keys table, races an UPDATE against the OLD partition
  // that mimics auth.ts incrementUsage exactly: `ADD #requestCount :one,
  // #version :one`. After the race, the row has requestCount=951 AND
  // version=6. Rotate's Delete CondExpr asserts version=5; mismatch
  // → cancel → retry. On retry attempt, no interception fires; rotate
  // re-Queries, reads version=6, and commits.
  let interceptedTransactWrites = 0;
  const proxyDdb = new Proxy(ddb, {
    get(target, prop, receiver) {
      if (prop !== "send") return Reflect.get(target, prop, receiver);
      const originalSend = target.send.bind(target);
      return async (cmd: unknown) => {
        const ctorName = (cmd as { constructor: { name: string } }).constructor.name;
        if (ctorName === "TransactWriteCommand" && interceptedTransactWrites === 0) {
          const items =
            ((cmd as { input?: { TransactItems?: unknown[] } }).input?.TransactItems as
              | { Delete?: { TableName?: string } }[]
              | undefined) ?? [];
          const isRotate = items[0]?.Delete?.TableName === KEYS_TABLE;
          if (isRotate) {
            interceptedTransactWrites += 1;
            await target.send(
              new UpdateCommand({
                TableName: USAGE_TABLE,
                Key: { apiKeyHash: oldHash, scope: "address#2026-04" },
                UpdateExpression:
                  "ADD #requestCount :one, #version :one",
                ExpressionAttributeNames: {
                  "#requestCount": "requestCount",
                  "#version": "version",
                },
                ExpressionAttributeValues: { ":one": 1 },
              }) as Parameters<typeof target.send>[0],
            );
          }
        }
        return originalSend(cmd as Parameters<typeof originalSend>[0]);
      };
    },
  });

  // Step 4: rotate via the service wired to the proxied client.
  // (Calling the service directly here — not the route — keeps the
  // proxy boundary tight; member-vs-admin gating is covered by tests
  // (s)/(t).)
  const service = createKeyManagementService({
    ddb: proxyDdb,
    keysTableName: KEYS_TABLE,
    auditTableName: AUDIT_TABLE,
    usageTableName: USAGE_TABLE,
  });
  const rotated = await service.rotateKey({
    orgId,
    keyId,
    actorId: "user_keys_test",
  });
  assert.equal(rotated.status, "rotated");
  if (rotated.status !== "rotated") return;
  const newHash = hashKey(rotated.raw);

  assert.equal(interceptedTransactWrites, 1, "interception fired exactly once on attempt 1");

  // After retry: NEW partition reflects the LATEST state (count=951,
  // version=6), not the stale snapshot Query returned on attempt 1.
  const newRow = await ddb.send(
    new GetCommand({
      TableName: USAGE_TABLE,
      Key: { apiKeyHash: newHash, scope: "address#2026-04" },
    }),
  );
  assert.ok(newRow.Item, "NEW usage row exists after retry");
  assert.equal(
    newRow.Item?.requestCount,
    951,
    "NEW partition reflects the concurrent increment, not the stale Query value",
  );
  assert.equal(
    newRow.Item?.version,
    6,
    "version sentinel reflects the concurrent writer's bump",
  );

  // OLD partition: counter row deleted on the retry attempt.
  const oldRow = await ddb.send(
    new GetCommand({
      TableName: USAGE_TABLE,
      Key: { apiKeyHash: oldHash, scope: "address#2026-04" },
    }),
  );
  assert.equal(oldRow.Item, undefined, "OLD counter row deleted after retry");
});

test("(x) rotate is a no-op for usage migration when no current-period rows exist (typical fresh-key rotate)", async () => {
  const orgId = `org_KeysRotateNoUsage${SUFFIX}`;
  await seedEnvelope(orgId);
  const app = buildApp({ orgId });

  const created = await postCreate(app, { label: "fresh-no-traffic" });
  const keyId = created.body.keyId as string;
  const oldHash = hashKey(created.body.raw as string);

  // Sanity: no usage rows exist for this key (fresh, never used).
  const before = await ddb.send(
    new QueryCommand({
      TableName: USAGE_TABLE,
      KeyConditionExpression: "apiKeyHash = :h",
      ExpressionAttributeValues: { ":h": oldHash },
    }),
  );
  assert.equal(before.Count ?? 0, 0, "no usage rows pre-rotate");

  const rotated = await postRotate(app, { keyId });
  assert.equal(rotated.status, 200, "rotate succeeds with empty usage state");
  const newHash = hashKey(rotated.body.raw as string);

  // Post-rotate: only the REDIRECT row exists under OLD hash; nothing
  // under NEW hash (no counter rows to migrate).
  const oldAfter = await ddb.send(
    new QueryCommand({
      TableName: USAGE_TABLE,
      KeyConditionExpression: "apiKeyHash = :h",
      ExpressionAttributeValues: { ":h": oldHash },
    }),
  );
  assert.equal(oldAfter.Count ?? 0, 1, "only REDIRECT under OLD hash");
  assert.equal(oldAfter.Items?.[0]?.scope, "REDIRECT");

  const newAfter = await ddb.send(
    new QueryCommand({
      TableName: USAGE_TABLE,
      KeyConditionExpression: "apiKeyHash = :h",
      ExpressionAttributeValues: { ":h": newHash },
    }),
  );
  assert.equal(newAfter.Count ?? 0, 0, "no usage rows under NEW hash either");
});

// ────────────────────────────────────────────────────────────────────
// PR 2 holistic-fix v2: bot review #2 raised two more material gaps.
// (y) covers Bug 3 — non-requestCount fields race past CondExpr if
// the sentinel is requestCount-only. Now uses `version` so any
// writer's bump cancels the migration. (z) covers Bug 2 — same
// ClientRequestToken across retries with mutated TransactItems
// returns IdempotentParameterMismatch. Now uses a per-attempt token.
// ────────────────────────────────────────────────────────────────────

test("(y) rotate retries when concurrent writer changes warningEmailSent without changing requestCount (version-only race)", async () => {
  const orgId = `org_KeysRotateEmailRace${SUFFIX}`;
  await seedEnvelope(orgId);
  const seedApp = buildApp({ orgId });
  const created = await postCreate(seedApp, { label: "email-race-target" });
  assert.equal(created.status, 201);
  const keyId = created.body.keyId as string;
  const oldHash = hashKey(created.body.raw as string);

  // Seed: usage row at requestCount=800 (right at warning threshold),
  // version=10. No warningEmailSent flag yet.
  await ddb.send(
    new PutCommand({
      TableName: USAGE_TABLE,
      Item: {
        apiKeyHash: oldHash,
        scope: "address#2026-04",
        requestCount: 800,
        ttl: 9999999999,
        lastPushedCumulativeCount: 0,
        version: 10,
      },
    }),
  );

  // Proxy: simulate quota-email worker flipping warningEmailSent=true
  // BETWEEN our Query and TransactWrite. The worker bumps version
  // (per quota-email.ts pattern) but does NOT touch requestCount.
  // The OLD CondExpr (requestCount = :rc) would NOT catch this — the
  // bug Bot Review #2 flagged. The NEW CondExpr (version = :rv)
  // catches it.
  let interceptedTransactWrites = 0;
  const proxyDdb = new Proxy(ddb, {
    get(target, prop, receiver) {
      if (prop !== "send") return Reflect.get(target, prop, receiver);
      const originalSend = target.send.bind(target);
      return async (cmd: unknown) => {
        const ctorName = (cmd as { constructor: { name: string } }).constructor.name;
        if (ctorName === "TransactWriteCommand" && interceptedTransactWrites === 0) {
          const items =
            ((cmd as { input?: { TransactItems?: unknown[] } }).input?.TransactItems as
              | { Delete?: { TableName?: string } }[]
              | undefined) ?? [];
          if (items[0]?.Delete?.TableName === KEYS_TABLE) {
            interceptedTransactWrites += 1;
            // Mimic quota-email.ts finalizeQuotaEmail exactly.
            await target.send(
              new UpdateCommand({
                TableName: USAGE_TABLE,
                Key: { apiKeyHash: oldHash, scope: "address#2026-04" },
                UpdateExpression:
                  "SET #sent = :true ADD #version :one",
                ExpressionAttributeNames: {
                  "#sent": "warningEmailSent",
                  "#version": "version",
                },
                ExpressionAttributeValues: { ":true": true, ":one": 1 },
              }) as Parameters<typeof target.send>[0],
            );
          }
        }
        return originalSend(cmd as Parameters<typeof originalSend>[0]);
      };
    },
  });

  const service = createKeyManagementService({
    ddb: proxyDdb,
    keysTableName: KEYS_TABLE,
    auditTableName: AUDIT_TABLE,
    usageTableName: USAGE_TABLE,
  });
  const rotated = await service.rotateKey({ orgId, keyId, actorId: "user_keys_test" });
  assert.equal(rotated.status, "rotated");
  if (rotated.status !== "rotated") return;
  const newHash = hashKey(rotated.raw);

  assert.equal(interceptedTransactWrites, 1, "version-only race intercepted exactly once");

  // After retry: NEW partition has the LATEST state — warningEmailSent=true
  // (preserved across migration), requestCount unchanged at 800
  // (the worker didn't touch it), version=11 (worker's bump).
  const newRow = await ddb.send(
    new GetCommand({
      TableName: USAGE_TABLE,
      Key: { apiKeyHash: newHash, scope: "address#2026-04" },
    }),
  );
  assert.ok(newRow.Item, "NEW usage row exists after retry");
  assert.equal(newRow.Item?.requestCount, 800, "requestCount unchanged");
  assert.equal(
    newRow.Item?.warningEmailSent,
    true,
    "concurrent worker's warningEmailSent flip survived the migration",
  );
  assert.equal(newRow.Item?.version, 11, "version reflects the concurrent worker's bump");
});

test("(z) rotate uses a fresh ClientRequestToken per outer attempt (Bug 2 regression)", async () => {
  const orgId = `org_KeysRotateToken${SUFFIX}`;
  await seedEnvelope(orgId);
  const seedApp = buildApp({ orgId });
  const created = await postCreate(seedApp, { label: "token-test" });
  const keyId = created.body.keyId as string;
  const oldHash = hashKey(created.body.raw as string);

  // Seed a usage row that we'll concurrently mutate to force a retry.
  await ddb.send(
    new PutCommand({
      TableName: USAGE_TABLE,
      Item: {
        apiKeyHash: oldHash,
        scope: "address#2026-04",
        requestCount: 100,
        ttl: 9999999999,
        lastPushedCumulativeCount: 0,
        version: 1,
      },
    }),
  );

  // Capture every TransactWriteCommand that targets the keys table
  // (i.e., rotate's transactions). Inject a one-shot version bump on
  // attempt 1 to force a retry. Then assert the captured tokens are
  // DIFFERENT across attempts (Bug 2 fix). DDB Local does not enforce
  // IdempotentParameterMismatch, so we can't directly assert the
  // failure mode — but verifying token uniqueness pins our fix.
  const capturedTokens: string[] = [];
  let intercepted = 0;
  const proxyDdb = new Proxy(ddb, {
    get(target, prop, receiver) {
      if (prop !== "send") return Reflect.get(target, prop, receiver);
      const originalSend = target.send.bind(target);
      return async (cmd: unknown) => {
        const ctorName = (cmd as { constructor: { name: string } }).constructor.name;
        if (ctorName === "TransactWriteCommand") {
          const input = (cmd as { input?: { TransactItems?: unknown[]; ClientRequestToken?: string } })
            .input;
          const items = (input?.TransactItems as { Delete?: { TableName?: string } }[]) ?? [];
          if (items[0]?.Delete?.TableName === KEYS_TABLE) {
            const token = input?.ClientRequestToken;
            if (token) capturedTokens.push(token);
            if (intercepted === 0) {
              intercepted += 1;
              await target.send(
                new UpdateCommand({
                  TableName: USAGE_TABLE,
                  Key: { apiKeyHash: oldHash, scope: "address#2026-04" },
                  UpdateExpression: "ADD #v :one",
                  ExpressionAttributeNames: { "#v": "version" },
                  ExpressionAttributeValues: { ":one": 1 },
                }) as Parameters<typeof target.send>[0],
              );
            }
          }
        }
        return originalSend(cmd as Parameters<typeof originalSend>[0]);
      };
    },
  });

  const service = createKeyManagementService({
    ddb: proxyDdb,
    keysTableName: KEYS_TABLE,
    auditTableName: AUDIT_TABLE,
    usageTableName: USAGE_TABLE,
  });
  const rotated = await service.rotateKey({ orgId, keyId, actorId: "user_keys_test" });
  assert.equal(rotated.status, "rotated");

  assert.equal(capturedTokens.length, 2, "exactly two attempts captured");
  assert.notEqual(
    capturedTokens[0],
    capturedTokens[1],
    `ClientRequestToken must differ per attempt (got ${capturedTokens[0]} vs ${capturedTokens[1]})`,
  );

  // Both tokens must be within DDB's 36-char limit and match the
  // [A-Za-z0-9_-]+ pattern.
  for (const token of capturedTokens) {
    assert.ok(token.length <= 36, `token "${token}" length ${token.length} > 36`);
    assert.match(token, /^[A-Za-z0-9_-]+$/, `token "${token}" must match DDB pattern`);
  }

  // Format: ${auditEventId}-${attempt}. Both share the same prefix
  // (the audit eventId) and differ only in the suffix index.
  const [t0, t1] = capturedTokens;
  if (!t0 || !t1) throw new Error("captured tokens missing");
  const prefix0 = t0.slice(0, t0.lastIndexOf("-"));
  const prefix1 = t1.slice(0, t1.lastIndexOf("-"));
  assert.equal(prefix0, prefix1, "tokens share the audit eventId prefix");
  assert.equal(t0.split("-").pop(), "0", "attempt 0 suffix");
  assert.equal(t1.split("-").pop(), "1", "attempt 1 suffix");
});
