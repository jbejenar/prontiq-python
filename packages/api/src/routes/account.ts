import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { createClerkClient } from "@clerk/backend";
import {
  AccountBillingError,
  createProvisioningService,
  createAccountBillingService,
  resolvePrimaryEmail,
  type AccountBillingPlanChangeResponse,
  type AccountBillingPortalSessionResponse,
  type AccountBillingSummary,
  type ClerkClient,
  type ProvisioningInput,
  type ProvisioningResult,
} from "@prontiq/control-plane";
import { createLogger } from "@prontiq/shared";

/**
 * `POST /v1/account/setup` — Clerk-JWT-authenticated org provisioning
 * recovery endpoint (P1B.05 PR 3/3).
 *
 * Mirrors the Clerk webhook handler's provisioning code path 1:1:
 *   1. Resolve verified primary email via `resolvePrimaryEmail` from
 *      `@prontiq/control-plane` (Bug 2 + Bug 4 invariants enforced
 *      once at the package boundary, shared with the webhook).
 *   2. Call `createProvisioningService().provisionOrg(...)` — same
 *      `Idempotency-Key`-protected Stripe customer create + atomic
 *      `TransactWriteItems` for ORG envelope + audit row.
 *
 * Why this endpoint exists (per ARCHITECTURE.MD §5.7.1 "Manual
 * recovery path"): the future `/account` page (P1C.03) detects "no
 * envelope" on first load (the user signed up but the Clerk webhook
 * was lost / dead-lettered / not yet redelivered) and calls this
 * endpoint as the user-driven fallback. Idempotent by construction:
 * a successful webhook delivery + a subsequent dashboard recovery
 * call collapse to the same envelope (same `ORG#{orgId}` key, same
 * Stripe customer via the deterministic idempotency-key, single audit
 * row). The canonical commercial architecture is moving toward Lago,
 * but that migration has not landed in this endpoint yet.
 *
 * Auth contract is enforced by the upstream `clerkJwt()` middleware
 * mounted on `app.use("/v1/account/*")` in `account-handler.ts`. The
 * handler reads `c.get("clerkPrincipal")` and trusts the userId +
 * orgId already extracted from the verified JWT.
 *
 * Response code mapping (matches webhook semantics so failure modes
 * are uniform across both ingress paths):
 *   - 201 created      → fresh org, envelope written, Stripe customer
 *                        created, welcome email best-effort sent
 *   - 200 already_exists → idempotent replay; webhook already
 *                        provisioned this org
 *   - 503 retryable    → DDB throttle / Clerk API blip / Stripe 5xx;
 *                        client retries (or the dashboard surfaces
 *                        "we're having trouble — try again")
 *   - 500 fatal        → user has no primary email / primary email
 *                        unverified / provably-terminal failure;
 *                        operator-facing fix required
 */

const accountSetupSuccessSchema = z.object({
  status: z.enum(["created", "already_exists"]),
  stripeCustomerId: z.string(),
  emailSent: z.boolean().optional().openapi({
    description:
      "True only when the welcome email was best-effort sent for a freshly-created envelope. Absent on already_exists replays.",
  }),
});

const billingSummarySchema = z.object({
  allowedActions: z.object({
    canOpenPortal: z.boolean(),
    canRequestPlanChange: z.boolean(),
  }),
  billingPeriod: z.object({
    endsAt: z.string().nullable(),
    key: z.string().nullable(),
    startsAt: z.string().nullable(),
  }),
  customer: z.object({
    customerId: z.string(),
    lagoCustomerId: z.string().nullable(),
    orgId: z.string(),
  }),
  invoices: z.object({
    portalRequired: z.boolean(),
  }),
  payment: z.object({
    overdue: z.boolean(),
    overdueInvoiceId: z.string().nullable(),
  }),
  plan: z.object({
    current: z.enum(["free", "payg", "starter", "growth", "max", "enterprise"]),
    lagoPlanCode: z.string().nullable(),
    pending: z.object({
      downgradePlanDate: z.string().nullable(),
      nextPlanCode: z.string().nullable(),
      previousPlanCode: z.string().nullable(),
      status: z.string().nullable(),
    }),
    supportedSelfServeTargets: z.array(z.enum(["free", "payg"])),
  }),
  subscription: z.object({
    externalId: z.string(),
    status: z.string().nullable(),
  }),
});

