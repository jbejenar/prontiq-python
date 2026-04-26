import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2, Context } from "aws-lambda";
import { SERVICE_NAMES, wrapLambdaHandler } from "@prontiq/observability";
import { createStripeBillingService } from "@prontiq/control-plane";
import { createLogger } from "@prontiq/shared";
import Stripe from "stripe";

let cachedSecret: string | undefined;
let cachedService: ReturnType<typeof createStripeBillingService> | undefined;
let cachedStripe: Stripe | undefined;
const logger = createLogger("webhooks-stripe");

function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function getWebhookSecret(): string {
  if (!cachedSecret) {
    cachedSecret = getRequiredEnv("STRIPE_WEBHOOK_SECRET");
  }
  return cachedSecret;
}

function getStripeClient(): Stripe {
  if (!cachedStripe) {
    cachedStripe = new Stripe(getRequiredEnv("STRIPE_SECRET_KEY"), { maxNetworkRetries: 3 });
  }
  return cachedStripe;
}

function getStripeBillingService(): ReturnType<typeof createStripeBillingService> {
  if (!cachedService) {
    cachedService = createStripeBillingService({ stripe: getStripeClient() });
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

function reply(statusCode: number, body: Record<string, unknown>): APIGatewayProxyResultV2 {
  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

export interface StripeHandlerOverrides {
  legacyStripeRuntimeEnabled?: boolean;
  service?: ReturnType<typeof createStripeBillingService>;
  stripeClient?: Stripe;
  webhookSecret?: string;
}

function legacyStripeRuntimeEnabled(): boolean {
  return process.env.LEGACY_STRIPE_RUNTIME_ENABLED !== "false";
}

export function createStripeHandler(overrides: StripeHandlerOverrides = {}) {
  return async function stripeHandler(
    event: APIGatewayProxyEventV2,
    _context?: Context,
  ): Promise<APIGatewayProxyResultV2> {
    let stripeEvent: Stripe.Event;
    try {
      const stripeClient = overrides.stripeClient ?? getStripeClient();
      stripeEvent = stripeClient.webhooks.constructEvent(
        getRawBody(event),
        event.headers["stripe-signature"] ?? event.headers["Stripe-Signature"] ?? "",
        overrides.webhookSecret ?? getWebhookSecret(),
      );
    } catch (error) {
      if (error instanceof Stripe.errors.StripeSignatureVerificationError) {
        logger.warn("Stripe webhook signature verification failed", {
          message: error.message,
        });
        return reply(400, { error: "invalid_signature" });
      }
      logger.error("Stripe webhook failed before event dispatch", {
        error: error instanceof Error ? error.message : String(error),
      });
      return reply(500, { error: "internal_error" });
    }

    if ((overrides.legacyStripeRuntimeEnabled ?? legacyStripeRuntimeEnabled()) === false) {
      logger.info("Stripe webhook received after legacy runtime retirement", {
        eventId: stripeEvent.id,
        eventType: stripeEvent.type,
      });
      return reply(200, { ok: true, status: "retired" });
    }

    const service = overrides.service ?? getStripeBillingService();
    const result = await service.handleEvent(stripeEvent);
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
      "prontiq.webhook.provider": "stripe",
    };
  },
  handler: createStripeHandler(),
  serviceName: SERVICE_NAMES.webhooks,
  spanName: "prontiq-webhooks.stripe",
});
