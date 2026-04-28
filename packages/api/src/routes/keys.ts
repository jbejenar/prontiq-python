import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import {
  createKeyManagementService,
  type KeyManagementService,
} from "@prontiq/control-plane";
import { createLogger } from "@prontiq/shared";
import { clerkAdminOnly } from "../middleware/clerk-jwt.js";

const clerkJwtSecurity = [{ ClerkJwt: [] }];
const logger = createLogger("api-keys-routes");

const apiErrorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    status: z.number().int(),
    request_id: z.string(),
    details: z.record(z.string(), z.unknown()).optional(),
  }),
});

const jsonResponse = (schema: z.ZodType, description: string) => ({
  content: { "application/json": { schema } },
  description,
});

const createKeyBodySchema = z.object({
  label: z.string().min(1).max(64).optional().openapi({
    description: "User-supplied display label for the key. Optional. 1-64 chars.",
  }),
});

const createKeySuccessSchema = z.object({
  keyId: z.string().openapi({
    description: "Stable identifier (`key_<ulid>`) that survives rotation.",
  }),
  raw: z.string().openapi({
    description:
      "The raw key. Returned ONCE in this response and never again. Treat as a credential.",
  }),
  keyPrefix: z.string().openapi({
    description: "Public-safe prefix for display in masked-key tables.",
  }),
  createdAt: z.string().openapi({ description: "ISO-8601 creation timestamp." }),
  label: z.string().optional(),
});

const listedKeySchema = z.object({
  keyId: z.string(),
  keyPrefix: z.string(),
  label: z.string().optional(),
  createdAt: z.string(),
  lastUsedAt: z.string().nullable(),
  active: z.boolean(),
  products: z.array(z.string()),
});

const listKeysSuccessSchema = z.object({ keys: z.array(listedKeySchema) });

let cachedDdb: DynamoDBDocumentClient | undefined;
let cachedService: KeyManagementService | undefined;

function getDefaultService(): KeyManagementService {
  if (cachedService) return cachedService;
  cachedDdb ??= DynamoDBDocumentClient.from(new DynamoDBClient({}));
  const keysTableName = process.env.KEYS_TABLE_NAME;
  if (!keysTableName) throw new Error("KEYS_TABLE_NAME is required");
  const auditTableName = process.env.AUDIT_TABLE_NAME;
  if (!auditTableName) throw new Error("AUDIT_TABLE_NAME is required");
  cachedService = createKeyManagementService({
    ddb: cachedDdb,
    keysTableName,
    auditTableName,
    logger,
  });
  return cachedService;
}

export interface KeysRouteOverrides {
  service?: KeyManagementService;
}

function getCallerIp(c: { req: { header(name: string): string | undefined } }): string | undefined {
  const xff = c.req.header("x-forwarded-for");
  if (!xff) return undefined;
  const first = xff.split(",")[0];
  return first ? first.trim() : undefined;
}

