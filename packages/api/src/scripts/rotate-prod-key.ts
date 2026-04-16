#!/usr/bin/env node
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  ScanCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { fileURLToPath } from "node:url";
import type { ApiKeyRecord, UsageCounterRecord } from "@prontiq/shared";
import { generateKey, hashKey } from "@prontiq/shared/keys";
import type { LegacyApiKeyRecord } from "./migrate-api-keys.js";
import { isLegacySeedKey } from "./migrate-api-keys.js";

const LEGACY_TABLE_NAME = process.env.LEGACY_API_KEY_TABLE_NAME ?? "ApiKeyTable";
const KEYS_TABLE_NAME = process.env.KEYS_TABLE_NAME ?? "prontiq-keys";
const USAGE_TABLE_NAME = process.env.USAGE_TABLE_NAME ?? "prontiq-usage";
const VERIFY_API = process.env.PRONTIQ_API ?? "https://api.prontiq.dev";
const VERIFY_PATH =
  process.env.PRONTIQ_ROTATE_VERIFY_PATH ?? "/v1/address/autocomplete?q=9+endeavour+cou&limit=1";
export interface RotationSourceState {
  keyRecord: ApiKeyRecord;
  legacyRecord: LegacyApiKeyRecord;
  oldApiKeyRaw: string;
  usageRecords: UsageCounterRecord[];
}

export interface RotationPlan {
  newApiKeyRaw: string;
  newKeyRecord: ApiKeyRecord;
  newLegacyRecord: LegacyApiKeyRecord;
  newUsageRecords: UsageCounterRecord[];
  oldApiKeyHash: string;
  oldApiKeyRaw: string;
}

function getClient(): DynamoDBDocumentClient {
  return DynamoDBDocumentClient.from(new DynamoDBClient({}));
}

function nowIso(): string {
  return new Date().toISOString();
}

function buildLegacyUsageFromRecords(
  legacyRecord: LegacyApiKeyRecord,
  usageRecords: UsageCounterRecord[],
): LegacyApiKeyRecord["usage"] {
  const usage = structuredClone(legacyRecord.usage ?? {});

  for (const usageRecord of usageRecords) {
    const [product, monthKey] = usageRecord.scope.split("#");
    if (!product || !monthKey) {
      continue;
    }

    usage[product] ??= {};
    usage[product][monthKey] = usageRecord.requestCount;
  }

  return usage;
}

export function buildRotationPlan(
  source: RotationSourceState,
  generated = generateKey(),
  rotatedAt: string = nowIso(),
): RotationPlan {
  const newUsageRecords = source.usageRecords.map((usageRecord) => ({
    ...usageRecord,
    apiKeyHash: generated.hash,
    closed: undefined,
  }));

  return {
    newApiKeyRaw: generated.raw,
    newKeyRecord: {
      ...source.keyRecord,
      active: true,
      apiKeyHash: generated.hash,
      createdAt: rotatedAt,
      keyPrefix: generated.prefix,
      lastUsedAt: null,
    },
    newLegacyRecord: {
      ...source.legacyRecord,
      active: true,
      apiKey: generated.raw,
      usage: buildLegacyUsageFromRecords(source.legacyRecord, source.usageRecords),
    },
    newUsageRecords,
    oldApiKeyHash: source.keyRecord.apiKeyHash,
    oldApiKeyRaw: source.oldApiKeyRaw,
  };
}

async function getActiveLegacySeedRecord(
  client: DynamoDBDocumentClient,
  oldApiKeyRaw?: string,
): Promise<LegacyApiKeyRecord> {
  if (oldApiKeyRaw) {
    const response = await client.send(
      new GetCommand({
        TableName: LEGACY_TABLE_NAME,
        Key: { apiKey: oldApiKeyRaw },
      }),
    );

    const record = response.Item as LegacyApiKeyRecord | undefined;
    if (!record || record.active !== true) {
      throw new Error("Specified OLD_API_KEY was not found as an active legacy key");
    }
    return record;
  }

  const response = await client.send(
    new ScanCommand({
      TableName: LEGACY_TABLE_NAME,
    }),
  );

  const candidates = ((response.Items as LegacyApiKeyRecord[] | undefined) ?? []).filter(
    (record) => record.active === true && typeof record.apiKey === "string" && isLegacySeedKey(record.apiKey),
  );

  if (candidates.length !== 1) {
    throw new Error(
      `Expected exactly one active legacy seed key, found ${candidates.length}; set OLD_API_KEY explicitly`,
    );
  }

  const [candidate] = candidates;
  if (!candidate) {
    throw new Error("Expected an active legacy seed candidate after length check");
  }
  return candidate;
}

async function loadRotationSourceState(
  client: DynamoDBDocumentClient,
  oldApiKeyRaw?: string,
): Promise<RotationSourceState> {
  const legacyRecord = await getActiveLegacySeedRecord(client, oldApiKeyRaw);
  const oldRaw = legacyRecord.apiKey;
  if (!oldRaw) {
    throw new Error("Legacy seed record is missing apiKey");
  }

  const oldHash = hashKey(oldRaw);
  const keyResponse = await client.send(
    new GetCommand({
      TableName: KEYS_TABLE_NAME,
      Key: { apiKeyHash: oldHash },
    }),
  );
  const keyRecord = keyResponse.Item as ApiKeyRecord | undefined;
  if (!keyRecord || keyRecord.active !== true) {
    throw new Error("Active hash-based key record for the legacy seed key was not found");
  }

  const usageResponse = await client.send(
    new ScanCommand({
      TableName: USAGE_TABLE_NAME,
      FilterExpression: "apiKeyHash = :hash",
      ExpressionAttributeValues: {
        ":hash": oldHash,
      },
    }),
  );
  const usageRecords = ((usageResponse.Items as UsageCounterRecord[] | undefined) ?? []).filter(
    (usageRecord) => usageRecord.scope !== "REDIRECT",
  );

  return {
    keyRecord,
    legacyRecord,
    oldApiKeyRaw: oldRaw,
    usageRecords,
  };
}

