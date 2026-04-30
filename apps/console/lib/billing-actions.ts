import { createHash, randomUUID } from "node:crypto";

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  TransactWriteCommand,
} from "@aws-sdk/lib-dynamodb";

import { getBillingActionsServerEnv } from "./server-env.js";

const ROUTE_NAME = "billing.plan-change";
const LOCK_PREFIX = "LOCK#billing.plan-change#";
const PROCESSING_LEASE_MS = 2 * 60 * 1000;
const TTL_SECONDS = 365 * 24 * 60 * 60;
const PROVIDER_IN_FLIGHT_LOCK_MS = TTL_SECONDS * 1000;

export type BillingActionStatus =
  | "failed_permanent"
  | "failed_retryable"
  | "outcome_unknown"
  | "processing"
  | "provider_in_flight"
  | "provider_accepted";

export interface BillingActionResponseBody {
  currentPlanCode: string | null;
  downgradePlanDate: string | null;
  nextPlanCode: string | null;
  reconciliationState: "not_required" | "pending_lago_webhook";
  status: "accepted" | "noop" | "pending";
  targetPlanCode: string;
}

export interface BillingActionRecord {
  actionId: string;
  actorUserId: string;
  attemptToken: string;
  createdAt: string;
  errorCode?: string;
  errorMessage?: string;
  errorStatus?: number;
  externalSubscriptionId: string;
  idempotencyKeyHash: string;
  leaseExpiresAt: number;
  orgId: string;
  requestHash: string;
  responseBody?: BillingActionResponseBody;
  route: typeof ROUTE_NAME;
  status: BillingActionStatus;
  targetPlanCode: string;
  ttl: number;
  updatedAt: string;
}

export interface BillingActionLockRecord {
  actionId: string;
  createdAt: string;
  leaseExpiresAt: number;
  lockOwnerAttemptToken: string;
  lockOwnerActionId: string;
  orgId: string;
  route: typeof ROUTE_NAME;
  targetPlanCode: string;
  ttl: number;
  updatedAt: string;
}

export type BillingActionInspection =
  | { action: BillingActionRecord; kind: "replay" }
  | { action: BillingActionRecord; kind: "retryable" }
  | { kind: "conflict" }
  | { kind: "none" };

export type BillingActionClaim =
  | { action: BillingActionRecord; kind: "claimed" }
  | { action: BillingActionRecord; kind: "replay" }
  | { kind: "conflict" }
  | { kind: "in_progress" };

export interface BillingActionStore {
  claim(input: BillingActionInput): Promise<BillingActionClaim>;
  finalizeFailure(input: BillingActionFailureInput): Promise<void>;
  finalizeSuccess(input: BillingActionSuccessInput): Promise<void>;
  inspect(input: BillingActionInput): Promise<BillingActionInspection>;
  markProviderMutationStarted(input: BillingActionProviderMutationInput): Promise<BillingActionRecord>;
}

export interface BillingActionInput {
  actorUserId: string;
  externalSubscriptionId: string;
  idempotencyKey: string;
  orgId: string;
  targetPlanCode: string;
}

export interface BillingActionSuccessInput {
  action: BillingActionRecord;
  responseBody: BillingActionResponseBody;
}

export interface BillingActionFailureInput {
  action: BillingActionRecord;
  errorCode: string;
  errorMessage: string;
  errorStatus: number;
  status: Extract<BillingActionStatus, "failed_permanent" | "failed_retryable" | "outcome_unknown">;
}

