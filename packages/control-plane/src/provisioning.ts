import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import {
  DEFAULT_ACCOUNT_URL,
  createLogger,
  deriveLagoExternalSubscriptionIdForOrg,
  type OrgEnvelopeRecord,
  type ApiKeyRecord,
} from "@prontiq/shared";
import { buildAuditTransactItem } from "./audit.js";
import { isSuppressedEmail, sendSignedSesEmail } from "./email.js";
import {
  HttpLagoEntitlementsClient,
  buildBillingPeriodKeyFromProjection,
  projectLagoEntitlements,
  type LagoEntitlementProjection,
  type LagoSubscriptionCharge,
  type LagoSubscriptionEntitlement,
} from "./lago-entitlements.js";

// Three classes of error vocabulary surface from a DynamoDB call:
//
//   1. Top-level AWS SDK exception names — the request itself was
//      rejected before any per-item processing. Includes throttling,
//      service unavailability, AND transport-layer failures (timeouts,
//      aborts, networking errors). The bottom three names cover the
//      ambiguous-write case: the call timed out so we don't know if
//      the write committed — safe stance is "transient, retry".
const TRANSIENT_TOP_LEVEL_NAMES = new Set([
  // Throughput / throttling (AWS service-side capacity)
  "ProvisionedThroughputExceededException",
  "ThrottlingException",
  "RequestLimitExceeded",
  "RequestThrottledException",
  // Server-side availability
  "InternalServerError",
  "InternalFailure",
  "ServiceUnavailable",
  // Transport-layer (client-side / network) — these are the previously
  // missing class that turned ambiguous TransactWrite timeouts into
  // false fatals.
  "TimeoutError",
  "AbortError",
  "NetworkingError",
]);

// 2. DynamoDB cancellation-reason codes (NOT the `...Exception` suffix
//    used at the top level). These appear inside the
//    TransactionCanceledException's `CancellationReasons[].Code` array.
//    Source: AWS DynamoDB API reference for TransactWriteItems.
const TRANSIENT_REASON_CODES = new Set([
  "TransactionConflict",
  "ProvisionedThroughputExceeded",
  "ThrottlingError",
]);

// 3. Provably-fatal AWS SDK exception names — retrying these will
//    never succeed. Anything NOT in this allowlist and NOT in the
//    transient set is "ambiguous" and treated as retryable after a
//    possible write commit (the safe default — see classifyDdbError).
const FATAL_TOP_LEVEL_NAMES = new Set([
  "ValidationException",
  "ResourceNotFoundException",
  "AccessDeniedException",
  "UnrecognizedClientException",
  "InvalidSignatureException",
  "MissingAuthenticationTokenException",
]);

const MAX_ATTEMPTS = 3;
const BACKOFF_MS = 150;
const FREE_TIER = "free" as const;
const ACTIVE_LAGO_SUBSCRIPTION_STATUS = "active" as const;

type Logger = Pick<Console, "error" | "warn" | "info">;
type Sleep = (ms: number) => Promise<void>;

export type ProvisioningStatus =
  | "created"
  | "already_exists"
  | "retryable_failure"
  | "fatal_failure";

export interface ProvisioningInput {
  actorId: string;
  orgId: string;
  ownerEmail: string;
  source: string;
}

export interface ProvisioningResult {
  status: ProvisioningStatus;
  emailSent: boolean;
  orgEnvelope?: OrgEnvelopeRecord;
  stripeCustomerId?: string | null;
}

export type OwnerEmailSyncStatus =
  | "updated"
  | "already_current"
  | "not_found"
  | "not_owner"
  | "owner_identity_missing"
  | "retryable_failure"
  | "fatal_failure";

export interface OwnerEmailSyncInput {
  actorId: string;
  orgId: string;
  ownerEmail: string;
  source: string;
}

export interface OwnerEmailSyncResult {
  status: OwnerEmailSyncStatus;
  orgEnvelope?: OrgEnvelopeRecord;
  keysUpdated?: number;
}

export interface EmailInput {
  docsUrl: string;
  fromEmail: string;
  region: string;
  signInUrl: string;
  toEmail: string;
}

export type EmailSender = (input: EmailInput) => Promise<boolean>;

export interface LagoProvisioningSubscriptionSnapshot {
  billingPeriodEndingAt: string | null;
  billingPeriodStartedAt: string | null;
  externalCustomerId: string;
  externalSubscriptionId: string;
  planCode: string;
  status: string;
}

interface LagoBootstrapProjection {
  periodKey: string;
  projected: LagoEntitlementProjection;
  snapshot: LagoProvisioningSubscriptionSnapshot;
}

export interface LagoProvisioningClient {
  getSubscription(
    externalSubscriptionId: string,
  ): Promise<LagoProvisioningSubscriptionSnapshot | null>;
  getSubscriptionCharges(externalSubscriptionId: string): Promise<LagoSubscriptionCharge[]>;
  getSubscriptionEntitlements(
    externalSubscriptionId: string,
  ): Promise<LagoSubscriptionEntitlement[]>;
  upsertCustomer(input: {
    orgId: string;
    email: string;
    paymentProviderCode: string;
  }): Promise<void>;
  upsertSubscription(input: {
    externalCustomerId: string;
    externalSubscriptionId: string;
    planCode: "free";
  }): Promise<void>;
}

export interface ProvisioningDependencies {
  ddb: DynamoDBDocumentClient;
  keysTableName: string;
  auditTableName: string;
  lagoClient: LagoProvisioningClient;
  lagoPaymentProviderCode: string;
  sendWelcomeEmail: EmailSender;
  logger: Logger;
  sleep: Sleep;
}

let cachedDdb: DynamoDBDocumentClient | undefined;
let cachedLagoClient: LagoProvisioningClient | undefined;
const defaultLogger = createLogger("control-plane-provisioning");

function getDefaultDdb(): DynamoDBDocumentClient {
  if (!cachedDdb) {
    cachedDdb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
  }
  return cachedDdb;
}

