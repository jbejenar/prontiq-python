import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import {
  PLANS,
  QUOTA_EMAIL_PENDING_LEASE_MINUTES,
  QUOTA_WARNING_THRESHOLD_FRACTION,
  createLogger,
  type OrgEnvelopeRecord,
  type QuotaEmailTask,
  type UsageCounterRecord,
  getBillingEndpointsForProduct,
} from "@prontiq/shared";
import { isSuppressedEmail, sendSignedSesEmail } from "./email.js";

type Logger = Pick<Console, "error" | "warn" | "info">;

export interface QuotaEmailDependencies {
  ddb: DynamoDBDocumentClient;
  keysTableName: string;
  logger: Logger;
  sendQuotaEmail: QuotaEmailSender;
  suppressionsTableName: string;
  usageTableName: string;
}

export interface QuotaEmailInput {
  envelope: OrgEnvelopeRecord;
  task: QuotaEmailTask;
}

export type QuotaEmailSender = (input: QuotaEmailInput) => Promise<boolean>;

type ThresholdField = {
  pendingAt: "warningEmailPendingAt" | "limitEmailPendingAt";
  sent: "warningEmailSent" | "limitEmailSent";
};

let cachedDdb: DynamoDBDocumentClient | undefined;
const defaultLogger = createLogger("control-plane-quota-email");

