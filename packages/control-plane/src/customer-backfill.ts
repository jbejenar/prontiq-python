#!/usr/bin/env node
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  ScanCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import type { ApiKeyRecord, CustomerRecord, OrgEnvelopeRecord } from "@prontiq/shared";
import { generateCustomerId } from "./customer-identity.js";

export interface CustomerBackfillStats {
  activeCustomers: number;
  apiKeysUpdated: number;
  conflicts: number;
  dryRun: boolean;
  envelopesScanned: number;
  invalidEnvelopesSkipped: number;
  orgEnvelopesUpdated: number;
  skipped: number;
}

export interface CustomerBackfillOptions {
  apply?: boolean;
  now?: Date;
}

const ORG_ID_INDEX = "orgId-index";

type BackfillOrgEnvelope = Omit<OrgEnvelopeRecord, "stripeCustomerId"> & {
  stripeCustomerId?: string | null;
};

interface ConflictCustomerInput {
  customerId: string;
  orgId: string;
  ownerEmail: string;
  stripeCustomerId: string | null;
}

function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function isOrgEnvelope(item: unknown): item is BackfillOrgEnvelope {
  if (!item || typeof item !== "object") return false;
  const candidate = item as Partial<BackfillOrgEnvelope>;
  return (
    typeof candidate.apiKeyHash === "string" &&
    candidate.apiKeyHash.startsWith("ORG#") &&
    typeof candidate.ownerEmail === "string" &&
    candidate.ownerEmail.length > 0 &&
    (candidate.stripeCustomerId == null || typeof candidate.stripeCustomerId === "string")
  );
}

function isMalformedOrgEnvelope(item: unknown): boolean {
  if (!item || typeof item !== "object") return false;
  const candidate = item as Partial<BackfillOrgEnvelope>;
  if (typeof candidate.apiKeyHash !== "string" || !candidate.apiKeyHash.startsWith("ORG#")) {
    return false;
  }
  return (
    typeof candidate.ownerEmail !== "string" ||
    candidate.ownerEmail.length === 0 ||
    (candidate.stripeCustomerId != null && typeof candidate.stripeCustomerId !== "string")
  );
}

function isApiKeyRecord(item: unknown): item is ApiKeyRecord {
  if (!item || typeof item !== "object") return false;
  const candidate = item as Partial<ApiKeyRecord>;
  return (
    typeof candidate.apiKeyHash === "string" &&
    !candidate.apiKeyHash.startsWith("ORG#") &&
    typeof candidate.keyPrefix === "string" &&
    typeof candidate.orgId === "string"
  );
}

function isCustomerRecord(item: unknown): item is CustomerRecord {
  if (!item || typeof item !== "object") return false;
  const candidate = item as Partial<CustomerRecord>;
  return (
    typeof candidate.orgId === "string" &&
    typeof candidate.customerId === "string" &&
    typeof candidate.ownerEmail === "string" &&
    (candidate.stripeCustomerId === null || typeof candidate.stripeCustomerId === "string")
  );
}

function orgIdFromEnvelope(envelope: BackfillOrgEnvelope): string {
  return envelope.apiKeyHash.slice("ORG#".length);
}

function stripeCustomerIdFromEnvelope(envelope: BackfillOrgEnvelope): string | null {
  return typeof envelope.stripeCustomerId === "string" && envelope.stripeCustomerId.length > 0
    ? envelope.stripeCustomerId
    : null;
}

async function scanOrgEnvelopes(
  ddb: DynamoDBDocumentClient,
  keysTableName: string,
): Promise<{ envelopes: BackfillOrgEnvelope[]; invalidEnvelopesSkipped: number }> {
  const envelopes: BackfillOrgEnvelope[] = [];
  let invalidEnvelopesSkipped = 0;
  let ExclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const response = await ddb.send(
      new ScanCommand({
        TableName: keysTableName,
        ExclusiveStartKey,
      }),
    );
    for (const item of response.Items ?? []) {
      if (isOrgEnvelope(item)) {
        envelopes.push(item);
      } else if (isMalformedOrgEnvelope(item)) {
        invalidEnvelopesSkipped += 1;
      }
    }
    ExclusiveStartKey = response.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return { envelopes, invalidEnvelopesSkipped };
}