const planChangeRequestSchema = z.object({
  targetPlanCode: z.enum(["free", "payg"]),
});

const idempotencyKeyHeaderSchema = z.object({
  "Idempotency-Key": z.string().trim().min(1).openapi({
    description: "Required idempotency key for replay-safe billing mutations.",
  }),
});

const planChangeResponseSchema = z.discriminatedUnion("status", [
  z.object({
    currentPlanCode: z.enum(["free", "payg", "starter", "growth", "max", "enterprise"]),
    status: z.literal("noop"),
    targetPlanCode: z.enum(["free", "payg"]),
  }),
  z.object({
    currentPlanCode: z.enum(["free", "payg", "starter", "growth", "max", "enterprise"]),
    effectiveAt: z.string().nullable(),
    status: z.enum(["submitted", "scheduled", "already_pending", "payment_method_required"]),
    subscriptionExternalId: z.string(),
    targetPlanCode: z.enum(["free", "payg"]),
    portalUrl: z.string().optional(),
  }),
]);

const portalSessionResponseSchema = z.object({
  expiresAt: z.string().nullable(),
  portalUrl: z.string(),
  status: z.literal("created"),
});

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

const clerkJwtSecurity = [{ ClerkJwt: [] }];

let cachedClerkClient: ClerkClient | undefined;
let cachedService: ReturnType<typeof createProvisioningService> | undefined;
let cachedBillingService: ReturnType<typeof createAccountBillingService> | undefined;
const logger = createLogger("api-account-routes");

function getDefaultClerkClient(): ClerkClient {
  if (cachedClerkClient) return cachedClerkClient;
  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey) {
    throw new Error("CLERK_SECRET_KEY is required");
  }
  cachedClerkClient = createClerkClient({ secretKey });
  return cachedClerkClient;
}

function getDefaultProvisioningService(): ReturnType<typeof createProvisioningService> {
  if (!cachedService) {
    cachedService = createProvisioningService();
  }
  return cachedService;
}

function getDefaultBillingService(): ReturnType<typeof createAccountBillingService> {
  if (!cachedBillingService) {
    cachedBillingService = createAccountBillingService();
  }
  return cachedBillingService;
}

export interface AccountRouteOverrides {
  billingService?: {
    createPortalSession(input: {
      idempotencyKey?: string;
      principal: { orgId: string; userId: string };
    }): Promise<AccountBillingPortalSessionResponse>;
    getBillingSummary(principal: { orgId: string }): Promise<AccountBillingSummary>;
    requestPlanChange(input: {
      idempotencyKey?: string;
      principal: { orgId: string; userId: string };
      targetPlanCode: string;
    }): Promise<AccountBillingPlanChangeResponse>;
  };
  clerkClient?: ClerkClient;
  service?: { provisionOrg: (input: ProvisioningInput) => Promise<ProvisioningResult> };
}

