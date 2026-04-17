import test from "node:test";
import assert from "node:assert/strict";
import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { PutCommand } from "@aws-sdk/lib-dynamodb";
import {
  buildAuditTransactItem,
  getAuditTtlSeconds,
  writeAudit,
  type AuditAction,
} from "./audit.js";

test("buildAuditTransactItem returns a Put item with the correct table and conditions", () => {
  const now = new Date("2026-04-17T10:00:00.000Z");
  const item = buildAuditTransactItem({
    tableName: "prontiq-audit-test",
    orgId: "org_abc",
    action: "ORG_PROVISIONED",
    actorId: "clerk-webhook",
    metadata: { source: "user.created" },
    now,
  });
  assert.ok(item.Put, "Put must be defined");
  assert.equal(item.Put.TableName, "prontiq-audit-test");
  assert.equal(
    item.Put.ConditionExpression,
    "attribute_not_exists(orgId) AND attribute_not_exists(#eventKey)",
  );
  assert.deepEqual(item.Put.ExpressionAttributeNames, {
    "#eventKey": "timestamp#eventId",
  });
});

test("buildAuditTransactItem populates the audit row schema per ARCH §5.5.1", () => {
  const now = new Date("2026-04-17T10:00:00.000Z");
  const item = buildAuditTransactItem({
    tableName: "audit",
    orgId: "org_abc",
    action: "ORG_PROVISIONED",
    actorId: "clerk-webhook",
    metadata: { source: "user.created", stripeCustomerId: "cus_123" },
    now,
  });
  const row = item.Put?.Item as Record<string, unknown>;
  assert.equal(row.orgId, "org_abc");
  assert.equal(row.action, "ORG_PROVISIONED");
  assert.equal(row.actorId, "clerk-webhook");
  assert.deepEqual(row.metadata, { source: "user.created", stripeCustomerId: "cus_123" });
  const sk = row["timestamp#eventId"] as string;
  assert.match(sk, /^2026-04-17T10:00:00\.000Z#[0-9A-HJKMNP-TV-Z]{26}$/);
});

test("buildAuditTransactItem omits metadata when not provided", () => {
  const item = buildAuditTransactItem({
    tableName: "audit",
    orgId: "org_abc",
    action: "KEY_REVOKED",
    actorId: "user_abc",
  });
  const row = item.Put?.Item as Record<string, unknown>;
  assert.equal("metadata" in row, false);
});

test("buildAuditTransactItem TTL is now + 365 days in seconds", () => {
  const now = new Date("2026-04-17T10:00:00.000Z");
  const item = buildAuditTransactItem({
    tableName: "audit",
    orgId: "org_abc",
    action: "X",
    actorId: "y",
    now,
  });
  const row = item.Put?.Item as Record<string, unknown>;
  const expectedTtl = Math.floor(now.getTime() / 1000) + 365 * 24 * 60 * 60;
  assert.equal(row.ttl, expectedTtl);
});

test("getAuditTtlSeconds is now + 365 days", () => {
  const now = new Date("2026-01-01T00:00:00.000Z");
  const ttl = getAuditTtlSeconds(now);
  assert.equal(ttl, Math.floor(now.getTime() / 1000) + 365 * 24 * 60 * 60);
});

test("ULID sort keys generated within the same millisecond are strictly monotonic", () => {
  const now = new Date("2026-04-17T10:00:00.000Z");
  const sortKeys: string[] = [];
  for (let i = 0; i < 100; i++) {
    const item = buildAuditTransactItem({
      tableName: "audit",
      orgId: "org_abc",
      action: "X",
      actorId: "y",
      now,
    });
    const row = item.Put?.Item as Record<string, unknown>;
    sortKeys.push(row["timestamp#eventId"] as string);
  }
  for (let i = 1; i < sortKeys.length; i++) {
    const prev = sortKeys[i - 1] as string;
    const curr = sortKeys[i] as string;
    assert.ok(curr > prev, `expected ${curr} > ${prev} at index ${i}`);
  }
});

test("apiKeyHash is included in the row when provided (P1B.07 DoD)", () => {
  const item = buildAuditTransactItem({
    tableName: "audit",
    orgId: "org_abc",
    action: "ROTATE",
    actorId: "user_y",
    apiKeyHash: "deadbeef".repeat(8),
  });
  const row = item.Put?.Item as Record<string, unknown>;
  assert.equal(row.apiKeyHash, "deadbeef".repeat(8));
});

test("apiKeyHash is omitted when not provided (org-scoped events)", () => {
  const item = buildAuditTransactItem({
    tableName: "audit",
    orgId: "org_abc",
    action: "ORG_PROVISIONED",
    actorId: "clerk-webhook",
  });
  const row = item.Put?.Item as Record<string, unknown>;
  assert.equal("apiKeyHash" in row, false);
});

test("all 5 lifecycle actions produce a valid row (P1B.07 DoD)", () => {
  const actions: AuditAction[] = [
    "CREATE",
    "ROTATE",
    "REVOKE",
    "UPGRADE",
    "DOWNGRADE",
  ];
  for (const action of actions) {
    const item = buildAuditTransactItem({
      tableName: "audit",
      orgId: "org_lifecycle",
      action,
      actorId: "user_test",
      apiKeyHash: "cafebabe".repeat(8),
    });
    const row = item.Put?.Item as Record<string, unknown>;
    assert.equal(row.action, action);
    assert.equal(row.actorId, "user_test");
    assert.equal(row.orgId, "org_lifecycle");
    assert.equal(row.apiKeyHash, "cafebabe".repeat(8));
    assert.equal(typeof row.ttl, "number");
    assert.equal(typeof row["timestamp#eventId"], "string");
  }
});

test("100 sort keys across consecutive ms are all unique", () => {
  const seen = new Set<string>();
  for (let i = 0; i < 100; i++) {
    const item = buildAuditTransactItem({
      tableName: "audit",
      orgId: "org_abc",
      action: "X",
      actorId: "y",
    });
    const row = item.Put?.Item as Record<string, unknown>;
    seen.add(row["timestamp#eventId"] as string);
  }
  assert.equal(seen.size, 100);
});

// ---------------------------------------------------------------------------
// Bug 5 regression — eventId enables idempotent audit writes across retries
// ---------------------------------------------------------------------------

test("Bug 5: deterministic eventId + deterministic now produces identical SK across calls", () => {
  // Without this, retried writeAudit calls always insert a new row.
  const now = new Date("2026-04-17T10:00:00.000Z");
  const eventId = "msg_abc123"; // e.g. Svix message-id
  const a = buildAuditTransactItem({
    tableName: "audit",
    orgId: "org_x",
    action: "ORG_PROVISIONED",
    actorId: "clerk-webhook",
    eventId,
    now,
  });
  const b = buildAuditTransactItem({
    tableName: "audit",
    orgId: "org_x",
    action: "ORG_PROVISIONED",
    actorId: "clerk-webhook",
    eventId,
    now,
  });
  const sk = (a.Put?.Item as Record<string, string>)["timestamp#eventId"];
  const sk2 = (b.Put?.Item as Record<string, string>)["timestamp#eventId"];
  assert.equal(sk, sk2, "same eventId + same now must produce identical SK");
  assert.equal(sk, "2026-04-17T10:00:00.000Z#msg_abc123");
});

test("Bug 5: missing eventId falls back to fresh ULID (no idempotency, but unique)", () => {
  const now = new Date("2026-04-17T10:00:00.000Z");
  const a = buildAuditTransactItem({
    tableName: "audit",
    orgId: "org_x",
    action: "X",
    actorId: "y",
    now,
  });
  const b = buildAuditTransactItem({
    tableName: "audit",
    orgId: "org_x",
    action: "X",
    actorId: "y",
    now,
  });
  const skA = (a.Put?.Item as Record<string, string>)["timestamp#eventId"];
  const skB = (b.Put?.Item as Record<string, string>)["timestamp#eventId"];
  assert.notEqual(skA, skB, "without eventId, fresh ULIDs guarantee uniqueness");
  assert.ok(skA);
  assert.match(skA, /#[0-9A-HJKMNP-TV-Z]{26}$/);
});

function makeWriteAuditStub(opts: {
  throwOnPut?: Error;
}): { ddb: DynamoDBDocumentClient; calls: number } {
  let calls = 0;
  const ddb = {
    async send(command: unknown) {
      if (command instanceof PutCommand) {
        calls += 1;
        if (opts.throwOnPut) {
          throw opts.throwOnPut;
        }
        return {};
      }
      throw new Error("unexpected command");
    },
  } as unknown as DynamoDBDocumentClient;
  return {
    ddb,
    get calls() {
      return calls;
    },
  } as { ddb: DynamoDBDocumentClient; calls: number };
}

test("Bug 5: writeAudit returns { written: true } on a fresh write", async () => {
  const stub = makeWriteAuditStub({});
  const result = await writeAudit({
    ddb: stub.ddb,
    tableName: "audit",
    orgId: "org_y",
    action: "CREATE",
    actorId: "user_test",
    eventId: "evt_unique_1",
    now: new Date("2026-04-17T10:00:00.000Z"),
  });
  assert.deepEqual(result, { written: true });
  assert.equal(stub.calls, 1);
});

test("Bug 5: writeAudit returns { written: false } on ConditionalCheckFailed (idempotent retry)", async () => {
  // Simulate the row already existing — second attempt of an idempotent
  // write must NOT throw; it must surface a clean signal that the row
  // was already there.
  const condFail = new ConditionalCheckFailedException({
    $metadata: {},
    message: "The conditional request failed",
  });
  const stub = makeWriteAuditStub({ throwOnPut: condFail });
  const result = await writeAudit({
    ddb: stub.ddb,
    tableName: "audit",
    orgId: "org_y",
    action: "CREATE",
    actorId: "user_test",
    eventId: "evt_dup",
    now: new Date("2026-04-17T10:00:00.000Z"),
  });
  assert.deepEqual(result, { written: false });
});

test("Bug 5: writeAudit re-throws non-ConditionalCheckFailed errors", async () => {
  // Genuine SDK errors (throttling, network) MUST escape so the caller's
  // retry/circuit-breaker logic can react. We don't want to swallow them
  // as `{ written: false }` — that would hide real failures behind the
  // idempotency contract.
  const throttle = new Error("Rate exceeded");
  throttle.name = "ProvisionedThroughputExceededException";
  const stub = makeWriteAuditStub({ throwOnPut: throttle });
  await assert.rejects(
    () =>
      writeAudit({
        ddb: stub.ddb,
        tableName: "audit",
        orgId: "org_y",
        action: "CREATE",
        actorId: "user_test",
        eventId: "evt_throttle",
        now: new Date("2026-04-17T10:00:00.000Z"),
      }),
    /Rate exceeded/,
  );
});
