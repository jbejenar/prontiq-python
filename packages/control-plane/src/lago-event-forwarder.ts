import { createHash } from "node:crypto";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { SERVICE_NAMES, wrapLambdaHandler } from "@prontiq/observability";
import {
  billingUsageEventV1Schema,
  createLogger,
  deriveBillingUsageEventId,
  deriveLagoExternalSubscriptionId,
  type BillingUsageEventV1,
} from "@prontiq/shared";
import type { SQSEvent, SQSRecord, SQSBatchResponse } from "aws-lambda";

type Logger = Pick<Console, "error" | "warn" | "info">;

export type BillingEventDeliveryStatus =
  | "processing"
  | "accepted"
  | "failed_retryable"
  | "failed_permanent"
  | "invalid";

export interface BillingEventDeliveryRecord {
  acceptedAt?: string;
  apiKeyHash?: string;
  attempts?: number;
  code?: string;
  creditDelta?: number;
  customerId?: string;
  eventId: string;
  eventPayloadHash?: string;
  externalSubscriptionId?: string;
  firstAttemptAt?: string;
  keyPrefix?: string;
  lastAttemptAt?: string;
  lastError?: string;
  orgId?: string;
  status?: BillingEventDeliveryStatus;
  ttl?: number;
  usageScope?: string;
}

interface DeliveryRecordInput {
  event: BillingUsageEventV1;
  eventPayloadHash: string;
  externalSubscriptionId: string;
  now: Date;
}

interface DeliveryFailureInput extends DeliveryRecordInput {
  countAttempt: boolean;
  error: string;
  status: Extract<BillingEventDeliveryStatus, "failed_retryable" | "failed_permanent" | "invalid">;
}

export type RecordAttemptResult =
  | "ok"
  | "accepted_same_hash"
  | "permanent_failure_same_hash"
  | "hash_conflict";

export type MarkAcceptedResult =
  | "ok"
  | "accepted_same_hash"
  | "terminal_same_hash"
  | "hash_conflict";

export interface BillingEventDeliveryLedger {
  get(eventId: string): Promise<BillingEventDeliveryRecord | undefined>;
  markAccepted(input: DeliveryRecordInput): Promise<MarkAcceptedResult>;
  markFailure(input: DeliveryFailureInput): Promise<void>;
  recordAttempt(input: DeliveryRecordInput): Promise<RecordAttemptResult>;
}

export interface LagoUsageEventPayload {
  event: {
    code: string;
    external_subscription_id: string;
    properties: {
      credits: number;
    };
    timestamp: number;
    transaction_id: string;
  };
}

type LagoEventConfirmationResult = "confirmed" | "not_found" | "unknown";

export interface LagoUsageClient {
  sendUsageEvent(payload: LagoUsageEventPayload): Promise<void>;
}

export interface LagoEventForwarderDependencies {
  lagoClient: LagoUsageClient;
  ledger: BillingEventDeliveryLedger;
  logger: Logger;
  now: () => Date;
}

class RecordProcessingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RecordProcessingError";
  }
}

export class LagoForwardingError extends Error {
  readonly retryable: boolean;
  readonly statusCode?: number;

  constructor(message: string, input: { retryable: boolean; statusCode?: number }) {
    super(message);
    this.name = "LagoForwardingError";
    this.retryable = input.retryable;
    this.statusCode = input.statusCode;
  }
}

let cachedDdb: DynamoDBDocumentClient | undefined;
const defaultLogger = createLogger("control-plane-lago-event-forwarder");
const DELIVERY_LEDGER_TTL_DAYS = 365;
const DEFAULT_LAGO_TIMEOUT_MS = 10_000;
const MAX_ERROR_LENGTH = 1_000;

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

function getDeliveryTtl(now: Date): number {
  return Math.floor(now.getTime() / 1000) + DELIVERY_LEDGER_TTL_DAYS * 24 * 60 * 60;
}

function truncateError(value: string): string {
  return value.length <= MAX_ERROR_LENGTH ? value : value.slice(0, MAX_ERROR_LENGTH);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  return `{${entries
    .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
    .join(",")}}`;
}

export function hashBillingEventPayload(event: BillingUsageEventV1): string {
  return createHash("sha256").update(stableStringify(event)).digest("hex");
}

