import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2, Context } from "aws-lambda";
import { createHmac, timingSafeEqual } from "node:crypto";
import { SERVICE_NAMES, wrapLambdaHandler } from "@prontiq/observability";
import { createLagoWebhookReconciliationService } from "@prontiq/control-plane";
import { createLogger, hashLagoWebhookPayload } from "@prontiq/shared";

let cachedSecret: string | undefined;
let cachedService: ReturnType<typeof createLagoWebhookReconciliationService> | undefined;
const logger = createLogger("webhooks-lago");

function getRequiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function getWebhookSecret(): string {
  if (!cachedSecret) {
    cachedSecret = getRequiredEnv("LAGO_WEBHOOK_HMAC_SECRET");
  }
  return cachedSecret;
}

function getReconciliationService(): ReturnType<typeof createLagoWebhookReconciliationService> {
  if (!cachedService) {
    cachedService = createLagoWebhookReconciliationService();
  }
  return cachedService;
}

function getRawBody(event: APIGatewayProxyEventV2): string {
  if (!event.body) return "";
  if (event.isBase64Encoded) {
    return Buffer.from(event.body, "base64").toString("utf8");
  }
  return event.body;
}

function getHeader(event: APIGatewayProxyEventV2, name: string): string {
  const lowerName = name.toLowerCase();
  for (const [key, value] of Object.entries(event.headers ?? {})) {
    if (key.toLowerCase() === lowerName && value) {
      return value;
    }
  }
  return "";
}

function reply(statusCode: number, body: Record<string, unknown>): APIGatewayProxyResultV2 {
  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export function verifyLagoHmacSignature(input: {
  rawBody: string;
  signature: string;
  secret: string;
}): boolean {
  const expected = createHmac("sha256", input.secret).update(input.rawBody).digest("base64");
  return safeEqual(expected, input.signature);
}

export interface LagoHandlerOverrides {
  service?: ReturnType<typeof createLagoWebhookReconciliationService>;
  webhookSecret?: string;
}

export function createLagoHandler(overrides: LagoHandlerOverrides = {}) {
  return async function lagoHandler(
    event: APIGatewayProxyEventV2,
    _context?: Context,
  ): Promise<APIGatewayProxyResultV2> {
    const rawBody = getRawBody(event);
    const algorithm = getHeader(event, "X-Lago-Signature-Algorithm").toLowerCase();
    const signature = getHeader(event, "X-Lago-Signature");
    const uniqueKey = getHeader(event, "X-Lago-Unique-Key");
    if (algorithm !== "hmac" || signature.length === 0) {
      logger.warn("Lago webhook missing HMAC signature headers", { algorithm });
      return reply(400, { error: "invalid_signature" });
    }
    if (uniqueKey.length === 0) {
      logger.warn("Lago webhook missing unique key");
      return reply(400, { error: "missing_unique_key" });
    }
    if (
      !verifyLagoHmacSignature({
        rawBody,
        signature,
        secret: overrides.webhookSecret ?? getWebhookSecret(),
      })
    ) {
      logger.warn("Lago webhook signature verification failed", { uniqueKey });
      return reply(400, { error: "invalid_signature" });
    }

    let payload: unknown;
    try {
      payload = JSON.parse(rawBody) as unknown;
    } catch {
      return reply(400, { error: "invalid_json" });
    }

    const service = overrides.service ?? getReconciliationService();
    const result = await service.handleWebhook({
      payload,
      payloadHash: hashLagoWebhookPayload(payload),
      uniqueKey,
    });
    return reply(result.httpStatus, result.body);
  };
}

export const handler = wrapLambdaHandler({
  attributes: (event) => {
    const request = event as APIGatewayProxyEventV2;
    return {
      "prontiq.method": request.requestContext.http.method,
      "prontiq.route": request.requestContext.http.path,
      "prontiq.stage": process.env.PRONTIQ_STAGE ?? "unknown",
      "prontiq.webhook.provider": "lago",
      "prontiq.webhook.unique_key": getHeader(request, "X-Lago-Unique-Key") || "unknown",
    };
  },
  handler: createLagoHandler(),
  serviceName: SERVICE_NAMES.webhooks,
  spanName: "prontiq-webhooks.lago",
});
