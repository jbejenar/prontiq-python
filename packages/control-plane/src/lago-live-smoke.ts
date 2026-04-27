#!/usr/bin/env node
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import { DynamoDBDocumentClient, GetCommand } from "@aws-sdk/lib-dynamodb";
import { fileURLToPath } from "node:url";
import {
  billingUsageEventV2Schema,
  deriveBillingUsageEventId,
  deriveLagoExternalSubscriptionIdForOrg,
  type ApiKeyRecord,
  type BillingUsageEventV2,
  type OrgEnvelopeRecord,
} from "@prontiq/shared";

const DEFAULT_PRODUCT = "address";
const DEFAULT_BILLING_ENDPOINT_KEY = "address.smoke";
const DEFAULT_CREDIT_DELTA = 1;
const DEFAULT_METER_EVENT_NAME = "prontiq_address_requests";
const DEFAULT_SOURCE_METHOD = "GET";
const DEFAULT_SOURCE_PATH = "/internal/lago-live-smoke";
const DEFAULT_SOURCE_REQUEST_ID = "manual-lago-smoke";

export interface LagoLiveSmokeInput {
  apiKeyHash: string;
  billingEndpointKey?: string;
  creditDelta?: number;
  key: ApiKeyRecord;
  occurredAt?: Date;
  org: OrgEnvelopeRecord;
  product?: string;
  requestCountAfterIncrement: number;
  sourceRequestId?: string;
  sourceMethod?: string;
  sourcePath?: string;
  stage: string;
  usageScope?: string;
}

export interface LagoLiveSmokeEnv {
  BILLING_ENDPOINT_KEY?: string;
  BILLING_EVENTS_QUEUE_URL?: string;
  CREDIT_DELTA?: string;
  KEYS_TABLE_NAME?: string;
  OCCURRED_AT?: string;
  PRODUCT?: string;
  REQUEST_COUNT_AFTER_INCREMENT?: string;
  SEND_TO_SQS?: string;
  SMOKE_API_KEY_HASH?: string;
  SOURCE_METHOD?: string;
  SOURCE_PATH?: string;
  SOURCE_REQUEST_ID?: string;
  STAGE?: string;
  USAGE_SCOPE?: string;
}

export interface LagoLiveSmokeConfig {
  billingEndpointKey: string;
  creditDelta: number;
  keysTableName: string;
  occurredAt: Date;
  product: string;
  queueUrl?: string;
  requestCountAfterIncrement: number;
  sendToSqs: boolean;
  smokeApiKeyHash: string;
  sourceMethod: string;
  sourcePath: string;
  sourceRequestId: string;
  stage: string;
  usageScope: string;
}

export interface LagoLiveSmokeEvidence {
  eventId: string;
  externalSubscriptionId: string;
  keyPrefix: string;
  meterEventName: string;
  orgId: string;
  sentToSqs: boolean;
  stage: string;
}

export interface LagoLiveSmokeLoadedState {
  key: ApiKeyRecord;
  org: OrgEnvelopeRecord;
}

export interface LagoLiveSmokeDependencies {
  loadSmokeState?: (config: LagoLiveSmokeConfig) => Promise<LagoLiveSmokeLoadedState>;
  sendSmokeEventToSqs?: (queueUrl: string, event: BillingUsageEventV2) => Promise<void>;
}

