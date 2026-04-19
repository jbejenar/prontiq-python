import { createHash, createHmac } from "node:crypto";
import { GetCommand } from "@aws-sdk/lib-dynamodb";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import {
  EMAIL_SUPPRESSION_SOFT_BOUNCE_THRESHOLD,
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
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
  if (!accessKeyId || !secretAccessKey) {
    return false;
  }
  const sessionToken = process.env.AWS_SESSION_TOKEN;
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const service = "ses";
  const host = `email.${input.region}.amazonaws.com`;
  const path = "/v2/email/outbound-emails";
  const endpoint = `https://${host}${path}`;
  const body = JSON.stringify({
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
  });
  const payloadHash = createHash("sha256").update(body).digest("hex");
  const canonicalHeaders = [
    "content-type:application/json",
    `host:${host}`,
    `x-amz-date:${amzDate}`,
    ...(sessionToken ? [`x-amz-security-token:${sessionToken}`] : []),
  ].join("\n");
  const signedHeaders = [
    "content-type",
    "host",
    "x-amz-date",
    ...(sessionToken ? ["x-amz-security-token"] : []),
  ].join(";");
  const canonicalRequest = ["POST", path, "", `${canonicalHeaders}\n`, signedHeaders, payloadHash].join("\n");
  const credentialScope = `${dateStamp}/${input.region}/${service}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    createHash("sha256").update(canonicalRequest).digest("hex"),
  ].join("\n");
  const dateKey = createHmac("sha256", `AWS4${secretAccessKey}`).update(dateStamp).digest();
  const regionKey = createHmac("sha256", dateKey).update(input.region).digest();
  const serviceKey = createHmac("sha256", regionKey).update(service).digest();
  const signingKey = createHmac("sha256", serviceKey).update("aws4_request").digest();
  const signature = createHmac("sha256", signingKey).update(stringToSign).digest("hex");
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
      "Content-Type": "application/json",
      Host: host,
      "X-Amz-Date": amzDate,
      ...(sessionToken ? { "X-Amz-Security-Token": sessionToken } : {}),
    },
    body,
  });
  return response.ok;
}
