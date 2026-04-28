import { ConditionalCheckFailedException, DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import {
  PLANS,
  createLogger,
  deriveLagoExternalSubscriptionIdForOrg,
  hashLagoWebhookPayload,
  isConsumedLagoWebhookEventType,
  type ApiKeyRecord,
  type LagoWebhookEventType,
  type LagoWebhookLedgerRecord,
  type LagoWebhookProcessingStatus,
  type OrgEnvelopeRecord,
  type Tier,
} from "@prontiq/shared";
import { writeAudit } from "./audit.js";

type Logger = Pick<Console, "error" | "warn" | "info">;

export interface LagoSubscriptionSnapshot {
  externalCustomerId: string;
  externalSubscriptionId: string;
  planCode: string;
  status: string;
  previousPlanCode?: string | null;
  nextPlanCode?: string | null;
  downgradePlanDate?: string | null;
  billingPeriodStartedAt: string | null;
  billingPeriodEndingAt: string | null;
}

export interface LagoSubscriptionClient {
  getSubscription(externalSubscriptionId: string): Promise<LagoSubscriptionSnapshot | null>;
}

export interface LagoWebhookReconciliationDependencies {
  auditTableName: string;
  ddb: DynamoDBDocumentClient;
  enabled: boolean;
  keysTableName: string;
  lagoClient: LagoSubscriptionClient;
  ledger: LagoWebhookLedger;
  logger: Logger;
  now: () => Date;
  usageTableName: string;
}

export interface LagoWebhookReconciliationInput {
  payload: unknown;
  payloadHash?: string;
  uniqueKey: string;
}

export type LagoWebhookReconciliationResult =
  | { status: "processed"; httpStatus: number; body: Record<string, unknown> }
  | { status: "ignored"; httpStatus: number; body: Record<string, unknown> }
  | { status: "duplicate"; httpStatus: number; body: Record<string, unknown> }
  | { status: "disabled"; httpStatus: number; body: Record<string, unknown> }
  | { status: "drift"; httpStatus: number; body: Record<string, unknown> }
  | { status: "retryable_failure"; httpStatus: number; body: Record<string, unknown> };

export type LagoWebhookClaimResult =
  | { kind: "claimed" }
  | { kind: "completed" | "ignored"; record: LagoWebhookLedgerRecord }
  | { kind: "in_progress" }
  | { kind: "hash_conflict"; record: LagoWebhookLedgerRecord };

export interface LagoWebhookLedger {
  claim(input: {
    customerId?: string;
    eventType: string;
    now: Date;
    payloadHash: string;
    uniqueKey: string;
  }): Promise<LagoWebhookClaimResult>;
  finalize(input: {
    customerId?: string;
    error?: string;
    eventType: string;
    now: Date;
    orgId?: string;
    payloadHash: string;
    status: LagoWebhookProcessingStatus;
    uniqueKey: string;
  }): Promise<void>;
  get(uniqueKey: string): Promise<LagoWebhookLedgerRecord | undefined>;
}

interface NormalizedWebhook {
  customerId: string | null;
  eventType: string;
  invoicePaymentOverdue: boolean | null;
  invoicePaymentStatus: string | null;
  invoiceSubscriptionExternalId: string | null;
  overdueInvoiceId: string | null;
  payload: unknown;
}

interface CustomerResolution {
  keys: ApiKeyRecord[];
  orgEnvelope: OrgEnvelopeRecord;
  orgId: string;
}

const ORG_ID_INDEX = "orgId-index";
const LEDGER_TTL_DAYS = 30;
// Keep this aligned with the PqLagoWebhook Lambda timeout in sst.config.ts.
const WEBHOOK_LAMBDA_TIMEOUT_SECONDS = 30;
const PROCESSING_LEASE_BUFFER_SECONDS = 15;
const PROCESSING_LEASE_SECONDS = WEBHOOK_LAMBDA_TIMEOUT_SECONDS + PROCESSING_LEASE_BUFFER_SECONDS;
const MAX_ERROR_LENGTH = 1_000;
const LAGO_ACTIVE_SUBSCRIPTION_STATUS = "active";
const LAGO_KNOWN_SUBSCRIPTION_STATUSES = new Set(["active", "canceled", "pending", "terminated"]);
const defaultLogger = createLogger("control-plane-lago-webhook-reconciliation");
let cachedDdb: DynamoDBDocumentClient | undefined;

function getDefaultDdb(): DynamoDBDocumentClient {
  if (!cachedDdb) {
    cachedDdb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
  }
  return cachedDdb;
}

function getRequiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isConditionalCheckFailure(error: unknown): boolean {
  return (
    error instanceof ConditionalCheckFailedException ||
    (error instanceof Error && error.name === "ConditionalCheckFailedException")
  );
}

function getLedgerTtl(now: Date): number {
  return Math.floor(now.getTime() / 1000) + LEDGER_TTL_DAYS * 24 * 60 * 60;
}

function truncate(value: string): string {
  return value.length <= MAX_ERROR_LENGTH ? value : value.slice(0, MAX_ERROR_LENGTH);
}

function getProcessingLeaseCutoff(now: Date): string {
  return new Date(now.getTime() - PROCESSING_LEASE_SECONDS * 1000).toISOString();
}

function getString(value: unknown, path: string[]): string | null {
  let cursor = value;
  for (const segment of path) {
    if (Array.isArray(cursor)) {
      const index = Number(segment);
      if (!Number.isInteger(index) || index < 0) return null;
      cursor = cursor[index];
    } else if (isRecord(cursor)) {
      cursor = cursor[segment];
    } else {
      return null;
    }
  }
  return typeof cursor === "string" && cursor.length > 0 ? cursor : null;
}

function getBoolean(value: unknown, path: string[]): boolean | null {
  let cursor = value;
  for (const segment of path) {
    if (Array.isArray(cursor)) {
      const index = Number(segment);
      if (!Number.isInteger(index) || index < 0) return null;
      cursor = cursor[index];
    } else if (isRecord(cursor)) {
      cursor = cursor[segment];
    } else {
      return null;
    }
  }
  return typeof cursor === "boolean" ? cursor : null;
}

function firstString(value: unknown, paths: string[][]): string | null {
  for (const path of paths) {
    const candidate = getString(value, path);
    if (candidate) return candidate;
  }
  return null;
}

function normalizeEventType(payload: unknown): string {
  return firstString(payload, [["webhook_type"], ["event_type"], ["type"]]) ?? "unknown";
}

export function normalizeLagoWebhookPayload(payload: unknown): NormalizedWebhook {
  const eventType = normalizeEventType(payload);
  const subscriptionExternalId = firstString(payload, [
    ["subscription", "external_id"],
    ["subscription", "external_subscription_id"],
    ["data", "subscription", "external_id"],
    ["data", "object", "external_id"],
  ]);
  const invoiceSubscriptionExternalId =
    firstString(payload, [
      ["invoice", "subscription", "external_id"],
      ["invoice", "subscription", "external_subscription_id"],
      ["invoice", "subscriptions", "0", "external_id"],
      ["data", "invoice", "subscription", "external_id"],
      ["data", "object", "subscription", "external_id"],
    ]) ?? subscriptionExternalId;
  const customerId = firstString(payload, [
    ["customer", "external_id"],
    ["subscription", "customer", "external_id"],
    ["subscription", "external_customer_id"],
    ["invoice", "customer", "external_id"],
    ["invoice", "external_customer_id"],
    ["data", "customer", "external_id"],
    ["data", "object", "customer", "external_id"],
    ["data", "object", "external_customer_id"],
  ]);

  return {
    customerId,
    eventType,
    invoicePaymentOverdue:
      getBoolean(payload, ["invoice", "payment_overdue"]) ??
      getBoolean(payload, ["data", "object", "payment_overdue"]),
    invoicePaymentStatus: firstString(payload, [
      ["invoice", "payment_status"],
      ["data", "object", "payment_status"],
    ]),
    invoiceSubscriptionExternalId,
    overdueInvoiceId: firstString(payload, [
      ["invoice", "id"],
      ["invoice", "number"],
      ["data", "object", "id"],
      ["data", "object", "number"],
    ]),
    payload,
  };
}

function buildBillingPeriodKey(snapshot: LagoSubscriptionSnapshot): string | null {
  if (!snapshot.billingPeriodStartedAt || !snapshot.billingPeriodEndingAt) {
    return null;
  }
  return `${snapshot.billingPeriodStartedAt.slice(0, 10)}_${snapshot.billingPeriodEndingAt.slice(0, 10)}`;
}

function isTier(value: string): value is Tier {
  return Object.prototype.hasOwnProperty.call(PLANS, value);
}

function getPlan(tier: Tier) {
  const plan = PLANS[tier];
  if (!plan) {
    throw new Error(`Plan ${tier} is not configured`);
  }
  return plan;
}

function assertKnownLagoSubscriptionStatus(status: string): void {
  if (!LAGO_KNOWN_SUBSCRIPTION_STATUSES.has(status)) {
    throw new Error(`Lago subscription status ${status} is not a recognized entitlement status`);
  }
}

function grantsPlanEntitlements(snapshot: LagoSubscriptionSnapshot): boolean {
  assertKnownLagoSubscriptionStatus(snapshot.status);
  return snapshot.status === LAGO_ACTIVE_SUBSCRIPTION_STATUS;
}

function downgradeSnapshotForInactiveSubscription(
  snapshot: LagoSubscriptionSnapshot | null,
  orgId: string,
  externalSubscriptionId: string,
): LagoSubscriptionSnapshot {
  return {
    billingPeriodEndingAt: null,
    billingPeriodStartedAt: null,
    externalCustomerId: snapshot?.externalCustomerId ?? orgId,
    externalSubscriptionId: snapshot?.externalSubscriptionId ?? externalSubscriptionId,
    planCode: snapshot?.planCode ?? "free",
    status: snapshot?.status ?? "terminated",
  };
}

function getExistingProducts(resolution: CustomerResolution): string[] {
  const products = new Set<string>(resolution.orgEnvelope.products);
  for (const key of resolution.keys) {
    for (const product of key.products) {
      products.add(product);
    }
  }
  return [...products];
}

function getOrgEnvelopeKey(orgId: string): string {
  return `ORG#${orgId}`;
}

function isApiKeyRecord(item: unknown): item is ApiKeyRecord {
  if (!isRecord(item)) return false;
  return (
    typeof item.apiKeyHash === "string" &&
    !item.apiKeyHash.startsWith("ORG#") &&
    !item.apiKeyHash.startsWith("REGISTRY#") &&
    typeof item.orgId === "string" &&
    typeof item.keyPrefix === "string"
  );
}

async function loadOrgEnvelope(
  ddb: DynamoDBDocumentClient,
  keysTableName: string,
  orgId: string,
): Promise<OrgEnvelopeRecord> {
  const response = await ddb.send(
    new GetCommand({
      TableName: keysTableName,
      Key: { apiKeyHash: getOrgEnvelopeKey(orgId) },
    }),
  );
  if (!response.Item) {
    throw new Error(`missing org envelope for ${orgId}`);
  }
  return response.Item as OrgEnvelopeRecord;
}

async function loadOrgKeys(
  ddb: DynamoDBDocumentClient,
  keysTableName: string,
  orgId: string,
): Promise<ApiKeyRecord[]> {
  const response = await ddb.send(
    new QueryCommand({
      TableName: keysTableName,
      IndexName: ORG_ID_INDEX,
      KeyConditionExpression: "orgId = :orgId",
      ExpressionAttributeValues: {
        ":orgId": orgId,
      },
    }),
  );
  return ((response.Items as unknown[] | undefined) ?? []).filter(isApiKeyRecord);
}

async function resolveCustomer(
  ddb: DynamoDBDocumentClient,
  keysTableName: string,
  orgId: string,
): Promise<CustomerResolution> {
  const orgEnvelope = await loadOrgEnvelope(ddb, keysTableName, orgId);
  const keys = await loadOrgKeys(ddb, keysTableName, orgId);
  return { keys, orgEnvelope, orgId };
}

async function updateEnvelopeForSubscription(
  ddb: DynamoDBDocumentClient,
  keysTableName: string,
  orgId: string,
  snapshot: LagoSubscriptionSnapshot,
  tier: Tier,
  paymentOverdue: boolean,
  overdueInvoiceId: string | null,
): Promise<void> {
  const plan = getPlan(tier);
  await ddb.send(
    new UpdateCommand({
      TableName: keysTableName,
      Key: { apiKeyHash: getOrgEnvelopeKey(orgId) },
      UpdateExpression: [
        "SET #tier = :tier",
        "#products = :products",
        "#paymentOverdue = :paymentOverdue",
        "#lagoPlanCode = :planCode",
        "#lagoSubscriptionExternalId = :externalSubscriptionId",
        "#lagoSubscriptionStatus = :subscriptionStatus",
        "#lagoPreviousPlanCode = :nullValue",
        "#lagoNextPlanCode = :nullValue",
        "#lagoDowngradePlanDate = :nullValue",
        "#lagoPlanTransitionStatus = :nullValue",
        "#billingPeriodStartedAt = :periodStart",
        "#billingPeriodEndingAt = :periodEnd",
        "#billingPeriodKey = :periodKey",
        "#lagoPaymentOverdueInvoiceId = :overdueInvoiceId",
      ].join(", "),
      ExpressionAttributeNames: {
        "#billingPeriodEndingAt": "billingPeriodEndingAt",
        "#billingPeriodKey": "billingPeriodKey",
        "#billingPeriodStartedAt": "billingPeriodStartedAt",
        "#lagoPaymentOverdueInvoiceId": "lagoPaymentOverdueInvoiceId",
        "#lagoDowngradePlanDate": "lagoDowngradePlanDate",
        "#lagoNextPlanCode": "lagoNextPlanCode",
        "#lagoPlanCode": "lagoPlanCode",
        "#lagoPlanTransitionStatus": "lagoPlanTransitionStatus",
        "#lagoPreviousPlanCode": "lagoPreviousPlanCode",
        "#lagoSubscriptionExternalId": "lagoSubscriptionExternalId",
        "#lagoSubscriptionStatus": "lagoSubscriptionStatus",
        "#paymentOverdue": "paymentOverdue",
        "#products": "products",
        "#tier": "tier",
      },
      ExpressionAttributeValues: {
        ":externalSubscriptionId": snapshot.externalSubscriptionId,
        ":nullValue": null,
        ":overdueInvoiceId": overdueInvoiceId,
        ":paymentOverdue": paymentOverdue,
        ":periodEnd": snapshot.billingPeriodEndingAt,
        ":periodKey": buildBillingPeriodKey(snapshot),
        ":periodStart": snapshot.billingPeriodStartedAt,
        ":planCode": snapshot.planCode,
        ":products": plan.products,
        ":subscriptionStatus": snapshot.status,
        ":tier": tier,
      },
    }),
  );
}

async function updateKeyForSubscription(
  ddb: DynamoDBDocumentClient,
  keysTableName: string,
  key: ApiKeyRecord,
  snapshot: LagoSubscriptionSnapshot,
  tier: Tier,
  paymentOverdue: boolean,
  overdueInvoiceId: string | null,
): Promise<void> {
  const plan = getPlan(tier);
  await ddb.send(
    new UpdateCommand({
      TableName: keysTableName,
      Key: { apiKeyHash: key.apiKeyHash },
      UpdateExpression: [
        "SET #tier = :tier",
        "#products = :products",
        "#quotaPerProduct = :quotaPerProduct",
        "#rateLimit = :rateLimit",
        "#paymentOverdue = :paymentOverdue",
        "#lagoPlanCode = :planCode",
        "#lagoSubscriptionExternalId = :externalSubscriptionId",
        "#lagoSubscriptionStatus = :subscriptionStatus",
        "#lagoPreviousPlanCode = :nullValue",
        "#lagoNextPlanCode = :nullValue",
        "#lagoDowngradePlanDate = :nullValue",
        "#lagoPlanTransitionStatus = :nullValue",
        "#billingPeriodStartedAt = :periodStart",
        "#billingPeriodEndingAt = :periodEnd",
        "#billingPeriodKey = :periodKey",
        "#lagoPaymentOverdueInvoiceId = :overdueInvoiceId",
      ].join(", "),
      ExpressionAttributeNames: {
        "#billingPeriodEndingAt": "billingPeriodEndingAt",
        "#billingPeriodKey": "billingPeriodKey",
        "#billingPeriodStartedAt": "billingPeriodStartedAt",
        "#lagoPaymentOverdueInvoiceId": "lagoPaymentOverdueInvoiceId",
        "#lagoDowngradePlanDate": "lagoDowngradePlanDate",
        "#lagoNextPlanCode": "lagoNextPlanCode",
        "#lagoPlanCode": "lagoPlanCode",
        "#lagoPlanTransitionStatus": "lagoPlanTransitionStatus",
        "#lagoPreviousPlanCode": "lagoPreviousPlanCode",
        "#lagoSubscriptionExternalId": "lagoSubscriptionExternalId",
        "#lagoSubscriptionStatus": "lagoSubscriptionStatus",
        "#paymentOverdue": "paymentOverdue",
        "#products": "products",
        "#quotaPerProduct": "quotaPerProduct",
        "#rateLimit": "rateLimit",
        "#tier": "tier",
      },
      ExpressionAttributeValues: {
        ":externalSubscriptionId": snapshot.externalSubscriptionId,
        ":nullValue": null,
        ":overdueInvoiceId": overdueInvoiceId,
        ":paymentOverdue": paymentOverdue,
        ":periodEnd": snapshot.billingPeriodEndingAt,
        ":periodKey": buildBillingPeriodKey(snapshot),
        ":periodStart": snapshot.billingPeriodStartedAt,
        ":planCode": snapshot.planCode,
        ":products": plan.products,
        ":quotaPerProduct": plan.quotaPerProduct,
        ":rateLimit": plan.rateLimit,
        ":subscriptionStatus": snapshot.status,
        ":tier": tier,
      },
    }),
  );
}

async function closePriorPeriodRows(
  ddb: DynamoDBDocumentClient,
  usageTableName: string,
  keys: ApiKeyRecord[],
  products: string[],
  nextPeriodKey: string | null,
): Promise<number> {
  let closed = 0;
  for (const key of keys) {
    for (const product of products) {
      const previousPeriodKey = key.billingPeriodKey;
      if (!previousPeriodKey || previousPeriodKey === nextPeriodKey) continue;
      try {
        await ddb.send(
          new UpdateCommand({
            TableName: usageTableName,
            Key: {
              apiKeyHash: key.apiKeyHash,
              scope: `${product}#period#${previousPeriodKey}`,
            },
            ConditionExpression: "attribute_exists(apiKeyHash) AND attribute_exists(#scope)",
            // `ADD #version :one` — see UsageCounterRecord.version.
            // Without this bump, a rotate racing with a plan transition
            // could migrate a row whose `closed` flag was just set,
            // resulting in a NEW partition that's marked open and gets
            // re-processed on next forwarder cycle.
            UpdateExpression: "SET #closed = :true ADD #version :one",
            ExpressionAttributeNames: {
              "#closed": "closed",
              "#scope": "scope",
              "#version": "version",
            },
            ExpressionAttributeValues: {
              ":true": true,
              ":one": 1,
            },
          }),
        );
        closed += 1;
      } catch (error) {
        if (isConditionalCheckFailure(error)) continue;
        throw error;
      }
    }
  }
  return closed;
}

async function updateEnvelopeForPendingTransition(
  ddb: DynamoDBDocumentClient,
  keysTableName: string,
  orgId: string,
  snapshot: LagoSubscriptionSnapshot,
): Promise<void> {
  await ddb.send(
    new UpdateCommand({
      TableName: keysTableName,
      Key: { apiKeyHash: getOrgEnvelopeKey(orgId) },
      UpdateExpression: [
        "SET #lagoPlanCode = :planCode",
        "#lagoSubscriptionExternalId = :externalSubscriptionId",
        "#lagoSubscriptionStatus = :subscriptionStatus",
        "#lagoPreviousPlanCode = :previousPlanCode",
        "#lagoNextPlanCode = :nextPlanCode",
        "#lagoDowngradePlanDate = :downgradePlanDate",
        "#lagoPlanTransitionStatus = :transitionStatus",
      ].join(", "),
      ExpressionAttributeNames: {
        "#lagoDowngradePlanDate": "lagoDowngradePlanDate",
        "#lagoNextPlanCode": "lagoNextPlanCode",
        "#lagoPlanCode": "lagoPlanCode",
        "#lagoPlanTransitionStatus": "lagoPlanTransitionStatus",
        "#lagoPreviousPlanCode": "lagoPreviousPlanCode",
        "#lagoSubscriptionExternalId": "lagoSubscriptionExternalId",
        "#lagoSubscriptionStatus": "lagoSubscriptionStatus",
      },
      ExpressionAttributeValues: {
        ":downgradePlanDate": snapshot.downgradePlanDate ?? null,
        ":externalSubscriptionId": snapshot.externalSubscriptionId,
        ":nextPlanCode": snapshot.nextPlanCode ?? null,
        ":planCode": snapshot.planCode,
        ":previousPlanCode": snapshot.previousPlanCode ?? null,
        ":subscriptionStatus": snapshot.status,
        ":transitionStatus": snapshot.nextPlanCode ? "pending" : snapshot.status,
      },
    }),
  );
}

async function updateKeyForPendingTransition(
  ddb: DynamoDBDocumentClient,
  keysTableName: string,
  key: ApiKeyRecord,
  snapshot: LagoSubscriptionSnapshot,
): Promise<void> {
  await ddb.send(
    new UpdateCommand({
      TableName: keysTableName,
      Key: { apiKeyHash: key.apiKeyHash },
      UpdateExpression: [
        "SET #lagoPlanCode = :planCode",
        "#lagoSubscriptionExternalId = :externalSubscriptionId",
        "#lagoSubscriptionStatus = :subscriptionStatus",
        "#lagoPreviousPlanCode = :previousPlanCode",
        "#lagoNextPlanCode = :nextPlanCode",
        "#lagoDowngradePlanDate = :downgradePlanDate",
        "#lagoPlanTransitionStatus = :transitionStatus",
      ].join(", "),
      ExpressionAttributeNames: {
        "#lagoDowngradePlanDate": "lagoDowngradePlanDate",
        "#lagoNextPlanCode": "lagoNextPlanCode",
        "#lagoPlanCode": "lagoPlanCode",
        "#lagoPlanTransitionStatus": "lagoPlanTransitionStatus",
        "#lagoPreviousPlanCode": "lagoPreviousPlanCode",
        "#lagoSubscriptionExternalId": "lagoSubscriptionExternalId",
        "#lagoSubscriptionStatus": "lagoSubscriptionStatus",
      },
      ExpressionAttributeValues: {
        ":downgradePlanDate": snapshot.downgradePlanDate ?? null,
        ":externalSubscriptionId": snapshot.externalSubscriptionId,
        ":nextPlanCode": snapshot.nextPlanCode ?? null,
        ":planCode": snapshot.planCode,
        ":previousPlanCode": snapshot.previousPlanCode ?? null,
        ":subscriptionStatus": snapshot.status,
        ":transitionStatus": snapshot.nextPlanCode ? "pending" : snapshot.status,
      },
    }),
  );
}

async function reconcileSubscriptionState(
  dependencies: LagoWebhookReconciliationDependencies,
  normalized: NormalizedWebhook,
  eventType: LagoWebhookEventType,
): Promise<{ orgId: string; closedScopes: number }> {
  if (!normalized.customerId) {
    throw new Error("Lago webhook is missing customer external_id");
  }
  if (normalized.customerId.startsWith("pq_cust_")) {
    throw new Error("legacy pq_cust Lago webhook ignored after Clerk org identity pivot");
  }
  const orgId = normalized.customerId;
  const externalSubscriptionId =
    normalized.invoiceSubscriptionExternalId ??
    deriveLagoExternalSubscriptionIdForOrg(orgId);
  const expectedSubscriptionId = deriveLagoExternalSubscriptionIdForOrg(orgId);
  if (externalSubscriptionId !== expectedSubscriptionId) {
    throw new Error(
      `subscription external id mismatch: expected ${expectedSubscriptionId}, received ${externalSubscriptionId}`,
    );
  }
  const resolved = await resolveCustomer(
    dependencies.ddb,
    dependencies.keysTableName,
    orgId,
  );
  const snapshot = await dependencies.lagoClient.getSubscription(expectedSubscriptionId);
  if (!snapshot && eventType !== "subscription.terminated") {
    throw new Error(`Lago subscription ${expectedSubscriptionId} was not found`);
  }
  if (snapshot && snapshot.externalCustomerId !== orgId) {
    throw new Error(`Lago subscription customer mismatch for ${expectedSubscriptionId}`);
  }
  if (snapshot?.status === "pending" || snapshot?.nextPlanCode) {
    assertKnownLagoSubscriptionStatus(snapshot.status);
    await updateEnvelopeForPendingTransition(
      dependencies.ddb,
      dependencies.keysTableName,
      resolved.orgId,
      snapshot,
    );
    for (const key of resolved.keys) {
      await updateKeyForPendingTransition(
        dependencies.ddb,
        dependencies.keysTableName,
        key,
        snapshot,
      );
    }
    return { orgId: resolved.orgId, closedScopes: 0 };
  }

  const grantsEntitlements = snapshot ? grantsPlanEntitlements(snapshot) : false;
  if (grantsEntitlements && snapshot && !isTier(snapshot.planCode)) {
    throw new Error(`Lago plan_code ${snapshot.planCode} is not a configured Prontiq tier`);
  }
  const effectiveTier: Tier =
    grantsEntitlements && snapshot && isTier(snapshot.planCode) ? snapshot.planCode : "free";
  const effectiveSnapshot =
    grantsEntitlements && snapshot
      ? snapshot
      : downgradeSnapshotForInactiveSubscription(
          snapshot,
          orgId,
          expectedSubscriptionId,
        );
  const nextPeriodKey = grantsEntitlements ? buildBillingPeriodKey(effectiveSnapshot) : null;

  const paymentOverdue =
    !grantsEntitlements || eventType === "subscription.terminated"
      ? false
      : eventType === "invoice.payment_overdue"
        ? true
        : eventType === "invoice.payment_status_updated"
          ? false
          : resolved.orgEnvelope.paymentOverdue;
  const overdueInvoiceId =
    !grantsEntitlements || eventType === "subscription.terminated"
      ? null
      : eventType === "invoice.payment_overdue"
        ? normalized.overdueInvoiceId
        : eventType === "invoice.payment_status_updated"
          ? null
          : (resolved.orgEnvelope.lagoPaymentOverdueInvoiceId ?? null);
  const closedScopes = await closePriorPeriodRows(
    dependencies.ddb,
    dependencies.usageTableName,
    resolved.keys,
    grantsEntitlements ? getPlan(effectiveTier).products : getExistingProducts(resolved),
    nextPeriodKey,
  );
  await updateEnvelopeForSubscription(
    dependencies.ddb,
    dependencies.keysTableName,
    resolved.orgId,
    effectiveSnapshot,
    effectiveTier,
    paymentOverdue,
    overdueInvoiceId,
  );
  for (const key of resolved.keys) {
    await updateKeyForSubscription(
      dependencies.ddb,
      dependencies.keysTableName,
      key,
      effectiveSnapshot,
      effectiveTier,
      paymentOverdue,
      overdueInvoiceId,
    );
  }
  return { orgId: resolved.orgId, closedScopes };
}

function shouldIgnoreInvoicePaymentStatusUpdate(
  normalized: NormalizedWebhook,
  envelope: OrgEnvelopeRecord,
): boolean {
  return (
    normalized.invoicePaymentStatus !== "succeeded" ||
    normalized.invoicePaymentOverdue !== false ||
    !normalized.overdueInvoiceId ||
    envelope.lagoPaymentOverdueInvoiceId !== normalized.overdueInvoiceId
  );
}

async function writeLagoAudit(
  dependencies: LagoWebhookReconciliationDependencies,
  input: {
    action: string;
    customerId?: string | null;
    eventType: string;
    metadata?: Record<string, unknown>;
    orgId: string;
    uniqueKey: string;
  },
): Promise<void> {
  await writeAudit({
    actorId: "lago-webhook",
    ddb: dependencies.ddb,
    eventId: input.uniqueKey,
    metadata: {
      customerId: input.customerId,
      eventType: input.eventType,
      ...input.metadata,
    },
    now: dependencies.now(),
    orgId: input.orgId,
    tableName: dependencies.auditTableName,
    action: input.action,
  });
}

export class DynamoLagoWebhookLedger implements LagoWebhookLedger {
  private readonly ddb: DynamoDBDocumentClient;
  private readonly tableName: string;

  constructor(input: { ddb: DynamoDBDocumentClient; tableName: string }) {
    this.ddb = input.ddb;
    this.tableName = input.tableName;
  }

  async get(uniqueKey: string): Promise<LagoWebhookLedgerRecord | undefined> {
    const response = await this.ddb.send(
      new GetCommand({
        ConsistentRead: true,
        TableName: this.tableName,
        Key: { uniqueKey },
      }),
    );
    return response.Item as LagoWebhookLedgerRecord | undefined;
  }

  private async reopenForRetry(input: {
    customerId?: string;
    eventType: string;
    expectedStatus: LagoWebhookProcessingStatus;
    now: Date;
    payloadHash: string;
    staleCutoff?: string;
    uniqueKey: string;
  }): Promise<boolean> {
    const setExpressions = [
      "#eventType = :eventType",
      "#lastSeenAt = :now",
      "#status = :processing",
      "#ttl = :ttl",
    ];
    const expressionAttributeNames: Record<string, string> = {
      "#eventType": "eventType",
      "#lastSeenAt": "lastSeenAt",
      "#payloadHash": "payloadHash",
      "#status": "status",
      "#ttl": "ttl",
    };
    const expressionAttributeValues: Record<string, unknown> = {
      ":eventType": input.eventType,
      ":expectedStatus": input.expectedStatus,
      ":now": input.now.toISOString(),
      ":payloadHash": input.payloadHash,
      ":processing": "processing",
      ":ttl": getLedgerTtl(input.now),
    };
    const conditionExpressions = ["#payloadHash = :payloadHash", "#status = :expectedStatus"];
    if (input.staleCutoff) {
      conditionExpressions.push("#lastSeenAt <= :staleCutoff");
      expressionAttributeValues[":staleCutoff"] = input.staleCutoff;
    }
    if (input.customerId) {
      expressionAttributeNames["#customerId"] = "customerId";
      expressionAttributeValues[":customerId"] = input.customerId;
      setExpressions.push("#customerId = :customerId");
    }

    try {
      await this.ddb.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: { uniqueKey: input.uniqueKey },
          ConditionExpression: conditionExpressions.join(" AND "),
          UpdateExpression: `SET ${setExpressions.join(", ")} REMOVE #completedAt, #lastError`,
          ExpressionAttributeNames: {
            ...expressionAttributeNames,
            "#completedAt": "completedAt",
            "#lastError": "lastError",
          },
          ExpressionAttributeValues: expressionAttributeValues,
        }),
      );
      return true;
    } catch (error) {
      if (isConditionalCheckFailure(error)) {
        return false;
      }
      throw error;
    }
  }

  async claim(input: {
    customerId?: string;
    eventType: string;
    now: Date;
    payloadHash: string;
    uniqueKey: string;
  }): Promise<LagoWebhookClaimResult> {
    const item: LagoWebhookLedgerRecord = {
      eventType: input.eventType,
      firstSeenAt: input.now.toISOString(),
      lastSeenAt: input.now.toISOString(),
      payloadHash: input.payloadHash,
      status: "processing",
      ttl: getLedgerTtl(input.now),
      uniqueKey: input.uniqueKey,
    };
    if (input.customerId) {
      item.customerId = input.customerId;
    }
    try {
      await this.ddb.send(
        new PutCommand({
          TableName: this.tableName,
          Item: item,
          ConditionExpression: "attribute_not_exists(#uniqueKey)",
          ExpressionAttributeNames: { "#uniqueKey": "uniqueKey" },
        }),
      );
      return { kind: "claimed" };
    } catch (error) {
      if (!isConditionalCheckFailure(error)) {
        throw error;
      }
    }
    const existing = await this.get(input.uniqueKey);
    if (!existing) {
      return this.claim(input);
    }
    if (existing.payloadHash !== input.payloadHash) {
      return { kind: "hash_conflict", record: existing };
    }
    if (existing.status === "completed" || existing.status === "ignored") {
      return { kind: existing.status, record: existing };
    }
    const staleCutoff = getProcessingLeaseCutoff(input.now);
    if (existing.status === "processing" && existing.lastSeenAt > staleCutoff) {
      return { kind: "in_progress" };
    }
    const reopened = await this.reopenForRetry({
      ...input,
      expectedStatus: existing.status,
      staleCutoff: existing.status === "processing" ? staleCutoff : undefined,
    });
    if (reopened) {
      return { kind: "claimed" };
    }
    return this.claim(input);
  }

  async finalize(input: {
    customerId?: string;
    error?: string;
    eventType: string;
    now: Date;
    orgId?: string;
    payloadHash: string;
    status: LagoWebhookProcessingStatus;
    uniqueKey: string;
  }): Promise<void> {
    const setExpressions = [
      "#status = :status",
      "#eventType = :eventType",
      "#lastSeenAt = :now",
      "#ttl = :ttl",
    ];
    const removeExpressions: string[] = [];
    const expressionAttributeNames: Record<string, string> = {
      "#eventType": "eventType",
      "#lastSeenAt": "lastSeenAt",
      "#payloadHash": "payloadHash",
      "#status": "status",
      "#ttl": "ttl",
    };
    const expressionAttributeValues: Record<string, unknown> = {
      ":eventType": input.eventType,
      ":now": input.now.toISOString(),
      ":payloadHash": input.payloadHash,
      ":status": input.status,
      ":ttl": getLedgerTtl(input.now),
    };

    if (input.customerId) {
      expressionAttributeNames["#customerId"] = "customerId";
      expressionAttributeValues[":customerId"] = input.customerId;
      setExpressions.push("#customerId = :customerId");
    }
    if (input.orgId) {
      expressionAttributeNames["#orgId"] = "orgId";
      expressionAttributeValues[":orgId"] = input.orgId;
      setExpressions.push("#orgId = :orgId");
    }
    if (input.status === "processing") {
      expressionAttributeNames["#completedAt"] = "completedAt";
      removeExpressions.push("#completedAt");
    } else {
      expressionAttributeNames["#completedAt"] = "completedAt";
      expressionAttributeValues[":completedAt"] = input.now.toISOString();
      setExpressions.push("#completedAt = :completedAt");
    }
    if (input.error) {
      expressionAttributeNames["#lastError"] = "lastError";
      expressionAttributeValues[":lastError"] = truncate(input.error);
      setExpressions.push("#lastError = :lastError");
    } else {
      expressionAttributeNames["#lastError"] = "lastError";
      removeExpressions.push("#lastError");
    }
    const updateExpression = [
      `SET ${setExpressions.join(", ")}`,
      removeExpressions.length > 0 ? `REMOVE ${removeExpressions.join(", ")}` : "",
    ]
      .filter(Boolean)
      .join(" ");

    await this.ddb.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { uniqueKey: input.uniqueKey },
        ConditionExpression: "#payloadHash = :payloadHash",
        UpdateExpression: updateExpression,
        ExpressionAttributeNames: expressionAttributeNames,
        ExpressionAttributeValues: expressionAttributeValues,
      }),
    );
  }
}

