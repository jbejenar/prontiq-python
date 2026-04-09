import { createMiddleware } from "hono/factory";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, UpdateCommand } from "@aws-sdk/lib-dynamodb";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE_NAME = process.env.API_KEY_TABLE_NAME ?? "ApiKeyTable";

export function usage() {
  return createMiddleware(async (c, next) => {
    await next();

    // Increment usage counter after response is sent
    // Uses waitUntil pattern: non-blocking from client perspective, but durable
    const product = c.get("product");
    const apiKeyRecord = c.get("apiKey");
    if (!product || !apiKeyRecord) return;

    const month = new Date().toISOString().slice(0, 7);

    const promise = ddb
      .send(
        new UpdateCommand({
          TableName: TABLE_NAME,
          Key: { apiKey: apiKeyRecord.apiKey },
          UpdateExpression: "ADD #usage.#product.#month :inc",
          ExpressionAttributeNames: {
            "#usage": "usage",
            "#product": product,
            "#month": month,
          },
          ExpressionAttributeValues: {
            ":inc": 1,
          },
        }),
      )
      .catch((err) => {
        // Usage undercount is acceptable; request failure is not
        console.error("Usage increment failed", {
          apiKey: apiKeyRecord.apiKey,
          product,
          error: String(err),
        });
      });

    // If running on Lambda/Cloudflare, use waitUntil to keep the Lambda alive
    // until the write completes without blocking the response
    if (c.executionCtx && "waitUntil" in c.executionCtx) {
      c.executionCtx.waitUntil(promise);
    }
  });
}
