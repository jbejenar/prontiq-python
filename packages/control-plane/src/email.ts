import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import { GetCommand } from "@aws-sdk/lib-dynamodb";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import {
  EMAIL_SUPPRESSION_SOFT_BOUNCE_THRESHOLD,
  createLogger,
  type SesSuppressionRecord,
} from "@prontiq/shared";

export type EmailLogger = Pick<Console, "warn" | "info">;

export interface SignedSesEmailInput {
  bodyText: string;
  configurationSetName?: string;
  fromEmail: string;
  region: string;
  subject: string;
  toEmail: string;
}

interface SesEmailClientLike {
  send(command: SendEmailCommand): Promise<unknown>;
}

const sesClients = new Map<string, SESv2Client>();
const logger = createLogger("control-plane-email");

export function normalizeEmailForSuppression(email: string): string {
  return email.trim().toLowerCase();
}

export async function readSuppressionRecord(
  ddb: DynamoDBDocumentClient,
  suppressionsTableName: string,
  email: string,
): Promise<SesSuppressionRecord | undefined> {
  const normalizedEmail = normalizeEmailForSuppression(email);
  if (normalizedEmail.length === 0) {
    return undefined;
  }
  const result = await ddb.send(
    new GetCommand({
      TableName: suppressionsTableName,
      Key: { email: normalizedEmail },
    }),
  );
  return result.Item as SesSuppressionRecord | undefined;
}

export function getActiveSuppressionRecord(
  record: SesSuppressionRecord | undefined,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): SesSuppressionRecord | undefined {
  if (!record) return undefined;
  if (record.reason !== "complaint" && typeof record.ttl === "number" && record.ttl <= nowSeconds) {
    return undefined;
  }
  return record;
}

export async function isSuppressedEmail(
  ddb: DynamoDBDocumentClient,
  suppressionsTableName: string,
  email: string,
): Promise<boolean> {
  const item = getActiveSuppressionRecord(await readSuppressionRecord(ddb, suppressionsTableName, email));
  if (!item) return false;
  if (item.reason === "complaint" || item.reason === "hard_bounce") {
    return true;
  }
  return item.reason === "soft_bounce" && (item.bounceCount ?? 0) >= EMAIL_SUPPRESSION_SOFT_BOUNCE_THRESHOLD;
}

export async function sendSignedSesEmail(input: SignedSesEmailInput): Promise<boolean> {
  return sendSignedSesEmailWithClient(input, getSesClient(input.region));
}

function getSesClient(region: string): SESv2Client {
  const cached = sesClients.get(region);
  if (cached) {
    return cached;
  }
  const client = new SESv2Client({ region });
  sesClients.set(region, client);
  return client;
}

export async function sendSignedSesEmailWithClient(
  input: SignedSesEmailInput,
  client: SesEmailClientLike,
): Promise<boolean> {
  try {
    await client.send(
      new SendEmailCommand({
        ConfigurationSetName: input.configurationSetName,
        Content: {
          Simple: {
            Body: {
              Text: {
                Data: input.bodyText,
              },
            },
            Subject: { Data: input.subject },
          },
        },
        Destination: { ToAddresses: [input.toEmail] },
        FromEmailAddress: input.fromEmail,
      }),
    );
    return true;
  } catch (error) {
    logger.warn("SES send failed", {
      error: error instanceof Error ? error.message : String(error),
      fromEmail: input.fromEmail,
      region: input.region,
      toEmail: input.toEmail,
    });
    return false;
  }
}
