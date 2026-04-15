import type { Handler } from "aws-lambda";

/**
 * Stripe webhook handler (per ARCHITECTURE.MD §5.7.2-§5.7.5).
 * Events: checkout.session.completed, customer.subscription.updated,
 * customer.subscription.deleted, invoice.payment_failed.
 * Updates prontiq-keys directly (DDB-native — no vendor sync).
 *
 * Implementation tracked by ROADMAP P1B.06.
 */
export const handler: Handler = async (event) => {
  // TODO(P1B.06): Verify webhook signature via Stripe SDK
  // TODO(P1B.06): Two-step retrieve (sub ID → expand items.data.price)
  // TODO(P1B.06): Map Stripe plan → tier (PLANS lookup)
  // TODO(P1B.06): TransactWriteItems update across all org keys
  // TODO(P1B.06): Past_due / active state transitions for grace period

  console.log("Stripe webhook received", { body: event.body });

  return { statusCode: 200, body: JSON.stringify({ received: true }) };
};