function verifyBillingEventId(event: BillingUsageEventV1): void {
  const expected = deriveBillingUsageEventId({
    apiKeyHash: event.apiKeyHash,
    billingEndpointKey: event.billingEndpointKey,
    creditDelta: event.creditDelta,
    customerId: event.customerId,
    requestCountAfterIncrement: event.requestCountAfterIncrement,
    usageScope: event.usageScope,
  });
  if (event.eventId !== expected) {
    throw new RecordProcessingError("billing event id does not match deterministic input");
  }
}

export function buildLagoUsageEventPayload(event: BillingUsageEventV1): LagoUsageEventPayload {
  return {
    event: {
      code: event.meterEventName,
      external_subscription_id: deriveLagoExternalSubscriptionId(event.customerId),
      properties: {
        credits: event.creditDelta,
      },
      timestamp: Math.floor(new Date(event.occurredAt).getTime() / 1000),
      transaction_id: event.eventId,
    },
  };
}

export function normalizeLagoApiUrl(value: string): string {
  let base = value.trim().replace(/\/+$/, "");
  if (base.endsWith("/api/v1")) {
    base = base.slice(0, -"/api/v1".length);
  }
  if (!base.startsWith("https://") && !base.startsWith("http://")) {
    throw new Error("LAGO_API_URL must include http:// or https://");
  }
  return `${base}/api/v1`;
}

export function classifyLagoStatusCode(statusCode: number): { retryable: boolean } {
  if (statusCode === 400) {
    return { retryable: false };
  }
  if (statusCode >= 400) {
    return { retryable: true };
  }
  return { retryable: false };
}

function flattenJsonStrings(value: unknown): string[] {
  if (typeof value === "string") {
    return [value];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item) => flattenJsonStrings(item));
  }
  if (isRecord(value)) {
    return Object.entries(value).flatMap(([key, item]) => [key, ...flattenJsonStrings(item)]);
  }
  return [];
}

function extractErrorText(body: string): string {
  try {
    return flattenJsonStrings(JSON.parse(body)).join(" ").toLowerCase();
  } catch {
    return body.toLowerCase();
  }
}

export function isDuplicateLagoTransactionError(input: {
  body: string;
  statusCode: number;
  transactionId: string;
}): boolean {
  if (input.statusCode !== 422) {
    return false;
  }
  const normalizedBody = extractErrorText(input.body);
  const normalizedTransactionId = input.transactionId.toLowerCase();
  if (!normalizedBody.includes("transaction")) {
    return false;
  }
  if (!normalizedBody.includes(normalizedTransactionId) && !normalizedBody.includes("id")) {
    return false;
  }
  return ["already", "duplicate", "taken", "unique"].some((marker) =>
    normalizedBody.includes(marker),
  );
}

export function isPermanentLagoEventValidationError(input: {
  body: string;
  statusCode: number;
}): boolean {
  if (input.statusCode === 400) {
    return true;
  }
  if (input.statusCode !== 422) {
    return false;
  }

  const normalizedBody = extractErrorText(input.body);
  const permanentValidationMarkers = [
    "code is invalid",
    "code can't be blank",
    "external subscription id is invalid",
    "external subscription id can't be blank",
    "external_subscription_id is invalid",
    "external_subscription_id can't be blank",
    "properties is invalid",
    "timestamp is invalid",
    "transaction_id is invalid",
    "transaction id is invalid",
  ];

  return permanentValidationMarkers.some((marker) => normalizedBody.includes(marker));
}

async function readErrorBody(response: Response): Promise<string> {
  try {
    return truncateError(await response.text());
  } catch {
    return "";
  }
}

export class HttpLagoUsageClient implements LagoUsageClient {
  private readonly apiKey: string;
  private readonly endpoint: string;
  private readonly eventsEndpoint: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(input: {
    apiKey: string;
    baseUrl: string;
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
  }) {
    this.apiKey = input.apiKey;
    this.eventsEndpoint = `${normalizeLagoApiUrl(input.baseUrl)}/events`;
    this.endpoint = this.eventsEndpoint;
    this.fetchImpl = input.fetchImpl ?? fetch;
    this.timeoutMs = input.timeoutMs ?? DEFAULT_LAGO_TIMEOUT_MS;
  }