async function scanExistingCustomers(
  ddb: DynamoDBDocumentClient,
  customersTableName: string,
): Promise<CustomerRecord[]> {
  const customers: CustomerRecord[] = [];
  let ExclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const response = await ddb.send(
      new ScanCommand({
        TableName: customersTableName,
        ExclusiveStartKey,
      }),
    );
    customers.push(...(response.Items ?? []).filter(isCustomerRecord));
    ExclusiveStartKey = response.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return customers;
}

async function loadApiKeysForOrg(
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
  return (response.Items ?? []).filter(isApiKeyRecord);
}

async function loadCustomer(
  ddb: DynamoDBDocumentClient,
  customersTableName: string,
  orgId: string,
): Promise<CustomerRecord | undefined> {
  const response = await ddb.send(new GetCommand({ TableName: customersTableName, Key: { orgId } }));
  return response.Item as CustomerRecord | undefined;
}

async function writeConflictCustomerRecord(
  ddb: DynamoDBDocumentClient,
  customersTableName: string,
  customer: ConflictCustomerInput,
  reason: string,
  now: string,
): Promise<void> {
  await ddb.send(
    new UpdateCommand({
      TableName: customersTableName,
      Key: { orgId: customer.orgId },
      UpdateExpression:
        "SET #customerId = if_not_exists(#customerId, :customerId), #lagoExternalCustomerId = if_not_exists(#lagoExternalCustomerId, :customerId), #lagoCustomerId = if_not_exists(#lagoCustomerId, :null), #stripeCustomerId = if_not_exists(#stripeCustomerId, :stripeCustomerId), #ownerEmail = if_not_exists(#ownerEmail, :ownerEmail), #status = :status, #conflictReason = :reason, #updatedAt = :updatedAt, #createdAt = if_not_exists(#createdAt, :createdAt), #backfilledAt = if_not_exists(#backfilledAt, :backfilledAt)",
      ExpressionAttributeNames: {
        "#backfilledAt": "backfilledAt",
        "#conflictReason": "conflictReason",
        "#createdAt": "createdAt",
        "#customerId": "customerId",
        "#lagoCustomerId": "lagoCustomerId",
        "#lagoExternalCustomerId": "lagoExternalCustomerId",
        "#ownerEmail": "ownerEmail",
        "#status": "status",
        "#stripeCustomerId": "stripeCustomerId",
        "#updatedAt": "updatedAt",
      },
      ExpressionAttributeValues: {
        ":backfilledAt": now,
        ":createdAt": now,
        ":customerId": customer.customerId,
        ":null": null,
        ":ownerEmail": customer.ownerEmail,
        ":reason": reason,
        ":status": "migration_conflict",
        ":stripeCustomerId": customer.stripeCustomerId,
        ":updatedAt": now,
      },
    }),
  );
}

async function writeConflictCustomer(
  ddb: DynamoDBDocumentClient,
  customersTableName: string,
  envelope: BackfillOrgEnvelope,
  reason: string,
  now: string,
  preferredCustomerId?: string,
): Promise<void> {
  await writeConflictCustomerRecord(
    ddb,
    customersTableName,
    {
      orgId: orgIdFromEnvelope(envelope),
      customerId: preferredCustomerId ?? envelope.customerId ?? generateCustomerId(new Date(now)),
      ownerEmail: envelope.ownerEmail,
      stripeCustomerId: stripeCustomerIdFromEnvelope(envelope),
    },
    reason,
    now,
  );
}

