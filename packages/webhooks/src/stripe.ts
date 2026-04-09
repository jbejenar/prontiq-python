import type { Handler } from "aws-lambda";

/**
 * Stripe webhook handler: subscription.created, subscription.updated
 * Updates Unkey key limits and syncs to DynamoDB.
 */
export const handler: Handler = async (event) => {
  // TODO: Verify webhook signature via Stripe SDK
  // TODO: Parse subscription event
  // TODO: Map Stripe plan → tier limits
  // TODO: Update Unkey key (new tier limits, product scopes)
  // TODO: Sync updated metadata to DynamoDB

  console.log("Stripe webhook received", { body: event.body });

  return { statusCode: 200, body: JSON.stringify({ received: true }) };
};
