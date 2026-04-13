import { createMiddleware } from "hono/factory";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, UpdateCommand } from "@aws-sdk/lib-dynamodb";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE_NAME = process.env.API_KEY_TABLE_NAME ?? "ApiKeyTable";

async function incrementUsage(apiKey: string, product: string, month: string): Promise<void> {
  const key = { apiKey };
  // Three-phase: ensure each parent map exists before incrementing
  await ddb.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: key,
      UpdateExpression: "SET #usage = if_not_exists(#usage, :empty)",
      ExpressionAttributeNames: { "#usage": "usage" },
      ExpressionAttributeValues: { ":empty": {} },
    }),
  );
  await ddb.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: key,
      UpdateExpression: "SET #usage.#product = if_not_exists(#usage.#product, :empty)",
      ExpressionAttributeNames: { "#usage": "usage", "#product": product },
      ExpressionAttributeValues: { ":empty": {} },
    }),
  );
  await ddb.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: key,
      UpdateExpression: "SET #usage.#product.#month = if_not_exists(#usage.#product.#month, :zero) + :inc",
      ExpressionAttributeNames: { "#usage": "usage", "#product": product, "#month": month },
      ExpressionAttributeValues: { ":zero": 0, ":inc": 1 },
    }),
  );
}

export function usage() {
  return createMiddleware(async (c, next) => {
    await next();

    const product = c.get("product");
    const apiKeyRecord = c.get("apiKey");
    if (!product || !apiKeyRecord) return;

    const month = new Date().toISOString().slice(0, 7);

    // Fire and forget — usage undercount is acceptable per ARCHITECTURE.MD.
    // On Lambda, background promises complete on warm invocations but may be
    // dropped on freeze. This keeps usage off the response critical path.
    incrementUsage(apiKeyRecord.apiKey, product, month).catch((err) => {
      console.error("Usage increment failed", {
        apiKey: apiKeyRecord.apiKey,
        product,
        error: String(err),
      });
    });
  });
}
