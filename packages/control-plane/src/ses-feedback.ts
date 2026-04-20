import {
  ConditionalCheckFailedException,
  DynamoDBClient,
} from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  PutCommand,
} from "@aws-sdk/lib-dynamodb";
import {
  EMAIL_SUPPRESSION_BOUNCE_TTL_DAYS,
  EMAIL_SUPPRESSION_SOFT_BOUNCE_THRESHOLD,
  EMAIL_SUPPRESSION_SOFT_BOUNCE_WINDOW_DAYS,
  createLogger,
  type SesSuppressionRecord,
} from "@prontiq/shared";
import { SERVICE_NAMES, wrapLambdaHandler } from "@prontiq/observability";
import {
  getActiveSuppressionRecord,
  normalizeEmailForSuppression,
  readSuppressionRecord,
} from "./email.js";

type Logger = Pick<Console, "error" | "warn" | "info">;

interface SesBounceRecipient {
  emailAddress?: string;
}

interface SesComplaintRecipient {
  emailAddress?: string;
}

interface SesBouncePayload {
  bounceType?: string;
  bouncedRecipients?: SesBounceRecipient[];
}

interface SesComplaintPayload {
  complainedRecipients?: SesComplaintRecipient[];
}

interface SesNotification {
  bounce?: SesBouncePayload;
  complaint?: SesComplaintPayload;
  eventType?: string;
  mail?: {
    timestamp?: string;
  };
  notificationType?: string;
}

interface SnsRecord {
  Sns?: {
    Message?: string;
  };
}

interface SnsEvent {
  Records?: SnsRecord[];
}

export interface SesFeedbackDependencies {
  ddb: DynamoDBDocumentClient;
  logger: Logger;
  suppressionsTableName: string;
}

let cachedDdb: DynamoDBDocumentClient | undefined;
const defaultLogger = createLogger("control-plane-ses-feedback");

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

function getBounceTtl(now: Date): number {
  return Math.floor(now.getTime() / 1000) + EMAIL_SUPPRESSION_BOUNCE_TTL_DAYS * 24 * 60 * 60;
}

function getSoftBounceWindowCutoff(now: Date): number {
  return now.getTime() - EMAIL_SUPPRESSION_SOFT_BOUNCE_WINDOW_DAYS * 24 * 60 * 60 * 1000;
}

