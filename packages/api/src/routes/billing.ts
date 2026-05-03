import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import {
  createDefaultBillingPlanChangeService,
  type BillingActionRecord,
  type BillingPlanChangeService,
} from "@prontiq/control-plane";
import { createLogger, type LagoCatalogEnvironment } from "@prontiq/shared";
import {
  clerkAdminOnly,
  clerkReverificationError403Schema,
  requireFirstFactorReverification,
} from "../middleware/clerk-jwt.js";

const clerkJwtSecurity = [{ ClerkJwt: [] }];
const logger = createLogger("api-billing-routes");

const apiErrorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    status: z.number().int(),
    request_id: z.string(),
    details: z.record(z.string(), z.unknown()).optional(),
  }),
});

const stepUpRoute403Schema = z.union([apiErrorResponseSchema, clerkReverificationError403Schema]);

const planChangeBodySchema = z.object({
  targetPlanCode: z.string().min(1).max(128),
});

const planChangeSuccessSchema = z.object({
  currentPlanCode: z.string().nullable(),
  downgradePlanDate: z.string().nullable(),
  nextPlanCode: z.string().nullable(),
  reconciliationState: z.enum(["not_required", "pending_lago_webhook"]),
  status: z.enum(["accepted", "noop", "pending"]),
  targetPlanCode: z.string(),
});

const idempotencyKeySchema = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9._~:-]+$/);

const jsonResponse = (schema: z.ZodType, description: string) => ({
  content: { "application/json": { schema } },
  description,
});

let cachedService: BillingPlanChangeService | undefined;

export interface BillingRouteOverrides {
  planChangesEnabled?: boolean;
  allowedOrgIds?: Set<string> | null;
  service?: BillingPlanChangeService;
}

function getRequiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function getCatalogEnv(): LagoCatalogEnvironment {
  const raw = process.env.PRONTIQ_BILLING_CATALOG_ENV;
  if (raw === "dev" || raw === "prod" || raw === "all") return raw;
  return process.env.PRONTIQ_STAGE === "prod" ? "prod" : "dev";
}

function parseAllowedOrgIds(value: string | undefined): Set<string> | null {
  if (!value) return null;
  const ids = value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return ids.length > 0 ? new Set(ids) : null;
}

function getDefaultService(): BillingPlanChangeService {
  if (cachedService) return cachedService;
  cachedService = createDefaultBillingPlanChangeService({
    catalogEnv: getCatalogEnv(),
    lagoApiKey: getRequiredEnv("LAGO_API_KEY"),
    lagoApiUrl: getRequiredEnv("LAGO_API_URL"),
    tableName: getRequiredEnv("BILLING_ACTIONS_TABLE_NAME"),
  });
  return cachedService;
}

function replayResponse(action: BillingActionRecord):
  | { body: unknown; status: 200 | 409 | 502 }
  | { body: unknown; status: number } {
  if (action.status === "provider_accepted" && action.responseBody) {
    return { body: action.responseBody, status: 200 };
  }
  if (action.status === "provider_in_flight" || action.status === "outcome_unknown") {
    return {
      body: {
        code: "LAGO_PLAN_CHANGE_OUTCOME_UNKNOWN",
        message: "Billing plan change outcome is unknown. Inspect Lago before retrying.",
        status: 409,
      },
      status: 409,
    };
  }
  return {
    body: {
      code: action.errorCode ?? "LAGO_PLAN_CHANGE_FAILED",
      message: action.errorMessage ?? "Stored billing plan change failed.",
      status: action.errorStatus ?? 502,
    },
    status: action.errorStatus ?? 502,
  };
}

function errorBody(c: { get(key: "requestId"): string }, input: {
  code: string;
  details?: Record<string, unknown>;
  message: string;
  status: number;
}) {
  return {
    error: {
      code: input.code,
      message: input.message,
      status: input.status,
      request_id: c.get("requestId"),
      ...(input.details ? { details: input.details } : {}),
    },
  };
}

