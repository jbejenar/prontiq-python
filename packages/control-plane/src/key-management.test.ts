import test from "node:test";
import assert from "node:assert/strict";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { GetCommand, QueryCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import type { OrgEnvelopeRecord } from "@prontiq/shared";
import { createKeyManagementService } from "./key-management.js";

interface CommandLog {
  type: "Get" | "Query" | "TransactWrite";
  args: unknown;
}

function makeFreeEnvelope(): OrgEnvelopeRecord {
  return {
    apiKeyHash: "ORG#org_test",
    orgId: "org_test",
    ownerEmail: "owner@example.com",
    tier: "free",
    products: ["address"],
    paymentOverdue: false,
    subscriptionItems: {},
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    hasFirstKey: false,
    completedAt: "2026-04-01T00:00:00.000Z",
    activeKeyCount: 0,
  };
}

function makeDdbStub(envelope: OrgEnvelopeRecord | undefined): {
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
        return { Items: [] };
      }
      if (command instanceof TransactWriteCommand) {
        log.push({ type: "TransactWrite", args: command.input });
        return {};
      }
      throw new Error(
        `Unhandled command in stub: ${(command as { constructor: { name: string } }).constructor.name}`,
      );
    },
  } as unknown as DynamoDBDocumentClient;
  return { client, log };
}

test("createKey sets ClientRequestToken=keyId on TransactWriteCommand for SDK-retry idempotency", async () => {
  const { client, log } = makeDdbStub(makeFreeEnvelope());
  const service = createKeyManagementService({
    ddb: client,
    keysTableName: "prontiq-keys-test",
    auditTableName: "prontiq-audit-test",
    usageTableName: "prontiq-usage-test",
    generateKeyId: () => "key_01HXTESTKEY00000000000000",
    generateRawKey: () => ({
      raw: "pq_test_static",
      hash: "h".repeat(64),
      prefix: "pq_test_stat",
    }),
  });

  const result = await service.createKey({
    orgId: "org_test",
    actorId: "user_test",
  });
  assert.equal(result.status, "created");

  const tx = log.find((entry) => entry.type === "TransactWrite");
  assert.ok(tx, "expected exactly one TransactWriteCommand");
  const txInput = tx.args as { ClientRequestToken?: string; TransactItems: unknown[] };

  // The contract: ClientRequestToken is set explicitly to keyId so
  // that (a) SDK-internal retries reuse the same token (preserved
  // across retries because serialization runs OUTSIDE the retry
  // middleware), and (b) DDB's 10-minute idempotency window collapses
  // a successful retry into a no-op without re-firing the conditional
  // checks. If this assertion ever flips, re-read the comment block
  // in key-management.ts createKey() before "fixing" the test.
  assert.equal(
    txInput.ClientRequestToken,
    "key_01HXTESTKEY00000000000000",
    "ClientRequestToken must be set to keyId; SDK auto-gen would also work but explicit is mandatory per AWS docs and makes the contract grep-able",
  );
  assert.equal(txInput.TransactItems.length, 3, "key Put + envelope Update + audit Put");
});

test("createKey ClientRequestToken matches keyId char-class (DDB accepts [A-Za-z0-9_-]{1,36})", async () => {
  const { client, log } = makeDdbStub(makeFreeEnvelope());
  // Use the production keyId generator (default) to confirm the
  // shape it emits is acceptable to DDB. ClientRequestToken pattern
  // per the DDB API reference is [^\x00-\x1f\x7f-\xff]+ length 1-36;
  // we apply the stricter [A-Za-z0-9_-]{1,36} constraint here.
  const service = createKeyManagementService({
    ddb: client,
    keysTableName: "prontiq-keys-test",
    auditTableName: "prontiq-audit-test",
    usageTableName: "prontiq-usage-test",
    generateRawKey: () => ({
      raw: "pq_test_static",
      hash: "h".repeat(64),
      prefix: "pq_test_stat",
    }),
  });

  await service.createKey({ orgId: "org_test", actorId: "user_test" });
  const tx = log.find((entry) => entry.type === "TransactWrite");
  assert.ok(tx);
  const token = (tx.args as { ClientRequestToken?: string }).ClientRequestToken;
  assert.ok(token, "ClientRequestToken must be present");
  assert.match(token, /^key_[0-9A-Z]{26}$/, "keyId-shaped");
  assert.ok(token.length <= 36, `token length ${token.length} must be <= 36 for DDB`);
});
