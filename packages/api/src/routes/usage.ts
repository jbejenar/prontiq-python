import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import {
  createAccountUsageService,
  type AccountUsageService,
  type UsageGranularity,
} from "@prontiq/control-plane";
import { createLogger } from "@prontiq/shared";

const logger = createLogger("api-usage-routes");
const clerkJwtSecurity = [{ ClerkJwt: [] }];

const apiErrorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    status: z.number().int(),
    request_id: z.string(),
    details: z.record(z.string(), z.unknown()).optional(),
  }),
});

const usageGranularitySchema = z.enum(["daily", "weekly", "monthly"]);

const usageSeriesPointSchema = z.object({
  bucket: z.string(),
  label: z.string(),
  credits: z.number().int().nonnegative(),
  kind: z.enum(["baseline", "projected", "total"]),
  sortKey: z.string(),
});

const usageProductSchema = z.object({
  product: z.string(),
  displayName: z.string(),
  includedInCurrentPlan: z.boolean(),
  usedCredits: z.number().int().nonnegative(),
  quotaCredits: z.number().int().nonnegative().nullable(),
  remainingCredits: z.number().int().nonnegative().nullable(),
  overageCredits: z.number().int().nonnegative().nullable(),
  enforcementMode: z.enum(["hard_cap", "soft_overage", "uncapped_tracked"]),
  rateLimitPerSecond: z.number().int().nonnegative().nullable(),
  series: z.array(usageSeriesPointSchema),
});

const usageResponseSchema = z.object({
  generatedAt: z.string(),
  granularity: usageGranularitySchema,
  period: z.object({
    key: z.string(),
    startedAt: z.string().nullable(),
    endingAt: z.string().nullable(),
    source: z.enum(["calendar", "lago"]),
    entitlementsSyncedAt: z.string().nullable(),
    scopeConsistency: z.enum(["single_period", "mixed_key_periods"]),
  }),
  products: z.array(usageProductSchema),
});

const jsonResponse = (schema: z.ZodType, description: string) => ({
  content: { "application/json": { schema } },
  description,
});

let cachedDdb: DynamoDBDocumentClient | undefined;
let cachedService: AccountUsageService | undefined;

function getDefaultService(): AccountUsageService {
  if (cachedService) return cachedService;
  cachedDdb ??= DynamoDBDocumentClient.from(new DynamoDBClient({}));
  const keysTableName = process.env.KEYS_TABLE_NAME;
  if (!keysTableName) throw new Error("KEYS_TABLE_NAME is required");
  const usageTableName = process.env.USAGE_TABLE_NAME;
  if (!usageTableName) throw new Error("USAGE_TABLE_NAME is required");
  const usageDailyTableName = process.env.USAGE_DAILY_TABLE_NAME;
  if (!usageDailyTableName) throw new Error("USAGE_DAILY_TABLE_NAME is required");
  cachedService = createAccountUsageService({
    ddb: cachedDdb,
    keysTableName,
    usageTableName,
    usageDailyTableName,
  });
  return cachedService;
}

export interface UsageRouteOverrides {
  service?: AccountUsageService;
}

export function createUsageRoutes(overrides: UsageRouteOverrides = {}) {
  const usageRoutes = new OpenAPIHono();

  usageRoutes.openAPIRegistry.registerComponent("securitySchemes", "ClerkJwt", {
    type: "http",
    scheme: "bearer",
    bearerFormat: "JWT",
    description: "Clerk session token; sent as `Authorization: Bearer <jwt>`.",
  });

  const usageRoute = createRoute({
    method: "get",
    path: "/usage",
    summary: "Read current-period usage for the active Clerk organization",
    description:
      "Member-readable private console endpoint. Current totals come from Prontiq usage counters; chart buckets come from the async Prontiq usage projection fed by billing events.",
    security: clerkJwtSecurity,
    request: {
      query: z.object({
        granularity: usageGranularitySchema.default("daily").openapi({
          description: "Chart granularity. Monthly is the current billing period in v1.",
        }),
      }),
    },
    responses: {
      200: jsonResponse(usageResponseSchema, "Current-period org usage"),
      401: jsonResponse(apiErrorResponseSchema, "Missing/invalid JWT"),
      404: jsonResponse(apiErrorResponseSchema, "ORG_NOT_PROVISIONED — call /v1/account/setup"),
      500: jsonResponse(apiErrorResponseSchema, "Server error"),
    },
  });

  usageRoutes.openapi(usageRoute, async (c) => {
    const principal = c.get("clerkPrincipal");
    const requestId = c.get("requestId");
    const service = overrides.service ?? getDefaultService();
    const granularity = c.req.valid("query").granularity as UsageGranularity;

    try {
      const result = await service.getUsage({ orgId: principal.orgId, granularity });
      if (result.status === "org_not_provisioned") {
        return c.json(
          {
            error: {
              code: "ORG_NOT_PROVISIONED",
              message: "Account is not provisioned. Run setup before reading usage.",
              status: 404,
              request_id: requestId,
            },
          },
          404,
        );
      }
      return c.json(result.usage, 200);
    } catch (error) {
      logger.error("getUsage failed", {
        request_id: requestId,
        orgId: principal.orgId,
        error: error instanceof Error ? error.message : String(error),
      });
      return c.json(
        {
          error: {
            code: "INTERNAL_ERROR",
            message: "Internal server error",
            status: 500,
            request_id: requestId,
          },
        },
        500,
      );
    }
  });

  return usageRoutes;
}

export const usageRoutes = createUsageRoutes();