function parseSesMessage(
  logger: Logger,
  record: SnsRecord,
): SesNotification | null {
  const message = record.Sns?.Message;
  if (typeof message !== "string" || message.length === 0) {
    return null;
  }
  try {
    return JSON.parse(message) as SesNotification;
  } catch (error) {
    logger.warn("Ignoring malformed SNS SES notification payload", {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

async function putSuppressionRecord(
  ddb: DynamoDBDocumentClient,
  suppressionsTableName: string,
  existing: SesSuppressionRecord | undefined,
  item: SesSuppressionRecord,
): Promise<void> {
  const expressionAttributeNames: Record<string, string> = {
    "#email": "email",
  };
  const expressionAttributeValues: Record<string, number | string> = {};
  const conditions: string[] = [];

  if (!existing) {
    conditions.push("attribute_not_exists(#email)");
  } else {
    conditions.push("attribute_exists(#email)");
    expressionAttributeNames["#lastEventAt"] = "lastEventAt";
    conditions.push("#lastEventAt = :lastEventAt");
    expressionAttributeValues[":lastEventAt"] = existing.lastEventAt;
    expressionAttributeNames["#reason"] = "reason";
    conditions.push("#reason = :reason");
    expressionAttributeValues[":reason"] = existing.reason;

    if (typeof existing.bounceCount === "number") {
      expressionAttributeNames["#bounceCount"] = "bounceCount";
      conditions.push("#bounceCount = :bounceCount");
      expressionAttributeValues[":bounceCount"] = existing.bounceCount;
    } else {
      expressionAttributeNames["#bounceCount"] = "bounceCount";
      conditions.push("attribute_not_exists(#bounceCount)");
    }

    if (typeof existing.softBounceWindowStartedAt === "string") {
      expressionAttributeNames["#softBounceWindowStartedAt"] = "softBounceWindowStartedAt";
      conditions.push("#softBounceWindowStartedAt = :softBounceWindowStartedAt");
      expressionAttributeValues[":softBounceWindowStartedAt"] = existing.softBounceWindowStartedAt;
    } else {
      expressionAttributeNames["#softBounceWindowStartedAt"] = "softBounceWindowStartedAt";
      conditions.push("attribute_not_exists(#softBounceWindowStartedAt)");
    }

    if (typeof existing.ttl === "number") {
      expressionAttributeNames["#ttl"] = "ttl";
      conditions.push("#ttl = :ttl");
      expressionAttributeValues[":ttl"] = existing.ttl;
    } else {
      expressionAttributeNames["#ttl"] = "ttl";
      conditions.push("attribute_not_exists(#ttl)");
    }
  }

  await ddb.send(
    new PutCommand({
      TableName: suppressionsTableName,
      Item: item,
      ConditionExpression: conditions.join(" AND "),
      ExpressionAttributeNames: expressionAttributeNames,
      ...(Object.keys(expressionAttributeValues).length > 0
        ? { ExpressionAttributeValues: expressionAttributeValues }
        : {}),
    }),
  );
}

type SupportedSesEventType = "BOUNCE" | "COMPLAINT";
type SuppressionEventKind = "hard_bounce" | "soft_bounce" | "complaint";
const MAX_SUPPRESSION_WRITE_RETRIES = 5;

function getSupportedEventType(notification: SesNotification): SupportedSesEventType | null {
  const rawEventType = notification.eventType ?? notification.notificationType;
  if (typeof rawEventType !== "string" || rawEventType.length === 0) {
    return null;
  }
  const normalized = rawEventType.toUpperCase();
  if (normalized === "BOUNCE" || normalized === "COMPLAINT") {
    return normalized;
  }
  return null;
}

function getSuppressionEventKind(notification: SesNotification): SuppressionEventKind | null {
  const eventType = getSupportedEventType(notification);
  if (eventType === "COMPLAINT") {
    return "complaint";
  }
  if (eventType !== "BOUNCE") {
    return null;
  }
  return notification.bounce?.bounceType === "Permanent" ? "hard_bounce" : "soft_bounce";
}

function getLatestEventTime(existing: string | undefined, next: string): string {
  if (!existing) {
    return next;
  }
  return new Date(existing).getTime() >= new Date(next).getTime() ? existing : next;
}

function buildSuppressionRecord(
  email: string,
  eventTime: string,
  kind: SuppressionEventKind,
  existing?: SesSuppressionRecord,
): SesSuppressionRecord {
  const eventDate = new Date(eventTime);

  if (kind === "complaint" || existing?.reason === "complaint") {
    return {
      email,
      lastEventAt: getLatestEventTime(existing?.lastEventAt, eventTime),
      reason: "complaint",
    };
  }

  if (kind === "hard_bounce" || existing?.reason === "hard_bounce") {
    return {
      bounceCount: EMAIL_SUPPRESSION_SOFT_BOUNCE_THRESHOLD,
      email,
      lastEventAt: getLatestEventTime(existing?.lastEventAt, eventTime),
      reason: "hard_bounce",
      ttl: getBounceTtl(eventDate),
    };
  }

  const existingWindowStartedAt = existing?.softBounceWindowStartedAt
    ? new Date(existing.softBounceWindowStartedAt)
    : null;
  const withinWindow =
    existingWindowStartedAt != null &&
    existingWindowStartedAt.getTime() >= getSoftBounceWindowCutoff(eventDate);
  const bounceCount = withinWindow ? (existing?.bounceCount ?? 0) + 1 : 1;
  return {
    bounceCount,
    email,
    lastEventAt: getLatestEventTime(existing?.lastEventAt, eventTime),
    reason: "soft_bounce",
    softBounceWindowStartedAt: withinWindow
      ? existing?.softBounceWindowStartedAt ?? eventTime
      : eventTime,
    ...(bounceCount >= EMAIL_SUPPRESSION_SOFT_BOUNCE_THRESHOLD
      ? { ttl: getBounceTtl(eventDate) }
      : {}),
  };
}

async function applySuppressionEvent(
  ddb: DynamoDBDocumentClient,
  suppressionsTableName: string,
  email: string,
  eventTime: string,
  kind: SuppressionEventKind,
): Promise<void> {
  const eventTimeSeconds = Math.floor(new Date(eventTime).getTime() / 1000);
  for (let attempt = 0; attempt < MAX_SUPPRESSION_WRITE_RETRIES; attempt += 1) {
    const rawExisting = await readSuppressionRecord(ddb, suppressionsTableName, email);
    const activeExisting = getActiveSuppressionRecord(rawExisting, eventTimeSeconds);
    try {
      await putSuppressionRecord(
        ddb,
        suppressionsTableName,
        rawExisting,
        buildSuppressionRecord(email, eventTime, kind, activeExisting),
      );
      return;
    } catch (error) {
      if (!(error instanceof ConditionalCheckFailedException)) {
        throw error;
      }
    }
  }
  throw new Error(`Failed to apply SES suppression event after ${MAX_SUPPRESSION_WRITE_RETRIES} retries`);
}

function getRecipientEmails(notification: SesNotification): string[] {
  switch (getSupportedEventType(notification)) {
    case "BOUNCE":
      return (notification.bounce?.bouncedRecipients ?? [])
        .map((recipient) => recipient.emailAddress)
        .filter((email): email is string => typeof email === "string" && email.length > 0)
        .map(normalizeEmailForSuppression);
    case "COMPLAINT":
      return (notification.complaint?.complainedRecipients ?? [])
        .map((recipient) => recipient.emailAddress)
        .filter((email): email is string => typeof email === "string" && email.length > 0)
        .map(normalizeEmailForSuppression);
    default:
      return [];
  }
}

export function createSesFeedbackService(
  overrides: Partial<SesFeedbackDependencies> = {},
): { handleSnsEvent: (event: SnsEvent) => Promise<void> } {
  const dependencies: SesFeedbackDependencies = {
    ddb: overrides.ddb ?? getDefaultDdb(),
    logger: overrides.logger ?? defaultLogger,
    suppressionsTableName:
      overrides.suppressionsTableName ?? getRequiredEnv("SUPPRESSIONS_TABLE_NAME"),
  };

  async function handleSnsEvent(event: SnsEvent): Promise<void> {
    for (const record of event.Records ?? []) {
      const notification = parseSesMessage(dependencies.logger, record);
      if (!notification) {
        continue;
      }
      const eventTime = notification.mail?.timestamp ?? new Date().toISOString();
      const eventKind = getSuppressionEventKind(notification);
      if (!eventKind) {
        dependencies.logger.warn("Ignoring unsupported SES feedback event", {
          eventType: notification.eventType ?? notification.notificationType ?? null,
        });
        continue;
      }
      const emails = getRecipientEmails(notification);
      if (emails.length === 0) {
        dependencies.logger.warn("Ignoring SES feedback event with no recipient emails", {
          eventType: notification.eventType ?? notification.notificationType ?? null,
        });
        continue;
      }
      for (const email of emails) {
        await applySuppressionEvent(
          dependencies.ddb,
          dependencies.suppressionsTableName,
          email,
          eventTime,
          eventKind,
        );
      }
    }
  }

  return { handleSnsEvent };
}

async function sesFeedbackHandler(event: SnsEvent): Promise<void> {
  const service = createSesFeedbackService();
  await service.handleSnsEvent(event);
}

export const handler = wrapLambdaHandler({
  attributes: () => ({
    "prontiq.billing.operation": "ses_feedback",
    "prontiq.stage": process.env.PRONTIQ_STAGE ?? "unknown",
  }),
  handler: sesFeedbackHandler,
  serviceName: SERVICE_NAMES.billing,
  spanName: "prontiq-billing.ses-feedback",
});