export function createAccountRoutes(overrides: AccountRouteOverrides = {}) {
  const accountRoutes = new OpenAPIHono({
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

  accountRoutes.openAPIRegistry.registerComponent("securitySchemes", "ClerkJwt", {
    type: "http",
    scheme: "bearer",
    bearerFormat: "JWT",
    description:
      "Clerk session token. Frontend obtains via `getToken()` then sends as `Authorization: Bearer <jwt>`.",
  });

  function billingErrorResponse(error: unknown, requestId: string) {
    if (error instanceof AccountBillingError) {
      return {
        body: {
          error: {
            code: error.code,
            message: error.message,
            status: error.httpStatus,
            request_id: requestId,
            ...(error.details ? { details: error.details } : {}),
          },
        },
        status: error.httpStatus,
      };
    }
    logger.error("Unhandled account billing route error", {
      request_id: requestId,
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      body: {
        error: {
          code: "INTERNAL_ERROR",
          message: "Internal server error",
          status: 500,
          request_id: requestId,
        },
      },
      status: 500 as const,
    };
  }

  function statusCode(response: ReturnType<typeof billingErrorResponse>) {
    return response.status;
  }

  const setupRoute = createRoute({
    method: "post",
    path: "/setup",
    summary: "Recover or initialise an org envelope (Clerk JWT auth)",
    description:
      "Idempotent. Resolves the caller's verified primary email via the Clerk Backend API and provisions the org's Stripe customer + envelope + audit row. Mirrors the Clerk webhook's provisioning path so a delayed/missed webhook is recoverable from the dashboard.",
    security: clerkJwtSecurity,
    request: {},
    responses: {
      200: jsonResponse(
        accountSetupSuccessSchema,
        "Org envelope already provisioned (replay-safe)",
      ),
      201: jsonResponse(accountSetupSuccessSchema, "Org envelope freshly created"),
      400: jsonResponse(apiErrorResponseSchema, "JWT missing org_id claim (NO_ACTIVE_ORG)"),
      401: jsonResponse(apiErrorResponseSchema, "Missing/invalid/expired JWT"),
      500: jsonResponse(apiErrorResponseSchema, "Fatal failure — operator-facing fix required"),
      503: jsonResponse(apiErrorResponseSchema, "Retryable failure — Stripe/Clerk/DDB transient"),
    },
  });

  accountRoutes.openapi(setupRoute, async (c) => {
    const principal = c.get("clerkPrincipal");
    const requestId = c.get("requestId");

    let clerkClient: ClerkClient;
    try {
      clerkClient = overrides.clerkClient ?? getDefaultClerkClient();
    } catch (error) {
      logger.error("Clerk client initialisation failed", {
        request_id: requestId,
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

    const emailLookup = await resolvePrimaryEmail(clerkClient, principal.userId);
    switch (emailLookup.kind) {
      case "transient_failure":
        logger.error("Clerk Backend API lookup failed (transient)", {
          request_id: requestId,
          orgId: principal.orgId,
          userId: principal.userId,
          error: emailLookup.error.message,
        });
        return c.json(
          {
            error: {
              code: "RETRYABLE_FAILURE",
              message: "Failed to resolve primary email via Clerk — please retry",
              status: 503,
              request_id: requestId,
              details: { reason: "clerk_api_lookup_failed" },
            },
          },
          503,
        );
      case "not_found":
        logger.error("User has no primary email — cannot provision via /v1/account/setup", {
          request_id: requestId,
          orgId: principal.orgId,
          userId: principal.userId,
        });
        return c.json(
          {
            error: {
              code: "FATAL_FAILURE",
              message:
                "Your account does not have a primary email address. Add one in your Clerk profile, then try again.",
              status: 500,
              request_id: requestId,
              details: { reason: "user_has_no_primary_email" },
            },
          },
          500,
        );
      case "not_verified":
        logger.error("Primary email is not verified — cannot provision via /v1/account/setup", {
          request_id: requestId,
          orgId: principal.orgId,
          userId: principal.userId,
          verificationStatus: emailLookup.verificationStatus,
        });
        return c.json(
          {
            error: {
              code: "FATAL_FAILURE",
              message:
                "Your primary email address is not verified. Verify it (or set a verified email as primary) in your Clerk profile, then try again.",
              status: 500,
              request_id: requestId,
              details: {
                reason: "primary_email_unverified",
                verificationStatus: emailLookup.verificationStatus,
              },
            },
          },
          500,
        );
      case "found":
        break;
    }

    const service = overrides.service ?? getDefaultProvisioningService();
    const result = await service.provisionOrg({
      orgId: principal.orgId,
      ownerEmail: emailLookup.email,
      actorId: principal.userId,
      source: "account-setup",
    });

    switch (result.status) {
      case "already_exists":
        logger.info("ORG envelope exists (account-setup replay)", {
          request_id: requestId,
          orgId: principal.orgId,
          stripeCustomerId: result.stripeCustomerId,
        });
        return c.json(
          {
            status: "already_exists" as const,
            stripeCustomerId: result.stripeCustomerId ?? "",
          },
          200,
        );
      case "created":
        logger.info("ORG envelope created (account-setup)", {
          request_id: requestId,
          orgId: principal.orgId,
          stripeCustomerId: result.stripeCustomerId,
          emailSent: result.emailSent,
        });
        return c.json(
          {
            status: "created" as const,
            stripeCustomerId: result.stripeCustomerId ?? "",
            emailSent: result.emailSent,
          },
          201,
        );
      case "retryable_failure":
        logger.error("ORG envelope provisioning retryable failure (account-setup)", {
          request_id: requestId,
          orgId: principal.orgId,
          stripeCustomerId: result.stripeCustomerId,
        });
        return c.json(
          {
            error: {
              code: "RETRYABLE_FAILURE",
              message: "Provisioning hit a transient error — please retry",
              status: 503,
              request_id: requestId,
            },
          },
          503,
        );
      case "fatal_failure":
        logger.error("ORG envelope provisioning fatal failure (account-setup)", {
          request_id: requestId,
          orgId: principal.orgId,
          stripeCustomerId: result.stripeCustomerId,
        });
        return c.json(
          {
            error: {
              code: "FATAL_FAILURE",
              message: "Provisioning failed irrecoverably — contact support if this persists",
              status: 500,
              request_id: requestId,
            },
          },
          500,
        );
    }

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
  });

  const billingSummaryRoute = createRoute({
    method: "get",
    path: "/billing",
    summary: "Get current account billing state",
    description:
      "Returns Prontiq-owned billing state for the caller's active Clerk organization. Lago remains off the API hot path; this admin/account route may read Lago-backed billing state.",
    security: clerkJwtSecurity,
    responses: {
      200: jsonResponse(billingSummarySchema, "Current billing state"),
      400: jsonResponse(apiErrorResponseSchema, "Invalid request"),
      401: jsonResponse(apiErrorResponseSchema, "Missing/invalid/expired JWT"),
      403: jsonResponse(apiErrorResponseSchema, "Caller is not an org admin"),
      404: jsonResponse(apiErrorResponseSchema, "Organization is not provisioned"),
      409: jsonResponse(apiErrorResponseSchema, "Customer mapping conflict"),
      500: jsonResponse(apiErrorResponseSchema, "Configuration or internal failure"),
      503: jsonResponse(apiErrorResponseSchema, "Lago unavailable"),
    },
  });

  accountRoutes.openapi(billingSummaryRoute, async (c) => {
    const requestId = c.get("requestId");
    const principal = c.get("clerkPrincipal");
    const service = overrides.billingService ?? getDefaultBillingService();
    try {
      return c.json(await service.getBillingSummary({ orgId: principal.orgId }), 200);
    } catch (error) {
      const response = billingErrorResponse(error, requestId);
      switch (statusCode(response)) {
        case 400:
          return c.json(response.body, 400);
        case 403:
          return c.json(response.body, 403);
        case 404:
          return c.json(response.body, 404);
        case 409:
          return c.json(response.body, 409);
        case 503:
          return c.json(response.body, 503);
        case 500:
          return c.json(response.body, 500);
      }
      return c.json(response.body, 500);
    }
  });

  const planChangeRoute = createRoute({
    method: "post",
    path: "/billing/plan-change",
    summary: "Request a Lago-backed plan change",
    description:
      "Admin-only and idempotent via Idempotency-Key. P1B.18 supports Free and PAYG self-service targets only.",
    security: clerkJwtSecurity,
    request: {
      body: {
        content: {
          "application/json": {
            schema: planChangeRequestSchema,
          },
        },
        required: true,
      },
      headers: idempotencyKeyHeaderSchema,
    },
    responses: {
      200: jsonResponse(planChangeResponseSchema, "Plan change accepted, scheduled, or a no-op"),
      400: jsonResponse(apiErrorResponseSchema, "Invalid request or missing Idempotency-Key"),
      401: jsonResponse(apiErrorResponseSchema, "Missing/invalid/expired JWT"),
      403: jsonResponse(apiErrorResponseSchema, "Plan changes disabled or caller unauthorized"),
      404: jsonResponse(apiErrorResponseSchema, "Organization is not provisioned"),
      409: jsonResponse(apiErrorResponseSchema, "Pending action or idempotency conflict"),
      500: jsonResponse(apiErrorResponseSchema, "Configuration or internal failure"),
      503: jsonResponse(apiErrorResponseSchema, "Lago unavailable"),
    },
  });

  accountRoutes.openapi(planChangeRoute, async (c) => {
    const requestId = c.get("requestId");
    const principal = c.get("clerkPrincipal");
    const service = overrides.billingService ?? getDefaultBillingService();
    const body = c.req.valid("json");
    try {
      return c.json(
        await service.requestPlanChange({
          idempotencyKey: c.req.header("Idempotency-Key"),
          principal: { orgId: principal.orgId, userId: principal.userId },
          targetPlanCode: body.targetPlanCode,
        }),
        200,
      );
    } catch (error) {
      const response = billingErrorResponse(error, requestId);
      switch (statusCode(response)) {
        case 400:
          return c.json(response.body, 400);
        case 403:
          return c.json(response.body, 403);
        case 404:
          return c.json(response.body, 404);
        case 409:
          return c.json(response.body, 409);
        case 503:
          return c.json(response.body, 503);
        case 500:
          return c.json(response.body, 500);
      }
      return c.json(response.body, 500);
    }
  });

  const portalSessionRoute = createRoute({
    method: "post",
    path: "/billing/portal-session",
    summary: "Create a Lago customer portal session",
    description:
      "Returns a Lago portal URL for invoice history, billing details, and payment-management surfaces.",
    security: clerkJwtSecurity,
    request: {
      headers: idempotencyKeyHeaderSchema,
    },
    responses: {
      200: jsonResponse(portalSessionResponseSchema, "Portal session created"),
      400: jsonResponse(apiErrorResponseSchema, "Missing Idempotency-Key"),
      401: jsonResponse(apiErrorResponseSchema, "Missing/invalid/expired JWT"),
      403: jsonResponse(apiErrorResponseSchema, "Caller is not an org admin"),
      404: jsonResponse(apiErrorResponseSchema, "Organization is not provisioned"),
      409: jsonResponse(apiErrorResponseSchema, "Idempotency conflict"),
      500: jsonResponse(apiErrorResponseSchema, "Configuration or internal failure"),
      503: jsonResponse(apiErrorResponseSchema, "Lago unavailable"),
    },
  });

  accountRoutes.openapi(portalSessionRoute, async (c) => {
    const requestId = c.get("requestId");
    const principal = c.get("clerkPrincipal");
    const service = overrides.billingService ?? getDefaultBillingService();
    try {
      return c.json(
        await service.createPortalSession({
          idempotencyKey: c.req.header("Idempotency-Key"),
          principal: { orgId: principal.orgId, userId: principal.userId },
        }),
        200,
      );
    } catch (error) {
      const response = billingErrorResponse(error, requestId);
      switch (statusCode(response)) {
        case 400:
          return c.json(response.body, 400);
        case 403:
          return c.json(response.body, 403);
        case 404:
          return c.json(response.body, 404);
        case 409:
          return c.json(response.body, 409);
        case 503:
          return c.json(response.body, 503);
        case 500:
          return c.json(response.body, 500);
      }
      return c.json(response.body, 500);
    }
  });

  return accountRoutes;
}

export const accountRoutes = createAccountRoutes();
