import { createHash, randomUUID } from "node:crypto";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  TransactWriteCommand,
} from "@aws-sdk/lib-dynamodb";
import {
  deriveLagoExternalSubscriptionIdForOrg,
  extractLagoPlanMetadata,
  isLagoPlanVisible,
  type LagoCatalogEnvironment,
} from "@prontiq/shared";

const ROUTE_NAME = "billing.plan-change";
const ROUTE_PATH = "/v1/account/billing/plan-change";
const LOCK_PREFIX = "LOCK#billing.plan-change#";
export const BILLING_PLAN_CHANGE_PRODUCT_POOL = "ADDRESS";
const PROCESSING_LEASE_MS = 2 * 60 * 1000;
const PROVIDER_IN_FLIGHT_LOCK_MS = 365 * 24 * 60 * 60 * 1000;
const TTL_SECONDS = 365 * 24 * 60 * 60;
const DEFAULT_TIMEOUT_MS = 10_000;

export type BillingProductPool = typeof BILLING_PLAN_CHANGE_PRODUCT_POOL;

export type BillingActionStatus =
  | "failed_permanent"
  | "failed_retryable"
  | "outcome_unknown"
  | "processing"
  | "provider_accepted"
  | "provider_in_flight";

export interface BillingPlanChangeResult {
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
  productPool: BillingProductPool;
  requestHash: string;
  responseBody?: BillingPlanChangeResult;
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
  lockOwnerActionId: string;
  lockOwnerAttemptToken: string;
  orgId: string;
  productPool: BillingProductPool;
  route: typeof ROUTE_NAME;
  targetPlanCode: string;
  ttl: number;
  updatedAt: string;
}

export interface BillingActionInput {
  actorUserId: string;
  externalSubscriptionId: string;
  idempotencyKey: string;
  orgId: string;
  productPool: BillingProductPool;
  targetPlanCode: string;
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

export type BillingActionLockInspection =
  | { kind: "active"; lock: BillingActionLockRecord }
  | { kind: "none" };

export interface BillingActionStore {
  claim(input: BillingActionInput): Promise<BillingActionClaim>;
  finalizeFailure(input: {
    action: BillingActionRecord;
    errorCode: string;
    errorMessage: string;
    errorStatus: number;
    status: Extract<BillingActionStatus, "failed_permanent" | "failed_retryable" | "outcome_unknown">;
  }): Promise<void>;
  finalizeSuccess(input: {
    action: BillingActionRecord;
    responseBody: BillingPlanChangeResult;
  }): Promise<void>;
  inspectOrgLock(input: { orgId: string; productPool: BillingProductPool }): Promise<BillingActionLockInspection>;
  inspect(input: BillingActionInput): Promise<BillingActionInspection>;
  markProviderMutationStarted(input: { action: BillingActionRecord }): Promise<BillingActionRecord>;
}

export interface LagoBillingSubscription {
  externalId: string;
  externalCustomerId: string;
  status: string;
  planCode: string;
  planName: string | null;
  previousPlanCode: string | null;
  nextPlanCode: string | null;
  downgradePlanDate: string | null;
}

export interface LagoPlanChangeClient {
  changeSubscriptionPlan(input: {
    externalCustomerId: string;
    externalSubscriptionId: string;
    targetPlanCode: string;
  }): Promise<LagoBillingSubscription>;
  getSubscription(externalSubscriptionId: string): Promise<LagoBillingSubscription | null>;
  listVisiblePlanCodes(): Promise<string[]>;
}

export class LagoPlanChangeError extends Error {
  readonly code: string | null;
  readonly details: Readonly<Record<string, readonly string[]>>;
  readonly status: number;

  constructor(input: {
    code?: string | null;
    details?: Record<string, string[]>;
    message: string;
    status: number;
  }) {
    super(input.message);
    this.name = "LagoPlanChangeError";
    this.code = input.code ?? null;
    this.details = input.details ?? {};
    this.status = input.status;
  }