export function createKeysRoutes(overrides: KeysRouteOverrides = {}) {
  const keysRoutes = new OpenAPIHono({
    defaultHook: (result, c) => {
      if (result.success) return;
      return c.json(
        {
          error: {
            code: "INVALID_PARAMETERS",
            message: "Invalid request body",
            status: 400,
            request_id: c.get("requestId"),
            details: result.error.flatten().fieldErrors,
          },
        },
        400,
      );
    },
  });

  keysRoutes.openAPIRegistry.registerComponent("securitySchemes", "ClerkJwt", {
    type: "http",
    scheme: "bearer",
    bearerFormat: "JWT",
    description: "Clerk session token; sent as `Authorization: Bearer <jwt>`.",
  });

  // Per-route admin gate: applied here (not Lambda-wide) so member
  // tokens reach `/keys` (list) without 403 but get rejected on
  // `/keys/create`. PR 2 will add the same gate to `/keys/rotate` and
  // `/keys/revoke`.
  keysRoutes.use("/keys/create", clerkAdminOnly());

  const createKeyRoute = createRoute({
    method: "post",
    path: "/keys/create",
    summary: "Create a new API key (admin only)",
    description:
      "Mints a fresh `pq_live_*` key, stores its hash, and returns the raw value once. The raw key is never persisted, never logged, and cannot be retrieved later. Free-tier orgs are capped per `PLANS[tier].maxKeys`; the cap is enforced atomically.",
    security: clerkJwtSecurity,
    request: {
      body: {
        content: { "application/json": { schema: createKeyBodySchema } },
        required: false,
      },
    },
    responses: {
      201: jsonResponse(createKeySuccessSchema, "Key created. Raw value returned once."),
      400: jsonResponse(apiErrorResponseSchema, "Invalid request body"),
      401: jsonResponse(apiErrorResponseSchema, "Missing/invalid JWT"),
      403: jsonResponse(
        apiErrorResponseSchema,
        "INSUFFICIENT_ROLE (non-admin) or KEY_LIMIT_EXCEEDED",
      ),
      404: jsonResponse(apiErrorResponseSchema, "ORG_NOT_PROVISIONED — call /v1/account/setup"),
      500: jsonResponse(apiErrorResponseSchema, "Server error"),
    },
  });

  keysRoutes.openapi(createKeyRoute, async (c) => {
    const principal = c.get("clerkPrincipal");
    const requestId = c.get("requestId");
    const service = overrides.service ?? getDefaultService();

    // Use the Zod-validated body. With `body.required: false`, an
    // absent body resolves to undefined; an INVALID body (wrong type,
    // label > 64 chars, etc.) is caught upstream by the route's
    // `defaultHook` and surfaces as 400 INVALID_PARAMETERS — the
    // handler never sees it. Reading `c.req.json()` directly here
    // would silently bypass that validation.
    const validated = c.req.valid("json") as
      | z.infer<typeof createKeyBodySchema>
      | undefined;
    const label = validated?.label;

    const ip = getCallerIp(c);
    const userAgent = c.req.header("user-agent");

    let result;
    try {
      result = await service.createKey({
        orgId: principal.orgId,
        actorId: principal.userId,
        ...(ip !== undefined ? { ip } : {}),
        ...(userAgent !== undefined ? { userAgent } : {}),
        ...(label !== undefined ? { label } : {}),
      });
    } catch (error) {
      logger.error("createKey failed", {
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

    if (result.status === "org_not_provisioned") {
      return c.json(
        {
          error: {
            code: "ORG_NOT_PROVISIONED",
            message:
              "Org envelope is missing. Call POST /v1/account/setup first to recover, then retry.",
            status: 404,
            request_id: requestId,
          },
        },
        404,
      );
    }
    if (result.status === "limit_exceeded") {
      return c.json(
        {
          error: {
            code: "KEY_LIMIT_EXCEEDED",
            message:
              "Your plan has reached its key limit. Revoke an unused key or upgrade your plan.",
            status: 403,
            request_id: requestId,
          },
        },
        403,
      );
    }
    return c.json(
      {
        keyId: result.keyId,
        raw: result.raw,
        keyPrefix: result.keyPrefix,
        createdAt: result.createdAt,
        ...(result.label !== undefined ? { label: result.label } : {}),
      },
      201,
    );
  });

  const listKeysRoute = createRoute({
    method: "get",
    path: "/keys",
    summary: "List active keys for the caller's org (member-allowed)",
    description:
      "Returns active keys with masked prefix only. The org envelope is excluded by sentinel filter; revoked keys are excluded by the active flag.",
    security: clerkJwtSecurity,
    responses: {
      200: jsonResponse(listKeysSuccessSchema, "Active keys for this org"),
      401: jsonResponse(apiErrorResponseSchema, "Missing/invalid JWT"),
      500: jsonResponse(apiErrorResponseSchema, "Server error"),
    },
  });

  keysRoutes.openapi(listKeysRoute, async (c) => {
    const principal = c.get("clerkPrincipal");
    const requestId = c.get("requestId");
    const service = overrides.service ?? getDefaultService();

    try {
      const keys = await service.listOrgKeys({ orgId: principal.orgId });
      return c.json({ keys }, 200);
    } catch (error) {
      logger.error("listOrgKeys failed", {
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

  return keysRoutes;
}

export const keysRoutes = createKeysRoutes();
