import { createClerkClient } from "@clerk/backend";
import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import {
  createProvisioningService,
  resolvePrimaryEmail,
  type ClerkClient,
  type ProvisioningInput,
  type ProvisioningResult,
} from "@prontiq/control-plane";
import { createLogger } from "@prontiq/shared";

const accountSetupSuccessSchema = z.object({
  status: z.enum(["created", "already_exists"]),
  orgId: z.string().openapi({
    description: "Clerk organization id and active Prontiq/Lago customer identity.",
  }),
  emailSent: z.boolean().optional().openapi({
    description:
      "True only when the welcome email was best-effort sent for a freshly-created envelope. Absent on already_exists replays.",
  }),
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

export interface AccountRouteOverrides {
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

  const setupRoute = createRoute({
    method: "post",
    path: "/setup",
    summary: "Recover or initialise an org envelope (Clerk JWT auth)",
    description:
      "Idempotent. Resolves the caller's verified primary email via the Clerk Backend API and provisions the org envelope. The Clerk org id is the active Prontiq and Lago customer identity; Stripe remains only Lago's payment rail.",
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
      503: jsonResponse(apiErrorResponseSchema, "Retryable failure — Lago/Clerk/DDB transient"),
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
        return c.json(
          {
            error: {
              code: "FATAL_FAILURE",
              message:
                "Your primary email address is not verified. Verify it or set a verified email as primary, then try again.",
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
      actorId: principal.userId,
      orgId: principal.orgId,
      ownerEmail: emailLookup.email,
      source: "account-setup",
    });

    switch (result.status) {
      case "already_exists":
        logger.info("ORG envelope exists (account-setup replay)", {
          request_id: requestId,
          orgId: principal.orgId,
        });
        return c.json({ status: "already_exists" as const, orgId: principal.orgId }, 200);
      case "created":
        logger.info("ORG envelope created (account-setup)", {
          request_id: requestId,
          orgId: principal.orgId,
          emailSent: result.emailSent,
        });
        return c.json(
          { status: "created" as const, orgId: principal.orgId, emailSent: result.emailSent },
          201,
        );
      case "retryable_failure":
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
          message: "Unknown provisioning result",
          status: 500,
          request_id: requestId,
        },
      },
      500,
    );
  });

  return accountRoutes;
}

export const accountRoutes = createAccountRoutes();
