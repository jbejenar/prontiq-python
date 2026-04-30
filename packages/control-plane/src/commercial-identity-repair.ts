import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand, ScanCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import {
  PLANS,
  createLogger,
  deriveLagoExternalSubscriptionIdForOrg,
  type ApiKeyRecord,
  type OrgEnvelopeRecord,
} from "@prontiq/shared";
import { HttpLagoProvisioningClient, type LagoProvisioningClient } from "./provisioning.js";

const logger = createLogger("control-plane-commercial-identity-repair");
const ORG_ID_INDEX = "orgId-index";
const FREE_TIER = "free" as const;

export interface CommercialIdentityRepairStats {
  dryRun: boolean;
  invalidOrgEnvelopes: Array<{
    apiKeyHash: string;
    orgId: string;
    reason: string;
  }>;
  lagoUpserted: number;
  orgsScanned: number;
  orgsSkippedInvalid: number;
  orgsUpdated: number;
  keysUpdated: number;
}

export interface CommercialIdentityRepairOptions {
  apply?: boolean;
  ddb?: DynamoDBDocumentClient;
  keysTableName: string;
  lagoClient?: LagoProvisioningClient;
  lagoPaymentProviderCode?: string;
}

function isOrgEnvelope(item: unknown): item is OrgEnvelopeRecord {
  if (typeof item !== "object" || item === null || Array.isArray(item)) return false;
  const candidate = item as Partial<OrgEnvelopeRecord>;
  return (
    typeof candidate.apiKeyHash === "string" &&
    candidate.apiKeyHash.startsWith("ORG#") &&
    typeof candidate.ownerEmail === "string"
  );
}

function orgIdFromEnvelope(envelope: OrgEnvelopeRecord): string {
  if (typeof envelope.orgId === "string" && envelope.orgId.length > 0) return envelope.orgId;
  return envelope.apiKeyHash.slice("ORG#".length);
}

function validateClerkOrgId(orgId: string): string | undefined {
  return /^org_[A-Za-z0-9]+$/.test(orgId) ? undefined : "orgId is not a Clerk organization id";
}

function isApiKeyRecord(item: unknown): item is ApiKeyRecord {
  if (typeof item !== "object" || item === null || Array.isArray(item)) return false;
  const candidate = item as Partial<ApiKeyRecord>;
  return (
    typeof candidate.apiKeyHash === "string" &&
    !candidate.apiKeyHash.startsWith("ORG#") &&
    typeof candidate.orgId === "string" &&
    typeof candidate.keyPrefix === "string"
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
      IndexName: ORG_ID_INDEX,
      KeyConditionExpression: "orgId = :orgId",
      ExpressionAttributeValues: { ":orgId": orgId },
    }),
  );
  return ((response.Items as unknown[] | undefined) ?? []).filter(isApiKeyRecord);
}

async function updateOrgEnvelope(
  ddb: DynamoDBDocumentClient,
  keysTableName: string,
  envelope: OrgEnvelopeRecord,
  orgId: string,
): Promise<void> {
  const plan = PLANS[FREE_TIER];
  if (!plan) throw new Error(`Plan ${FREE_TIER} is not configured`);
  await ddb.send(
    new UpdateCommand({
      TableName: keysTableName,
      Key: { apiKeyHash: envelope.apiKeyHash },
      UpdateExpression:
        "SET #orgId = :orgId, #lagoSubscriptionExternalId = :subscriptionId, #lagoPlanCode = if_not_exists(#lagoPlanCode, :planCode), #tier = if_not_exists(#tier, :tier), #products = if_not_exists(#products, :products)",
      ExpressionAttributeNames: {
        "#lagoPlanCode": "lagoPlanCode",
        "#lagoSubscriptionExternalId": "lagoSubscriptionExternalId",
        "#orgId": "orgId",
        "#products": "products",
        "#tier": "tier",
      },
      ExpressionAttributeValues: {
        ":orgId": orgId,
        ":planCode": FREE_TIER,
        ":products": plan.products,
        ":subscriptionId": deriveLagoExternalSubscriptionIdForOrg(orgId),
        ":tier": FREE_TIER,
      },
    }),
  );
}

async function updateApiKey(
  ddb: DynamoDBDocumentClient,
  keysTableName: string,
  key: ApiKeyRecord,
  orgId: string,
): Promise<void> {
  await ddb.send(
    new UpdateCommand({
      TableName: keysTableName,
      Key: { apiKeyHash: key.apiKeyHash },
      UpdateExpression: "SET #lagoSubscriptionExternalId = :subscriptionId",
      ExpressionAttributeNames: {
        "#lagoSubscriptionExternalId": "lagoSubscriptionExternalId",
      },
      ExpressionAttributeValues: {
        ":subscriptionId": deriveLagoExternalSubscriptionIdForOrg(orgId),
      },
    }),
  );
}