export class HttpLagoSubscriptionClient implements LagoSubscriptionClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(input: {
    apiKey: string;
    baseUrl: string;
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
  }) {
    this.apiKey = input.apiKey;
    this.baseUrl = input.baseUrl
      .trim()
      .replace(/\/+$/, "")
      .replace(/\/api\/v1$/, "");
    this.fetchImpl = input.fetchImpl ?? fetch;
    this.timeoutMs = input.timeoutMs ?? 10_000;
  }

  async getSubscription(externalSubscriptionId: string): Promise<LagoSubscriptionSnapshot | null> {
    const response = await this.fetchImpl(
      `${this.baseUrl}/api/v1/subscriptions/${encodeURIComponent(externalSubscriptionId)}`,
      {
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
        },
        method: "GET",
        signal: AbortSignal.timeout(this.timeoutMs),
      },
    );
    if (response.status === 404) {
      return null;
    }
    if (!response.ok) {
      throw new Error(`Lago subscription lookup failed with HTTP ${response.status}`);
    }
    const payload = (await response.json()) as unknown;
    const subscription =
      isRecord(payload) && isRecord(payload.subscription) ? payload.subscription : payload;
    const externalCustomerId = firstString(subscription, [
      ["customer", "external_id"],
      ["external_customer_id"],
    ]);
    const planCode = firstString(subscription, [["plan_code"], ["plan", "code"]]);
    const externalId = firstString(subscription, [["external_id"], ["external_subscription_id"]]);
    if (!externalCustomerId || !planCode || !externalId) {
      throw new Error("Lago subscription response is missing required identifiers");
    }
    return {
      billingPeriodEndingAt: firstString(subscription, [
        ["current_billing_period_ending_at"],
        ["current_billing_period_ends_at"],
      ]),
      billingPeriodStartedAt: firstString(subscription, [
        ["current_billing_period_started_at"],
        ["current_billing_period_starts_at"],
      ]),
      externalCustomerId,
      externalSubscriptionId: externalId,
      downgradePlanDate: firstString(subscription, [["downgrade_plan_date"]]),
      nextPlanCode: firstString(subscription, [["next_plan", "code"], ["next_plan_code"]]),
      planCode,
      previousPlanCode: firstString(subscription, [
        ["previous_plan", "code"],
        ["previous_plan_code"],
      ]),
      status: firstString(subscription, [["status"]]) ?? "unknown",
    };
  }
}