  hasDetail(value: string): boolean {
    return Object.values(this.details).some((items) => items.includes(value));
  }
}

export type BillingPlanChangeServiceResult =
  | { kind: "success"; responseBody: BillingPlanChangeResult }
  | { action: BillingActionRecord; kind: "replay" }
  | { kind: "conflict" }
  | { kind: "in_progress" }
  | { kind: "ledger_unavailable" }
  | { kind: "transition_in_progress" }
  | {
      code: string;
      kind: "provider_error" | "finalize_error";
      message: string;
      status: number;
    };

export interface BillingPlanChangeDependencies {
  client: LagoPlanChangeClient;
  store: BillingActionStore;
}

let cachedDdb: DynamoDBDocumentClient | undefined;

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function buildLegacyBillingActionId(input: Pick<BillingActionInput, "idempotencyKey" | "orgId">) {
  return sha256([input.orgId, ROUTE_NAME, input.idempotencyKey].join("\n"));
}

export function buildBillingActionId(
  input: Pick<BillingActionInput, "idempotencyKey" | "orgId" | "productPool">,
) {
  return sha256([input.orgId, input.productPool, ROUTE_NAME, input.idempotencyKey].join("\n"));
}

export function buildBillingActionRequestHash(
  input: Pick<BillingActionInput, "externalSubscriptionId" | "orgId" | "productPool" | "targetPlanCode">,
) {
  return sha256(
    [
      "POST",
      ROUTE_PATH,
      input.orgId,
      input.productPool,
      input.externalSubscriptionId,
      input.targetPlanCode,
    ].join("\n"),
  );
}

function buildLegacyBillingActionRequestHash(
  input: Pick<BillingActionInput, "externalSubscriptionId" | "orgId" | "targetPlanCode">,
) {
  return sha256(
    [
      "POST",
      ROUTE_PATH,
      input.orgId,
      input.externalSubscriptionId,
      input.targetPlanCode,
    ].join("\n"),
  );
}

function buildLegacyLockId(orgId: string): string {
  return `${LOCK_PREFIX}${orgId}`;
}

function buildLockId(input: { orgId: string; productPool: BillingProductPool }): string {
  return `${LOCK_PREFIX}${input.productPool}#${input.orgId}`;
}

function isLegacyBillingActionId(action: BillingActionRecord, input: BillingActionInput): boolean {
  return action.actionId === buildLegacyBillingActionId(input);
}

function nowIso(now: Date): string {
  return now.toISOString();
}

function ttlFrom(now: Date): number {
  return Math.floor(now.getTime() / 1000) + TTL_SECONDS;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function getString(value: unknown, paths: string[][]): string | null {
  for (const path of paths) {
    let cursor = value;
    for (const segment of path) {
      cursor = isRecord(cursor) ? cursor[segment] : undefined;
    }
    if (typeof cursor === "string" && cursor.length > 0) return cursor;
  }
  return null;
}

function getObject(value: unknown, paths: string[][]): Record<string, unknown> | undefined {
  for (const path of paths) {
    let cursor = value;
    for (const segment of path) {
      cursor = isRecord(cursor) ? cursor[segment] : undefined;
    }
    if (isRecord(cursor)) return cursor;
  }
  return undefined;
}

function getNumber(value: unknown, paths: string[][]): number | null {
  for (const path of paths) {
    let cursor = value;
    for (const segment of path) {
      cursor = isRecord(cursor) ? cursor[segment] : undefined;
    }
    if (typeof cursor === "number" && Number.isFinite(cursor)) return cursor;
    if (typeof cursor === "string" && cursor.trim().length > 0) {
      const parsed = Number(cursor);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

function getNextPage(payload: unknown): number | null {
  const meta = getObject(payload, [["meta"], ["pagination"]]);
  const nextPage = getNumber(meta, [["next_page"], ["nextPage"]]);
  if (nextPage !== null && nextPage > 0) return nextPage;

  const currentPage = getNumber(meta, [["current_page"], ["currentPage"], ["page"]]);
  const totalPages = getNumber(meta, [["total_pages"], ["totalPages"]]);
  if (currentPage !== null && totalPages !== null && currentPage < totalPages) {
    return currentPage + 1;
  }
  return null;
}

function withPagination(path: string, page: number, perPage = 100) {
  const [pathname, query = ""] = path.split("?", 2);
  const params = new URLSearchParams(query);
  params.set("page", String(page));
  params.set("per_page", String(perPage));
  return `${pathname}?${params.toString()}`;
}

function isBillingPlanChangeResult(value: unknown): value is BillingPlanChangeResult {
  if (!isRecord(value)) return false;
  return (
    (value.status === "accepted" || value.status === "noop" || value.status === "pending") &&
    typeof value.targetPlanCode === "string"
  );
}

function toBillingActionRecord(value: unknown): BillingActionRecord | null {
  if (!isRecord(value)) return null;
  const responseBody = isBillingPlanChangeResult(value.responseBody)
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
    (value.productPool !== undefined && value.productPool !== BILLING_PLAN_CHANGE_PRODUCT_POOL) ||
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
    productPool: BILLING_PLAN_CHANGE_PRODUCT_POOL,
    requestHash: value.requestHash,
    ...responseBody,
    route: ROUTE_NAME,
    status: value.status as BillingActionStatus,
    targetPlanCode: value.targetPlanCode,
    ttl: value.ttl,
    updatedAt: value.updatedAt,
  };
}

function toBillingActionLockRecord(value: unknown): BillingActionLockRecord | null {
  if (!isRecord(value)) return null;
  if (
    typeof value.actionId !== "string" ||
    typeof value.createdAt !== "string" ||
    typeof value.leaseExpiresAt !== "number" ||
    typeof value.lockOwnerActionId !== "string" ||
    typeof value.lockOwnerAttemptToken !== "string" ||
    typeof value.orgId !== "string" ||
    (value.productPool !== undefined && value.productPool !== BILLING_PLAN_CHANGE_PRODUCT_POOL) ||
    value.route !== ROUTE_NAME ||
    typeof value.targetPlanCode !== "string" ||
    typeof value.ttl !== "number" ||
    typeof value.updatedAt !== "string"
  ) {
    return null;
  }
  return {
    actionId: value.actionId,
    createdAt: value.createdAt,
    leaseExpiresAt: value.leaseExpiresAt,
    lockOwnerActionId: value.lockOwnerActionId,
    lockOwnerAttemptToken: value.lockOwnerAttemptToken,
    orgId: value.orgId,
    productPool: BILLING_PLAN_CHANGE_PRODUCT_POOL,
    route: ROUTE_NAME,
    targetPlanCode: value.targetPlanCode,
    ttl: value.ttl,
    updatedAt: value.updatedAt,
  };
}

function normalizeLagoApiUrl(value: string): string {
  const base = value
    .trim()
    .replace(/\/+$/, "")
    .replace(/\/api\/v1$/, "");
  if (!base.startsWith("https://") && !base.startsWith("http://")) {
    throw new Error("LAGO_API_URL must include http:// or https://");
  }
  return `${base}/api/v1`;
}

function parseJsonPayload(text: string): unknown {
  if (text.length === 0) return {};
  return JSON.parse(text) as unknown;
}

function parseLagoErrorDetails(payload: unknown): Record<string, string[]> {
  const rawDetails = getObject(payload, [["error_details"]]);
  if (!rawDetails) return {};
  const details: Record<string, string[]> = {};
  for (const [key, value] of Object.entries(rawDetails)) {
    if (Array.isArray(value)) {
      const items = value.filter((item): item is string => typeof item === "string");
      if (items.length > 0) details[key] = items;
      continue;
    }
    if (typeof value === "string" && value.length > 0) details[key] = [value];
  }
  return details;
}

function buildLagoError(status: number, text: string): LagoPlanChangeError {
  let payload: unknown = {};
  if (text.length > 0) {
    try {
      payload = JSON.parse(text) as unknown;
    } catch {
      return new LagoPlanChangeError({
        message: `Lago request failed with HTTP ${status}`,
        status,
      });
    }
  }
  const code = getString(payload, [["code"]]);
  return new LagoPlanChangeError({
    code,
    details: parseLagoErrorDetails(payload),
    message: `Lago request failed with HTTP ${status}${code ? ` (${code})` : ""}`,
    status,
  });
}

function parseSubscription(payload: unknown): LagoBillingSubscription | null {
  const subscription = isRecord(payload) && isRecord(payload.subscription) ? payload.subscription : payload;
  const externalId = getString(subscription, [["external_id"], ["external_subscription_id"]]);
  const externalCustomerId = getString(subscription, [
    ["external_customer_id"],
    ["customer", "external_id"],
  ]);
  const planCode = getString(subscription, [["plan_code"], ["plan", "code"]]);
  if (!externalId || !externalCustomerId || !planCode) return null;
  return {
    externalId,
    externalCustomerId,
    status: getString(subscription, [["status"]]) ?? "unknown",
    planCode,
    planName: getString(subscription, [["plan", "name"]]),
    previousPlanCode: getString(subscription, [["previous_plan", "code"], ["previous_plan_code"]]),
    nextPlanCode: getString(subscription, [["next_plan", "code"], ["next_plan_code"]]),
    downgradePlanDate: getString(subscription, [["downgrade_plan_date"]]),
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
    const result = await this.ddb.send(
      new GetCommand({
        ConsistentRead: true,
        Key: { actionId: buildBillingActionId(input) },
        TableName: this.tableName,
      }),
    );
    let action = toBillingActionRecord(result.Item);
    if (!action) {
      const legacyResult = await this.ddb.send(
        new GetCommand({
          ConsistentRead: true,
          Key: { actionId: buildLegacyBillingActionId(input) },
          TableName: this.tableName,
        }),
      );
      action = toBillingActionRecord(legacyResult.Item);
    }
    if (!action) return { kind: "none" };
    if (
      action.requestHash !== buildBillingActionRequestHash(input) &&
      action.requestHash !== buildLegacyBillingActionRequestHash(input)
    ) {
      return { kind: "conflict" };
    }
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

  async inspectOrgLock(input: { orgId: string; productPool: BillingProductPool }): Promise<BillingActionLockInspection> {
    const nowMs = this.now().getTime();
    const result = await this.ddb.send(
      new GetCommand({
        ConsistentRead: true,
        Key: { actionId: buildLockId(input) },
        TableName: this.tableName,
      }),
    );
    const scopedLock = toBillingActionLockRecord(result.Item);
    if (scopedLock && scopedLock.leaseExpiresAt >= nowMs) {
      return { kind: "active", lock: scopedLock };
    }

    const legacyResult = await this.ddb.send(
      new GetCommand({
        ConsistentRead: true,
        Key: { actionId: buildLegacyLockId(input.orgId) },
        TableName: this.tableName,
      }),
    );
    const legacyLock = toBillingActionLockRecord(legacyResult.Item);
    if (legacyLock && legacyLock.leaseExpiresAt >= nowMs) {
      return { kind: "active", lock: legacyLock };
    }

    return { kind: "none" };
  }

  async claim(input: BillingActionInput): Promise<BillingActionClaim> {
    const inspected = await this.inspect(input);
    if (inspected.kind === "conflict" || inspected.kind === "replay") return inspected;

    const now = this.now();
    const action = inspected.kind === "retryable" ? inspected.action : this.buildProcessingAction(input, now);
    const lockId = buildLockId(input);
    const legacyLockId = buildLegacyLockId(input.orgId);
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
                  Key: { actionId: action.actionId },
                  TableName: this.tableName,
                  UpdateExpression:
                    "SET #status = :status, #attemptToken = :attemptToken, #leaseExpiresAt = :leaseExpiresAt, #updatedAt = :updatedAt",
                },
              },
              {
                Put: {
                  ConditionExpression:
                    "attribute_not_exists(actionId) OR leaseExpiresAt < :nowMs OR lockOwnerActionId = :ownerActionId",
                  ExpressionAttributeValues: {
                    ":nowMs": now.getTime(),
                    ":ownerActionId": action.actionId,
                  },
                  Item: {
                    actionId: lockId,
                    createdAt: nowIso(now),
                    leaseExpiresAt,
                    lockOwnerActionId: action.actionId,
                    lockOwnerAttemptToken: attemptToken,
                    orgId: input.orgId,
                    productPool: input.productPool,
                    route: ROUTE_NAME,
                    targetPlanCode: input.targetPlanCode,
                    ttl,
                    updatedAt: nowIso(now),
                  } satisfies BillingActionLockRecord,
                  TableName: this.tableName,
                },
              },
              ...(isLegacyBillingActionId(action, input)
                ? [
                    {
                      Delete: {
                        ConditionExpression:
                          "attribute_not_exists(actionId) OR lockOwnerActionId = :ownerActionId OR leaseExpiresAt < :nowMs",
                        ExpressionAttributeValues: {
                          ":nowMs": now.getTime(),
                          ":ownerActionId": action.actionId,
                        },
                        Key: { actionId: legacyLockId },
                        TableName: this.tableName,
                      },
                    },
                  ]
                : []),
            ],
          }),
        );
      } else {
        await this.ddb.send(
          new TransactWriteCommand({
            TransactItems: [
              {
                Put: {
                  ConditionExpression: "attribute_not_exists(actionId)",
                  Item: action,
                  TableName: this.tableName,
                },
              },
              {
                Put: {
                  ConditionExpression: "attribute_not_exists(actionId) OR leaseExpiresAt < :nowMs",
                  ExpressionAttributeValues: { ":nowMs": now.getTime() },
                  Item: {
                    actionId: lockId,
                    createdAt: nowIso(now),
                    leaseExpiresAt,
                    lockOwnerActionId: action.actionId,
                    lockOwnerAttemptToken: action.attemptToken,
                    orgId: input.orgId,
                    productPool: input.productPool,
                    route: ROUTE_NAME,
                    targetPlanCode: input.targetPlanCode,
                    ttl,
                    updatedAt: nowIso(now),
                  } satisfies BillingActionLockRecord,
                  TableName: this.tableName,
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

  async markProviderMutationStarted(input: { action: BillingActionRecord }): Promise<BillingActionRecord> {
    const now = this.now();
    const leaseExpiresAt = now.getTime() + PROVIDER_IN_FLIGHT_LOCK_MS;
    await this.ddb.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Update: {
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
              Key: { actionId: input.action.actionId },
              TableName: this.tableName,
              UpdateExpression:
                "SET #status = :status, #leaseExpiresAt = :leaseExpiresAt, #updatedAt = :updatedAt REMOVE #errorCode, #errorMessage, #errorStatus",
            },
          },
          {
            Update: {
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
              Key: { actionId: buildLockId(input.action) },
              TableName: this.tableName,
              UpdateExpression: "SET #leaseExpiresAt = :leaseExpiresAt, #updatedAt = :updatedAt",
            },
          },
        ],
      }),
    );
    return { ...input.action, leaseExpiresAt, status: "provider_in_flight", updatedAt: nowIso(now) };
  }

  async finalizeSuccess(input: {
    action: BillingActionRecord;
    responseBody: BillingPlanChangeResult;
  }): Promise<void> {
    const now = this.now();
    await this.ddb.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Update: {
              ConditionExpression:
                "#requestHash = :requestHash AND (#status = :providerInFlight OR #status = :processing) AND #attemptToken = :attemptToken",
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
                ":processing": "processing",
                ":requestHash": input.action.requestHash,
                ":responseBody": input.responseBody,
                ":status": "provider_accepted",
                ":updatedAt": nowIso(now),
              },
              Key: { actionId: input.action.actionId },
              TableName: this.tableName,
              UpdateExpression:
                "SET #status = :status, #responseBody = :responseBody, #updatedAt = :updatedAt REMOVE #errorCode, #errorMessage, #errorStatus",
            },
          },
          {
            Delete: {
              ConditionExpression:
                "attribute_not_exists(actionId) OR (lockOwnerActionId = :ownerActionId AND lockOwnerAttemptToken = :attemptToken)",
              ExpressionAttributeValues: {
                ":attemptToken": input.action.attemptToken,
                ":ownerActionId": input.action.actionId,
              },
              Key: { actionId: buildLockId(input.action) },
              TableName: this.tableName,
            },
          },
        ],
      }),
    );
  }

  async finalizeFailure(input: {
    action: BillingActionRecord;
    errorCode: string;
    errorMessage: string;
    errorStatus: number;
    status: Extract<BillingActionStatus, "failed_permanent" | "failed_retryable" | "outcome_unknown">;
  }): Promise<void> {
    const now = this.now();
    const keepLockForOutcomeUnknown = input.status === "outcome_unknown";
    await this.ddb.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Update: {
              ConditionExpression:
                "#requestHash = :requestHash AND (#status = :providerInFlight OR #status = :processing) AND #attemptToken = :attemptToken",
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
                ":attemptToken": input.action.attemptToken,
                ":errorCode": input.errorCode,
                ":errorMessage": input.errorMessage,
                ":errorStatus": input.errorStatus,
                ":providerInFlight": "provider_in_flight",
                ":processing": "processing",
                ":requestHash": input.action.requestHash,
                ":status": input.status,
                ":updatedAt": nowIso(now),
              },
              Key: { actionId: input.action.actionId },
              TableName: this.tableName,
              UpdateExpression:
                "SET #status = :status, #errorCode = :errorCode, #errorMessage = :errorMessage, #errorStatus = :errorStatus, #updatedAt = :updatedAt",
            },
          },
          keepLockForOutcomeUnknown
            ? {
                Update: {
                  ConditionExpression:
                    "lockOwnerActionId = :ownerActionId AND lockOwnerAttemptToken = :attemptToken",
                  ExpressionAttributeNames: {
                    "#leaseExpiresAt": "leaseExpiresAt",
                    "#updatedAt": "updatedAt",
                  },
                  ExpressionAttributeValues: {
                    ":attemptToken": input.action.attemptToken,
                    ":leaseExpiresAt": now.getTime() + PROVIDER_IN_FLIGHT_LOCK_MS,
                    ":ownerActionId": input.action.actionId,
                    ":updatedAt": nowIso(now),
                  },
                  Key: { actionId: buildLockId(input.action) },
                  TableName: this.tableName,
                  UpdateExpression: "SET #leaseExpiresAt = :leaseExpiresAt, #updatedAt = :updatedAt",
                },
              }
            : {
                Delete: {
                  ConditionExpression:
                    "attribute_not_exists(actionId) OR (lockOwnerActionId = :ownerActionId AND lockOwnerAttemptToken = :attemptToken)",
                  ExpressionAttributeValues: {
                    ":attemptToken": input.action.attemptToken,
                    ":ownerActionId": input.action.actionId,
                  },
                  Key: { actionId: buildLockId(input.action) },
                  TableName: this.tableName,
                },
              },
        ],
      }),
    );
  }

  private buildProcessingAction(input: BillingActionInput, now: Date): BillingActionRecord {
    return {
      actionId: buildBillingActionId(input),
      actorUserId: input.actorUserId,
      attemptToken: randomUUID(),
      createdAt: nowIso(now),
      externalSubscriptionId: input.externalSubscriptionId,
      idempotencyKeyHash: sha256(input.idempotencyKey),
      leaseExpiresAt: now.getTime() + PROCESSING_LEASE_MS,
      orgId: input.orgId,
      productPool: input.productPool,
      requestHash: buildBillingActionRequestHash(input),
      route: ROUTE_NAME,
      status: "processing",
      targetPlanCode: input.targetPlanCode,
      ttl: ttlFrom(now),
      updatedAt: nowIso(now),
    };
  }
}