async function ensureLagoCommercialIdentity(input: {
  client: LagoProvisioningClient;
  email: string;
  orgId: string;
  paymentProviderCode: string;
  subscriptionId: string;
}): Promise<void> {
  await input.client.upsertCustomer({
    email: input.email,
    name: input.email,
    orgId: input.orgId,
    paymentProviderCode: input.paymentProviderCode,
  });
  const existing = await input.client.getSubscription(input.subscriptionId);
  if (!existing) {
    await input.client.upsertSubscription({
      externalCustomerId: input.orgId,
      externalSubscriptionId: input.subscriptionId,
      planCode: FREE_TIER,
    });
  }
}

export async function repairCommercialIdentity(
  options: CommercialIdentityRepairOptions,
): Promise<CommercialIdentityRepairStats> {
  const ddb = options.ddb ?? DynamoDBDocumentClient.from(new DynamoDBClient({}));
  const dryRun = options.apply !== true;
  const lagoClient = options.lagoClient;
  const lagoPaymentProviderCode = options.lagoPaymentProviderCode;
  if (!dryRun && !lagoClient) {
    throw new Error("lagoClient is required when apply=true");
  }
  if (!dryRun && !lagoPaymentProviderCode) {
    throw new Error("lagoPaymentProviderCode is required when apply=true");
  }
  const stats: CommercialIdentityRepairStats = {
    dryRun,
    invalidOrgEnvelopes: [],
    keysUpdated: 0,
    lagoUpserted: 0,
    orgsScanned: 0,
    orgsSkippedInvalid: 0,
    orgsUpdated: 0,
  };
  let ExclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const page = await ddb.send(
      new ScanCommand({
        TableName: options.keysTableName,
        ExclusiveStartKey,
        FilterExpression: "begins_with(#apiKeyHash, :prefix)",
        ExpressionAttributeNames: { "#apiKeyHash": "apiKeyHash" },
        ExpressionAttributeValues: { ":prefix": "ORG#" },
      }),
    );
    for (const item of (page.Items as unknown[] | undefined) ?? []) {
      if (!isOrgEnvelope(item)) continue;
      stats.orgsScanned += 1;
      const orgId = orgIdFromEnvelope(item);
      const invalidReason = validateClerkOrgId(orgId);
      if (invalidReason) {
        stats.orgsSkippedInvalid += 1;
        stats.invalidOrgEnvelopes.push({
          apiKeyHash: item.apiKeyHash,
          orgId,
          reason: invalidReason,
        });
        continue;
      }
      const subscriptionId = deriveLagoExternalSubscriptionIdForOrg(orgId);
      if (!dryRun && lagoClient && lagoPaymentProviderCode) {
        await ensureLagoCommercialIdentity({
          client: lagoClient,
          email: item.ownerEmail,
          orgId,
          paymentProviderCode: lagoPaymentProviderCode,
          subscriptionId,
        });
        stats.lagoUpserted += 1;
      }
      const needsEnvelopeUpdate =
        item.orgId !== orgId || item.lagoSubscriptionExternalId !== subscriptionId;
      if (needsEnvelopeUpdate) {
        stats.orgsUpdated += 1;
        if (!dryRun) await updateOrgEnvelope(ddb, options.keysTableName, item, orgId);
      }
      const keys = await loadOrgKeys(ddb, options.keysTableName, orgId);
      for (const key of keys) {
        if (key.lagoSubscriptionExternalId === subscriptionId) continue;
        stats.keysUpdated += 1;
        if (!dryRun) await updateApiKey(ddb, options.keysTableName, key, orgId);
      }
    }
    ExclusiveStartKey = page.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (ExclusiveStartKey);
  return stats;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const keysTableName = process.env.KEYS_TABLE_NAME;
  if (!keysTableName) throw new Error("KEYS_TABLE_NAME is required");
  const apply = process.argv.includes("--apply");
  const lagoClient = apply
    ? new HttpLagoProvisioningClient({
        apiKey: process.env.LAGO_API_KEY ?? "",
        baseUrl: process.env.LAGO_API_URL ?? "",
      })
    : undefined;
  const stats = await repairCommercialIdentity({
    apply,
    keysTableName,
    lagoClient,
    lagoPaymentProviderCode: process.env.LAGO_PAYMENT_PROVIDER_CODE,
  });
  logger.info("Commercial identity repair completed", stats);
}