  async sendUsageEvent(payload: LagoUsageEventPayload): Promise<void> {
    let response: Response;
    try {
      response = await this.fetchImpl(this.endpoint, {
        body: JSON.stringify(payload),
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        method: "POST",
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      throw new LagoForwardingError(
        `Lago usage event request failed: ${error instanceof Error ? error.message : String(error)}`,
        { retryable: true },
      );
    }

    if (response.ok) {
      return;
    }

    const body = await readErrorBody(response);
    if (
      isDuplicateLagoTransactionError({
        body,
        statusCode: response.status,
        transactionId: payload.event.transaction_id,
      })
    ) {
      return;
    }
    if (response.status === 422) {
      const confirmation = await this.confirmEventStored(payload);
      if (confirmation === "confirmed") {
        return;
      }
      const isPermanentValidation = isPermanentLagoEventValidationError({
        body,
        statusCode: response.status,
      });
      if (confirmation === "not_found" && isPermanentValidation) {
        throw new LagoForwardingError(
          `Lago usage event rejected with HTTP ${response.status}${body ? `: ${body}` : ""}`,
          { retryable: false, statusCode: response.status },
        );
      }
      if (confirmation === "unknown" || !isPermanentValidation) {
        throw new LagoForwardingError(
          `Lago usage event rejected with ambiguous HTTP 422${body ? `: ${body}` : ""}`,
          { retryable: true, statusCode: response.status },
        );
      }
    }
    const { retryable } = classifyLagoStatusCode(response.status);
    throw new LagoForwardingError(
      `Lago usage event rejected with HTTP ${response.status}${body ? `: ${body}` : ""}`,
      { retryable, statusCode: response.status },
    );
  }

  private async confirmEventStored(
    payload: LagoUsageEventPayload,
  ): Promise<LagoEventConfirmationResult> {
    let response: Response;
    try {
      response = await this.fetchImpl(
        `${this.eventsEndpoint}/${encodeURIComponent(payload.event.transaction_id)}`,
        {
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
          },
          method: "GET",
          signal: AbortSignal.timeout(this.timeoutMs),
        },
      );
    } catch {
      return "unknown";
    }

    if (response.status === 404) {
      return "not_found";
    }
    if (!response.ok) {
      return "unknown";
    }

    let parsed: unknown;
    try {
      parsed = await response.json();
    } catch {
      return "unknown";
    }
    if (!isRecord(parsed) || !isRecord(parsed.event)) {
      return "unknown";
    }

    const event = parsed.event;
    return event.transaction_id === payload.event.transaction_id &&
      event.external_subscription_id === payload.event.external_subscription_id
      ? "confirmed"
      : "unknown";
  }
}

export class DynamoBillingEventDeliveryLedger implements BillingEventDeliveryLedger {
  private readonly ddb: DynamoDBDocumentClient;
  private readonly tableName: string;

  constructor(input: { ddb: DynamoDBDocumentClient; tableName: string }) {
    this.ddb = input.ddb;
    this.tableName = input.tableName;
  }

  async get(eventId: string): Promise<BillingEventDeliveryRecord | undefined> {
    const response = await this.ddb.send(
      new GetCommand({
        ConsistentRead: true,
        Key: { eventId },
        TableName: this.tableName,
      }),
    );
    return response.Item as BillingEventDeliveryRecord | undefined;
  }