export function createBillingRoutes(overrides: BillingRouteOverrides = {}) {
  const billingRoutes = new OpenAPIHono({
    defaultHook: (result, c) => {
      if (result.success) return;
      return c.json(
        errorBody(c, {
          code: "INVALID_PARAMETERS",
          message: "Invalid request body",
          status: 400,
          details: result.error.flatten().fieldErrors,
        }),
        400,
      );
    },
  });

  billingRoutes.openAPIRegistry.registerComponent("securitySchemes", "ClerkJwt", {
    type: "http",
    scheme: "bearer",
    bearerFormat: "JWT",
    description: "Clerk session token; sent as `Authorization: Bearer <jwt>`.",
  });

  billingRoutes.use(
    "/billing/plan-change",
    clerkAdminOnly(),
    requireFirstFactorReverification(),
  );

  const planChangeRoute = createRoute({
    method: "post",
    path: "/billing/plan-change",
    summary: "Change Lago subscription plan (admin only)",
    description:
      "Replay-safe Lago plan-change adapter. Clerk org admins submit a target Lago plan code with an Idempotency-Key; Lago remains the billing source of truth and webhook reconciliation updates local enforcement.",
    security: clerkJwtSecurity,
    request: {
      body: {
        content: { "application/json": { schema: planChangeBodySchema } },
        required: true,
      },
    },
    responses: {
      200: jsonResponse(planChangeSuccessSchema, "Plan change accepted, pending, or no-op."),
      400: jsonResponse(apiErrorResponseSchema, "Invalid body, idempotency key, or target plan"),
      401: jsonResponse(apiErrorResponseSchema, "Missing/invalid JWT"),
      403: jsonResponse(stepUpRoute403Schema, "INSUFFICIENT_ROLE, feature disabled, or step-up required"),
      404: jsonResponse(apiErrorResponseSchema, "Lago subscription not found"),
      409: jsonResponse(apiErrorResponseSchema, "Idempotency conflict, action in progress, or pending transition"),
      500: jsonResponse(apiErrorResponseSchema, "Server error"),
      502: jsonResponse(apiErrorResponseSchema, "Lago plan change failed"),
      503: jsonResponse(apiErrorResponseSchema, "Ledger unavailable"),
    },
  });

  billingRoutes.openapi(planChangeRoute, async (c) => {
    const principal = c.get("clerkPrincipal");
    const idempotencyKey = c.req.header("idempotency-key")?.trim();
    if (!idempotencyKey) {
      return c.json(
        errorBody(c, {
          code: "MISSING_IDEMPOTENCY_KEY",
          message: "Idempotency-Key header is required.",
          status: 400,
        }),
        400,
      );
    }
    if (!idempotencyKeySchema.safeParse(idempotencyKey).success) {
      return c.json(
        errorBody(c, {
          code: "INVALID_IDEMPOTENCY_KEY",
          message: "Idempotency-Key must be 1-256 URL-safe characters.",
          status: 400,
        }),
        400,
      );
    }

    const planChangesEnabled =
      overrides.planChangesEnabled ?? process.env.PRONTIQ_BILLING_PLAN_CHANGES_ENABLED === "true";
    if (!planChangesEnabled) {
      return c.json(
        errorBody(c, {
          code: "FEATURE_DISABLED",
          message: "Billing plan changes are not enabled.",
          status: 403,
        }),
        403,
      );
    }

    const allowedOrgIds =
      overrides.allowedOrgIds ??
      parseAllowedOrgIds(process.env.PRONTIQ_BILLING_PLAN_CHANGE_ALLOWED_ORG_IDS);
    if (allowedOrgIds && !allowedOrgIds.has(principal.orgId)) {
      return c.json(
        errorBody(c, {
          code: "ORG_NOT_ALLOWLISTED",
          message: "Billing plan changes are not enabled for this organization.",
          status: 403,
        }),
        403,
      );
    }

    const body = c.req.valid("json");
    const service = overrides.service ?? getDefaultService();
    const result = await service.changePlan({
      actorUserId: principal.userId,
      idempotencyKey,
      orgId: principal.orgId,
      targetPlanCode: body.targetPlanCode,
    });

    if (result.kind === "success") return c.json(result.responseBody, 200);
    if (result.kind === "conflict") {
      return c.json(
        errorBody(c, {
          code: "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST",
          message: "Idempotency-Key was already used for a different request.",
          status: 409,
        }),
        409,
      );
    }
    if (result.kind === "in_progress") {
      return c.json(
        errorBody(c, {
          code: "ACTION_IN_PROGRESS",
          message: "A billing plan change is already in progress.",
          status: 409,
        }),
        409,
      );
    }
    if (result.kind === "transition_in_progress") {
      return c.json(
        errorBody(c, {
          code: "BILLING_TRANSITION_IN_PROGRESS",
          message: "A billing transition is already fenced for this organization.",
          status: 409,
        }),
        409,
      );
    }
    if (result.kind === "ledger_unavailable") {
      return c.json(
        errorBody(c, {
          code: "BILLING_ACTION_LEDGER_UNAVAILABLE",
          message: "Billing action ledger is unavailable. No Lago plan change was attempted.",
          status: 503,
        }),
        503,
      );
    }
    if (result.kind === "provider_error" || result.kind === "finalize_error") {
      logger.warn("billing plan change failed", {
        code: result.code,
        orgId: principal.orgId,
        request_id: c.get("requestId"),
        status: result.status,
      });
      return c.json(
        errorBody(c, {
          code: result.code,
          message: result.message,
          status: result.status,
        }),
        result.status as 400 | 401 | 403 | 404 | 409 | 500 | 502 | 503,
      );
    }

    if (result.kind === "replay") {
      const replay = replayResponse(result.action);
      const replayBody = replay.status === 200
        ? replay.body
        : errorBody(c, replay.body as { code: string; message: string; status: number });
      return c.json(replayBody, replay.status as 200 | 400 | 404 | 409 | 500 | 502);
    }

    return c.json(
      errorBody(c, {
        code: "INTERNAL_ERROR",
        message: "Internal server error",
        status: 500,
      }),
      500,
    );
  });

  return billingRoutes;
}

export const billingRoutes = createBillingRoutes();