async function createNewRecords(
  client: DynamoDBDocumentClient,
  plan: RotationPlan,
): Promise<void> {
  await client.send(
    new PutCommand({
      TableName: LEGACY_TABLE_NAME,
      Item: plan.newLegacyRecord,
      ConditionExpression: "attribute_not_exists(apiKey)",
    }),
  );

  await client.send(
    new PutCommand({
      TableName: KEYS_TABLE_NAME,
      Item: plan.newKeyRecord,
      ConditionExpression: "attribute_not_exists(apiKeyHash)",
    }),
  );

  for (const usageRecord of plan.newUsageRecords) {
    await client.send(
      new PutCommand({
        TableName: USAGE_TABLE_NAME,
        Item: usageRecord,
        ConditionExpression: "attribute_not_exists(apiKeyHash) AND attribute_not_exists(#scope)",
        ExpressionAttributeNames: {
          "#scope": "scope",
        },
      }),
    );
  }
}

async function rollbackNewRecords(
  client: DynamoDBDocumentClient,
  plan: RotationPlan,
): Promise<void> {
  await client.send(
    new DeleteCommand({
      TableName: LEGACY_TABLE_NAME,
      Key: { apiKey: plan.newApiKeyRaw },
    }),
  );

  await client.send(
    new DeleteCommand({
      TableName: KEYS_TABLE_NAME,
      Key: { apiKeyHash: plan.newKeyRecord.apiKeyHash },
    }),
  );

  for (const usageRecord of plan.newUsageRecords) {
    await client.send(
      new DeleteCommand({
        TableName: USAGE_TABLE_NAME,
        Key: {
          apiKeyHash: usageRecord.apiKeyHash,
          scope: usageRecord.scope,
        },
      }),
    );
  }
}

export async function verifyReplacementKey(
  apiBase: string,
  rawKey: string,
  verifyPath: string,
): Promise<void> {
  const response = await fetch(new URL(verifyPath, apiBase), {
    headers: {
      "X-Api-Key": rawKey,
    },
  });

  if (!response.ok) {
    throw new Error(`Replacement key verification failed with HTTP ${response.status}`);
  }
}

async function revokeOldKey(
  client: DynamoDBDocumentClient,
  source: RotationSourceState,
): Promise<void> {
  await client.send(
    new UpdateCommand({
      TableName: LEGACY_TABLE_NAME,
      Key: { apiKey: source.oldApiKeyRaw },
      UpdateExpression: "SET #active = :inactive",
      ExpressionAttributeNames: {
        "#active": "active",
      },
      ExpressionAttributeValues: {
        ":inactive": false,
      },
    }),
  );

  await client.send(
    new UpdateCommand({
      TableName: KEYS_TABLE_NAME,
      Key: { apiKeyHash: source.keyRecord.apiKeyHash },
      UpdateExpression: "SET #active = :inactive",
      ExpressionAttributeNames: {
        "#active": "active",
      },
      ExpressionAttributeValues: {
        ":inactive": false,
      },
    }),
  );

  for (const usageRecord of source.usageRecords) {
    await client.send(
      new UpdateCommand({
        TableName: USAGE_TABLE_NAME,
        Key: {
          apiKeyHash: usageRecord.apiKeyHash,
          scope: usageRecord.scope,
        },
        UpdateExpression: "SET #closed = :closed",
        ExpressionAttributeNames: {
          "#closed": "closed",
        },
        ExpressionAttributeValues: {
          ":closed": true,
        },
      }),
    );
  }
}

export async function rotateProdKey(
  client: DynamoDBDocumentClient,
  options?: {
    oldApiKeyRaw?: string;
    verifyApi?: string;
    verifyPath?: string;
  },
): Promise<RotationPlan> {
  const source = await loadRotationSourceState(client, options?.oldApiKeyRaw);
  const plan = buildRotationPlan(source);

  await createNewRecords(client, plan);

  try {
    await verifyReplacementKey(
      options?.verifyApi ?? VERIFY_API,
      plan.newApiKeyRaw,
      options?.verifyPath ?? VERIFY_PATH,
    );
  } catch (error) {
    await rollbackNewRecords(client, plan);
    throw error;
  }

  await revokeOldKey(client, source);
  return plan;
}

async function main(): Promise<void> {
  const client = getClient();
  const plan = await rotateProdKey(client, {
    oldApiKeyRaw: process.env.OLD_API_KEY,
  });

  console.log(
    JSON.stringify(
      {
        keysTable: KEYS_TABLE_NAME,
        legacyTable: LEGACY_TABLE_NAME,
        newApiKey: plan.newApiKeyRaw,
        newApiKeyHash: plan.newKeyRecord.apiKeyHash,
        oldApiKey: plan.oldApiKeyRaw,
        oldApiKeyHash: plan.oldApiKeyHash,
        usageRowsCopied: plan.newUsageRecords.length,
        usageTable: USAGE_TABLE_NAME,
        verifyApi: VERIFY_API,
        verifyPath: VERIFY_PATH,
      },
      null,
      2,
    ),
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  void main();
}