  async recordAttempt(input: DeliveryRecordInput): Promise<RecordAttemptResult> {
    try {
      await this.ddb.send(
        new UpdateCommand({
          ConditionExpression:
            "attribute_not_exists(#eventId) OR (#eventPayloadHash = :hash AND (attribute_not_exists(#status) OR (#status <> :accepted AND #status <> :failedPermanent)))",
          ExpressionAttributeNames: expressionNames(
            "#apiKeyHash",
            "#attempts",
            "#code",
            "#creditDelta",
            "#customerId",
            "#eventId",
            "#eventPayloadHash",
            "#externalSubscriptionId",
            "#firstAttemptAt",
            "#keyPrefix",
            "#lastAttemptAt",
            "#lastError",
            "#orgId",
            "#status",
            "#ttl",
            "#usageScope",
          ),
          ExpressionAttributeValues: {
            ...eventExpressionValues(input),
            ":accepted": "accepted",
            ":failedPermanent": "failed_permanent",
            ":processing": "processing",
            ":one": 1,
          },
          Key: { eventId: input.event.eventId },
          TableName: this.tableName,
          UpdateExpression: [
            [
              "SET #eventPayloadHash = :hash",
              "#status = :processing",
              "#customerId = :customerId",
              "#orgId = :orgId",
              "#apiKeyHash = :apiKeyHash",
              "#keyPrefix = :keyPrefix",
              "#externalSubscriptionId = :externalSubscriptionId",
              "#code = :code",
              "#creditDelta = :creditDelta",
              "#usageScope = :usageScope",
              "#firstAttemptAt = if_not_exists(#firstAttemptAt, :now)",
              "#lastAttemptAt = :now",
              "#ttl = if_not_exists(#ttl, :ttl)",
            ].join(", "),
            "ADD #attempts :one",
            "REMOVE #lastError",
          ].join(" "),
        }),
      );
      return "ok";
    } catch (error) {
      if (isConditionalCheckFailed(error)) {
        const existing = await this.get(input.event.eventId);
        if (existing?.eventPayloadHash !== input.eventPayloadHash) {
          return "hash_conflict";
        }
        if (existing.status === "accepted") {
          return "accepted_same_hash";
        }
        if (existing.status === "failed_permanent") {
          return "permanent_failure_same_hash";
        }
        return "ok";
      }
      throw error;
    }
  }

  async markAccepted(input: DeliveryRecordInput): Promise<MarkAcceptedResult> {
    try {
      await this.ddb.send(
        new UpdateCommand({
          ConditionExpression:
            "#eventPayloadHash = :hash AND (attribute_not_exists(#status) OR (#status <> :failedPermanent AND #status <> :invalid))",
          ExpressionAttributeNames: expressionNames(
            "#acceptedAt",
            "#apiKeyHash",
            "#code",
            "#creditDelta",
            "#customerId",
            "#eventPayloadHash",
            "#externalSubscriptionId",
            "#keyPrefix",
            "#lastAttemptAt",
            "#lastError",
            "#orgId",
            "#status",
            "#ttl",
            "#usageScope",
          ),
          ExpressionAttributeValues: {
            ...eventExpressionValues(input),
            ":accepted": "accepted",
            ":failedPermanent": "failed_permanent",
            ":invalid": "invalid",
          },
          Key: { eventId: input.event.eventId },
          TableName: this.tableName,
          UpdateExpression: [
            [
              "SET #eventPayloadHash = :hash",
              "#status = :accepted",
              "#customerId = :customerId",
              "#orgId = :orgId",
              "#apiKeyHash = :apiKeyHash",
              "#keyPrefix = :keyPrefix",
              "#externalSubscriptionId = :externalSubscriptionId",
              "#code = :code",
              "#creditDelta = :creditDelta",
              "#usageScope = :usageScope",
              "#lastAttemptAt = :now",
              "#acceptedAt = :now",
              "#ttl = if_not_exists(#ttl, :ttl)",
            ].join(", "),
            "REMOVE #lastError",
          ].join(" "),
        }),
      );
      return "ok";
    } catch (error) {
      if (isConditionalCheckFailed(error)) {
        const existing = await this.get(input.event.eventId);
        if (existing?.eventPayloadHash !== input.eventPayloadHash) {
          return "hash_conflict";
        }
        if (existing.status === "accepted") {
          return "accepted_same_hash";
        }
        if (existing.status === "failed_permanent" || existing.status === "invalid") {
          return "terminal_same_hash";
        }
      }
      throw error;
    }
  }