function getDefaultDdb(): DynamoDBDocumentClient {
  if (!cachedDdb) {
    cachedDdb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
  }
  return cachedDdb;
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

function getThresholdFields(threshold: QuotaEmailTask["threshold"]): ThresholdField {
  return threshold === "warning"
    ? {
        pendingAt: "warningEmailPendingAt",
        sent: "warningEmailSent",
      }
    : {
        pendingAt: "limitEmailPendingAt",
        sent: "limitEmailSent",
      };
}

function getWarningThreshold(limit: number): number {
  return Math.ceil(limit * QUOTA_WARNING_THRESHOLD_FRACTION);
}

function getFamilyDisplayName(product: string): string {
  return getBillingEndpointsForProduct(product)[0]?.familyDisplayName ?? product;
}

function getEnvelopeKey(orgId: string): string {
  return `ORG#${orgId}`;
}

function getLeaseCutoff(now: Date): string {
  const cutoff = new Date(now.getTime() - QUOTA_EMAIL_PENDING_LEASE_MINUTES * 60 * 1000);
  return cutoff.toISOString();
}

function buildQuotaEmailSubject(task: QuotaEmailTask, tier: OrgEnvelopeRecord["tier"]): string {
  if (task.threshold === "warning") {
    return `${getFamilyDisplayName(task.product)} credits are nearing the limit`;
  }
  if (tier === "free") {
    return `${getFamilyDisplayName(task.product)} credits are exhausted`;
  }
  return `${getFamilyDisplayName(task.product)} included credits are exhausted`;
}

function buildQuotaEmailBody(task: QuotaEmailTask, envelope: OrgEnvelopeRecord): string {
  const familyDisplayName = getFamilyDisplayName(task.product);
  const billingUrl = getOptionalEnv("PRONTIQ_BILLING_URL", "https://prontiq.dev/account");
  const docsUrl = getOptionalEnv("PRONTIQ_DOCS_URL", "https://docs.prontiq.dev");
  const plan = PLANS[envelope.tier];
  const includedCredits = plan.quotaPerProduct;

  if (task.threshold === "warning") {
    return [
      `${familyDisplayName} has crossed 80% of its included monthly credits.`,
      "",
      includedCredits == null
        ? "Your current plan does not have a fixed included-credit limit."
        : `Included monthly credits for this family: ${includedCredits.toLocaleString()}.`,
      "",
      `Review usage or upgrade at ${billingUrl}`,
      `Credits guide: ${docsUrl}/guides/credits`,
      "",
    ].join("\n");
  }

  if (envelope.tier === "free") {
    return [
      `${familyDisplayName} has exhausted the free monthly credits for this cycle.`,
      "",
      includedCredits == null
        ? "No included-credit limit is configured for this plan."
        : `Included monthly credits for this family: ${includedCredits.toLocaleString()}.`,
      "",
      `Upgrade at ${billingUrl} or wait until the monthly reset.`,
      `Credits guide: ${docsUrl}/guides/credits`,
      "",
    ].join("\n");
  }

  return [
    `${familyDisplayName} has exhausted its included monthly credits and overage is now accruing.`,
    "",
    includedCredits == null
      ? "No included-credit limit is configured for this plan."
      : `Included monthly credits for this family: ${includedCredits.toLocaleString()}.`,
    "",
    `Review billing at ${billingUrl}`,
    `Credits guide: ${docsUrl}/guides/credits`,
    "",
  ].join("\n");
}

async function loadUsageRow(
  ddb: DynamoDBDocumentClient,
  usageTableName: string,
  task: QuotaEmailTask,
): Promise<UsageCounterRecord | undefined> {
  const response = await ddb.send(
    new GetCommand({
      TableName: usageTableName,
      Key: {
        apiKeyHash: task.apiKeyHash,
        scope: task.scope,
      },
    }),
  );
  return response.Item as UsageCounterRecord | undefined;
}

async function loadEnvelope(
  ddb: DynamoDBDocumentClient,
  keysTableName: string,
  orgId: string,
): Promise<OrgEnvelopeRecord | undefined> {
  const response = await ddb.send(
    new GetCommand({
      TableName: keysTableName,
      Key: {
        apiKeyHash: getEnvelopeKey(orgId),
      },
      ConsistentRead: true,
    }),
  );
  return response.Item as OrgEnvelopeRecord | undefined;
}

async function claimQuotaEmail(
  ddb: DynamoDBDocumentClient,
  usageTableName: string,
  task: QuotaEmailTask,
  fields: ThresholdField,
  claimedAt: string,
  reclaimBefore: string,
): Promise<boolean> {
  try {
    await ddb.send(
      new UpdateCommand({
        TableName: usageTableName,
        Key: {
          apiKeyHash: task.apiKeyHash,
          scope: task.scope,
        },
        ConditionExpression: [
          "(attribute_not_exists(#sent) OR #sent = :false)",
          "AND",
          "(attribute_not_exists(#pendingAt) OR #pendingAt < :reclaimBefore)",
        ].join(" "),
        UpdateExpression: "SET #pendingAt = :claimedAt",
        ExpressionAttributeNames: {
          "#pendingAt": fields.pendingAt,
          "#sent": fields.sent,
        },
        ExpressionAttributeValues: {
          ":claimedAt": claimedAt,
          ":false": false,
          ":reclaimBefore": reclaimBefore,
        },
      }),
    );
    return true;
  } catch (error) {
    if (
      error instanceof Error &&
      "name" in error &&
      error.name === "ConditionalCheckFailedException"
    ) {
      return false;
    }
    throw error;
  }
}

async function finalizeQuotaEmail(
  ddb: DynamoDBDocumentClient,
  usageTableName: string,
  task: QuotaEmailTask,
  fields: ThresholdField,
  claimedAt: string,
): Promise<void> {
  await ddb.send(
    new UpdateCommand({
      TableName: usageTableName,
      Key: {
        apiKeyHash: task.apiKeyHash,
        scope: task.scope,
      },
      ConditionExpression: "#pendingAt = :claimedAt",
      UpdateExpression: "SET #sent = :true REMOVE #pendingAt",
      ExpressionAttributeNames: {
        "#pendingAt": fields.pendingAt,
        "#sent": fields.sent,
      },
      ExpressionAttributeValues: {
        ":claimedAt": claimedAt,
        ":true": true,
      },
    }),
  );
}

async function releaseQuotaEmailClaim(
  ddb: DynamoDBDocumentClient,
  usageTableName: string,
  task: QuotaEmailTask,
  fields: ThresholdField,
  claimedAt: string,
): Promise<void> {
  await ddb.send(
    new UpdateCommand({
      TableName: usageTableName,
      Key: {
        apiKeyHash: task.apiKeyHash,
        scope: task.scope,
      },
      ConditionExpression: "#pendingAt = :claimedAt",
      UpdateExpression: "REMOVE #pendingAt",
      ExpressionAttributeNames: {
        "#pendingAt": fields.pendingAt,
      },
      ExpressionAttributeValues: {
        ":claimedAt": claimedAt,
      },
    }),
  );
}

function thresholdStillEligible(
  usageRow: UsageCounterRecord,
  threshold: QuotaEmailTask["threshold"],
  quotaPerProduct: number,
): boolean {
  if (threshold === "warning") {
    return usageRow.requestCount >= getWarningThreshold(quotaPerProduct);
  }
  return usageRow.requestCount >= quotaPerProduct;
}

async function sendQuotaEmailDefault(
  envelope: OrgEnvelopeRecord,
  task: QuotaEmailTask,
): Promise<boolean> {
  const emailFrom = process.env.WELCOME_EMAIL_FROM;
  if (typeof emailFrom !== "string" || emailFrom.length === 0 || envelope.ownerEmail.length === 0) {
    return false;
  }
  return sendSignedSesEmail({
    bodyText: buildQuotaEmailBody(task, envelope),
    configurationSetName: process.env.SES_CONFIGURATION_SET_NAME,
    fromEmail: emailFrom,
    region: getOptionalEnv("AWS_REGION", "ap-southeast-2"),
    subject: buildQuotaEmailSubject(task, envelope.tier),
    toEmail: envelope.ownerEmail,
  });
}

export function createQuotaEmailService(
  overrides: Partial<QuotaEmailDependencies> = {},
): { processTask: (task: QuotaEmailTask) => Promise<void> } {
  const logger = overrides.logger ?? defaultLogger;
  const dependencies: QuotaEmailDependencies = {
    ddb: overrides.ddb ?? getDefaultDdb(),
    keysTableName: overrides.keysTableName ?? getRequiredEnv("KEYS_TABLE_NAME"),
    logger,
    sendQuotaEmail:
      overrides.sendQuotaEmail ??
      (async (input) => sendQuotaEmailDefault(input.envelope, input.task)),
    suppressionsTableName:
      overrides.suppressionsTableName ?? getRequiredEnv("SUPPRESSIONS_TABLE_NAME"),
    usageTableName: overrides.usageTableName ?? getRequiredEnv("USAGE_TABLE_NAME"),
  };

  async function processTask(task: QuotaEmailTask): Promise<void> {
    const usageRow = await loadUsageRow(dependencies.ddb, dependencies.usageTableName, task);
    if (!usageRow) {
      return;
    }

    const envelope = await loadEnvelope(dependencies.ddb, dependencies.keysTableName, task.orgId);
    if (!envelope) {
      dependencies.logger.warn("Skipping quota email because org envelope is missing", {
        apiKeyHash: task.apiKeyHash,
        orgId: task.orgId,
        scope: task.scope,
        threshold: task.threshold,
      });
      return;
    }

    const plan = PLANS[envelope.tier];
    if (plan.quotaPerProduct == null || !thresholdStillEligible(usageRow, task.threshold, plan.quotaPerProduct)) {
      return;
    }

    const fields = getThresholdFields(task.threshold);
    const claimedAt = new Date().toISOString();
    const reclaimBefore = getLeaseCutoff(new Date());
    const claimed = await claimQuotaEmail(
      dependencies.ddb,
      dependencies.usageTableName,
      task,
      fields,
      claimedAt,
      reclaimBefore,
    );
    if (!claimed) {
      return;
    }

    try {
      const suppressed = await isSuppressedEmail(
        dependencies.ddb,
        dependencies.suppressionsTableName,
        envelope.ownerEmail,
      );
      if (suppressed) {
        dependencies.logger.info("Skipping quota email due to SES suppression", {
          orgId: task.orgId,
          scope: task.scope,
          threshold: task.threshold,
          toEmail: envelope.ownerEmail,
        });
        await finalizeQuotaEmail(
          dependencies.ddb,
          dependencies.usageTableName,
          task,
          fields,
          claimedAt,
        );
        return;
      }

      const sent = await dependencies.sendQuotaEmail({ envelope, task });
      if (sent) {
        await finalizeQuotaEmail(
          dependencies.ddb,
          dependencies.usageTableName,
          task,
          fields,
          claimedAt,
        );
        return;
      }
      await releaseQuotaEmailClaim(
        dependencies.ddb,
        dependencies.usageTableName,
        task,
        fields,
        claimedAt,
      );
    } catch (error) {
      dependencies.logger.warn("Quota email send failed", {
        apiKeyHash: task.apiKeyHash,
        error: error instanceof Error ? error.message : String(error),
        orgId: task.orgId,
        scope: task.scope,
        threshold: task.threshold,
      });
      try {
        await releaseQuotaEmailClaim(
          dependencies.ddb,
          dependencies.usageTableName,
          task,
          fields,
          claimedAt,
        );
      } catch {
        // Best-effort cleanup only. The short lease allows reclaim.
      }
    }
  }

  return { processTask };
}

export async function handler(event: QuotaEmailTask): Promise<void> {
  const service = createQuotaEmailService();
  await service.processTask(event);
}