function normalizeLagoApiUrl(value: string): string {
  const trimmed = value
    .trim()
    .replace(/\/+$/, "")
    .replace(/\/api\/v1$/, "");
  if (!trimmed.startsWith("https://") && !trimmed.startsWith("http://")) {
    throw new Error("LAGO_API_URL must include http:// or https://");
  }
  return `${trimmed}/api/v1`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function firstString(value: unknown, paths: string[][]): string | null {
  for (const path of paths) {
    let cursor = value;
    for (const segment of path) {
      if (isRecord(cursor)) {
        cursor = cursor[segment];
      } else {
        cursor = undefined;
        break;
      }
    }
    if (typeof cursor === "string" && cursor.length > 0) return cursor;
  }
  return null;
}

function parseLagoSubscription(payload: unknown): LagoProvisioningSubscriptionSnapshot {
  const subscription =
    isRecord(payload) && isRecord(payload.subscription) ? payload.subscription : payload;
  const externalCustomerId = firstString(subscription, [
    ["customer", "external_id"],
    ["external_customer_id"],
  ]);
  const externalSubscriptionId = firstString(subscription, [
    ["external_id"],
    ["external_subscription_id"],
  ]);
  const planCode = firstString(subscription, [["plan_code"], ["plan", "code"]]);
  if (!externalCustomerId || !externalSubscriptionId || !planCode) {
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
    externalSubscriptionId,
    planCode,
    status: firstString(subscription, [["status"]]) ?? "unknown",
  };
}

export class HttpLagoProvisioningClient implements LagoProvisioningClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(input: { apiKey: string; baseUrl: string; fetchImpl?: typeof fetch }) {
    this.apiKey = input.apiKey;
    this.baseUrl = normalizeLagoApiUrl(input.baseUrl);
    this.fetchImpl = input.fetchImpl ?? fetch;
  }

  private async request(path: string, init: RequestInit): Promise<unknown> {
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
      signal: AbortSignal.timeout(10_000),
    });
    const text = await response.text();
    const payload = text ? (JSON.parse(text) as unknown) : {};
    if (!response.ok) {
      throw new Error(`Lago request failed with HTTP ${response.status}`);
    }
    return payload;
  }

  async upsertCustomer(input: {
    orgId: string;
    email: string;
    paymentProviderCode: string;
  }): Promise<void> {
    await this.request("/customers", {
      body: JSON.stringify({
        customer: {
          billing_configuration: {
            invoice_grace_period: 0,
            payment_provider: "stripe",
            payment_provider_code: input.paymentProviderCode,
            provider_payment_methods: ["card", "link"],
            sync: true,
            sync_with_provider: true,
          },
          currency: "AUD",
          email: input.email,
          external_id: input.orgId,
          name: input.email,
        },
      }),
      method: "POST",
    });
  }

  async upsertSubscription(input: {
    externalCustomerId: string;
    externalSubscriptionId: string;
    planCode: "free";
  }): Promise<void> {
    await this.request("/subscriptions", {
      body: JSON.stringify({
        subscription: {
          external_customer_id: input.externalCustomerId,
          external_id: input.externalSubscriptionId,
          plan_code: input.planCode,
        },
      }),
      method: "POST",
    });
  }

  async getSubscription(
    externalSubscriptionId: string,
  ): Promise<LagoProvisioningSubscriptionSnapshot | null> {
    const response = await this.fetchImpl(
      `${this.baseUrl}/subscriptions/${encodeURIComponent(externalSubscriptionId)}`,
      {
        headers: { Authorization: `Bearer ${this.apiKey}` },
        method: "GET",
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (response.status === 404) return null;
    const text = await response.text();
    const payload = text ? (JSON.parse(text) as unknown) : {};
    if (!response.ok)
      throw new Error(`Lago subscription lookup failed with HTTP ${response.status}`);
    return parseLagoSubscription(payload);
  }

  async getSubscriptionCharges(externalSubscriptionId: string): Promise<LagoSubscriptionCharge[]> {
    return new HttpLagoEntitlementsClient({
      apiKey: this.apiKey,
      baseUrl: this.baseUrl,
      fetchImpl: this.fetchImpl,
    }).getSubscriptionCharges(externalSubscriptionId);
  }

  async getSubscriptionEntitlements(
    externalSubscriptionId: string,
  ): Promise<LagoSubscriptionEntitlement[]> {
    return new HttpLagoEntitlementsClient({
      apiKey: this.apiKey,
      baseUrl: this.baseUrl,
      fetchImpl: this.fetchImpl,
    }).getSubscriptionEntitlements(externalSubscriptionId);
  }
}

function getDefaultLagoClient(): LagoProvisioningClient {
  if (!cachedLagoClient) {
    cachedLagoClient = new HttpLagoProvisioningClient({
      apiKey: getRequiredEnv("LAGO_API_KEY"),
      baseUrl: getRequiredEnv("LAGO_API_URL"),
    });
  }
  return cachedLagoClient;
}

function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function getOptionalEnv(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

function getOrgEnvelopeKey(orgId: string): string {
  return `ORG#${orgId}`;
}

function isCompleteOrgEnvelope(record: unknown, orgId: string): record is OrgEnvelopeRecord {
  if (!record || typeof record !== "object") {
    return false;
  }
  const candidate = record as Partial<OrgEnvelopeRecord>;
  return (
    candidate.apiKeyHash === getOrgEnvelopeKey(orgId) &&
    (candidate.stripeCustomerId === null ||
      (typeof candidate.stripeCustomerId === "string" && candidate.stripeCustomerId.length > 0)) &&
    typeof candidate.ownerEmail === "string" &&
    candidate.ownerEmail.length > 0 &&
    typeof candidate.tier === "string" &&
    Array.isArray(candidate.products) &&
    typeof candidate.paymentOverdue === "boolean" &&
    (candidate.stripeSubscriptionId === null ||
      (typeof candidate.stripeSubscriptionId === "string" &&
        candidate.stripeSubscriptionId.length > 0)) &&
    candidate.subscriptionItems != null &&
    typeof candidate.subscriptionItems === "object" &&
    typeof candidate.hasFirstKey === "boolean" &&
    typeof candidate.completedAt === "string" &&
    candidate.completedAt.length > 0
  );
}

// Discriminated union surfaces every read outcome the state machine
// must distinguish, so the compiler enforces handling at every call
// site. Earlier versions returned `OrgEnvelopeRecord | undefined` and
// let SDK exceptions escape — that turned recoverable read failures
// (throttle, network blip, IAM lapse) into uncaught 500s, *especially*
// dangerous after a TransactWriteItems may have already committed.
type EnvelopeReadResult =
  | { kind: "found"; record: OrgEnvelopeRecord }
  | { kind: "missing" }
  | { kind: "transient_failure"; error: Error }
  | { kind: "fatal_failure"; error: Error };

// Strongly-consistent read. Eventual consistency would let three real
// scenarios slip past the state machine:
//   1. Preflight idempotency check misses a concurrent provisioner that
//      committed <1ms ago → unnecessary retry work and a predictable
//      ConditionalCheckFailed on the next TransactWriteItems.
//   2. Post-commit confirmation reads back undefined despite the
//      transaction having committed → caller sees `created` with
//      `orgEnvelope: undefined`, which is a lie about durability.
//   3. Post-failure reconciliation read misses an envelope that the
//      competing writer just committed → we report `fatal_failure` for a
//      provisioning that actually succeeded.
// Cost: 2x RCU per read. Acceptable for a webhook/admin path with
// <1 RPS; correctness > cost.
async function readOrgEnvelope(
  ddb: DynamoDBDocumentClient,
  keysTableName: string,
  orgId: string,
): Promise<EnvelopeReadResult> {
  try {
    const result = await ddb.send(
      new GetCommand({
        TableName: keysTableName,
        Key: { apiKeyHash: getOrgEnvelopeKey(orgId) },
        ConsistentRead: true,
      }),
    );
    if (isCompleteOrgEnvelope(result.Item, orgId)) {
      return { kind: "found", record: result.Item };
    }
    return { kind: "missing" };
  } catch (raw) {
    const error = raw instanceof Error ? raw : new Error(String(raw));
    // Reads share the unified classifier with writes. Reads can't
    // trigger a TransactionCanceledException, so reason walking is a
    // no-op for them — but using one classifier prevents drift.
    // For reads we treat ambiguous as transient: an unknown error
    // before any side-effect is safe to retry, and the caller's
    // exhaustive switch maps transient → retryable_failure.
    const classification = classifyDdbError(error);
    if (classification === "fatal") {
      return { kind: "fatal_failure", error };
    }
    return { kind: "transient_failure", error };
  }
}

function buildProvisioningTransactWrite(
  input: ProvisioningInput,
  stripeCustomerId: string | null,
  keysTableName: string,
  auditTableName: string,
  now: Date,
  bootstrap: LagoBootstrapProjection,
): TransactWriteCommand {
  const completedAt = now.toISOString();
  const envelope: OrgEnvelopeRecord = {
    apiKeyHash: getOrgEnvelopeKey(input.orgId),
    billingPeriodEndingAt: bootstrap.snapshot.billingPeriodEndingAt,
    billingPeriodKey: bootstrap.periodKey,
    billingPeriodStartedAt: bootstrap.snapshot.billingPeriodStartedAt,
    completedAt,
    hasFirstKey: false,
    activeKeyCount: 0,
    lagoEntitlementsHash: bootstrap.projected.lagoEntitlementsHash,
    lagoLastSyncStatus: "synced",
    lagoLastSyncedAt: completedAt,
    lagoPaymentOverdueInvoiceId: null,
    lagoPlanCode: bootstrap.snapshot.planCode,
    lagoSubscriptionExternalId: bootstrap.snapshot.externalSubscriptionId,
    lagoSubscriptionStatus: bootstrap.snapshot.status,
    maxKeys: bootstrap.projected.maxKeys,
    orgId: input.orgId,
    ownerEmail: input.ownerEmail,
    ownerUserId: input.actorId,
    paymentOverdue: false,
    products: bootstrap.projected.products,
    quotaPerProduct: bootstrap.projected.quotaPerProduct,
    rateLimit: bootstrap.projected.rateLimit,
    enforcementMode: bootstrap.projected.enforcementMode,
    stripeCustomerId,
    stripeSubscriptionId: null,
    subscriptionItems: {},
    tier: FREE_TIER,
  };

  const auditItem = buildAuditTransactItem({
    tableName: auditTableName,
    orgId: input.orgId,
    action: "ORG_PROVISIONED",
    actorId: input.actorId,
    metadata: {
      commercialIdentity: "clerk_org_id",
      source: input.source,
      stripeCustomerId,
    },
    now,
  });

  return new TransactWriteCommand({
    TransactItems: [
      {
        Put: {
          TableName: keysTableName,
          Item: envelope,
          ConditionExpression: "attribute_not_exists(apiKeyHash)",
        },
      },
      auditItem,
    ],
  });
}

function buildBillingPeriodKey(snapshot: LagoProvisioningSubscriptionSnapshot): string | null {
  if (!snapshot.billingPeriodStartedAt || !snapshot.billingPeriodEndingAt) return null;
  return `${snapshot.billingPeriodStartedAt.slice(0, 10)}_${snapshot.billingPeriodEndingAt.slice(0, 10)}`;
}

function isCompleteLagoBootstrap(envelope: OrgEnvelopeRecord): boolean {
  return (
    envelope.lagoPlanCode === FREE_TIER &&
    typeof envelope.lagoSubscriptionExternalId === "string" &&
    envelope.lagoSubscriptionExternalId.length > 0 &&
    typeof envelope.lagoSubscriptionStatus === "string" &&
    envelope.lagoSubscriptionStatus.length > 0 &&
    typeof envelope.billingPeriodStartedAt === "string" &&
    envelope.billingPeriodStartedAt.length > 0 &&
    typeof envelope.billingPeriodEndingAt === "string" &&
    envelope.billingPeriodEndingAt.length > 0 &&
    typeof envelope.billingPeriodKey === "string" &&
    envelope.billingPeriodKey.length > 0
  );
}

function resultForExistingEnvelope(envelope: OrgEnvelopeRecord): ProvisioningResult {
  return {
    status: "already_exists",
    emailSent: false,
    orgEnvelope: envelope,
    stripeCustomerId: envelope.stripeCustomerId ?? null,
  };
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

async function loadOrgKeys(
  ddb: DynamoDBDocumentClient,
  keysTableName: string,
  orgId: string,
): Promise<ApiKeyRecord[]> {
  const response = await ddb.send(
    new QueryCommand({
      TableName: keysTableName,
      IndexName: "orgId-index",
      KeyConditionExpression: "orgId = :orgId",
      ExpressionAttributeValues: { ":orgId": orgId },
    }),
  );
  return ((response.Items as unknown[] | undefined) ?? []).filter(isApiKeyRecord);
}

async function writeLagoBootstrapState(
  dependencies: ProvisioningDependencies,
  orgId: string,
  bootstrap: LagoBootstrapProjection,
): Promise<OrgEnvelopeRecord> {
  const { snapshot, projected, periodKey } = bootstrap;
  if (snapshot.externalCustomerId.length === 0) {
    throw new Error("Lago subscription snapshot is missing external customer id");
  }
  if (snapshot.planCode !== FREE_TIER) {
    throw new Error(`Lago bootstrap subscription must use plan ${FREE_TIER}`);
  }
  if (snapshot.status !== ACTIVE_LAGO_SUBSCRIPTION_STATUS) {
    throw new Error("Lago bootstrap subscription must be active");
  }
  const keys = await loadOrgKeys(dependencies.ddb, dependencies.keysTableName, orgId);

  const commonNames = {
    "#billingPeriodEndingAt": "billingPeriodEndingAt",
    "#billingPeriodKey": "billingPeriodKey",
    "#billingPeriodStartedAt": "billingPeriodStartedAt",
    "#lagoPaymentOverdueInvoiceId": "lagoPaymentOverdueInvoiceId",
    "#lagoPlanCode": "lagoPlanCode",
    "#lagoSubscriptionExternalId": "lagoSubscriptionExternalId",
    "#lagoSubscriptionStatus": "lagoSubscriptionStatus",
    "#paymentOverdue": "paymentOverdue",
    "#enforcementMode": "enforcementMode",
    "#lagoEntitlementsHash": "lagoEntitlementsHash",
    "#lagoLastSyncError": "lagoLastSyncError",
    "#lagoLastSyncStatus": "lagoLastSyncStatus",
    "#lagoLastSyncedAt": "lagoLastSyncedAt",
    "#maxKeys": "maxKeys",
    "#products": "products",
    "#quotaPerProduct": "quotaPerProduct",
    "#rateLimit": "rateLimit",
    "#tier": "tier",
  };
  const commonValues = {
    ":externalSubscriptionId": snapshot.externalSubscriptionId,
    ":overdueInvoiceId": null,
    ":paymentOverdue": false,
    ":periodEnd": snapshot.billingPeriodEndingAt,
    ":periodKey": buildBillingPeriodKeyFromProjection(snapshot) ?? periodKey,
    ":periodStart": snapshot.billingPeriodStartedAt,
    ":planCode": snapshot.planCode,
    ":products": projected.products,
    ":quota": projected.quotaPerProduct,
    ":rateLimit": projected.rateLimit,
    ":enforcementMode": projected.enforcementMode,
    ":maxKeys": projected.maxKeys,
    ":lagoEntitlementsHash": projected.lagoEntitlementsHash,
    ":lagoLastSyncedAt": new Date().toISOString(),
    ":lagoLastSyncStatus": "synced",
    ":lagoLastSyncError": null,
    ":subscriptionStatus": snapshot.status,
    ":tier": snapshot.planCode,
  };

  await dependencies.ddb.send(
    new UpdateCommand({
      TableName: dependencies.keysTableName,
      Key: { apiKeyHash: getOrgEnvelopeKey(orgId) },
      UpdateExpression: [
        "SET #tier = :tier",
        "#products = :products",
        "#paymentOverdue = :paymentOverdue",
        "#quotaPerProduct = :quota",
        "#enforcementMode = :enforcementMode",
        "#rateLimit = :rateLimit",
        "#maxKeys = :maxKeys",
        "#lagoPlanCode = :planCode",
        "#lagoSubscriptionExternalId = :externalSubscriptionId",
        "#lagoSubscriptionStatus = :subscriptionStatus",
        "#billingPeriodStartedAt = :periodStart",
        "#billingPeriodEndingAt = :periodEnd",
        "#billingPeriodKey = :periodKey",
        "#lagoPaymentOverdueInvoiceId = :overdueInvoiceId",
        "#lagoEntitlementsHash = :lagoEntitlementsHash",
        "#lagoLastSyncedAt = :lagoLastSyncedAt",
        "#lagoLastSyncStatus = :lagoLastSyncStatus",
        "#lagoLastSyncError = :lagoLastSyncError",
      ].join(", "),
      ExpressionAttributeNames: commonNames,
      ExpressionAttributeValues: commonValues,
    }),
  );

  await Promise.all(
    keys.map((key) =>
      dependencies.ddb.send(
        new UpdateCommand({
          TableName: dependencies.keysTableName,
          Key: { apiKeyHash: key.apiKeyHash },
          UpdateExpression: [
            "SET #tier = :tier",
            "#products = :products",
            "#quotaPerProduct = :quota",
            "#enforcementMode = :enforcementMode",
            "#rateLimit = :rateLimit",
            "#paymentOverdue = :paymentOverdue",
            "#lagoPlanCode = :planCode",
            "#lagoSubscriptionExternalId = :externalSubscriptionId",
            "#lagoSubscriptionStatus = :subscriptionStatus",
            "#billingPeriodStartedAt = :periodStart",
            "#billingPeriodEndingAt = :periodEnd",
            "#billingPeriodKey = :periodKey",
            "#lagoPaymentOverdueInvoiceId = :overdueInvoiceId",
          ].join(", "),
          ExpressionAttributeNames: {
            ...commonNames,
            "#quotaPerProduct": "quotaPerProduct",
            "#rateLimit": "rateLimit",
          },
          ExpressionAttributeValues: {
            ...commonValues,
            ":quota": projected.quotaPerProduct,
            ":rateLimit": projected.rateLimit,
            ":enforcementMode": projected.enforcementMode,
          },
        }),
      ),
    ),
  );

  const confirm = await readOrgEnvelope(dependencies.ddb, dependencies.keysTableName, orgId);
  if (confirm.kind !== "found") {
    throw new Error(`failed to confirm Lago bootstrap state for ${orgId}`);
  }
  return confirm.record;
}

async function loadLagoFreeBootstrapProjection(
  dependencies: ProvisioningDependencies,
  input: ProvisioningInput,
  existingEnvelope?: OrgEnvelopeRecord,
): Promise<LagoBootstrapProjection> {
  const externalCustomerId = existingEnvelope?.customerId ?? input.orgId;
  const externalSubscriptionId = existingEnvelope?.customerId
    ? `pq_sub_${existingEnvelope.customerId.slice("pq_cust_".length)}`
    : deriveLagoExternalSubscriptionIdForOrg(input.orgId);
  await dependencies.lagoClient.upsertCustomer({
    orgId: externalCustomerId,
    email: input.ownerEmail,
    paymentProviderCode: dependencies.lagoPaymentProviderCode,
  });
  let snapshot = await dependencies.lagoClient.getSubscription(externalSubscriptionId);
  if (!snapshot) {
    await dependencies.lagoClient.upsertSubscription({
      externalCustomerId,
      externalSubscriptionId,
      planCode: FREE_TIER,
    });
    snapshot = await dependencies.lagoClient.getSubscription(externalSubscriptionId);
  }
  if (!snapshot)
    throw new Error(`Lago subscription ${externalSubscriptionId} was not found after upsert`);
  if (
    snapshot.externalCustomerId !== externalCustomerId ||
    snapshot.externalSubscriptionId !== externalSubscriptionId
  ) {
    throw new Error("Lago bootstrap subscription identifiers do not match Clerk org");
  }
  if (snapshot.planCode !== FREE_TIER) {
    throw new Error(`Lago bootstrap subscription must use plan ${FREE_TIER}`);
  }
  if (snapshot.status !== ACTIVE_LAGO_SUBSCRIPTION_STATUS) {
    throw new Error("Lago bootstrap subscription must be active");
  }
  const periodKey = buildBillingPeriodKey(snapshot);
  if (!periodKey || !snapshot.billingPeriodStartedAt || !snapshot.billingPeriodEndingAt) {
    throw new Error("Lago bootstrap subscription is missing billing period fields");
  }
  const projection = projectLagoEntitlements({
    snapshot,
    charges: await dependencies.lagoClient.getSubscriptionCharges(snapshot.externalSubscriptionId),
    entitlements: await dependencies.lagoClient.getSubscriptionEntitlements(
      snapshot.externalSubscriptionId,
    ),
  });
  if (projection.status === "drift") {
    throw new Error(`Lago bootstrap subscription projection drift: ${projection.reason}`);
  }
  return { periodKey, projected: projection.projection, snapshot };
}

async function bootstrapLagoFreeSubscription(
  dependencies: ProvisioningDependencies,
  input: ProvisioningInput,
  envelope: OrgEnvelopeRecord,
): Promise<OrgEnvelopeRecord> {
  if (isCompleteLagoBootstrap(envelope)) {
    return envelope;
  }
  const bootstrap = await loadLagoFreeBootstrapProjection(dependencies, input, envelope);
  return writeLagoBootstrapState(dependencies, input.orgId, bootstrap);
}

type DdbClassification = "transient" | "fatal" | "ambiguous";

function getCancellationReasons(error: Error): { Code?: string }[] | undefined {
  const reasons = (error as { CancellationReasons?: unknown }).CancellationReasons;
  return Array.isArray(reasons) ? (reasons as { Code?: string }[]) : undefined;
}

function hasSmithyRetryableTrait(error: unknown): boolean {
  // Smithy/AWS-SDK v3 sets `$retryable` on errors the SDK considered
  // retryable. By the time the error escapes to our code the SDK has
  // already retried internally, so this is mostly a *classification*
  // signal ("the kind of error this was") rather than a directive. Use
  // it as a fallback when we don't recognise the name.
  if (typeof error !== "object" || error === null) return false;
  return "$retryable" in error && (error as { $retryable: unknown }).$retryable !== undefined;
}

// Unified DynamoDB error classifier — used by both the read path
// (readOrgEnvelope) and the write path (the post-TransactWriteItems
// retry loop). Three outcomes:
//
//   transient  → name allowlist OR Smithy retryable trait OR a
//                TransactionCanceledException whose reasons are all
//                transient. Our retry loop should retry.
//   fatal      → name in FATAL_TOP_LEVEL_NAMES OR a TransactionCanceled
//                with at least one provably-terminal reason
//                (ValidationError, ItemCollectionSizeLimitExceeded, …).
//                Retrying will not succeed.
//   ambiguous  → unknown error name, no retry trait, not a recognised
//                terminal. Caller chooses policy: post-write paths map
//                this to retryable_failure (envelope attribute_not_exists
//                makes retries safe); preflight can choose fatal.
//
// ConditionalCheckFailed is deliberately NOT in either set — it's the
// idempotency-success signal handled by the post-failure reconciliation
// read in `provisionOrg`, not a retry trigger.
function classifyDdbError(error: unknown): DdbClassification {
  if (!(error instanceof Error)) return "ambiguous";

  // TransactionCanceledException needs reason walking before the
  // top-level checks: the wrapper name itself is uninformative.
  if (error.name === "TransactionCanceledException") {
    const reasons = getCancellationReasons(error);
    if (reasons) {
      // Provably fatal if ANY reason is terminal (excluding the
      // race-won ConditionalCheckFailed and the no-op None).
      const hasFatalReason = reasons.some((reason) => {
        const code = reason.Code;
        if (!code || code === "None" || code === "ConditionalCheckFailed") return false;
        if (TRANSIENT_REASON_CODES.has(code)) return false;
        return true;
      });
      if (hasFatalReason) return "fatal";
      const hasTransientReason = reasons.some(
        (reason) => reason.Code != null && TRANSIENT_REASON_CODES.has(reason.Code),
      );
      if (hasTransientReason) return "transient";
      // All ConditionalCheckFailed / None — caller's reconciliation
      // read decides; classify ambiguous.
      return "ambiguous";
    }
  }

  if (FATAL_TOP_LEVEL_NAMES.has(error.name)) return "fatal";
  if (TRANSIENT_TOP_LEVEL_NAMES.has(error.name)) return "transient";
  if (hasSmithyRetryableTrait(error)) return "transient";

  return "ambiguous";
}

async function sleepDefault(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function getDefaultEmailSender(logger: Logger): EmailSender {
  return async (input) => {
    try {
      return await sendSignedSesEmail({
        bodyText: `Welcome to Prontiq.\n\nYour account is ready. Sign in to create your first API key:\n${input.signInUrl}\n\nDocs: ${input.docsUrl}\n`,
        configurationSetName: process.env.SES_CONFIGURATION_SET_NAME,
        fromEmail: input.fromEmail,
        region: input.region,
        subject: "Welcome to Prontiq.",
        toEmail: input.toEmail,
      });
    } catch (error) {
      logger.warn("Welcome email send failed", {
        error: error instanceof Error ? error.message : String(error),
        toEmail: input.toEmail,
      });
      return false;
    }
  };
}

// Boundary guard: invoked only after the org envelope is durably
// committed. Any throw from an injected `sendWelcomeEmail` (rejecting
// promise, sync throw before the await, anything) is logged and
// translated to `false` so it cannot escape `provisionOrg`. The
// envelope is durable; the email is genuinely best-effort.
//
// Skips when WELCOME_EMAIL_FROM is unset (returns false without
// invoking the sender), preserving the prior contract.
async function sendWelcomeEmailSafely(
  ddb: DynamoDBDocumentClient,
  send: EmailSender,
  logger: Logger,
  input: ProvisioningInput,
): Promise<boolean> {
  const emailFrom = process.env.WELCOME_EMAIL_FROM;
  if (typeof emailFrom !== "string" || emailFrom.length === 0) {
    return false;
  }
  try {
    const suppressionsTableName = process.env.SUPPRESSIONS_TABLE_NAME;
    if (typeof suppressionsTableName === "string" && suppressionsTableName.length > 0) {
      if (await isSuppressedEmail(ddb, suppressionsTableName, input.ownerEmail)) {
        logger.info("Skipping welcome email due to SES suppression", {
          orgId: input.orgId,
          toEmail: input.ownerEmail,
        });
        return false;
      }
    }
    return await send({
      docsUrl: getOptionalEnv("PRONTIQ_DOCS_URL", "https://docs.prontiq.dev"),
      fromEmail: emailFrom,
      region: getOptionalEnv("AWS_REGION", "ap-southeast-2"),
      signInUrl: getOptionalEnv("PRONTIQ_ACCOUNT_URL", DEFAULT_ACCOUNT_URL),
      toEmail: input.ownerEmail,
    });
  } catch (error) {
    logger.warn(
      "Welcome email send threw after envelope commit (treating as best-effort failure)",
      {
        error: error instanceof Error ? error.message : String(error),
        orgId: input.orgId,
        toEmail: input.ownerEmail,
      },
    );
    return false;
  }
}

export function createProvisioningService(overrides: Partial<ProvisioningDependencies> = {}): {
  provisionOrg: (input: ProvisioningInput) => Promise<ProvisioningResult>;
  syncOwnerEmail: (input: OwnerEmailSyncInput) => Promise<OwnerEmailSyncResult>;
} {
  const logger = overrides.logger ?? defaultLogger;
  const dependencies: ProvisioningDependencies = {
    auditTableName: overrides.auditTableName ?? getRequiredEnv("AUDIT_TABLE_NAME"),
    ddb: overrides.ddb ?? getDefaultDdb(),
    keysTableName: overrides.keysTableName ?? getRequiredEnv("KEYS_TABLE_NAME"),
    lagoClient: overrides.lagoClient ?? getDefaultLagoClient(),
    lagoPaymentProviderCode:
      overrides.lagoPaymentProviderCode ?? getRequiredEnv("LAGO_PAYMENT_PROVIDER_CODE"),
    logger,
    sendWelcomeEmail: overrides.sendWelcomeEmail ?? getDefaultEmailSender(logger),
    sleep: overrides.sleep ?? sleepDefault,
  };

  async function provisionOrg(input: ProvisioningInput): Promise<ProvisioningResult> {
    const preflight = await readOrgEnvelope(
      dependencies.ddb,
      dependencies.keysTableName,
      input.orgId,
    );
    switch (preflight.kind) {
      case "found":
        if (!preflight.record.customerId && !preflight.record.orgId) {
          return resultForExistingEnvelope(preflight.record);
        }
        try {
          const orgEnvelope = await bootstrapLagoFreeSubscription(
            dependencies,
            input,
            preflight.record,
          );
          return resultForExistingEnvelope(orgEnvelope);
        } catch (error) {
          dependencies.logger.error("Existing ORG envelope Lago bootstrap failed", {
            error: error instanceof Error ? error.message : String(error),
            orgId: input.orgId,
          });
          return {
            status: "retryable_failure",
            emailSent: false,
            stripeCustomerId: preflight.record.stripeCustomerId ?? null,
          };
        }
      case "transient_failure":
        dependencies.logger.error("Preflight ORG envelope read failed (transient)", {
          error: preflight.error.message,
          orgId: input.orgId,
        });
        return { status: "retryable_failure", emailSent: false };
      case "fatal_failure":
        dependencies.logger.error("Preflight ORG envelope read failed (fatal)", {
          error: preflight.error.message,
          orgId: input.orgId,
        });
        return { status: "fatal_failure", emailSent: false };
      case "missing":
        break;
    }

    const stripeCustomerId: string | null = null;
    let bootstrap: LagoBootstrapProjection;
    try {
      bootstrap = await loadLagoFreeBootstrapProjection(dependencies, input);
    } catch (error) {
      dependencies.logger.error("Pre-commit Lago bootstrap failed", {
        error: error instanceof Error ? error.message : String(error),
        orgId: input.orgId,
        stripeCustomerId,
      });
      return {
        status: "retryable_failure",
        emailSent: false,
        stripeCustomerId,
      };
    }

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      try {
        const now = new Date();
        await dependencies.ddb.send(
          buildProvisioningTransactWrite(
            input,
            stripeCustomerId,
            dependencies.keysTableName,
            dependencies.auditTableName,
            now,
            bootstrap,
          ),
        );
        // Strong-read confirmation: a successful TransactWriteItems
        // commit followed by a strongly-consistent GetItem MUST return
        // the envelope. Three failure shapes to handle:
        //  - transient_failure: temporary read issue → caller should
        //    retry (Svix redelivery for webhook, client retry for API)
        //  - fatal_failure: schema/IAM drift → page someone
        //  - missing: impossible under strong reads after a successful
        //    commit; treat as fatal infra fault
        const confirm = await readOrgEnvelope(
          dependencies.ddb,
          dependencies.keysTableName,
          input.orgId,
        );
        switch (confirm.kind) {
          case "found": {
            // The org is durably committed at this point. The welcome
            // email is genuinely best-effort — ANY failure here (a
            // rejecting injected sender, a misconfigured SES identity,
            // a network blip mid-call) MUST be translated to
            // emailSent: false rather than allowed to escape. The
            // default `getDefaultEmailSender` already wraps SigV4 in
            // try/catch, but `EmailSender` is a public interface and
            // injected implementations are not contractually required
            // to be exception-free. This is the boundary that enforces
            // it. Without this guard, a throw here would turn a
            // durable provisioning success into a 500, the caller would
            // observe failure for an org that was actually provisioned,
            // and the next Svix retry would self-recover via the
            // preflight `already_exists` path — but the initial
            // response would be wrong. Belt-and-braces.
            const emailSent = await sendWelcomeEmailSafely(
              dependencies.ddb,
              dependencies.sendWelcomeEmail,
              dependencies.logger,
              input,
            );
            return {
              status: "created",
              emailSent,
              orgEnvelope: confirm.record,
              stripeCustomerId,
            };
          }
          case "transient_failure":
            dependencies.logger.error(
              "Post-commit confirmation read failed (transient) — envelope likely committed; caller should retry to confirm",
              { attempt, orgId: input.orgId, stripeCustomerId, error: confirm.error.message },
            );
            return { status: "retryable_failure", emailSent: false, stripeCustomerId };
          case "fatal_failure":
            dependencies.logger.error(
              "Post-commit confirmation read failed (fatal) — envelope likely committed but cannot be verified",
              { attempt, orgId: input.orgId, stripeCustomerId, error: confirm.error.message },
            );
            return { status: "fatal_failure", emailSent: false, stripeCustomerId };
          case "missing":
            dependencies.logger.error(
              "Post-commit confirmation read returned no envelope despite successful TransactWriteItems",
              { attempt, orgId: input.orgId, stripeCustomerId },
            );
            return { status: "fatal_failure", emailSent: false, stripeCustomerId };
        }
      } catch (error) {
        // After a write failure, we must read to distinguish "competing
        // writer won the race" (already_exists) from "real failure"
        // (retryable / fatal). If the read itself fails, we cannot
        // distinguish — return retryable. Svix redelivery is safe because
        // the envelope's attribute_not_exists condition prevents a duplicate
        // envelope and the preflight read collapses successful retries.
        const reconcile = await readOrgEnvelope(
          dependencies.ddb,
          dependencies.keysTableName,
          input.orgId,
        );
        if (reconcile.kind === "found") {
          if (!reconcile.record.customerId && !reconcile.record.orgId) {
            return resultForExistingEnvelope(reconcile.record);
          }
          try {
            const orgEnvelope = await bootstrapLagoFreeSubscription(
              dependencies,
              input,
              reconcile.record,
            );
            return resultForExistingEnvelope(orgEnvelope);
          } catch (bootstrapError) {
            dependencies.logger.error("Reconciled ORG envelope Lago bootstrap failed", {
              attempt,
              error:
                bootstrapError instanceof Error ? bootstrapError.message : String(bootstrapError),
              orgId: input.orgId,
              stripeCustomerId,
            });
            return {
              status: "retryable_failure",
              emailSent: false,
              orgEnvelope: reconcile.record,
              stripeCustomerId,
            };
          }
        }
        if (reconcile.kind === "transient_failure" || reconcile.kind === "fatal_failure") {
          dependencies.logger.error("Reconciliation read after write failure also failed", {
            attempt,
            orgId: input.orgId,
            stripeCustomerId,
            writeError: error instanceof Error ? error.message : String(error),
            readError: reconcile.error.message,
            readKind: reconcile.kind,
          });
          return {
            status: reconcile.kind === "transient_failure" ? "retryable_failure" : "fatal_failure",
            emailSent: false,
            stripeCustomerId,
          };
        }
        // reconcile.kind === "missing" → no competing writer visible.
        // Classify the original write error using the unified DDB
        // classifier. We treat AMBIGUOUS as transient on this path —
        // the write may have committed but its response was lost
        // (TimeoutError, AbortError, generic SDK error). Two safety
        // properties make a retry safe even in the truly-committed
        // case:
        //   - The envelope's `attribute_not_exists(apiKeyHash)` and
        //     audit's conditional write reject duplicates.
        // The cost of misclassifying transient as fatal is much worse
        // (operator alarm + user-visible failure for a successful
        // provisioning) than the cost of misclassifying fatal as
        // transient (Svix retries for 5d, then DLQ alarm — same
        // operator visibility, just delayed).
        const writeClassification = classifyDdbError(error);
        if (writeClassification === "transient" && attempt < MAX_ATTEMPTS) {
          await dependencies.sleep(BACKOFF_MS * attempt);
          continue;
        }
        if (writeClassification === "ambiguous" && attempt < MAX_ATTEMPTS) {
          await dependencies.sleep(BACKOFF_MS * attempt);
          continue;
        }
        const isFatal = writeClassification === "fatal";
        dependencies.logger.error("Org provisioning failed", {
          attempt,
          classification: writeClassification,
          error: error instanceof Error ? error.message : String(error),
          orgId: input.orgId,
        });
        return {
          status: isFatal ? "fatal_failure" : "retryable_failure",
          emailSent: false,
          stripeCustomerId,
        };
      }
    }

    return {
      status: "retryable_failure",
      emailSent: false,
      stripeCustomerId,
    };
  }

  async function syncOwnerEmail(input: OwnerEmailSyncInput): Promise<OwnerEmailSyncResult> {
    const preflight = await readOrgEnvelope(
      dependencies.ddb,
      dependencies.keysTableName,
      input.orgId,
    );
    switch (preflight.kind) {
      case "missing":
        dependencies.logger.info("Skipping owner email sync for unprovisioned org", {
          orgId: input.orgId,
          source: input.source,
        });
        return { status: "not_found" };
      case "transient_failure":
        dependencies.logger.error("Owner email sync envelope read failed (transient)", {
          error: preflight.error.message,
          orgId: input.orgId,
        });
        return { status: "retryable_failure" };
      case "fatal_failure":
        dependencies.logger.error("Owner email sync envelope read failed (fatal)", {
          error: preflight.error.message,
          orgId: input.orgId,
        });
        return { status: "fatal_failure" };
      case "found":
        break;
    }

    if (preflight.record.ownerUserId === undefined || preflight.record.ownerUserId.length === 0) {
      dependencies.logger.warn("Skipping owner email sync because envelope lacks ownerUserId", {
        actorId: input.actorId,
        orgId: input.orgId,
        source: input.source,
      });
      return { status: "owner_identity_missing", orgEnvelope: preflight.record };
    }
    if (preflight.record.ownerUserId !== input.actorId) {
      dependencies.logger.info("Skipping owner email sync for non-owner admin", {
        actorId: input.actorId,
        orgId: input.orgId,
        ownerUserId: preflight.record.ownerUserId,
        source: input.source,
      });
      return { status: "not_owner", orgEnvelope: preflight.record };
    }

    try {
      await dependencies.lagoClient.upsertCustomer({
        orgId: input.orgId,
        email: input.ownerEmail,
        paymentProviderCode: dependencies.lagoPaymentProviderCode,
      });
    } catch (error) {
      dependencies.logger.error("Lago owner email sync failed", {
        error: error instanceof Error ? error.message : String(error),
        orgId: input.orgId,
      });
      return { status: "retryable_failure", orgEnvelope: preflight.record };
    }

    let keys: ApiKeyRecord[];
    try {
      keys = await loadOrgKeys(dependencies.ddb, dependencies.keysTableName, input.orgId);
    } catch (raw) {
      const error = raw instanceof Error ? raw : new Error(String(raw));
      const classification = classifyDdbError(error);
      dependencies.logger.error("Owner email sync key scan failed", {
        classification,
        error: error.message,
        orgId: input.orgId,
      });
      return {
        status: classification === "fatal" ? "fatal_failure" : "retryable_failure",
        orgEnvelope: preflight.record,
      };
    }

    const shouldUpdateEnvelope = preflight.record.ownerEmail !== input.ownerEmail;
    const staleKeys = keys.filter((key) => key.ownerEmail !== input.ownerEmail);
    if (!shouldUpdateEnvelope && staleKeys.length === 0) {
      return { status: "already_current", orgEnvelope: preflight.record, keysUpdated: 0 };
    }

    try {
      if (shouldUpdateEnvelope) {
        await dependencies.ddb.send(
          new UpdateCommand({
            TableName: dependencies.keysTableName,
            Key: { apiKeyHash: getOrgEnvelopeKey(input.orgId) },
            UpdateExpression: "SET #ownerEmail = :ownerEmail",
            ConditionExpression: "attribute_exists(apiKeyHash)",
            ExpressionAttributeNames: { "#ownerEmail": "ownerEmail" },
            ExpressionAttributeValues: { ":ownerEmail": input.ownerEmail },
          }),
        );
      }
      await Promise.all(
        staleKeys.map((key) =>
          dependencies.ddb.send(
            new UpdateCommand({
              TableName: dependencies.keysTableName,
              Key: { apiKeyHash: key.apiKeyHash },
              UpdateExpression: "SET #ownerEmail = :ownerEmail",
              ConditionExpression: "attribute_exists(apiKeyHash)",
              ExpressionAttributeNames: { "#ownerEmail": "ownerEmail" },
              ExpressionAttributeValues: { ":ownerEmail": input.ownerEmail },
            }),
          ),
        ),
      );
    } catch (raw) {
      const error = raw instanceof Error ? raw : new Error(String(raw));
      const classification = classifyDdbError(error);
      dependencies.logger.error("Owner email sync DynamoDB update failed", {
        classification,
        error: error.message,
        orgId: input.orgId,
      });
      return {
        status: classification === "fatal" ? "fatal_failure" : "retryable_failure",
        orgEnvelope: preflight.record,
      };
    }

    const updatedEnvelope: OrgEnvelopeRecord = {
      ...preflight.record,
      ownerEmail: input.ownerEmail,
    };
    return { status: "updated", orgEnvelope: updatedEnvelope, keysUpdated: staleKeys.length };
  }

  return { provisionOrg, syncOwnerEmail };
}
