import { createHash } from "node:crypto";
import { ConditionalCheckFailedException, DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import {
  createLogger,
  deriveLagoExternalSubscriptionId,
  type ApiKeyRecord,
  type CustomerRecord,
  type OrgEnvelopeRecord,
  type Tier,
} from "@prontiq/shared";

type Logger = Pick<Console, "error" | "warn" | "info">;
type AccountPrincipal = { orgId: string; userId: string };

export type AccountBillingActionStatus =
  | "processing"
  | "succeeded"
  | "failed_retryable"
  | "failed_permanent";

export interface BillingActionRecord {
  actionId: string;
  actorId: string;
  createdAt: string;
  customerId: string;
  idempotencyKeyHash: string;
  lastError?: string;
  orgId: string;
  previousPlanCode?: string | null;
  providerRequestId?: string | null;
  providerStatus?: string | null;
  providerSubscriptionState?: LagoSubscriptionState | null;
  requestHash: string;
  responseBody?: AccountBillingPlanChangeResponse | AccountBillingPortalSessionResponse;
  route: string;
  status: AccountBillingActionStatus;
  subscriptionExternalId?: string | null;
  targetPlanCode?: string | null;
  ttl: number;
  updatedAt: string;
}

export interface AccountBillingSummary {
  allowedActions: {
    canOpenPortal: boolean;
    canRequestPlanChange: boolean;
  };
  billingPeriod: {
    endsAt: string | null;
    key: string | null;
    startsAt: string | null;
  };
  customer: {
    customerId: string;
    lagoCustomerId: string | null;
    orgId: string;
  };
  invoices: {
    portalRequired: boolean;
  };
  payment: {
    overdue: boolean;
    overdueInvoiceId: string | null;
  };
  plan: {
    current: Tier;
    lagoPlanCode: string | null;
    pending: {
      downgradePlanDate: string | null;
      nextPlanCode: string | null;
      previousPlanCode: string | null;
      status: string | null;
    };
    supportedSelfServeTargets: Array<"free" | "payg">;
  };
  subscription: {
    externalId: string;
    status: string | null;
  };
}

export type AccountBillingPlanChangeResponse =
  | {
      status: "noop";
      currentPlanCode: Tier;
      targetPlanCode: "free" | "payg";
    }
  | {
      status: "submitted" | "scheduled" | "already_pending" | "payment_method_required";
      currentPlanCode: Tier;
      effectiveAt: string | null;
      portalUrl?: string;
      subscriptionExternalId: string;
      targetPlanCode: "free" | "payg";
    };

export interface AccountBillingPortalSessionResponse {
  expiresAt: string | null;
  portalUrl: string;
  status: "created";
}

export class AccountBillingError extends Error {
  readonly code: string;
  readonly httpStatus: 400 | 403 | 404 | 409 | 500 | 503;
  readonly details?: Record<string, unknown>;

  constructor(
    code: string,
    message: string,
    httpStatus: 400 | 403 | 404 | 409 | 500 | 503,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "AccountBillingError";
    this.code = code;
    this.httpStatus = httpStatus;
    this.details = details;
  }
}

export interface LagoCustomerInput {
  billingConfiguration: {
    invoiceGracePeriod?: number;
    paymentProvider?: string;
    paymentProviderCode?: string;
  };
  currency: "AUD";
  customerId: string;
  email: string;
  name: string;
}

export interface LagoSubscriptionInput {
  externalCustomerId: string;
  externalSubscriptionId: string;
  planCode: "free" | "payg";
}

export interface LagoSubscriptionState {
  downgradePlanDate: string | null;
  externalCustomerId: string;
  externalSubscriptionId: string;
  nextPlanCode: string | null;
  planCode: string;
  previousPlanCode: string | null;
  status: string;
}

export interface LagoPortalUrl {
  expiresAt: string | null;
  url: string;
}

export interface LagoAccountBillingClient {
  getCustomerPortalUrl(customerId: string): Promise<LagoPortalUrl>;
  getSubscription(externalSubscriptionId: string): Promise<LagoSubscriptionState | null>;
  upsertCustomer(input: LagoCustomerInput): Promise<void>;
  upsertSubscription(input: LagoSubscriptionInput): Promise<LagoSubscriptionState>;
}

export interface AccountBillingDependencies {
  actionLedger: BillingActionLedger;
  customersTableName: string;
  ddb: DynamoDBDocumentClient;
  enabled: boolean;
  keysTableName: string;
  lagoClient: LagoAccountBillingClient;
  lagoPaymentProviderCode: string | undefined;
  logger: Logger;
  now: () => Date;
  planChangeAllowedOrgIds: Set<string>;
}

export interface BillingActionLedger {
  complete(input: {
    actionId: string;
    now: Date;
    providerRequestId?: string | null;
    providerStatus?: string | null;
    providerSubscriptionState?: LagoSubscriptionState | null;
    responseBody: AccountBillingPlanChangeResponse | AccountBillingPortalSessionResponse;
    status: Extract<AccountBillingActionStatus, "succeeded" | "failed_permanent" | "failed_retryable">;
  }): Promise<void>;
  fail(input: {
    actionId: string;
    error: string;
    now: Date;
    status: Extract<AccountBillingActionStatus, "failed_permanent" | "failed_retryable">;
  }): Promise<void>;
  lookup(input: {
    idempotencyKey: string;
    now: Date;
    orgId: string;
    requestBody: unknown;
    route: string;
  }): Promise<
    | { kind: "not_found" }
    | {
        kind: "replay";
        record: BillingActionRecord;
      }
    | {
        kind: "failed_replay";
        record: BillingActionRecord;
      }
    | {
        actionId: string;
        kind: "resume";
        record: BillingActionRecord;
      }
    | { kind: "conflict" }
  >;
  start(input: {
    actorId: string;
    customerId: string;
    idempotencyKey: string;
    now: Date;
    orgId: string;
    previousPlanCode?: string | null;
    requestBody: unknown;
    route: string;
    subscriptionExternalId?: string | null;
    targetPlanCode?: string | null;
  }): Promise<
    | { kind: "started"; actionId: string }
    | {
        kind: "replay";
        record: BillingActionRecord;
      }
    | {
        kind: "failed_replay";
        record: BillingActionRecord;
      }
    | {
        actionId: string;
        kind: "resume";
        record: BillingActionRecord;
      }
    | { kind: "conflict" }
  >;
}

const ACCOUNT_BILLING_LEDGER_TTL_DAYS = 365;
const ACCOUNT_BILLING_PROCESSING_LEASE_MS = 2 * 60 * 1_000;
const CUSTOMER_ID_INDEX = "customerId-index";
const DEFAULT_LAGO_TIMEOUT_MS = 10_000;
const MAX_ERROR_LENGTH = 1_000;
const ORG_ID_INDEX = "orgId-index";
const SELF_SERVE_PLANS = new Set<Tier>(["free", "payg"]);
const defaultLogger = createLogger("control-plane-account-billing");
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

function getOptionalSet(name: string): Set<string> {
  return new Set(
    (process.env[name] ?? "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  );
}

function getLedgerTtl(now: Date): number {
  return Math.floor(now.getTime() / 1000) + ACCOUNT_BILLING_LEDGER_TTL_DAYS * 24 * 60 * 60;
}

function getOrgEnvelopeKey(orgId: string): string {
  return `ORG#${orgId}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  return `{${Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
    .join(",")}}`;
}

function hashValue(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function deriveActionId(orgId: string, route: string, idempotencyKey: string): string {
  return `bact_${hashValue(`${orgId}|${route}|${idempotencyKey}`).slice(0, 32)}`;
}

function truncateError(value: string): string {
  return value.length <= MAX_ERROR_LENGTH ? value : value.slice(0, MAX_ERROR_LENGTH);
}

function isConditionalCheckFailure(error: unknown): boolean {
  return (
    error instanceof ConditionalCheckFailedException ||
    (error instanceof Error && error.name === "ConditionalCheckFailedException")
  );
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

function assertSelfServePlan(value: string): asserts value is "free" | "payg" {
  if (!SELF_SERVE_PLANS.has(value as Tier)) {
    throw new AccountBillingError(
      "INVALID_PARAMETERS",
      "targetPlanCode must be one of: free, payg",
      400,
      { targetPlanCode: value },
    );
  }
}

function normalizeLagoApiUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, "").replace(/\/api\/v1$/, "");
  if (!trimmed.startsWith("https://") && !trimmed.startsWith("http://")) {
    throw new Error("LAGO_API_URL must include http:// or https://");
  }
  return `${trimmed}/api/v1`;
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

function getLagoError(response: Response, payload: unknown): AccountBillingError {
  if (response.status === 402 || response.status === 422) {
    return new AccountBillingError(
      "LAGO_CONFIGURATION_ERROR",
      `Lago rejected billing request with HTTP ${response.status}`,
      500,
      { status: response.status, payload },
    );
  }
  if (response.status >= 500 || response.status === 429) {
    return new AccountBillingError(
      "LAGO_UNAVAILABLE",
      `Lago request failed with HTTP ${response.status}`,
      503,
      { status: response.status },
    );
  }
  return new AccountBillingError(
    "LAGO_CONFIGURATION_ERROR",
    `Lago request failed with HTTP ${response.status}`,
    500,
    { status: response.status, payload },
  );
}

async function readJsonResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new AccountBillingError(
      "LAGO_UNAVAILABLE",
      "Lago response body was not valid JSON",
      503,
      { status: response.status },
    );
  }
}

function normalizeLagoTransportError(error: unknown): AccountBillingError {
  if (error instanceof AccountBillingError) return error;
  return new AccountBillingError(
    "LAGO_UNAVAILABLE",
    "Lago request failed before receiving a valid response",
    503,
    {
      cause:
        error instanceof Error
          ? { name: error.name, message: error.message }
          : { name: typeof error, message: String(error) },
    },
  );
}

function parseLagoSubscription(payload: unknown): LagoSubscriptionState {
  const subscription = isRecord(payload) && isRecord(payload.subscription) ? payload.subscription : payload;
  const externalCustomerId = firstString(subscription, [
    ["customer", "external_id"],
    ["external_customer_id"],
  ]);
  const externalSubscriptionId = firstString(subscription, [["external_id"], ["external_subscription_id"]]);
  const planCode = firstString(subscription, [["plan_code"], ["plan", "code"]]);
  if (!externalCustomerId || !externalSubscriptionId || !planCode) {
    throw new AccountBillingError(
      "LAGO_CONFIGURATION_ERROR",
      "Lago subscription response is missing required identifiers",
      500,
    );
  }
  return {
    downgradePlanDate: firstString(subscription, [["downgrade_plan_date"]]),
    externalCustomerId,
    externalSubscriptionId,
    nextPlanCode: firstString(subscription, [["next_plan", "code"], ["next_plan_code"]]),
    planCode,
    previousPlanCode: firstString(subscription, [["previous_plan", "code"], ["previous_plan_code"]]),
    status: firstString(subscription, [["status"]]) ?? "unknown",
  };
}

export class HttpLagoAccountBillingClient implements LagoAccountBillingClient {
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
    this.baseUrl = normalizeLagoApiUrl(input.baseUrl);
    this.fetchImpl = input.fetchImpl ?? fetch;
    this.timeoutMs = input.timeoutMs ?? DEFAULT_LAGO_TIMEOUT_MS;
  }

  private async request(path: string, init: RequestInit): Promise<unknown> {
    let response: Response;
    let payload: unknown;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
          ...(init.headers ?? {}),
        },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      payload = await readJsonResponse(response);
    } catch (error) {
      throw normalizeLagoTransportError(error);
    }
    if (!response.ok) throw getLagoError(response, payload);
    return payload;
  }

  async getCustomerPortalUrl(customerId: string): Promise<LagoPortalUrl> {
    const payload = await this.request(`/customers/${encodeURIComponent(customerId)}/portal_url`, {
      method: "GET",
    });
    const url = firstString(payload, [
      ["customer", "portal_url"],
      ["portal_url"],
      ["url"],
    ]);
    if (!url) {
      throw new AccountBillingError(
        "LAGO_CONFIGURATION_ERROR",
        "Lago portal URL response did not include a URL",
        500,
      );
    }
    return {
      expiresAt: firstString(payload, [["expires_at"], ["customer", "portal_url_expires_at"]]),
      url,
    };
  }

  async getSubscription(externalSubscriptionId: string): Promise<LagoSubscriptionState | null> {
    try {
      const payload = await this.request(`/subscriptions/${encodeURIComponent(externalSubscriptionId)}`, {
        method: "GET",
      });
      return parseLagoSubscription(payload);
    } catch (error) {
      if (
        error instanceof AccountBillingError &&
        error.details &&
        error.details.status === 404
      ) {
        return null;
      }
      throw error;
    }
  }

  async upsertCustomer(input: LagoCustomerInput): Promise<void> {
    await this.request(`/customers`, {
      body: JSON.stringify({
        customer: {
          billing_configuration: {
            invoice_grace_period: input.billingConfiguration.invoiceGracePeriod ?? 0,
            payment_provider: input.billingConfiguration.paymentProvider ?? "stripe",
            payment_provider_code: input.billingConfiguration.paymentProviderCode,
          },
          currency: input.currency,
          email: input.email,
          external_id: input.customerId,
          name: input.name,
        },
      }),
      method: "POST",
    });
  }

  async upsertSubscription(input: LagoSubscriptionInput): Promise<LagoSubscriptionState> {
    const payload = await this.request(`/subscriptions`, {
      body: JSON.stringify({
        subscription: {
          external_customer_id: input.externalCustomerId,
          external_id: input.externalSubscriptionId,
          plan_code: input.planCode,
        },
      }),
      method: "POST",
    });
    const subscription = parseLagoSubscription(payload);
    if (
      subscription.externalSubscriptionId !== input.externalSubscriptionId ||
      subscription.externalCustomerId !== input.externalCustomerId ||
      (subscription.planCode !== input.planCode && subscription.nextPlanCode !== input.planCode)
    ) {
      throw new AccountBillingError(
        "LAGO_CONFIGURATION_ERROR",
        "Lago subscription response did not apply the requested subscription change",
        500,
        {
          actualExternalCustomerId: subscription.externalCustomerId,
          actualExternalSubscriptionId: subscription.externalSubscriptionId,
          actualNextPlanCode: subscription.nextPlanCode,
          actualPlanCode: subscription.planCode,
          expectedExternalCustomerId: input.externalCustomerId,
          expectedExternalSubscriptionId: input.externalSubscriptionId,
          expectedPlanCode: input.planCode,
        },
      );
    }
    return subscription;
  }
}

export class DynamoBillingActionLedger implements BillingActionLedger {
  private readonly ddb: DynamoDBDocumentClient;
  private readonly tableName: string;

  constructor(input: { ddb: DynamoDBDocumentClient; tableName: string }) {
    this.ddb = input.ddb;
    this.tableName = input.tableName;
  }

  async lookup(input: {
    idempotencyKey: string;
    now: Date;
    orgId: string;
    requestBody: unknown;
    route: string;
  }): Promise<
    | { kind: "not_found" }
    | { kind: "replay"; record: BillingActionRecord }
    | { kind: "failed_replay"; record: BillingActionRecord }
    | { actionId: string; kind: "resume"; record: BillingActionRecord }
    | { kind: "conflict" }
  > {
    const actionId = deriveActionId(input.orgId, input.route, input.idempotencyKey);
    const requestHash = hashValue(stableStringify(input.requestBody));
    const existing = await this.ddb.send(
      new GetCommand({
        ConsistentRead: true,
        TableName: this.tableName,
        Key: { actionId },
      }),
    );
    const record = existing.Item as BillingActionRecord | undefined;
    if (!record) return { kind: "not_found" };
    const classified = await this.classifyExistingAction(
      record,
      actionId,
      requestHash,
      input.now,
      false,
    );
    return classified.kind === "started" ? { kind: "not_found" } : classified;
  }

  async start(input: {
    actorId: string;
    customerId: string;
    idempotencyKey: string;
    now: Date;
    orgId: string;
    previousPlanCode?: string | null;
    requestBody: unknown;
    route: string;
    subscriptionExternalId?: string | null;
    targetPlanCode?: string | null;
  }): Promise<
    | { kind: "started"; actionId: string }
    | { kind: "replay"; record: BillingActionRecord }
    | { kind: "failed_replay"; record: BillingActionRecord }
    | { actionId: string; kind: "resume"; record: BillingActionRecord }
    | { kind: "conflict" }
  > {
    const actionId = deriveActionId(input.orgId, input.route, input.idempotencyKey);
    const requestHash = hashValue(stableStringify(input.requestBody));
    const item: BillingActionRecord = {
      actionId,
      actorId: input.actorId,
      createdAt: input.now.toISOString(),
      customerId: input.customerId,
      idempotencyKeyHash: hashValue(input.idempotencyKey),
      orgId: input.orgId,
      previousPlanCode: input.previousPlanCode,
      requestHash,
      route: input.route,
      status: "processing",
      subscriptionExternalId: input.subscriptionExternalId,
      targetPlanCode: input.targetPlanCode,
      ttl: getLedgerTtl(input.now),
      updatedAt: input.now.toISOString(),
    };
    try {
      await this.ddb.send(
        new PutCommand({
          TableName: this.tableName,
          Item: item,
          ConditionExpression: "attribute_not_exists(#actionId)",
          ExpressionAttributeNames: { "#actionId": "actionId" },
        }),
      );
      return { kind: "started", actionId };
    } catch (error) {
      if (!isConditionalCheckFailure(error)) throw error;
    }
    const existing = await this.ddb.send(
      new GetCommand({
        ConsistentRead: true,
        TableName: this.tableName,
        Key: { actionId },
      }),
    );
    const record = existing.Item as BillingActionRecord | undefined;
    if (!record) return { kind: "conflict" };
    const classified = await this.classifyExistingAction(record, actionId, requestHash, input.now, true);
    return classified.kind === "not_found" ? { kind: "conflict" } : classified;
  }

  private async classifyExistingAction(
    record: BillingActionRecord,
    actionId: string,
    requestHash: string,
    now: Date,
    allowReclaim: boolean,
  ): Promise<
    | { kind: "not_found" }
    | { kind: "started"; actionId: string }
    | { kind: "replay"; record: BillingActionRecord }
    | { kind: "failed_replay"; record: BillingActionRecord }
    | { actionId: string; kind: "resume"; record: BillingActionRecord }
    | { kind: "conflict" }
  > {
    if (record.requestHash !== requestHash) return { kind: "conflict" };
    if (record.status === "succeeded" && record.responseBody) {
      return { kind: "replay", record };
    }
    if (record.status === "failed_permanent" || record.status === "succeeded") {
      return { kind: "failed_replay", record };
    }
    if (record.status === "failed_retryable") {
      if (record.responseBody && record.providerSubscriptionState) {
        return { actionId, kind: "resume", record };
      }
      if (!allowReclaim) return { kind: "not_found" };
      const reclaimed = await this.reclaimRetryableAction(actionId, requestHash, now, {
        status: "failed_retryable",
      });
      return reclaimed ? { kind: "started", actionId } : { kind: "conflict" };
    }
    if (record.status === "processing") {
      const staleBefore = new Date(now.getTime() - ACCOUNT_BILLING_PROCESSING_LEASE_MS);
      const updatedAt = Date.parse(record.updatedAt);
      if (!Number.isFinite(updatedAt) || updatedAt > staleBefore.getTime()) {
        return { kind: "conflict" };
      }
      if (!allowReclaim) return { kind: "not_found" };
      const reclaimed = await this.reclaimRetryableAction(actionId, requestHash, now, {
        staleBefore,
        status: "processing",
      });
      return reclaimed ? { kind: "started", actionId } : { kind: "conflict" };
    }
    return { kind: "conflict" };
  }

  private async reclaimRetryableAction(
    actionId: string,
    requestHash: string,
    now: Date,
    condition: { status: "failed_retryable" } | { status: "processing"; staleBefore: Date },
  ): Promise<boolean> {
    const expressionAttributeNames: Record<string, string> = {
      "#lastError": "lastError",
      "#requestHash": "requestHash",
      "#status": "status",
      "#updatedAt": "updatedAt",
    };
    const expressionAttributeValues: Record<string, unknown> = {
      ":expectedStatus": condition.status,
      ":processing": "processing",
      ":requestHash": requestHash,
      ":updatedAt": now.toISOString(),
    };
    const staleCondition =
      condition.status === "processing" ? " AND #updatedAt <= :staleBefore" : "";
    if (condition.status === "processing") {
      expressionAttributeValues[":staleBefore"] = condition.staleBefore.toISOString();
    }
    try {
      await this.ddb.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: { actionId },
          UpdateExpression: "SET #status = :processing, #updatedAt = :updatedAt REMOVE #lastError",
          ConditionExpression:
            "#requestHash = :requestHash AND #status = :expectedStatus" + staleCondition,
          ExpressionAttributeNames: expressionAttributeNames,
          ExpressionAttributeValues: expressionAttributeValues,
        }),
      );
      return true;
    } catch (error) {
      if (isConditionalCheckFailure(error)) return false;
      throw error;
    }
  }

  async complete(input: {
    actionId: string;
    now: Date;
    providerRequestId?: string | null;
    providerStatus?: string | null;
    providerSubscriptionState?: LagoSubscriptionState | null;
    responseBody: AccountBillingPlanChangeResponse | AccountBillingPortalSessionResponse;
    status: Extract<AccountBillingActionStatus, "succeeded" | "failed_permanent" | "failed_retryable">;
  }): Promise<void> {
    await this.ddb.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { actionId: input.actionId },
        UpdateExpression:
          "SET #status = :status, #updatedAt = :updatedAt, #providerStatus = :providerStatus, #providerRequestId = :providerRequestId, #providerSubscriptionState = :providerSubscriptionState, #responseBody = :responseBody",
        ExpressionAttributeNames: {
          "#providerRequestId": "providerRequestId",
          "#providerStatus": "providerStatus",
          "#providerSubscriptionState": "providerSubscriptionState",
          "#responseBody": "responseBody",
          "#status": "status",
          "#updatedAt": "updatedAt",
        },
        ExpressionAttributeValues: {
          ":providerRequestId": input.providerRequestId ?? null,
          ":providerStatus": input.providerStatus ?? null,
          ":providerSubscriptionState": input.providerSubscriptionState ?? null,
          ":responseBody": input.responseBody,
          ":status": input.status,
          ":updatedAt": input.now.toISOString(),
        },
      }),
    );
  }

  async fail(input: {
    actionId: string;
    error: string;
    now: Date;
    status: Extract<AccountBillingActionStatus, "failed_permanent" | "failed_retryable">;
  }): Promise<void> {
    await this.ddb.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { actionId: input.actionId },
        UpdateExpression: "SET #status = :status, #updatedAt = :updatedAt, #lastError = :lastError",
        ExpressionAttributeNames: {
          "#lastError": "lastError",
          "#status": "status",
          "#updatedAt": "updatedAt",
        },
        ExpressionAttributeValues: {
          ":lastError": truncateError(input.error),
          ":status": input.status,
          ":updatedAt": input.now.toISOString(),
        },
      }),
    );
  }
}

async function loadOrgEnvelope(
  ddb: DynamoDBDocumentClient,
  keysTableName: string,
  orgId: string,
): Promise<OrgEnvelopeRecord> {
  const response = await ddb.send(
    new GetCommand({
      ConsistentRead: true,
      TableName: keysTableName,
      Key: { apiKeyHash: getOrgEnvelopeKey(orgId) },
    }),
  );
  if (!response.Item) {
    throw new AccountBillingError(
      "NOT_FOUND",
      "This organization has not been provisioned yet",
      404,
    );
  }
  return response.Item as OrgEnvelopeRecord;
}

async function loadCustomer(
  ddb: DynamoDBDocumentClient,
  customersTableName: string,
  customerId: string,
): Promise<CustomerRecord> {
  const response = await ddb.send(
    new QueryCommand({
      TableName: customersTableName,
      IndexName: CUSTOMER_ID_INDEX,
      KeyConditionExpression: "customerId = :customerId",
      ExpressionAttributeValues: { ":customerId": customerId },
    }),
  );
  const rows = (response.Items as CustomerRecord[] | undefined) ?? [];
  if (rows.length !== 1) {
    throw new AccountBillingError(
      "CUSTOMER_MAPPING_CONFLICT",
      "Customer mapping is not unique",
      409,
      { customerId, rowCount: rows.length },
    );
  }
  const customer = rows[0];
  if (!customer || customer.status !== "active" || customer.lagoExternalCustomerId !== customerId) {
    throw new AccountBillingError(
      "CUSTOMER_MAPPING_CONFLICT",
      "Customer mapping is inactive or inconsistent",
      409,
      { customerId },
    );
  }
  return customer;
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
      ExpressionAttributeValues: { ":orgId": orgId },
    }),
  );
  return ((response.Items as unknown[] | undefined) ?? []).filter(isApiKeyRecord);
}

function currentTier(envelope: OrgEnvelopeRecord): Tier {
  return envelope.tier;
}

function ensureMutable(dependencies: AccountBillingDependencies, orgId: string): void {
  if (!dependencies.enabled || !dependencies.planChangeAllowedOrgIds.has(orgId)) {
    throw new AccountBillingError(
      "PLAN_CHANGES_DISABLED",
      "Plan changes are not enabled for this organization",
      403,
    );
  }
}

function assertIdempotencyKey(value: string | undefined): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    throw new AccountBillingError(
      "MISSING_IDEMPOTENCY_KEY",
      "Idempotency-Key header is required for this billing action",
      400,
    );
  }
  return trimmed;
}

function replayStoredFailure(record: BillingActionRecord): AccountBillingError {
  return new AccountBillingError(
    record.status === "failed_retryable"
      ? "BILLING_ACTION_RETRYABLE_FAILURE"
      : "BILLING_ACTION_FAILED",
    record.lastError ?? "Prior billing action failed",
    record.status === "failed_retryable" ? 503 : 500,
    {
      actionId: record.actionId,
      providerStatus: record.providerStatus ?? null,
    },
  );
}

function getLedgerFailureStatus(
  error: unknown,
): Extract<AccountBillingActionStatus, "failed_permanent" | "failed_retryable"> {
  if (error instanceof AccountBillingError && error.httpStatus !== 503) {
    return "failed_permanent";
  }
  return "failed_retryable";
}

async function completeResumedPlanChange(input: {
  actionId: string;
  dependencies: AccountBillingDependencies;
  orgId: string;
  record: BillingActionRecord;
}): Promise<AccountBillingPlanChangeResponse> {
  const response = input.record.responseBody as AccountBillingPlanChangeResponse | undefined;
  const subscription = input.record.providerSubscriptionState;
  if (!response || !subscription) {
    throw new AccountBillingError(
      "BILLING_ACTION_LEDGER_CORRUPT",
      "Billing action ledger is missing provider outcome for retry",
      500,
      { actionId: input.actionId },
    );
  }
  try {
    await updatePendingTransition(input.dependencies, input.orgId, subscription);
    await input.dependencies.actionLedger.complete({
      actionId: input.actionId,
      now: input.dependencies.now(),
      providerStatus: subscription.status,
      providerSubscriptionState: subscription,
      responseBody: response,
      status: "succeeded",
    });
    return response;
  } catch (error) {
    await input.dependencies.actionLedger.fail({
      actionId: input.actionId,
      error: error instanceof Error ? error.message : String(error),
      now: input.dependencies.now(),
      status: getLedgerFailureStatus(error),
    });
    throw error;
  }
}

function buildSummary(
  envelope: OrgEnvelopeRecord,
  customer: CustomerRecord,
  subscription: LagoSubscriptionState | null,
  mutable: boolean,
): AccountBillingSummary {
  const subscriptionExternalId =
    envelope.lagoSubscriptionExternalId ?? deriveLagoExternalSubscriptionId(customer.customerId);
  const pendingTransitionStatus =
    envelope.lagoPlanTransitionStatus ??
    (subscription?.nextPlanCode || subscription?.status === "pending" ? "pending" : null);
  return {
    allowedActions: {
      canOpenPortal: true,
      canRequestPlanChange: mutable,
    },
    billingPeriod: {
      endsAt: envelope.billingPeriodEndingAt ?? null,
      key: envelope.billingPeriodKey ?? null,
      startsAt: envelope.billingPeriodStartedAt ?? null,
    },
    customer: {
      customerId: customer.customerId,
      lagoCustomerId: customer.lagoCustomerId,
      orgId: customer.orgId,
    },
    invoices: {
      portalRequired: true,
    },
    payment: {
      overdue: envelope.paymentOverdue,
      overdueInvoiceId: envelope.lagoPaymentOverdueInvoiceId ?? null,
    },
    plan: {
      current: envelope.tier,
      lagoPlanCode: envelope.lagoPlanCode ?? subscription?.planCode ?? null,
      pending: {
        downgradePlanDate: envelope.lagoDowngradePlanDate ?? subscription?.downgradePlanDate ?? null,
        nextPlanCode: envelope.lagoNextPlanCode ?? subscription?.nextPlanCode ?? null,
        previousPlanCode:
          envelope.lagoPreviousPlanCode ?? subscription?.previousPlanCode ?? null,
        status: pendingTransitionStatus,
      },
      supportedSelfServeTargets: ["free", "payg"],
    },
    subscription: {
      externalId: subscriptionExternalId,
      status: envelope.lagoSubscriptionStatus ?? subscription?.status ?? null,
    },
  };
}

async function updatePendingTransition(
  dependencies: AccountBillingDependencies,
  orgId: string,
  subscription: LagoSubscriptionState,
): Promise<void> {
  const keys = await loadOrgKeys(dependencies.ddb, dependencies.keysTableName, orgId);
  const transitionStatus =
    subscription.nextPlanCode || subscription.status === "pending" ? "pending" : null;
  await dependencies.ddb.send(
    new UpdateCommand({
      TableName: dependencies.keysTableName,
      Key: { apiKeyHash: getOrgEnvelopeKey(orgId) },
      UpdateExpression: [
        "SET #lagoPreviousPlanCode = :previousPlanCode",
        "#lagoNextPlanCode = :nextPlanCode",
        "#lagoDowngradePlanDate = :downgradePlanDate",
        "#lagoPlanTransitionStatus = :transitionStatus",
        "#lagoSubscriptionExternalId = :externalSubscriptionId",
      ].join(", "),
      ExpressionAttributeNames: {
        "#lagoDowngradePlanDate": "lagoDowngradePlanDate",
        "#lagoNextPlanCode": "lagoNextPlanCode",
        "#lagoPlanTransitionStatus": "lagoPlanTransitionStatus",
        "#lagoPreviousPlanCode": "lagoPreviousPlanCode",
        "#lagoSubscriptionExternalId": "lagoSubscriptionExternalId",
      },
      ExpressionAttributeValues: {
        ":downgradePlanDate": subscription.downgradePlanDate,
        ":externalSubscriptionId": subscription.externalSubscriptionId,
        ":nextPlanCode": subscription.nextPlanCode,
        ":previousPlanCode": subscription.previousPlanCode,
        ":transitionStatus": transitionStatus,
      },
    }),
  );
  await Promise.all(
    keys.map((key) =>
      dependencies.ddb.send(
        new UpdateCommand({
          TableName: dependencies.keysTableName,
          Key: { apiKeyHash: key.apiKeyHash },
          UpdateExpression: [
            "SET #lagoPreviousPlanCode = :previousPlanCode",
            "#lagoNextPlanCode = :nextPlanCode",
            "#lagoDowngradePlanDate = :downgradePlanDate",
            "#lagoPlanTransitionStatus = :transitionStatus",
            "#lagoSubscriptionExternalId = :externalSubscriptionId",
          ].join(", "),
          ExpressionAttributeNames: {
            "#lagoDowngradePlanDate": "lagoDowngradePlanDate",
            "#lagoNextPlanCode": "lagoNextPlanCode",
            "#lagoPlanTransitionStatus": "lagoPlanTransitionStatus",
            "#lagoPreviousPlanCode": "lagoPreviousPlanCode",
            "#lagoSubscriptionExternalId": "lagoSubscriptionExternalId",
          },
          ExpressionAttributeValues: {
            ":downgradePlanDate": subscription.downgradePlanDate,
            ":externalSubscriptionId": subscription.externalSubscriptionId,
            ":nextPlanCode": subscription.nextPlanCode,
            ":previousPlanCode": subscription.previousPlanCode,
            ":transitionStatus": transitionStatus,
          },
        }),
      ),
    ),
  );
}

export function createAccountBillingService(
  overrides: Partial<AccountBillingDependencies> = {},
): {
  getBillingSummary(principal: Pick<AccountPrincipal, "orgId">): Promise<AccountBillingSummary>;
  requestPlanChange(input: {
    idempotencyKey?: string;
    principal: AccountPrincipal;
    targetPlanCode: string;
  }): Promise<AccountBillingPlanChangeResponse>;
  createPortalSession(input: {
    idempotencyKey?: string;
    principal: AccountPrincipal;
  }): Promise<AccountBillingPortalSessionResponse>;
} {
  function resolveDependencies(): AccountBillingDependencies {
    const ddb = overrides.ddb ?? getDefaultDdb();
    return {
      actionLedger:
        overrides.actionLedger ??
        new DynamoBillingActionLedger({
          ddb,
          tableName: getRequiredEnv("BILLING_ACTIONS_TABLE_NAME"),
        }),
      customersTableName: overrides.customersTableName ?? getRequiredEnv("CUSTOMERS_TABLE_NAME"),
      ddb,
      enabled:
        overrides.enabled ??
        process.env.CONSOLE_BILLING_PLAN_CHANGES_ENABLED?.toLowerCase() === "true",
      keysTableName: overrides.keysTableName ?? getRequiredEnv("KEYS_TABLE_NAME"),
      lagoClient:
        overrides.lagoClient ??
        new HttpLagoAccountBillingClient({
          apiKey: getRequiredEnv("LAGO_API_KEY"),
          baseUrl: getRequiredEnv("LAGO_API_URL"),
        }),
      lagoPaymentProviderCode:
        overrides.lagoPaymentProviderCode ??
        process.env.LAGO_PAYMENT_PROVIDER_CODE?.trim() ??
        undefined,
      logger: overrides.logger ?? defaultLogger,
      now: overrides.now ?? (() => new Date()),
      planChangeAllowedOrgIds:
        overrides.planChangeAllowedOrgIds ??
        getOptionalSet("CONSOLE_BILLING_PLAN_CHANGE_ALLOWED_ORG_IDS"),
    };
  }

  async function loadState(dependencies: AccountBillingDependencies, orgId: string) {
    const envelope = await loadOrgEnvelope(dependencies.ddb, dependencies.keysTableName, orgId);
    if (!envelope.customerId) {
      throw new AccountBillingError(
        "CUSTOMER_MAPPING_CONFLICT",
        "Organization envelope is missing customerId",
        409,
      );
    }
    const customer = await loadCustomer(
      dependencies.ddb,
      dependencies.customersTableName,
      envelope.customerId,
    );
    if (customer.orgId !== orgId) {
      throw new AccountBillingError(
        "CUSTOMER_MAPPING_CONFLICT",
        "Customer belongs to a different organization",
        409,
      );
    }
    const subscriptionExternalId =
      envelope.lagoSubscriptionExternalId ?? deriveLagoExternalSubscriptionId(customer.customerId);
    const subscription = await dependencies.lagoClient.getSubscription(subscriptionExternalId);
    return { customer, envelope, subscription, subscriptionExternalId };
  }

  async function getBillingSummary(
    principal: Pick<AccountPrincipal, "orgId">,
  ): Promise<AccountBillingSummary> {
    const dependencies = resolveDependencies();
    const state = await loadState(dependencies, principal.orgId);
    return buildSummary(
      state.envelope,
      state.customer,
      state.subscription,
      dependencies.enabled && dependencies.planChangeAllowedOrgIds.has(principal.orgId),
    );
  }

  async function createPortalSession(input: {
    idempotencyKey?: string;
    principal: AccountPrincipal;
  }): Promise<AccountBillingPortalSessionResponse> {
    const dependencies = resolveDependencies();
    const idempotencyKey = assertIdempotencyKey(input.idempotencyKey);
    const now = dependencies.now();
    const prior = await dependencies.actionLedger.lookup({
      idempotencyKey,
      now,
      orgId: input.principal.orgId,
      requestBody: {},
      route: "POST /v1/account/billing/portal-session",
    });
    if (prior.kind === "conflict") {
      throw new AccountBillingError(
        "IDEMPOTENCY_CONFLICT",
        "Idempotency-Key was reused with a different request",
        409,
      );
    }
    if (prior.kind === "replay") {
      return prior.record.responseBody as AccountBillingPortalSessionResponse;
    }
    if (prior.kind === "failed_replay") {
      throw replayStoredFailure(prior.record);
    }
    if (prior.kind === "resume") {
      throw new AccountBillingError(
        "IDEMPOTENCY_CONFLICT",
        "Portal-session billing action is already in progress",
        409,
      );
    }
    const state = await loadState(dependencies, input.principal.orgId);
    const started = await dependencies.actionLedger.start({
      actorId: input.principal.userId,
      customerId: state.customer.customerId,
      idempotencyKey,
      now,
      orgId: input.principal.orgId,
      requestBody: {},
      route: "POST /v1/account/billing/portal-session",
      subscriptionExternalId: state.subscriptionExternalId,
    });
    if (started.kind === "conflict") {
      throw new AccountBillingError(
        "IDEMPOTENCY_CONFLICT",
        "Idempotency-Key was reused with a different request",
        409,
      );
    }
    if (started.kind === "replay") {
      return started.record.responseBody as AccountBillingPortalSessionResponse;
    }
    if (started.kind === "failed_replay") {
      throw replayStoredFailure(started.record);
    }
    if (started.kind === "resume") {
      throw new AccountBillingError(
        "IDEMPOTENCY_CONFLICT",
        "Portal-session billing action is already in progress",
        409,
      );
    }
    try {
      const portal = await dependencies.lagoClient.getCustomerPortalUrl(state.customer.customerId);
      const response: AccountBillingPortalSessionResponse = {
        expiresAt: portal.expiresAt,
        portalUrl: portal.url,
        status: "created",
      };
      await dependencies.actionLedger.complete({
        actionId: started.actionId,
        now: dependencies.now(),
        providerStatus: "created",
        responseBody: response,
        status: "succeeded",
      });
      return response;
    } catch (error) {
      await dependencies.actionLedger.fail({
        actionId: started.actionId,
        error: error instanceof Error ? error.message : String(error),
        now: dependencies.now(),
        status: getLedgerFailureStatus(error),
      });
      throw error;
    }
  }

  async function requestPlanChange(input: {
    idempotencyKey?: string;
    principal: AccountPrincipal;
    targetPlanCode: string;
  }): Promise<AccountBillingPlanChangeResponse> {
    const dependencies = resolveDependencies();
    const idempotencyKey = assertIdempotencyKey(input.idempotencyKey);
    assertSelfServePlan(input.targetPlanCode);
    const now = dependencies.now();
    const requestBody = { targetPlanCode: input.targetPlanCode };
    const prior = await dependencies.actionLedger.lookup({
      idempotencyKey,
      now,
      orgId: input.principal.orgId,
      requestBody,
      route: "POST /v1/account/billing/plan-change",
    });
    if (prior.kind === "conflict") {
      throw new AccountBillingError(
        "IDEMPOTENCY_CONFLICT",
        "Idempotency-Key was reused with a different request",
        409,
      );
    }
    if (prior.kind === "replay") {
      return prior.record.responseBody as AccountBillingPlanChangeResponse;
    }
    if (prior.kind === "failed_replay") {
      throw replayStoredFailure(prior.record);
    }
    if (prior.kind === "resume") {
      return completeResumedPlanChange({
        actionId: prior.actionId,
        dependencies,
        orgId: input.principal.orgId,
        record: prior.record,
      });
    }
    const state = await loadState(dependencies, input.principal.orgId);
    const currentPlan = currentTier(state.envelope);
    const started = await dependencies.actionLedger.start({
      actorId: input.principal.userId,
      customerId: state.customer.customerId,
      idempotencyKey,
      now,
      orgId: input.principal.orgId,
      previousPlanCode: currentPlan,
      requestBody,
      route: "POST /v1/account/billing/plan-change",
      subscriptionExternalId: state.subscriptionExternalId,
      targetPlanCode: input.targetPlanCode,
    });
    if (started.kind === "conflict") {
      throw new AccountBillingError(
        "IDEMPOTENCY_CONFLICT",
        "Idempotency-Key was reused with a different request",
        409,
      );
    }
    if (started.kind === "replay") {
      return started.record.responseBody as AccountBillingPlanChangeResponse;
    }
    if (started.kind === "failed_replay") {
      throw replayStoredFailure(started.record);
    }
    if (started.kind === "resume") {
      return completeResumedPlanChange({
        actionId: started.actionId,
        dependencies,
        orgId: input.principal.orgId,
        record: started.record,
      });
    }
    try {
      ensureMutable(dependencies, input.principal.orgId);
      const pendingPlanCode = state.envelope.lagoNextPlanCode ?? state.subscription?.nextPlanCode;
      const hasPendingTransition =
        Boolean(pendingPlanCode) ||
        state.envelope.lagoPlanTransitionStatus === "pending" ||
        state.subscription?.status === "pending";
      if (hasPendingTransition) {
        throw new AccountBillingError(
          "PLAN_CHANGE_ALREADY_PENDING",
          "A Lago plan change is already pending",
          409,
          { nextPlanCode: pendingPlanCode },
        );
      }
      if (currentPlan === input.targetPlanCode) {
        const response: AccountBillingPlanChangeResponse = {
          currentPlanCode: currentPlan,
          status: "noop",
          targetPlanCode: input.targetPlanCode,
        };
        await dependencies.actionLedger.complete({
          actionId: started.actionId,
          now: dependencies.now(),
          providerStatus: "noop",
          responseBody: response,
          status: "succeeded",
        });
        return response;
      }
      await dependencies.lagoClient.upsertCustomer({
        billingConfiguration: {
          paymentProvider: "stripe",
          paymentProviderCode: dependencies.lagoPaymentProviderCode || undefined,
        },
        currency: "AUD",
        customerId: state.customer.customerId,
        email: state.customer.ownerEmail,
        name: state.customer.ownerEmail,
      });
      const subscription = await dependencies.lagoClient.upsertSubscription({
        externalCustomerId: state.customer.customerId,
        externalSubscriptionId: state.subscriptionExternalId,
        planCode: input.targetPlanCode,
      });
      const status = subscription.nextPlanCode ? "scheduled" : "submitted";
      const response: AccountBillingPlanChangeResponse = {
        currentPlanCode: currentPlan,
        effectiveAt: subscription.downgradePlanDate,
        status,
        subscriptionExternalId: subscription.externalSubscriptionId,
        targetPlanCode: input.targetPlanCode,
      };
      await dependencies.actionLedger.complete({
        actionId: started.actionId,
        now: dependencies.now(),
        providerStatus: subscription.status,
        providerSubscriptionState: subscription,
        responseBody: response,
        status: "failed_retryable",
      });
      await updatePendingTransition(dependencies, input.principal.orgId, subscription);
      await dependencies.actionLedger.complete({
        actionId: started.actionId,
        now: dependencies.now(),
        providerStatus: subscription.status,
        providerSubscriptionState: subscription,
        responseBody: response,
        status: "succeeded",
      });
      return response;
    } catch (error) {
      await dependencies.actionLedger.fail({
        actionId: started.actionId,
        error: error instanceof Error ? error.message : String(error),
        now: dependencies.now(),
        status: getLedgerFailureStatus(error),
      });
      throw error;
    }
  }

  return { createPortalSession, getBillingSummary, requestPlanChange };
}
