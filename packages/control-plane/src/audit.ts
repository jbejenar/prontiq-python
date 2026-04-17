import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import type {
  DynamoDBDocumentClient,
  TransactWriteCommandInput,
} from "@aws-sdk/lib-dynamodb";
import { PutCommand } from "@aws-sdk/lib-dynamodb";
import { monotonicFactory } from "ulid";

const ulid = monotonicFactory();

const AUDIT_TTL_DAYS = 365;
const AUDIT_TTL_SECONDS = AUDIT_TTL_DAYS * 24 * 60 * 60;
const SORT_KEY_NAME = "timestamp#eventId";

export type AuditAction =
  | "CREATE"
  | "ROTATE"
  | "REVOKE"
  | "UPGRADE"
  | "DOWNGRADE"
  | "ORG_PROVISIONED";

export interface BuildAuditInput {
  tableName: string;
  orgId: string;
  action: AuditAction | (string & {});
  actorId: string;
  apiKeyHash?: string;
  metadata?: Record<string, unknown>;
  /**
   * Timestamp of the event. Defaults to `new Date()`. **For idempotent
   * writes** (where the same logical event might be retried — Svix
   * webhook redelivery, billing-cron retry after timeout, etc.) you
   * MUST pass the upstream event's timestamp here so retries produce
   * the same sort key.
   */
  now?: Date;
  /**
   * Deterministic identifier for the logical event, used as the eventId
   * portion of the `timestamp#eventId` sort key. Defaults to a fresh
   * monotonic ULID (provides uniqueness but NOT idempotency).
   *
   * **For idempotent writes**, pass the upstream event's identifier:
   *   - Clerk webhook: the Svix `svix-id` header
   *   - Stripe webhook: the Stripe event ID (`evt_...`)
   *   - Billing cron: a deterministic key like `${invoiceId}-${period}`
   *
   * MUST be paired with a deterministic `now` (the upstream event's
   * timestamp) so the full sort key is stable across retries. With both
   * pinned, retries hit the same primary key and the conditional write
   * deterministically rejects duplicates — the audit history then
   * reflects logical events, not delivery attempts.
   */
  eventId?: string;
}

export interface WriteAuditInput extends BuildAuditInput {
  ddb: DynamoDBDocumentClient;
}

export interface WriteAuditResult {
  /**
   * `true` if this call wrote a new audit row.
   * `false` if the row was already present (idempotent retry detected
   * via ConditionalCheckFailed). Callers should treat `false` as a
   * successful no-op, not an error.
   */
  written: boolean;
}

type TransactItem = NonNullable<TransactWriteCommandInput["TransactItems"]>[number];

export function getAuditTtlSeconds(now: Date): number {
  return Math.floor(now.getTime() / 1000) + AUDIT_TTL_SECONDS;
}

export function buildAuditTransactItem(input: BuildAuditInput): TransactItem {
  const now = input.now ?? new Date();
  const eventId = input.eventId ?? ulid(now.getTime());
  const sortKey = `${now.toISOString()}#${eventId}`;

  const item: Record<string, unknown> = {
    orgId: input.orgId,
    [SORT_KEY_NAME]: sortKey,
    action: input.action,
    actorId: input.actorId,
    ttl: getAuditTtlSeconds(now),
  };
  if (input.apiKeyHash !== undefined) {
    item.apiKeyHash = input.apiKeyHash;
  }
  if (input.metadata !== undefined) {
    item.metadata = input.metadata;
  }

  return {
    Put: {
      TableName: input.tableName,
      Item: item,
      ConditionExpression:
        "attribute_not_exists(orgId) AND attribute_not_exists(#eventKey)",
      ExpressionAttributeNames: {
        "#eventKey": SORT_KEY_NAME,
      },
    },
  };
}

/**
 * Writes a single audit row standalone (not inside a TransactWriteItems
 * group). Returns `{ written: false }` when the row already existed —
 * this is the idempotent-retry case, NOT an error. Callers passing
 * a deterministic `eventId` + `now` get exactly-once semantics.
 *
 * Callers that need atomicity with another write (e.g. ORG envelope +
 * audit row in one transaction) should use `buildAuditTransactItem`
 * instead and bundle into their own TransactWriteCommand.
 */
export async function writeAudit(input: WriteAuditInput): Promise<WriteAuditResult> {
  const transactItem = buildAuditTransactItem(input);
  const put = transactItem.Put;
  if (!put) {
    throw new Error("buildAuditTransactItem returned an item without Put");
  }
  try {
    await input.ddb.send(
      new PutCommand({
        TableName: put.TableName,
        Item: put.Item,
        ConditionExpression: put.ConditionExpression,
        ExpressionAttributeNames: put.ExpressionAttributeNames,
      }),
    );
    return { written: true };
  } catch (error) {
    if (error instanceof ConditionalCheckFailedException) {
      return { written: false };
    }
    throw error;
  }
}