function isConditionalCheckFailed(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "ConditionalCheckFailedException" ||
      error.message.includes("ConditionalCheckFailedException"))
  );
}

async function upsertActiveCustomer(
  ddb: DynamoDBDocumentClient,
  customersTableName: string,
  envelope: BackfillOrgEnvelope,
  customerId: string,
  now: string,
): Promise<string> {
  const orgId = orgIdFromEnvelope(envelope);
  try {
    await ddb.send(
      new PutCommand({
        TableName: customersTableName,
        Item: {
          orgId,
          customerId,
          lagoExternalCustomerId: customerId,
          lagoCustomerId: null,
          stripeCustomerId: stripeCustomerIdFromEnvelope(envelope),
          ownerEmail: envelope.ownerEmail,
          status: "active",
          createdAt: now,
          updatedAt: now,
          backfilledAt: now,
        } satisfies CustomerRecord,
        ConditionExpression: "attribute_not_exists(orgId)",
      }),
    );
    return customerId;
  } catch (error) {
    if (!isConditionalCheckFailed(error)) throw error;
    const existingCustomer = await loadCustomer(ddb, customersTableName, orgId);
    if (!existingCustomer) throw error;
    return existingCustomer.customerId;
  }
}

async function denormalizeCustomerId(
  ddb: DynamoDBDocumentClient,
  keysTableName: string,
  apiKeyHash: string,
  customerId: string,
): Promise<void> {
  await ddb.send(
    new UpdateCommand({
      TableName: keysTableName,
      Key: { apiKeyHash },
      UpdateExpression: "SET #customerId = :customerId",
      ExpressionAttributeNames: { "#customerId": "customerId" },
      ExpressionAttributeValues: { ":customerId": customerId },
    }),
  );
}

function findDuplicateStripeOrgIds(
  envelopes: BackfillOrgEnvelope[],
  existingCustomers: CustomerRecord[],
): Set<string> {
  const linksByStripeCustomerId = new Map<
    string,
    { customerIds: Set<string>; orgIds: Set<string> }
  >();

  for (const customer of existingCustomers) {
    if (!customer.stripeCustomerId) continue;
    const links = linksByStripeCustomerId.get(customer.stripeCustomerId) ?? {
      customerIds: new Set<string>(),
      orgIds: new Set<string>(),
    };
    links.orgIds.add(customer.orgId);
    links.customerIds.add(customer.customerId);
    linksByStripeCustomerId.set(customer.stripeCustomerId, links);
  }

  for (const envelope of envelopes) {
    const stripeCustomerId = stripeCustomerIdFromEnvelope(envelope);
    if (!stripeCustomerId) continue;
    const links = linksByStripeCustomerId.get(stripeCustomerId) ?? {
      customerIds: new Set<string>(),
      orgIds: new Set<string>(),
    };
    links.orgIds.add(orgIdFromEnvelope(envelope));
    if (envelope.customerId) links.customerIds.add(envelope.customerId);
    linksByStripeCustomerId.set(stripeCustomerId, links);
  }

  const duplicateOrgIds = new Set<string>();
  for (const [stripeCustomerId, links] of linksByStripeCustomerId) {
    if (links.orgIds.size <= 1 && links.customerIds.size <= 1) continue;
    for (const customer of existingCustomers) {
      if (customer.stripeCustomerId === stripeCustomerId) duplicateOrgIds.add(customer.orgId);
    }
    for (const envelope of envelopes) {
      if (stripeCustomerIdFromEnvelope(envelope) === stripeCustomerId) {
        duplicateOrgIds.add(orgIdFromEnvelope(envelope));
      }
    }
  }
  return duplicateOrgIds;
}

