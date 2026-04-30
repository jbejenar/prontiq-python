import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import {
  parseUsageScope,
  type BillingUsageEventV1,
  type BillingUsageEventV2,
} from "@prontiq/shared";

export type UsageAnalyticsProjectionResult = "applied" | "already_applied";

export interface UsageAnalyticsProjectInput {
  event: BillingUsageEventV1 | BillingUsageEventV2;
  eventPayloadHash: string;
  now: Date;
}

export interface UsageAnalyticsProjector {
  project(input: UsageAnalyticsProjectInput): Promise<UsageAnalyticsProjectionResult>;
}

const USAGE_ANALYTICS_TTL_DAYS = 400;

function getUsageAnalyticsTtl(eventOccurredAt: string): number {
  const parsed = new Date(eventOccurredAt);
  const baseMs = Number.isNaN(parsed.getTime()) ? Date.now() : parsed.getTime();
  return Math.floor(baseMs / 1000) + USAGE_ANALYTICS_TTL_DAYS * 24 * 60 * 60;
}

function getBucketDate(eventOccurredAt: string): string {
  const parsed = new Date(eventOccurredAt);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("occurredAt must be a valid ISO timestamp");
  }
  return parsed.toISOString().slice(0, 10);
}

export function buildUsageDailyBucketKey(input: {
  bucketDate: string;
  periodKey: string;
  product: string;
}): string {
  return `period#${input.periodKey}#day#${input.bucketDate}#product#${input.product}`;
}

export class UsageAnalyticsAlreadyAppliedError extends Error {
  constructor() {
    super("usage analytics projection already applied");
    this.name = "UsageAnalyticsAlreadyAppliedError";
  }
}

export class UsageAnalyticsHashConflictError extends Error {
  constructor() {
    super("usage analytics projection hash conflict");
    this.name = "UsageAnalyticsHashConflictError";
  }
}

function isConditionalCheckFailed(error: unknown): boolean {
  return error instanceof Error && error.name === "TransactionCanceledException";
}

function transactionCancellationCodes(error: unknown): string[] {
  const reasons = (error as { CancellationReasons?: Array<{ Code?: string }> }).CancellationReasons;
  return reasons?.map((reason) => reason.Code ?? "Unknown") ?? [];
}

export class DynamoUsageAnalyticsProjector implements UsageAnalyticsProjector {
  private readonly ddb: DynamoDBDocumentClient;
  private readonly deliveryLedgerTableName: string;
  private readonly usageDailyTableName: string;

  constructor(input: {
    ddb?: DynamoDBDocumentClient;
    deliveryLedgerTableName: string;
    usageDailyTableName: string;
  }) {
    this.ddb =
      input.ddb ?? DynamoDBDocumentClient.from(new DynamoDBClient({ maxAttempts: 3 }));
    this.deliveryLedgerTableName = input.deliveryLedgerTableName;
    this.usageDailyTableName = input.usageDailyTableName;
  }

  async project(
    input: UsageAnalyticsProjectInput,
  ): Promise<UsageAnalyticsProjectionResult> {
    const parsedScope = parseUsageScope(input.event.usageScope);
    if (!parsedScope || parsedScope.product !== input.event.product) {
      throw new Error(`invalid usage scope for analytics projection: ${input.event.usageScope}`);
    }

    const bucketDate = getBucketDate(input.event.occurredAt);
    const bucketKey = buildUsageDailyBucketKey({
      bucketDate,
      periodKey: parsedScope.periodKey,
      product: input.event.product,
    });
    const token = `ua${input.event.eventId.replace(/^bevt_/, "")}`;

    try {
      await this.ddb.send(
        new TransactWriteCommand({
          ClientRequestToken: token,
          TransactItems: [
            {
              Update: {
                TableName: this.deliveryLedgerTableName,
                Key: { eventId: input.event.eventId },
                ConditionExpression:
                  "attribute_exists(#eventId) AND #eventPayloadHash = :hash AND attribute_not_exists(#usageAnalyticsAppliedAt)",
                UpdateExpression:
                  "SET #occurredAt = :occurredAt, #usageAnalyticsAppliedAt = :now",
                ExpressionAttributeNames: {
                  "#eventId": "eventId",
                  "#eventPayloadHash": "eventPayloadHash",
                  "#occurredAt": "occurredAt",
                  "#usageAnalyticsAppliedAt": "usageAnalyticsAppliedAt",
                },
                ExpressionAttributeValues: {
                  ":hash": input.eventPayloadHash,
                  ":now": input.now.toISOString(),
                  ":occurredAt": input.event.occurredAt,
                },
              },
            },
            {
              Update: {
                TableName: this.usageDailyTableName,
                Key: { orgId: input.event.orgId, bucketKey },
                UpdateExpression:
                  "SET #product = :product, #periodKey = :periodKey, #bucketDate = :bucketDate, #updatedAt = :now, #ttl = if_not_exists(#ttl, :ttl) ADD #credits :credits, #eventCount :one",
                ExpressionAttributeNames: {
                  "#bucketDate": "bucketDate",
                  "#credits": "credits",
                  "#eventCount": "eventCount",
                  "#periodKey": "periodKey",
                  "#product": "product",
                  "#ttl": "ttl",
                  "#updatedAt": "updatedAt",
                },
                ExpressionAttributeValues: {
                  ":bucketDate": bucketDate,
                  ":credits": input.event.creditDelta,
                  ":now": input.now.toISOString(),
                  ":one": 1,
                  ":periodKey": parsedScope.periodKey,
                  ":product": input.event.product,
                  ":ttl": getUsageAnalyticsTtl(input.event.occurredAt),
                },
              },
            },
          ],
        }),
      );
      return "applied";
    } catch (error) {
      if (!isConditionalCheckFailed(error)) {
        throw error;
      }
      const codes = transactionCancellationCodes(error);
      if (codes[0] === "ConditionalCheckFailed") {
        return "already_applied";
      }
      throw error;
    }
  }
}
