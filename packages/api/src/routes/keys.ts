import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { createKeyManagementService, type KeyManagementService } from "@prontiq/control-plane";
import { createLogger } from "@prontiq/shared";
import {
  clerkAdminOnly,
  clerkReverificationError403Schema,
  requireReverification,
} from "../middleware/clerk-jwt.js";

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

/**
 * 403 response schema for routes that compose `requireReverification`
 * after `clerkAdminOnly`. Two mutually-exclusive 403 paths exist on
 * those routes:
 *
 *   - `INSUFFICIENT_ROLE` — admin gate rejection. Standard envelope.
 *   - `reverification-error` (stale `fva`) — Clerk-native top-level
 *     `clerk_error` body that `useReverification()` matches against.
 *
 * Both must be documented or generated clients / contract tests will
 * mis-type the actual runtime body. `z.union` translates to OpenAPI
 * `oneOf` via `@asteasolutions/zod-to-openapi`.
 */
const stepUpRoute403Schema = z.union([apiErrorResponseSchema, clerkReverificationError403Schema]);

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

const auditEventSchema = z.object({
  action: z.string(),
  actorId: z.string(),
  timestamp: z.string(),
  metadata: z
    .object({
      keyId: z.string().optional(),
      label: z.string().optional(),
    })
    .optional(),
  ip: z.string().optional(),
  userAgent: z.string().optional(),
});

const listAuditSuccessSchema = z.object({ events: z.array(auditEventSchema) });

const accountStatusSchema = z.discriminatedUnion("provisioned", [
  z.object({
    orgId: z.string(),
    orgRole: z.string(),
    canManageKeys: z.boolean(),
    provisioned: z.literal(false),
  }),
  z.object({
    orgId: z.string(),
    orgRole: z.string(),
    canManageKeys: z.boolean(),
    provisioned: z.literal(true),
    hasFirstKey: z.boolean(),
    activeKeyCount: z.number().int().nonnegative(),
    tier: z.string(),
    maxKeys: z.number().int().nonnegative(),
  }),
]);

// Body schema shared by /keys/rotate and /keys/revoke. The keyId
// regex is the canonical Crockford-base32 ULID-prefix shape we
// generate at create time; rejecting non-conforming input early
// keeps the service layer free of input-validation duplication.
const keyIdBodySchema = z.object({
  keyId: z.string().regex(/^key_[0-9A-Z]{26}$/, "expected key_<26-char-Crockford-ULID>"),
});

const rotateKeySuccessSchema = z.object({
  keyId: z.string(),
  raw: z.string().openapi({
    description:
      "The raw key for the rotated identity. Returned ONCE in this response. Old raw remains valid for 5 minutes via the REDIRECT grace.",
  }),
  keyPrefix: z.string(),
  createdAt: z
    .string()
    .openapi({ description: "Original creation timestamp — preserved across rotation." }),
  rotatedAt: z.string().openapi({ description: "ISO-8601 timestamp of this rotation." }),
});

const revokeKeySuccessSchema = z.object({
  keyId: z.string(),
  revokedAt: z.string().openapi({ description: "ISO-8601 timestamp of the revocation." }),
});

let cachedDdb: DynamoDBDocumentClient | undefined;
let cachedService: KeyManagementService | undefined;