export interface BillingActionProviderMutationInput {
  action: BillingActionRecord;
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function buildBillingActionId(input: Pick<BillingActionInput, "idempotencyKey" | "orgId">) {
  return sha256([input.orgId, ROUTE_NAME, input.idempotencyKey].join("\n"));
}

export function buildBillingActionRequestHash(
  input: Pick<BillingActionInput, "externalSubscriptionId" | "orgId" | "targetPlanCode">,
) {
  return sha256(["POST", "/api/billing/plan-change", input.orgId, input.externalSubscriptionId, input.targetPlanCode].join("\n"));
}

function buildLockId(orgId: string) {
  return `${LOCK_PREFIX}${orgId}`;
}

function nowIso(now: Date) {
  return now.toISOString();
}

function ttlFrom(now: Date) {
  return Math.floor(now.getTime() / 1000) + TTL_SECONDS;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isBillingActionResponseBody(value: unknown): value is BillingActionResponseBody {
  if (!isRecord(value)) return false;
  return (
    (value.status === "accepted" || value.status === "noop" || value.status === "pending") &&
    typeof value.targetPlanCode === "string"
  );
}

function toBillingActionRecord(value: unknown): BillingActionRecord | null {
  if (!isRecord(value)) return null;
  const responseBody = isBillingActionResponseBody(value.responseBody)
    ? { responseBody: value.responseBody }
    : {};
  if (
    typeof value.actionId !== "string" ||
    typeof value.actorUserId !== "string" ||
    typeof value.createdAt !== "string" ||
    typeof value.externalSubscriptionId !== "string" ||
    typeof value.idempotencyKeyHash !== "string" ||
    typeof value.leaseExpiresAt !== "number" ||
    typeof value.orgId !== "string" ||
    typeof value.requestHash !== "string" ||
    value.route !== ROUTE_NAME ||
    typeof value.targetPlanCode !== "string" ||
    typeof value.ttl !== "number" ||
    typeof value.updatedAt !== "string" ||
    ![
      "failed_permanent",
      "failed_retryable",
      "outcome_unknown",
      "processing",
      "provider_accepted",
      "provider_in_flight",
    ].includes(String(value.status))
  ) {
    return null;
  }
  return {
    actionId: value.actionId,
    actorUserId: value.actorUserId,
    attemptToken: typeof value.attemptToken === "string" ? value.attemptToken : "",
    createdAt: value.createdAt,
    ...(typeof value.errorCode === "string" ? { errorCode: value.errorCode } : {}),
    ...(typeof value.errorMessage === "string" ? { errorMessage: value.errorMessage } : {}),
    ...(typeof value.errorStatus === "number" ? { errorStatus: value.errorStatus } : {}),
    externalSubscriptionId: value.externalSubscriptionId,
    idempotencyKeyHash: value.idempotencyKeyHash,
    leaseExpiresAt: value.leaseExpiresAt,
    orgId: value.orgId,
    requestHash: value.requestHash,
    ...responseBody,
    route: ROUTE_NAME,
    status: value.status as BillingActionStatus,
    targetPlanCode: value.targetPlanCode,
    ttl: value.ttl,
    updatedAt: value.updatedAt,
  };
}

export class DynamoBillingActionStore implements BillingActionStore {
  private readonly ddb: DynamoDBDocumentClient;
  private readonly now: () => Date;
  private readonly tableName: string;

  constructor(input: {
    ddb: DynamoDBDocumentClient;
    now?: () => Date;
    tableName: string;
  }) {
    this.ddb = input.ddb;
    this.now = input.now ?? (() => new Date());
    this.tableName = input.tableName;
  }

  async inspect(input: BillingActionInput): Promise<BillingActionInspection> {
    const actionId = buildBillingActionId(input);
    const requestHash = buildBillingActionRequestHash(input);
    const result = await this.ddb.send(
      new GetCommand({
        ConsistentRead: true,
        TableName: this.tableName,
        Key: { actionId },
      }),
    );
    const action = toBillingActionRecord(result.Item);
    if (!action) return { kind: "none" };
    if (action.requestHash !== requestHash) return { kind: "conflict" };
    if (
      action.status === "failed_permanent" ||
      action.status === "outcome_unknown" ||
      action.status === "provider_accepted" ||
      action.status === "provider_in_flight"
    ) {
      return { action, kind: "replay" };
    }
    return { action, kind: "retryable" };
  }

  async claim(input: BillingActionInput): Promise<BillingActionClaim> {
    const inspected = await this.inspect(input);
    if (inspected.kind === "conflict") return inspected;
    if (inspected.kind === "replay") return inspected;

    const now = this.now();
    const action =
      inspected.kind === "retryable"
        ? inspected.action
        : this.buildProcessingAction(input, now);
    const lockId = buildLockId(input.orgId);
    const leaseExpiresAt = now.getTime() + PROCESSING_LEASE_MS;
    const attemptToken = randomUUID();
    const ttl = ttlFrom(now);

    try {
      if (inspected.kind === "retryable") {
        await this.ddb.send(
          new TransactWriteCommand({
            TransactItems: [
              {
                Update: {
                  TableName: this.tableName,
                  Key: { actionId: action.actionId },
                  UpdateExpression:
                    "SET #status = :status, #attemptToken = :attemptToken, #leaseExpiresAt = :leaseExpiresAt, #updatedAt = :updatedAt",
                  ConditionExpression:
                    "#requestHash = :requestHash AND (#status = :retryable OR (#status = :processing AND #leaseExpiresAt < :nowMs))",
                  ExpressionAttributeNames: {
                    "#attemptToken": "attemptToken",
                    "#leaseExpiresAt": "leaseExpiresAt",
                    "#requestHash": "requestHash",
                    "#status": "status",
                    "#updatedAt": "updatedAt",
                  },
                  ExpressionAttributeValues: {
                    ":attemptToken": attemptToken,
                    ":leaseExpiresAt": leaseExpiresAt,
                    ":nowMs": now.getTime(),
                    ":processing": "processing",
                    ":requestHash": action.requestHash,
                    ":retryable": "failed_retryable",
                    ":status": "processing",
                    ":updatedAt": nowIso(now),
                  },
                },
              },
              {
                Put: {
                  TableName: this.tableName,
                  Item: {
                    actionId: lockId,
                    createdAt: nowIso(now),
                    leaseExpiresAt,
                    lockOwnerAttemptToken: attemptToken,
                    lockOwnerActionId: action.actionId,
                    orgId: input.orgId,
                    route: ROUTE_NAME,
                    targetPlanCode: input.targetPlanCode,
                    ttl,
                    updatedAt: nowIso(now),
                  } satisfies BillingActionLockRecord,
                  ConditionExpression:
                    "attribute_not_exists(actionId) OR leaseExpiresAt < :nowMs OR lockOwnerActionId = :ownerActionId",
                  ExpressionAttributeValues: {
                    ":nowMs": now.getTime(),
                    ":ownerActionId": action.actionId,
                  },
                },
              },
            ],
          }),
        );
      } else {
        await this.ddb.send(
          new TransactWriteCommand({
            TransactItems: [
              {
                Put: {
                  TableName: this.tableName,
                  Item: action,
                  ConditionExpression: "attribute_not_exists(actionId)",
                },
              },
              {
                Put: {
                  TableName: this.tableName,
                  Item: {
                    actionId: lockId,
                    createdAt: nowIso(now),
                    leaseExpiresAt,
                    lockOwnerAttemptToken: action.attemptToken,
                    lockOwnerActionId: action.actionId,
                    orgId: input.orgId,
                    route: ROUTE_NAME,
                    targetPlanCode: input.targetPlanCode,
                    ttl,
                    updatedAt: nowIso(now),
                  } satisfies BillingActionLockRecord,
                  ConditionExpression: "attribute_not_exists(actionId) OR leaseExpiresAt < :nowMs",
                  ExpressionAttributeValues: {
                    ":nowMs": now.getTime(),
                  },
                },
              },
            ],
          }),
        );
      }
      return {
        action: {
          ...action,
          attemptToken: inspected.kind === "retryable" ? attemptToken : action.attemptToken,
          leaseExpiresAt,
          status: "processing",
          updatedAt: nowIso(now),
        },
        kind: "claimed",
      };
    } catch {
      const refreshed = await this.inspect(input);
      if (refreshed.kind === "conflict" || refreshed.kind === "replay") return refreshed;
      return { kind: "in_progress" };
    }
  }

  async markProviderMutationStarted(
    input: BillingActionProviderMutationInput,
  ): Promise<BillingActionRecord> {
    const now = this.now();
    const lockId = buildLockId(input.action.orgId);
    const leaseExpiresAt = now.getTime() + PROVIDER_IN_FLIGHT_LOCK_MS;
    await this.ddb.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Update: {
              TableName: this.tableName,
              Key: { actionId: input.action.actionId },
              UpdateExpression:
                "SET #status = :status, #leaseExpiresAt = :leaseExpiresAt, #updatedAt = :updatedAt REMOVE #errorCode, #errorMessage, #errorStatus",
              ConditionExpression:
                "#requestHash = :requestHash AND #status = :processing AND #attemptToken = :attemptToken",
              ExpressionAttributeNames: {
                "#attemptToken": "attemptToken",
                "#errorCode": "errorCode",
                "#errorMessage": "errorMessage",
                "#errorStatus": "errorStatus",
                "#leaseExpiresAt": "leaseExpiresAt",
                "#requestHash": "requestHash",
                "#status": "status",
                "#updatedAt": "updatedAt",
              },
              ExpressionAttributeValues: {
                ":attemptToken": input.action.attemptToken,
                ":leaseExpiresAt": leaseExpiresAt,
                ":processing": "processing",
                ":requestHash": input.action.requestHash,
                ":status": "provider_in_flight",
                ":updatedAt": nowIso(now),
              },
            },
          },
          {
            Update: {
              TableName: this.tableName,
              Key: { actionId: lockId },
              UpdateExpression:
                "SET #leaseExpiresAt = :leaseExpiresAt, #updatedAt = :updatedAt",
              ConditionExpression:
                "lockOwnerActionId = :ownerActionId AND lockOwnerAttemptToken = :attemptToken",
              ExpressionAttributeNames: {
                "#leaseExpiresAt": "leaseExpiresAt",
                "#updatedAt": "updatedAt",
              },
              ExpressionAttributeValues: {
                ":attemptToken": input.action.attemptToken,
                ":leaseExpiresAt": leaseExpiresAt,
                ":ownerActionId": input.action.actionId,
                ":updatedAt": nowIso(now),
              },
            },
          },
        ],
      }),
    );
    return {
      ...input.action,
      leaseExpiresAt,
      status: "provider_in_flight",
      updatedAt: nowIso(now),
    };
  }

  async finalizeSuccess(input: BillingActionSuccessInput): Promise<void> {
    const now = this.now();
    const lockId = buildLockId(input.action.orgId);
    await this.ddb.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Update: {
              TableName: this.tableName,
              Key: { actionId: input.action.actionId },
              UpdateExpression:
                "SET #status = :status, #responseBody = :responseBody, #updatedAt = :updatedAt REMOVE #errorCode, #errorMessage, #errorStatus",
              ConditionExpression:
                "#requestHash = :requestHash AND #status = :providerInFlight AND #attemptToken = :attemptToken",
              ExpressionAttributeNames: {
                "#attemptToken": "attemptToken",
                "#errorCode": "errorCode",
                "#errorMessage": "errorMessage",
                "#errorStatus": "errorStatus",
                "#requestHash": "requestHash",
                "#responseBody": "responseBody",
                "#status": "status",
                "#updatedAt": "updatedAt",
              },
              ExpressionAttributeValues: {
                ":attemptToken": input.action.attemptToken,
                ":providerInFlight": "provider_in_flight",
                ":requestHash": input.action.requestHash,
                ":responseBody": input.responseBody,
                ":status": "provider_accepted",
                ":updatedAt": nowIso(now),
              },
            },
          },
          {
            Delete: {
              TableName: this.tableName,
              Key: { actionId: lockId },
              ConditionExpression:
                "attribute_not_exists(actionId) OR (lockOwnerActionId = :ownerActionId AND lockOwnerAttemptToken = :attemptToken)",
              ExpressionAttributeValues: {
                ":attemptToken": input.action.attemptToken,
                ":ownerActionId": input.action.actionId,
              },
            },
          },
        ],
      }),
    );
  }

  async finalizeFailure(input: BillingActionFailureInput): Promise<void> {
    const now = this.now();
    await this.ddb.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Update: {
              TableName: this.tableName,
              Key: { actionId: input.action.actionId },
              UpdateExpression:
                "SET #status = :status, #errorCode = :errorCode, #errorMessage = :errorMessage, #errorStatus = :errorStatus, #updatedAt = :updatedAt",
              ConditionExpression:
                "#requestHash = :requestHash AND #status = :providerInFlight AND #attemptToken = :attemptToken",
              ExpressionAttributeNames: {
                "#attemptToken": "attemptToken",
                "#errorCode": "errorCode",
                "#errorMessage": "errorMessage",
                "#errorStatus": "errorStatus",
                "#requestHash": "requestHash",
                "#status": "status",
                "#updatedAt": "updatedAt",
              },
              ExpressionAttributeValues: {
                ":errorCode": input.errorCode,
                ":errorMessage": input.errorMessage,
                ":errorStatus": input.errorStatus,
                ":attemptToken": input.action.attemptToken,
                ":providerInFlight": "provider_in_flight",
                ":requestHash": input.action.requestHash,
                ":status": input.status,
                ":updatedAt": nowIso(now),
              },
            },
          },
          {
            Delete: {
              TableName: this.tableName,
              Key: { actionId: buildLockId(input.action.orgId) },
              ConditionExpression:
                "attribute_not_exists(actionId) OR (lockOwnerActionId = :ownerActionId AND lockOwnerAttemptToken = :attemptToken)",
              ExpressionAttributeValues: {
                ":attemptToken": input.action.attemptToken,
                ":ownerActionId": input.action.actionId,
              },
            },
          },
        ],
      }),
    );
  }

  private buildProcessingAction(input: BillingActionInput, now: Date): BillingActionRecord {
    const actionId = buildBillingActionId(input);
    return {
      actionId,
      actorUserId: input.actorUserId,
      attemptToken: randomUUID(),
      createdAt: nowIso(now),
      externalSubscriptionId: input.externalSubscriptionId,
      idempotencyKeyHash: sha256(input.idempotencyKey),
      leaseExpiresAt: now.getTime() + PROCESSING_LEASE_MS,
      orgId: input.orgId,
      requestHash: buildBillingActionRequestHash(input),
      route: ROUTE_NAME,
      status: "processing",
      targetPlanCode: input.targetPlanCode,
      ttl: ttlFrom(now),
      updatedAt: nowIso(now),
    };
  }
}

export function createBillingActionStore() {
  const env = getBillingActionsServerEnv();
  const ddb = DynamoDBDocumentClient.from(
    new DynamoDBClient({
      credentials: {
        accessKeyId: env.accessKeyId,
        secretAccessKey: env.secretAccessKey,
      },
      region: env.region,
    }),
  );
  return new DynamoBillingActionStore({ ddb, tableName: env.tableName });
}