export function createLagoWebhookReconciliationService(
  overrides: Partial<LagoWebhookReconciliationDependencies> = {},
): {
  handleWebhook: (
    input: LagoWebhookReconciliationInput,
  ) => Promise<LagoWebhookReconciliationResult>;
} {
  function resolveDependencies(): LagoWebhookReconciliationDependencies {
    const ddb = overrides.ddb ?? getDefaultDdb();
    return {
      auditTableName: overrides.auditTableName ?? getRequiredEnv("AUDIT_TABLE_NAME"),
      ddb,
      enabled: overrides.enabled ?? process.env.LAGO_WEBHOOK_RECONCILIATION_ENABLED === "true",
      keysTableName: overrides.keysTableName ?? getRequiredEnv("KEYS_TABLE_NAME"),
      lagoClient:
        overrides.lagoClient ??
        new HttpLagoSubscriptionClient({
          apiKey: getRequiredEnv("LAGO_API_KEY"),
          baseUrl: getRequiredEnv("LAGO_API_URL"),
        }),
      ledger:
        overrides.ledger ??
        new DynamoLagoWebhookLedger({
          ddb,
          tableName: getRequiredEnv("LAGO_WEBHOOK_EVENTS_TABLE_NAME"),
        }),
      logger: overrides.logger ?? defaultLogger,
      now: overrides.now ?? (() => new Date()),
      usageTableName: overrides.usageTableName ?? getRequiredEnv("USAGE_TABLE_NAME"),
    };
  }

  async function handleWebhook(
    input: LagoWebhookReconciliationInput,
  ): Promise<LagoWebhookReconciliationResult> {
    const dependencies = resolveDependencies();
    const now = dependencies.now();
    const payloadHash = input.payloadHash ?? hashLagoWebhookPayload(input.payload);
    const normalized = normalizeLagoWebhookPayload(input.payload);
    if (!dependencies.enabled) {
      dependencies.logger.warn("Lago webhook reconciliation is disabled", {
        eventType: normalized.eventType,
        uniqueKey: input.uniqueKey,
      });
      return { status: "disabled", httpStatus: 503, body: { error: "reconciliation_disabled" } };
    }
    const claim = await dependencies.ledger.claim({
      customerId: normalized.customerId ?? undefined,
      eventType: normalized.eventType,
      now,
      payloadHash,
      uniqueKey: input.uniqueKey,
    });
    if (claim.kind === "completed" || claim.kind === "ignored") {
      return { status: "duplicate", httpStatus: 200, body: { ok: true, status: "duplicate" } };
    }
    if (claim.kind === "in_progress") {
      return { status: "retryable_failure", httpStatus: 500, body: { error: "event_in_progress" } };
    }
    if (claim.kind === "hash_conflict") {
      await dependencies.ledger.finalize({
        customerId: normalized.customerId ?? claim.record.customerId,
        error: "same Lago unique key was delivered with a different payload hash",
        eventType: claim.record.eventType,
        now,
        orgId: claim.record.orgId,
        payloadHash: claim.record.payloadHash,
        status: "drift",
        uniqueKey: input.uniqueKey,
      });
      return { status: "drift", httpStatus: 500, body: { error: "payload_hash_conflict" } };
    }

    if (!isConsumedLagoWebhookEventType(normalized.eventType)) {
      await dependencies.ledger.finalize({
        customerId: normalized.customerId ?? undefined,
        eventType: normalized.eventType,
        now,
        payloadHash,
        status: "ignored",
        uniqueKey: input.uniqueKey,
      });
      return { status: "ignored", httpStatus: 200, body: { ok: true, status: "ignored" } };
    }

    if (normalized.customerId?.startsWith("pq_cust_")) {
      await dependencies.ledger.finalize({
        customerId: normalized.customerId,
        error: "legacy pq_cust webhook ignored after Clerk org identity pivot",
        eventType: normalized.eventType,
        now,
        payloadHash,
        status: "ignored",
        uniqueKey: input.uniqueKey,
      });
      return { status: "ignored", httpStatus: 200, body: { ok: true, status: "ignored" } };
    }

    try {
      if (normalized.eventType === "invoice.payment_status_updated" && normalized.customerId) {
        const envelope = await loadOrgEnvelope(
          dependencies.ddb,
          dependencies.keysTableName,
          normalized.customerId,
        );
        if (shouldIgnoreInvoicePaymentStatusUpdate(normalized, envelope)) {
          await dependencies.ledger.finalize({
            customerId: normalized.customerId,
            eventType: normalized.eventType,
            now,
            orgId: normalized.customerId,
            payloadHash,
            status: "ignored",
            uniqueKey: input.uniqueKey,
          });
          await writeLagoAudit(dependencies, {
            action: "LAGO_WEBHOOK_IGNORED",
            customerId: normalized.customerId,
            eventType: normalized.eventType,
            metadata: { reason: "payment_status_not_overdue_recovery" },
            orgId: normalized.customerId,
            uniqueKey: input.uniqueKey,
          });
          return { status: "ignored", httpStatus: 200, body: { ok: true, status: "ignored" } };
        }
      }
      const reconciliation = await reconcileSubscriptionState(
        dependencies,
        normalized,
        normalized.eventType,
      );
      await dependencies.ledger.finalize({
        customerId: normalized.customerId ?? undefined,
        eventType: normalized.eventType,
        now,
        orgId: reconciliation.orgId,
        payloadHash,
        status: "completed",
        uniqueKey: input.uniqueKey,
      });
      await writeLagoAudit(dependencies, {
        action: "LAGO_WEBHOOK_RECONCILED",
        customerId: normalized.customerId,
        eventType: normalized.eventType,
        metadata: { closedScopes: reconciliation.closedScopes },
        orgId: reconciliation.orgId,
        uniqueKey: input.uniqueKey,
      });
      return { status: "processed", httpStatus: 200, body: { ok: true, status: "processed" } };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await dependencies.ledger.finalize({
        customerId: normalized.customerId ?? undefined,
        error: message,
        eventType: normalized.eventType,
        now,
        payloadHash,
        status: "drift",
        uniqueKey: input.uniqueKey,
      });
      dependencies.logger.error("Lago webhook reconciliation failed", {
        error: message,
        eventType: normalized.eventType,
        uniqueKey: input.uniqueKey,
      });
      return { status: "drift", httpStatus: 500, body: { error: "reconciliation_drift" } };
    }
  }

  return { handleWebhook };
}