export async function backfillCustomers(
  ddb: DynamoDBDocumentClient,
  keysTableName: string,
  customersTableName: string,
  options: CustomerBackfillOptions = {},
): Promise<CustomerBackfillStats> {
  const dryRun = options.apply !== true;
  const now = (options.now ?? new Date()).toISOString();
  const stats: CustomerBackfillStats = {
    activeCustomers: 0,
    apiKeysUpdated: 0,
    conflicts: 0,
    dryRun,
    envelopesScanned: 0,
    invalidEnvelopesSkipped: 0,
    orgEnvelopesUpdated: 0,
    skipped: 0,
  };
  const scanned = await scanOrgEnvelopes(ddb, keysTableName);
  const envelopes = scanned.envelopes;
  stats.invalidEnvelopesSkipped = scanned.invalidEnvelopesSkipped;
  const existingCustomers = await scanExistingCustomers(ddb, customersTableName);
  const duplicateStripeOrgIds = findDuplicateStripeOrgIds(envelopes, existingCustomers);
  const envelopeOrgIds = new Set(envelopes.map(orgIdFromEnvelope));
  for (const customer of existingCustomers) {
    if (!duplicateStripeOrgIds.has(customer.orgId) || envelopeOrgIds.has(customer.orgId)) continue;
    stats.conflicts += 1;
    if (!dryRun) {
      await writeConflictCustomerRecord(
        ddb,
        customersTableName,
        {
          orgId: customer.orgId,
          customerId: customer.customerId,
          ownerEmail: customer.ownerEmail,
          stripeCustomerId: customer.stripeCustomerId,
        },
        "duplicate_stripe_customer_id",
        now,
      );
    }
  }

  for (const envelope of envelopes) {
    stats.envelopesScanned += 1;
    const orgId = orgIdFromEnvelope(envelope);
    const existingCustomer = await loadCustomer(ddb, customersTableName, orgId);
    let customerId = existingCustomer?.customerId ?? envelope.customerId ?? generateCustomerId(new Date(now));
    const apiKeys = await loadApiKeysForOrg(ddb, keysTableName, orgId);
    const mismatchedApiKeys = apiKeys.filter(
      (key) => key.customerId && key.customerId !== customerId,
    );
    const duplicateStripe = duplicateStripeOrgIds.has(orgId);
    const conflictReason = duplicateStripe
      ? "duplicate_stripe_customer_id"
      : existingCustomer?.customerId && envelope.customerId && existingCustomer.customerId !== envelope.customerId
        ? "customer_id_mismatch"
        : mismatchedApiKeys.length > 0
          ? "api_key_customer_id_mismatch"
          : null;

    if (conflictReason) {
      stats.conflicts += Math.max(1, mismatchedApiKeys.length);
      if (!dryRun) await writeConflictCustomer(ddb, customersTableName, envelope, conflictReason, now, customerId);
      continue;
    }

    if (!existingCustomer) {
      stats.activeCustomers += 1;
      if (!dryRun) {
        customerId = await upsertActiveCustomer(ddb, customersTableName, envelope, customerId, now);
      }
    }
    if (envelope.customerId !== customerId) {
      stats.orgEnvelopesUpdated += 1;
      if (!dryRun) await denormalizeCustomerId(ddb, keysTableName, envelope.apiKeyHash, customerId);
    }
    for (const key of apiKeys) {
      if (key.customerId === customerId) continue;
      stats.apiKeysUpdated += 1;
      if (!dryRun) await denormalizeCustomerId(ddb, keysTableName, key.apiKeyHash, customerId);
    }
    if (existingCustomer && envelope.customerId === customerId && apiKeys.every((key) => key.customerId === customerId)) {
      stats.skipped += 1;
    }
  }
  return stats;
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));
  const stats = await backfillCustomers(
    client,
    getRequiredEnv("KEYS_TABLE_NAME"),
    getRequiredEnv("CUSTOMERS_TABLE_NAME"),
    { apply },
  );
  console.log(JSON.stringify(stats, null, 2));
  if (!apply) console.log("Dry run only. Re-run with --apply to write changes.");
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1])) {
  await main();
}
