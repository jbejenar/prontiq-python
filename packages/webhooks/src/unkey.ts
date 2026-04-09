import type { Handler } from "aws-lambda";

/**
 * Unkey webhook handler: key.created, key.updated, key.deleted
 * Syncs key state to DynamoDB (hot-path verification cache).
 */
export const handler: Handler = async (event) => {
  // TODO: Verify webhook signature
  // TODO: Parse key event
  // TODO: Write/update/delete in DynamoDB

  console.log("Unkey webhook received", { body: event.body });

  return { statusCode: 200, body: JSON.stringify({ received: true }) };
};
