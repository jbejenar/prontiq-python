import type { Handler } from "aws-lambda";

/**
 * Clerk webhook handler: user.created
 * Provisioning chain (per ARCHITECTURE.MD §5.7.1, ADR-001):
 * 1. Verify Svix signature
 * 2. GetItem ORG#{orgId} — return 200 if already provisioned
 * 3. Create Stripe customer with Idempotency-Key
 * 4. TransactWriteItems: ORG envelope + audit entry
 * 5. Send welcome email (no API key — minted via /v1/account/keys/create)
 *
 * Implementation tracked by ROADMAP P1B.05.
 */
export const handler: Handler = async (event) => {
  // TODO(P1B.05): Verify webhook signature via Svix
  // TODO(P1B.05): GetItem ORG#{orgId} idempotency check
  // TODO(P1B.05): Stripe customer create with Idempotency-Key
  // TODO(P1B.05): TransactWriteItems for ORG envelope + audit
  // TODO(P1B.05): Welcome email via SES (no key in body)

  console.log("Clerk webhook received", { body: event.body });

  return { statusCode: 200, body: JSON.stringify({ received: true }) };
};