function requireEnv(env: LagoLiveSmokeEnv, name: keyof LagoLiveSmokeEnv): string {
  const value = env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function parsePositiveInteger(value: string, name: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

function parseDate(value: string | undefined): Date {
  if (!value) {
    return new Date();
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("OCCURRED_AT must be an ISO-8601 date/time");
  }
  return parsed;
}

function parseSendToSqs(value: string | undefined): boolean {
  if (!value) {
    return false;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "true") {
    return true;
  }
  if (normalized === "false" || normalized === "") {
    return false;
  }
  throw new Error("SEND_TO_SQS must be true or false");
}

function defaultUsageScope(product: string, occurredAt: Date): string {
  const year = occurredAt.getUTCFullYear();
  const month = String(occurredAt.getUTCMonth() + 1).padStart(2, "0");
  return `${product}#${year}-${month}`;
}

export function parseLagoLiveSmokeEnv(env: LagoLiveSmokeEnv): LagoLiveSmokeConfig {
  const occurredAt = parseDate(env.OCCURRED_AT);
  const product = env.PRODUCT?.trim() || DEFAULT_PRODUCT;
  return {
    billingEndpointKey: env.BILLING_ENDPOINT_KEY?.trim() || DEFAULT_BILLING_ENDPOINT_KEY,
    creditDelta: env.CREDIT_DELTA
      ? parsePositiveInteger(env.CREDIT_DELTA, "CREDIT_DELTA")
      : DEFAULT_CREDIT_DELTA,
    keysTableName: requireEnv(env, "KEYS_TABLE_NAME"),
    occurredAt,
    product,
    queueUrl: env.BILLING_EVENTS_QUEUE_URL?.trim() || undefined,
    requestCountAfterIncrement: parsePositiveInteger(
      requireEnv(env, "REQUEST_COUNT_AFTER_INCREMENT"),
      "REQUEST_COUNT_AFTER_INCREMENT",
    ),
    sendToSqs: parseSendToSqs(env.SEND_TO_SQS),
    smokeApiKeyHash: requireEnv(env, "SMOKE_API_KEY_HASH"),
    sourceMethod: env.SOURCE_METHOD?.trim() || DEFAULT_SOURCE_METHOD,
    sourcePath: env.SOURCE_PATH?.trim() || DEFAULT_SOURCE_PATH,
    sourceRequestId: env.SOURCE_REQUEST_ID?.trim() || DEFAULT_SOURCE_REQUEST_ID,
    stage: requireEnv(env, "STAGE"),
    usageScope: env.USAGE_SCOPE?.trim() || defaultUsageScope(product, occurredAt),
  };
}

function assertSmokeState(input: LagoLiveSmokeInput): void {
  if (input.key.apiKeyHash !== input.apiKeyHash) {
    throw new Error("loaded API key hash does not match SMOKE_API_KEY_HASH");
  }
  if (input.key.active !== true) {
    throw new Error("smoke API key is not active");
  }
  if (input.org.apiKeyHash !== `ORG#${input.key.orgId}`) {
    throw new Error("smoke org envelope does not match API key orgId");
  }
  if (input.org.orgId && input.org.orgId !== input.key.orgId) {
    throw new Error("smoke org envelope orgId does not match API key orgId");
  }
}

export function buildLagoLiveSmokeEvent(input: LagoLiveSmokeInput): BillingUsageEventV2 {
  assertSmokeState(input);
  const product = input.product ?? DEFAULT_PRODUCT;
  const billingEndpointKey = input.billingEndpointKey ?? DEFAULT_BILLING_ENDPOINT_KEY;
  const creditDelta = input.creditDelta ?? DEFAULT_CREDIT_DELTA;
  const occurredAt = input.occurredAt ?? new Date();
  const usageScope = input.usageScope ?? defaultUsageScope(product, occurredAt);
  const eventId = deriveBillingUsageEventId({
    apiKeyHash: input.key.apiKeyHash,
    billingEndpointKey,
    creditDelta,
    orgId: input.key.orgId,
    requestCountAfterIncrement: input.requestCountAfterIncrement,
    usageScope,
  });

  return billingUsageEventV2Schema.parse({
    version: 2,
    eventId,
    occurredAt: occurredAt.toISOString(),
    orgId: input.key.orgId,
    apiKeyHash: input.key.apiKeyHash,
    keyPrefix: input.key.keyPrefix,
    product,
    billingEndpointKey,
    meterEventName: DEFAULT_METER_EVENT_NAME,
    creditDelta,
    usageScope,
    requestCountAfterIncrement: input.requestCountAfterIncrement,
    source: {
      requestId: input.sourceRequestId ?? DEFAULT_SOURCE_REQUEST_ID,
      method: input.sourceMethod ?? DEFAULT_SOURCE_METHOD,
      path: input.sourcePath ?? DEFAULT_SOURCE_PATH,
      stage: input.stage,
    },
  });
}

export function buildLagoLiveSmokeEvidence(input: {
  event: BillingUsageEventV2;
  sentToSqs: boolean;
}): LagoLiveSmokeEvidence {
  return {
    eventId: input.event.eventId,
    externalSubscriptionId: deriveLagoExternalSubscriptionIdForOrg(input.event.orgId),
    keyPrefix: input.event.keyPrefix,
    meterEventName: input.event.meterEventName,
    orgId: input.event.orgId,
    sentToSqs: input.sentToSqs,
    stage: input.event.source.stage,
  };
}

async function loadSmokeState(
  ddb: DynamoDBDocumentClient,
  config: LagoLiveSmokeConfig,
): Promise<LagoLiveSmokeLoadedState> {
  const keyResponse = await ddb.send(
    new GetCommand({
      ConsistentRead: true,
      Key: { apiKeyHash: config.smokeApiKeyHash },
      TableName: config.keysTableName,
    }),
  );
  const key = keyResponse.Item as ApiKeyRecord | undefined;
  if (!key) {
    throw new Error("SMOKE_API_KEY_HASH was not found in KEYS_TABLE_NAME");
  }

  const orgResponse = await ddb.send(
    new GetCommand({
      ConsistentRead: true,
      Key: { apiKeyHash: `ORG#${key.orgId}` },
      TableName: config.keysTableName,
    }),
  );
  const org = orgResponse.Item as OrgEnvelopeRecord | undefined;
  if (!org) {
    throw new Error("smoke org envelope was not found in KEYS_TABLE_NAME");
  }
  return { key, org };
}

async function sendSmokeEventToSqs(queueUrl: string, event: BillingUsageEventV2): Promise<void> {
  await new SQSClient({}).send(
    new SendMessageCommand({
      QueueUrl: queueUrl,
      MessageBody: JSON.stringify(event),
    }),
  );
}

export async function runLagoLiveSmoke(
  env: LagoLiveSmokeEnv = process.env,
  dependencies: LagoLiveSmokeDependencies = {},
): Promise<{
  event: BillingUsageEventV2;
  evidence: LagoLiveSmokeEvidence;
}> {
  const config = parseLagoLiveSmokeEnv(env);
  if (config.sendToSqs && !config.queueUrl) {
    throw new Error("BILLING_EVENTS_QUEUE_URL is required when SEND_TO_SQS=true");
  }
  const { key, org } = dependencies.loadSmokeState
    ? await dependencies.loadSmokeState(config)
    : await loadSmokeState(DynamoDBDocumentClient.from(new DynamoDBClient({})), config);
  const event = buildLagoLiveSmokeEvent({
    apiKeyHash: config.smokeApiKeyHash,
    billingEndpointKey: config.billingEndpointKey,
    creditDelta: config.creditDelta,
    key,
    occurredAt: config.occurredAt,
    org,
    product: config.product,
    requestCountAfterIncrement: config.requestCountAfterIncrement,
    sourceMethod: config.sourceMethod,
    sourcePath: config.sourcePath,
    sourceRequestId: config.sourceRequestId,
    stage: config.stage,
    usageScope: config.usageScope,
  });
  if (config.sendToSqs && config.queueUrl) {
    const sender = dependencies.sendSmokeEventToSqs ?? sendSmokeEventToSqs;
    await sender(config.queueUrl, event);
  }
  const evidence = buildLagoLiveSmokeEvidence({ event, sentToSqs: config.sendToSqs });
  return { event, evidence };
}

async function main(): Promise<void> {
  const result = await runLagoLiveSmoke();
  console.log(JSON.stringify(result.evidence, null, 2));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
