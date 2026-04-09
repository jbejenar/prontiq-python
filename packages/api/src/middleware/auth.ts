import { createMiddleware } from "hono/factory";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand } from "@aws-sdk/lib-dynamodb";
import { ERROR_CODES, PRODUCT_REGISTRY } from "@prontiq/shared";
import type { ApiKeyRecord } from "@prontiq/shared";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE_NAME = process.env.API_KEY_TABLE_NAME ?? "ApiKeyTable";

declare module "hono" {
  interface ContextVariableMap {
    apiKey: ApiKeyRecord;
    product: string;
  }
}

export function auth() {
  return createMiddleware(async (c, next) => {
    const apiKey = c.req.header("X-Api-Key");
    if (!apiKey) {
      return c.json(
        {
          error: {
            ...ERROR_CODES.MISSING_API_KEY,
            code: "MISSING_API_KEY" as const,
            request_id: c.get("requestId"),
          },
        },
        401,
      );
    }

    const result = await ddb.send(new GetCommand({ TableName: TABLE_NAME, Key: { apiKey } }));

    const record = result.Item as ApiKeyRecord | undefined;
    if (!record || !record.active) {
      return c.json(
        {
          error: {
            ...ERROR_CODES.INVALID_API_KEY,
            code: "INVALID_API_KEY" as const,
            request_id: c.get("requestId"),
          },
        },
        401,
      );
    }

    // Extract product from route path: /v1/{product}/...
    const pathSegments = c.req.path.split("/");
    const product = pathSegments[2]; // ["", "v1", "address", ...]

    // Skip product checks for non-product routes (e.g., /v1/status)
    if (!product || !PRODUCT_REGISTRY[product]) {
      c.set("apiKey", record);
      await next();
      return;
    }

    {
      // Tier enforcement
      if (!record.products.includes(product)) {
        return c.json(
          {
            error: {
              ...ERROR_CODES.PRODUCT_NOT_ALLOWED,
              code: "PRODUCT_NOT_ALLOWED" as const,
              request_id: c.get("requestId"),
              details: { product, allowed: record.products },
            },
          },
          403,
        );
      }

      // Monthly quota check
      const month = new Date().toISOString().slice(0, 7); // "2026-04"
      const currentUsage = record.usage?.[product]?.[month] ?? 0;
      if (currentUsage >= record.monthlyQuotaPerProduct) {
        const nextMonth = new Date();
        nextMonth.setMonth(nextMonth.getMonth() + 1, 1);
        nextMonth.setHours(0, 0, 0, 0);

        return c.json(
          {
            error: {
              ...ERROR_CODES.QUOTA_EXCEEDED,
              code: "QUOTA_EXCEEDED" as const,
              request_id: c.get("requestId"),
              details: {
                product,
                used: currentUsage,
                limit: record.monthlyQuotaPerProduct,
                resets_at: nextMonth.toISOString(),
              },
            },
          },
          429,
        );
      }

      c.set("product", product);
    }

    c.set("apiKey", record);
    await next();
  });
}
