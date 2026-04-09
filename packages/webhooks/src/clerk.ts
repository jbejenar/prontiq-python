import type { Handler } from "aws-lambda";

/**
 * Clerk webhook handler: user.created
 * Provisioning chain:
 * 1. Create Stripe customer (free tier)
 * 2. Create Unkey API key (free tier limits)
 * 3. Sync key metadata to DynamoDB
 * 4. Send welcome email with API key + docs link
 */
export const handler: Handler = async (event) => {
  // TODO: Verify webhook signature via Svix
  // TODO: Parse Clerk user.created payload
  // TODO: Create Stripe customer
  // TODO: Create Unkey key with free tier limits
  // TODO: Write key record to DynamoDB
  // TODO: Trigger welcome email

  console.log("Clerk webhook received", { body: event.body });

  return { statusCode: 200, body: JSON.stringify({ received: true }) };
};