export class HttpLagoPlanChangeClient implements LagoPlanChangeClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly catalogEnv: LagoCatalogEnvironment;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(input: {
    apiKey: string;
    baseUrl: string;
    catalogEnv: LagoCatalogEnvironment;
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
  }) {
    this.apiKey = input.apiKey;
    this.baseUrl = normalizeLagoApiUrl(input.baseUrl);
    this.catalogEnv = input.catalogEnv;
    this.fetchImpl = input.fetchImpl ?? fetch;
    this.timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  private async request(path: string, init: RequestInit = {}): Promise<unknown | null> {
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${this.apiKey}`,
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...init.headers,
      },
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (response.status === 404) return null;
    const text = await response.text();
    if (!response.ok) throw buildLagoError(response.status, text);
    return parseJsonPayload(text);
  }

  async listVisiblePlanCodes(): Promise<string[]> {
    const rawPlans: unknown[] = [];
    let page: number | null = 1;
    while (page !== null) {
      const payload = await this.request(withPagination("/plans", page));
      rawPlans.push(...(isRecord(payload) ? asArray(payload.plans) : []));
      page = getNextPage(payload);
    }
    return rawPlans.flatMap((plan) => {
      const code = getString(plan, [["code"]]);
      if (!code) return [];
      return isLagoPlanVisible({
        catalogEnv: this.catalogEnv,
        metadata: extractLagoPlanMetadata(plan),
      })
        ? [code]
        : [];
    });
  }

  async getSubscription(externalSubscriptionId: string): Promise<LagoBillingSubscription | null> {
    const payload = await this.request(`/subscriptions/${encodeURIComponent(externalSubscriptionId)}`);
    return payload ? parseSubscription(payload) : null;
  }

  async changeSubscriptionPlan(input: {
    externalCustomerId: string;
    externalSubscriptionId: string;
    targetPlanCode: string;
  }): Promise<LagoBillingSubscription> {
    const payload = await this.request("/subscriptions", {
      body: JSON.stringify({
        subscription: {
          external_customer_id: input.externalCustomerId,
          external_id: input.externalSubscriptionId,
          plan_code: input.targetPlanCode,
        },
      }),
      method: "POST",
    });
    const subscription = parseSubscription(payload);
    if (!subscription) throw new Error("Lago subscription change response was missing subscription.");
    return subscription;
  }
}

function mapPlanChangeError(error: unknown): {
  code: string;
  message: string;
  status: number;
} {
  if (error instanceof Error) {
    if (error.message === "TARGET_PLAN_NOT_AVAILABLE") {
      return { code: "TARGET_PLAN_NOT_AVAILABLE", message: "Selected plan is not available.", status: 400 };
    }
    if (error.message === "PLAN_CHANGE_ALREADY_PENDING") {
      return {
        code: "PLAN_CHANGE_ALREADY_PENDING",
        message: "A Lago plan transition is already pending for this organization.",
        status: 409,
      };
    }
    if (error.message === "SUBSCRIPTION_NOT_FOUND") {
      return {
        code: "SUBSCRIPTION_NOT_FOUND",
        message: "Lago subscription was not found for this organization.",
        status: 404,
      };
    }
  }
  if (error instanceof LagoPlanChangeError) {
    if (error.hasDetail("no_linked_payment_provider")) {
      return {
        code: "PAYMENT_PROVIDER_NOT_LINKED",
        message:
          "Billing is not ready for plan changes yet. The Lago customer has not been linked to Stripe.",
        status: 409,
      };
    }
    if (
      error.hasDetail("payment_method_required") ||
      error.hasDetail("no_payment_method") ||
      error.hasDetail("missing_payment_method")
    ) {
      return {
        code: "PAYMENT_METHOD_REQUIRED",
        message: "Set up a payment method before changing to this plan.",
        status: 409,
      };
    }
  }
  return {
    code: "LAGO_PLAN_CHANGE_FAILED",
    message: error instanceof Error ? error.message : "Could not change billing plan.",
    status: 502,
  };
}

function toOutcomeUnknownResponse(input: {
  message?: string;
} = {}): {
  code: string;
  message: string;
  status: number;
} {
  return {
    code: "LAGO_PLAN_CHANGE_OUTCOME_UNKNOWN",
    message:
      input.message ??
      "Billing plan change outcome is unknown. Inspect Lago before retrying.",
    status: 409,
  };
}

type PreparedPlanChange =
  | { kind: "no_mutation"; responseBody: BillingPlanChangeResult }
  | { externalCustomerId: string; externalSubscriptionId: string; kind: "mutation_required" };

async function prepareBillingPlanChange(input: {
  client: LagoPlanChangeClient;
  orgId: string;
  targetPlanCode: string;
}): Promise<PreparedPlanChange> {
  const externalSubscriptionId = deriveLagoExternalSubscriptionIdForOrg(input.orgId);
  const [subscription, visiblePlanCodes] = await Promise.all([
    input.client.getSubscription(externalSubscriptionId),
    input.client.listVisiblePlanCodes(),
  ]);
  if (!visiblePlanCodes.includes(input.targetPlanCode)) {
    throw new Error("TARGET_PLAN_NOT_AVAILABLE");
  }
  if (!subscription) throw new Error("SUBSCRIPTION_NOT_FOUND");
  if (subscription.nextPlanCode && subscription.nextPlanCode !== input.targetPlanCode) {
    throw new Error("PLAN_CHANGE_ALREADY_PENDING");
  }
  if (subscription.nextPlanCode === input.targetPlanCode) {
    return {
      kind: "no_mutation",
      responseBody: {
        currentPlanCode: subscription.planCode,
        downgradePlanDate: subscription.downgradePlanDate,
        nextPlanCode: subscription.nextPlanCode,
        reconciliationState: "pending_lago_webhook",
        status: "pending",
        targetPlanCode: input.targetPlanCode,
      },
    };
  }
  if (subscription.planCode === input.targetPlanCode) {
    return {
      kind: "no_mutation",
      responseBody: {
        currentPlanCode: subscription.planCode,
        downgradePlanDate: subscription.downgradePlanDate,
        nextPlanCode: subscription.nextPlanCode,
        reconciliationState: "not_required",
        status: "noop",
        targetPlanCode: input.targetPlanCode,
      },
    };
  }

  return {
    externalCustomerId: input.orgId,
    externalSubscriptionId,
    kind: "mutation_required",
  };
}

async function changeBillingPlan(input: {
  client: LagoPlanChangeClient;
  externalCustomerId: string;
  externalSubscriptionId: string;
  targetPlanCode: string;
}): Promise<BillingPlanChangeResult> {
  const changed = await input.client.changeSubscriptionPlan({
    externalCustomerId: input.externalCustomerId,
    externalSubscriptionId: input.externalSubscriptionId,
    targetPlanCode: input.targetPlanCode,
  });
  return {
    currentPlanCode: changed.planCode,
    downgradePlanDate: changed.downgradePlanDate,
    nextPlanCode: changed.nextPlanCode,
    reconciliationState: "pending_lago_webhook",
    status: changed.nextPlanCode ? "pending" : "accepted",
    targetPlanCode: input.targetPlanCode,
  };
}

export function createBillingPlanChangeService(dependencies: BillingPlanChangeDependencies) {
  return {
    async changePlan(input: {
      actorUserId: string;
      idempotencyKey: string;
      orgId: string;
      targetPlanCode: string;
    }): Promise<BillingPlanChangeServiceResult> {
      const actionInput = {
        actorUserId: input.actorUserId,
        externalSubscriptionId: deriveLagoExternalSubscriptionIdForOrg(input.orgId),
        idempotencyKey: input.idempotencyKey,
        orgId: input.orgId,
        productPool: BILLING_PLAN_CHANGE_PRODUCT_POOL,
        targetPlanCode: input.targetPlanCode,
      } satisfies BillingActionInput;

      let inspected: BillingActionInspection;
      try {
        inspected = await dependencies.store.inspect(actionInput);
      } catch {
        return { kind: "ledger_unavailable" };
      }
      if (inspected.kind === "conflict") return { kind: "conflict" };
      if (inspected.kind === "replay") return { action: inspected.action, kind: "replay" };

      try {
        const activeLock = await dependencies.store.inspectOrgLock({
          orgId: input.orgId,
          productPool: BILLING_PLAN_CHANGE_PRODUCT_POOL,
        });
        const requestedActionIds = new Set([
          buildBillingActionId(actionInput),
          buildLegacyBillingActionId(actionInput),
        ]);
        if (
          activeLock.kind === "active" &&
          !requestedActionIds.has(activeLock.lock.lockOwnerActionId)
        ) {
          return { kind: "transition_in_progress" };
        }
      } catch {
        return { kind: "ledger_unavailable" };
      }

      let claim: BillingActionClaim;
      try {
        claim = await dependencies.store.claim(actionInput);
      } catch {
        return { kind: "ledger_unavailable" };
      }
      if (claim.kind === "conflict") return { kind: "conflict" };
      if (claim.kind === "in_progress") return { kind: "in_progress" };
      if (claim.kind === "replay") return { action: claim.action, kind: "replay" };

      let prepared: PreparedPlanChange;
      try {
        prepared = await prepareBillingPlanChange({
          client: dependencies.client,
          orgId: input.orgId,
          targetPlanCode: input.targetPlanCode,
        });
      } catch (error) {
        const mapped = mapPlanChangeError(error);
        try {
          await dependencies.store.finalizeFailure({
            action: claim.action,
            errorCode: mapped.code,
            errorMessage: mapped.message,
            errorStatus: mapped.status,
            status: mapped.status >= 500 ? "failed_retryable" : "failed_permanent",
          });
        } catch {
          return {
            code: "BILLING_ACTION_FINALIZE_FAILED",
            kind: "finalize_error",
            message:
              "Lago preflight rejected the plan change, but local replay evidence could not be finalized. Retry shortly.",
            status: 500,
          };
        }
        return { ...mapped, kind: "provider_error" };
      }

      if (prepared.kind === "no_mutation") {
        try {
          await dependencies.store.finalizeSuccess({
            action: claim.action,
            responseBody: prepared.responseBody,
          });
        } catch {
          return {
            code: "BILLING_ACTION_FINALIZE_FAILED",
            kind: "finalize_error",
            message:
              "The plan change was a Lago no-op, but local replay evidence could not be finalized. Retry shortly.",
            status: 500,
          };
        }
        return { kind: "success", responseBody: prepared.responseBody };
      }

      let providerAction: BillingActionRecord;
      try {
        providerAction = await dependencies.store.markProviderMutationStarted({
          action: claim.action,
        });
      } catch {
        return { kind: "ledger_unavailable" };
      }

      let result: BillingPlanChangeResult;
      try {
        result = await changeBillingPlan({
          client: dependencies.client,
          externalCustomerId: prepared.externalCustomerId,
          externalSubscriptionId: prepared.externalSubscriptionId,
          targetPlanCode: input.targetPlanCode,
        });
      } catch (error) {
        const mapped = mapPlanChangeError(error);
        const status = mapped.status >= 500 ? "outcome_unknown" : "failed_permanent";
        const response = status === "outcome_unknown" ? toOutcomeUnknownResponse() : mapped;
        try {
          await dependencies.store.finalizeFailure({
            action: providerAction,
            errorCode: mapped.code,
            errorMessage: mapped.message,
            errorStatus: mapped.status,
            status,
          });
        } catch {
          return {
            code: "BILLING_ACTION_FINALIZE_FAILED",
            kind: "finalize_error",
            message:
              "Lago rejected the plan change, but local replay evidence could not be finalized. Retry shortly.",
            status: 500,
          };
        }
        return { ...response, kind: "provider_error" };
      }

      try {
        await dependencies.store.finalizeSuccess({ action: providerAction, responseBody: result });
      } catch {
        return {
          code: "BILLING_ACTION_FINALIZE_FAILED",
          kind: "finalize_error",
          message:
            "Lago accepted the plan change, but local replay evidence could not be finalized. Retry shortly.",
          status: 500,
        };
      }
      return { kind: "success", responseBody: result };
    },
  };
}

export type BillingPlanChangeService = ReturnType<typeof createBillingPlanChangeService>;

export function createDefaultBillingPlanChangeService(input: {
  catalogEnv: LagoCatalogEnvironment;
  lagoApiKey: string;
  lagoApiUrl: string;
  tableName: string;
}): BillingPlanChangeService {
  cachedDdb ??= DynamoDBDocumentClient.from(new DynamoDBClient({}));
  return createBillingPlanChangeService({
    client: new HttpLagoPlanChangeClient({
      apiKey: input.lagoApiKey,
      baseUrl: input.lagoApiUrl,
      catalogEnv: input.catalogEnv,
    }),
    store: new DynamoBillingActionStore({ ddb: cachedDdb, tableName: input.tableName }),
  });
}