function getDefaultService(): KeyManagementService {
  if (cachedService) return cachedService;
  cachedDdb ??= DynamoDBDocumentClient.from(new DynamoDBClient({}));
  const keysTableName = process.env.KEYS_TABLE_NAME;
  if (!keysTableName) throw new Error("KEYS_TABLE_NAME is required");
  const auditTableName = process.env.AUDIT_TABLE_NAME;
  if (!auditTableName) throw new Error("AUDIT_TABLE_NAME is required");
  const usageTableName = process.env.USAGE_TABLE_NAME;
  if (!usageTableName) throw new Error("USAGE_TABLE_NAME is required");
  cachedService = createKeyManagementService({
    ddb: cachedDdb,
    keysTableName,
    auditTableName,
    usageTableName,
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
  // mutations. The reverification gate runs AFTER admin so a member
  // token gets a clean 403 INSUFFICIENT_ROLE rather than a step-up
  // modal they can't satisfy.
  keysRoutes.use("/keys/create", clerkAdminOnly());
  keysRoutes.use("/keys/rotate", clerkAdminOnly(), requireReverification());
  keysRoutes.use("/keys/revoke", clerkAdminOnly(), requireReverification());

  const statusRoute = createRoute({
    method: "get",
    path: "/status",
    summary: "Read account key-management status (member-allowed)",
    description:
      "Returns the caller's org provisioning status and key-management capability. Used by the console to choose between setup recovery, first-key creation, and key-list states without probing mutation endpoints.",
    security: clerkJwtSecurity,
    responses: {
      200: jsonResponse(accountStatusSchema, "Account status for the active Clerk org"),
      401: jsonResponse(apiErrorResponseSchema, "Missing/invalid JWT"),
      500: jsonResponse(apiErrorResponseSchema, "Server error"),
    },
  });

  keysRoutes.openapi(statusRoute, async (c) => {
    const principal = c.get("clerkPrincipal");
    const requestId = c.get("requestId");
    const service = overrides.service ?? getDefaultService();

    try {
      const status = await service.getOrgStatus({
        orgId: principal.orgId,
        orgRole: principal.orgRole,
      });
      return c.json(status, 200);
    } catch (error) {
      logger.error("getOrgStatus failed", {
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
    const validated = c.req.valid("json") as z.infer<typeof createKeyBodySchema> | undefined;
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

  const listAuditRoute = createRoute({
    method: "get",
    path: "/audit",
    summary: "List recent account audit events (member-allowed)",
    description:
      "Returns the latest API-key lifecycle audit events for the caller's org, newest first. Used by the console key-management page to show recent CREATE / ROTATE / REVOKE activity. Raw API keys, key hashes, and hash-bearing internal metadata are never present.",
    security: clerkJwtSecurity,
    responses: {
      200: jsonResponse(listAuditSuccessSchema, "Recent audit events for this org"),
      401: jsonResponse(apiErrorResponseSchema, "Missing/invalid JWT"),
      500: jsonResponse(apiErrorResponseSchema, "Server error"),
    },
  });

  keysRoutes.openapi(listAuditRoute, async (c) => {
    const principal = c.get("clerkPrincipal");
    const requestId = c.get("requestId");
    const service = overrides.service ?? getDefaultService();

    try {
      const events = await service.listAuditTail({ orgId: principal.orgId });
      return c.json({ events }, 200);
    } catch (error) {
      logger.error("listAuditTail failed", {
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

  const rotateKeyRoute = createRoute({
    method: "post",
    path: "/keys/rotate",
    summary: "Rotate an API key (admin + step-up)",
    description:
      "Issues a new raw key under the existing `keyId`. The old key remains valid for 5 minutes via a REDIRECT row in the usage table — clients must update credentials within that window. `createdAt` is preserved; `rotatedAt` records the rotation. Requires recent second-factor reverification (`fva` claim).",
    security: clerkJwtSecurity,
    request: {
      body: { content: { "application/json": { schema: keyIdBodySchema } }, required: true },
    },
    responses: {
      200: jsonResponse(rotateKeySuccessSchema, "Key rotated. New raw returned once."),
      400: jsonResponse(apiErrorResponseSchema, "Invalid request body"),
      401: jsonResponse(apiErrorResponseSchema, "Missing/invalid JWT"),
      403: jsonResponse(
        stepUpRoute403Schema,
        "INSUFFICIENT_ROLE (admin gate, standard envelope) OR reverification-error (Clerk-native body for stale fva)",
      ),
      404: jsonResponse(apiErrorResponseSchema, "KEY_NOT_FOUND"),
      500: jsonResponse(apiErrorResponseSchema, "Server error / STEP_UP_MISCONFIGURED"),
    },
  });

  keysRoutes.openapi(rotateKeyRoute, async (c) => {
    const principal = c.get("clerkPrincipal");
    const requestId = c.get("requestId");
    const service = overrides.service ?? getDefaultService();

    const validated = c.req.valid("json") as z.infer<typeof keyIdBodySchema>;
    const ip = getCallerIp(c);
    const userAgent = c.req.header("user-agent");

    let result;
    try {
      result = await service.rotateKey({
        orgId: principal.orgId,
        keyId: validated.keyId,
        actorId: principal.userId,
        ...(ip !== undefined ? { ip } : {}),
        ...(userAgent !== undefined ? { userAgent } : {}),
      });
    } catch (error) {
      logger.error("rotateKey failed", {
        request_id: requestId,
        orgId: principal.orgId,
        keyId: validated.keyId,
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

    if (result.status === "key_not_found") {
      return c.json(
        {
          error: {
            code: "KEY_NOT_FOUND",
            message:
              "No active key with that keyId exists in this org. The key may have been revoked or already rotated.",
            status: 404,
            request_id: requestId,
          },
        },
        404,
      );
    }

    return c.json(
      {
        keyId: result.keyId,
        raw: result.raw,
        keyPrefix: result.keyPrefix,
        createdAt: result.createdAt,
        rotatedAt: result.rotatedAt,
      },
      200,
    );
  });

  const revokeKeyRoute = createRoute({
    method: "post",
    path: "/keys/revoke",
    summary: "Revoke an API key (admin + step-up)",
    description:
      "Marks a key as inactive. Subsequent requests with the raw key (or with the pre-rotation raw, if a rotation grace was active) return 401. Decrements `activeKeyCount` atomically so create-quota frees up. Requires recent second-factor reverification.",
    security: clerkJwtSecurity,
    request: {
      body: { content: { "application/json": { schema: keyIdBodySchema } }, required: true },
    },
    responses: {
      200: jsonResponse(revokeKeySuccessSchema, "Key revoked."),
      400: jsonResponse(apiErrorResponseSchema, "Invalid request body"),
      401: jsonResponse(apiErrorResponseSchema, "Missing/invalid JWT"),
      403: jsonResponse(
        stepUpRoute403Schema,
        "INSUFFICIENT_ROLE (admin gate, standard envelope) OR reverification-error (Clerk-native body for stale fva)",
      ),
      404: jsonResponse(apiErrorResponseSchema, "KEY_NOT_FOUND"),
      409: jsonResponse(apiErrorResponseSchema, "KEY_ALREADY_REVOKED"),
      500: jsonResponse(apiErrorResponseSchema, "Server error / STEP_UP_MISCONFIGURED"),
    },
  });

  keysRoutes.openapi(revokeKeyRoute, async (c) => {
    const principal = c.get("clerkPrincipal");
    const requestId = c.get("requestId");
    const service = overrides.service ?? getDefaultService();

    const validated = c.req.valid("json") as z.infer<typeof keyIdBodySchema>;
    const ip = getCallerIp(c);
    const userAgent = c.req.header("user-agent");

    let result;
    try {
      result = await service.revokeKey({
        orgId: principal.orgId,
        keyId: validated.keyId,
        actorId: principal.userId,
        ...(ip !== undefined ? { ip } : {}),
        ...(userAgent !== undefined ? { userAgent } : {}),
      });
    } catch (error) {
      logger.error("revokeKey failed", {
        request_id: requestId,
        orgId: principal.orgId,
        keyId: validated.keyId,
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

    if (result.status === "key_not_found") {
      return c.json(
        {
          error: {
            code: "KEY_NOT_FOUND",
            message: "No key with that keyId exists in this org.",
            status: 404,
            request_id: requestId,
          },
        },
        404,
      );
    }
    if (result.status === "already_revoked") {
      return c.json(
        {
          error: {
            code: "KEY_ALREADY_REVOKED",
            message: "This key is already revoked. No action taken.",
            status: 409,
            request_id: requestId,
          },
        },
        409,
      );
    }

    return c.json({ keyId: result.keyId, revokedAt: result.revokedAt }, 200);
  });

  return keysRoutes;
}

export const keysRoutes = createKeysRoutes();