  async markFailure(input: DeliveryFailureInput): Promise<void> {
    try {
      await this.ddb.send(
        new UpdateCommand({
          ConditionExpression:
            "attribute_not_exists(#eventId) OR (#eventPayloadHash = :hash AND (attribute_not_exists(#status) OR (#status <> :accepted AND #status <> :failedPermanent)))",
          ExpressionAttributeNames: expressionNames(
            "#apiKeyHash",
            "#attempts",
            "#code",
            "#creditDelta",
            "#customerId",
            "#eventId",
            "#eventPayloadHash",
            "#externalSubscriptionId",
            "#firstAttemptAt",
            "#keyPrefix",
            "#lastAttemptAt",
            "#lastError",
            "#orgId",
            "#status",
            "#ttl",
            "#usageScope",
          ),
          ExpressionAttributeValues: {
            ...eventExpressionValues(input),
            ":accepted": "accepted",
            ":error": truncateError(input.error),
            ":attemptIncrement": input.countAttempt ? 1 : 0,
            ":failedPermanent": "failed_permanent",
            ":status": input.status,
            ":zero": 0,
          },
          Key: { eventId: input.event.eventId },
          TableName: this.tableName,
          UpdateExpression: [
            [
              "SET #eventPayloadHash = :hash",
              "#status = :status",
              "#customerId = :customerId",
              "#orgId = :orgId",
              "#apiKeyHash = :apiKeyHash",
              "#keyPrefix = :keyPrefix",
              "#externalSubscriptionId = :externalSubscriptionId",
              "#code = :code",
              "#creditDelta = :creditDelta",
              "#usageScope = :usageScope",
              "#firstAttemptAt = if_not_exists(#firstAttemptAt, :now)",
              "#lastAttemptAt = :now",
              "#lastError = :error",
              "#ttl = if_not_exists(#ttl, :ttl)",
              "#attempts = if_not_exists(#attempts, :zero) + :attemptIncrement",
            ].join(", "),
          ].join(" "),
        }),
      );
    } catch (error) {
      if (isConditionalCheckFailed(error)) {
        return;
      }
      throw error;
    }
  }
}

const DELIVERY_EXPRESSION_NAMES = {
  "#acceptedAt": "acceptedAt",
  "#apiKeyHash": "apiKeyHash",
  "#attempts": "attempts",
  "#code": "code",
  "#creditDelta": "creditDelta",
  "#customerId": "customerId",
  "#eventId": "eventId",
  "#eventPayloadHash": "eventPayloadHash",
  "#externalSubscriptionId": "externalSubscriptionId",
  "#firstAttemptAt": "firstAttemptAt",
  "#keyPrefix": "keyPrefix",
  "#lastAttemptAt": "lastAttemptAt",
  "#lastError": "lastError",
  "#orgId": "orgId",
  "#status": "status",
  "#ttl": "ttl",
  "#usageScope": "usageScope",
} as const;

function expressionNames(
  ...aliases: Array<keyof typeof DELIVERY_EXPRESSION_NAMES>
): Record<string, string> {
  return Object.fromEntries(aliases.map((alias) => [alias, DELIVERY_EXPRESSION_NAMES[alias]]));
}

function eventExpressionValues(input: DeliveryRecordInput): Record<string, string | number> {
  return {
    ":apiKeyHash": input.event.apiKeyHash,
    ":code": input.event.meterEventName,
    ":creditDelta": input.event.creditDelta,
    ":customerId": input.event.customerId,
    ":externalSubscriptionId": input.externalSubscriptionId,
    ":hash": input.eventPayloadHash,
    ":keyPrefix": input.event.keyPrefix,
    ":now": input.now.toISOString(),
    ":orgId": input.event.orgId,
    ":ttl": getDeliveryTtl(input.now),
    ":usageScope": input.event.usageScope,
  };
}

function isConditionalCheckFailed(error: unknown): boolean {
  return error instanceof Error && error.name === "ConditionalCheckFailedException";
}

function parseRecord(record: SQSRecord): BillingUsageEventV1 {
  let parsed: unknown;
  try {
    parsed = JSON.parse(record.body);
  } catch (error) {
    throw new RecordProcessingError(
      `billing event body is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (!isRecord(parsed)) {
    throw new RecordProcessingError("billing event body must be a JSON object");
  }

  const result = billingUsageEventV1Schema.safeParse(parsed);
  if (!result.success) {
    throw new RecordProcessingError(
      `billing event schema validation failed: ${result.error.message}`,
    );
  }
  return result.data;
}

async function processRecord(
  record: SQSRecord,
  dependencies: LagoEventForwarderDependencies,
): Promise<void> {
  const event = parseRecord(record);
  const eventPayloadHash = hashBillingEventPayload(event);
  const externalSubscriptionId = deriveLagoExternalSubscriptionId(event.customerId);
  const now = dependencies.now();
  const input = { event, eventPayloadHash, externalSubscriptionId, now };

  try {
    verifyBillingEventId(event);
  } catch (error) {
    await dependencies.ledger.markFailure({
      ...input,
      countAttempt: false,
      error: error instanceof Error ? error.message : String(error),
      status: "invalid",
    });
    throw error;
  }

  const existing = await dependencies.ledger.get(event.eventId);
  if (existing) {
    if (existing.eventPayloadHash !== eventPayloadHash) {
      throw new RecordProcessingError(
        "billing event id already exists with a different payload hash",
      );
    }
    if (existing.status === "accepted") {
      dependencies.logger.info("Skipping already accepted Lago billing event", {
        eventId: event.eventId,
      });
      return;
    }
    if (existing.status === "failed_permanent") {
      throw new RecordProcessingError("billing event has a prior permanent Lago delivery failure");
    }
  }

  const attemptResult = await dependencies.ledger.recordAttempt(input);
  if (attemptResult === "hash_conflict") {
    throw new RecordProcessingError(
      "billing event id already exists with a different payload hash",
    );
  }
  if (attemptResult === "accepted_same_hash") {
    dependencies.logger.info("Skipping concurrently accepted Lago billing event", {
      eventId: event.eventId,
    });
    return;
  }
  if (attemptResult === "permanent_failure_same_hash") {
    throw new RecordProcessingError("billing event has a prior permanent Lago delivery failure");
  }

  try {
    await dependencies.lagoClient.sendUsageEvent(buildLagoUsageEventPayload(event));
  } catch (error) {
    const retryable = error instanceof LagoForwardingError ? error.retryable : true;
    await dependencies.ledger.markFailure({
      ...input,
      countAttempt: false,
      error: error instanceof Error ? error.message : String(error),
      status: retryable ? "failed_retryable" : "failed_permanent",
    });
    throw error;
  }

  const acceptedResult = await dependencies.ledger.markAccepted(input);
  if (acceptedResult === "hash_conflict") {
    throw new RecordProcessingError(
      "billing event id already exists with a different payload hash",
    );
  }
  if (acceptedResult === "terminal_same_hash") {
    dependencies.logger.warn("Preserving terminal Lago billing event delivery state after send", {
      eventId: event.eventId,
    });
  }
}

export function createLagoEventForwarderService(
  overrides: Partial<LagoEventForwarderDependencies> = {},
): { handleSqsEvent: (event: SQSEvent) => Promise<SQSBatchResponse> } {
  function resolveDependencies(): LagoEventForwarderDependencies {
    return {
      lagoClient:
        overrides.lagoClient ??
        new HttpLagoUsageClient({
          apiKey: getRequiredEnv("LAGO_API_KEY"),
          baseUrl: getRequiredEnv("LAGO_API_URL"),
        }),
      ledger:
        overrides.ledger ??
        new DynamoBillingEventDeliveryLedger({
          ddb: getDefaultDdb(),
          tableName: getRequiredEnv("BILLING_EVENT_DELIVERIES_TABLE_NAME"),
        }),
      logger: overrides.logger ?? defaultLogger,
      now: overrides.now ?? (() => new Date()),
    };
  }

  async function handleSqsEvent(event: SQSEvent): Promise<SQSBatchResponse> {
    const dependencies = resolveDependencies();
    const batchItemFailures: SQSBatchResponse["batchItemFailures"] = [];

    for (const record of event.Records) {
      try {
        await processRecord(record, dependencies);
      } catch (error) {
        dependencies.logger.error("Lago billing event forwarding failed", {
          error: error instanceof Error ? error.message : String(error),
          messageId: record.messageId,
        });
        batchItemFailures.push({ itemIdentifier: record.messageId });
      }
    }

    return { batchItemFailures };
  }

  return { handleSqsEvent };
}

export const handler = wrapLambdaHandler({
  attributes: (event) => ({
    "prontiq.billing.operation": "lago_event_forwarder",
    "prontiq.billing.records": event.Records.length,
    "prontiq.stage": process.env.PRONTIQ_STAGE ?? "unknown",
  }),
  handler: (event: SQSEvent) => createLagoEventForwarderService().handleSqsEvent(event),
  serviceName: SERVICE_NAMES.billing,
  spanName: "prontiq-billing.lago-event-forwarder",
});
