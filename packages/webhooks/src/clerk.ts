import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2, Context } from "aws-lambda";
import { Webhook, WebhookVerificationError } from "svix";
import { createClerkClient, type ClerkClient } from "@clerk/backend";
import {
  createProvisioningService,
  getAdminRoles,
  resolvePrimaryEmail,
} from "@prontiq/control-plane";

/**
 * Clerk webhook handler for `organizationMembership.created`.
 *
 * Per ARCHITECTURE.MD §5.7.1 (post-review), this handler provisions
 * the **org envelope** (Stripe customer + ORG#{orgId} record + audit
 * row + best-effort welcome email). It does NOT mint API keys —
 * that's the user-driven `POST /v1/account/keys/create` (P1C.03).
 *
 * Events:
 *   - `organizationMembership.created` with admin role → resolve verified
 *     primary email from Clerk Backend API → provision
 *   - `organizationMembership.created` with non-admin role → 200 no-op
 *     (an invited user, not the org creator)
 *   - any other event type → 200 no-op (forward-compat)
 *
 * Response contract:
 *   - 401 on Svix signature failure (invalid → Clerk does not retry)
 *   - 500 on retryable_failure / fatal_failure / Clerk-API failure
 *     (Svix redelivers; if persistent, lands in DLQ alarm via
 *     PqClerkWebhookErrors)
 *   - 200 on already_exists / created / skipped / unknown event type
 *
 * Critical invariants:
 *   - NEVER return 200 unless the org envelope is confirmed durable.
 *   - NEVER use `public_user_data.identifier` as an email — it can be
 *     a phone number, username, or OAuth handle depending on Clerk auth
 *     config. Always resolve via the Backend API's verified primary
 *     email.
 *   - NEVER hard-code Clerk role tokens — Clerk's default org admin role
 *     is `org:admin`, not `admin`, and operators may configure custom
 *     role sets. Allow override via CLERK_ADMIN_ROLES env var.
 */

interface ClerkOrganizationMembershipPayload {
  data: {
    organization: {
      id: string;
    };
    public_user_data: {
      user_id: string;
      identifier?: string;
    };
    role: string;
  };
  type: string;
}

interface ParsedClerkEvent {
  type: string;
  data: unknown;
}

let cachedService: ReturnType<typeof createProvisioningService> | undefined;
let cachedSecret: string | undefined;
let cachedClerkClient: ClerkClient | undefined;

function getProvisioningService(): ReturnType<typeof createProvisioningService> {
  if (!cachedService) {
    cachedService = createProvisioningService();
  }
  return cachedService;
}

function getWebhookSecret(): string {
  if (cachedSecret) return cachedSecret;
  const secret = process.env.CLERK_WEBHOOK_SECRET;
  if (!secret) {
    throw new Error("CLERK_WEBHOOK_SECRET is required");
  }
  cachedSecret = secret;
  return secret;
}

function getDefaultClerkClient(): ClerkClient {
  if (cachedClerkClient) return cachedClerkClient;
  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey) {
    throw new Error("CLERK_SECRET_KEY is required");
  }
  cachedClerkClient = createClerkClient({ secretKey });
  return cachedClerkClient;
}

function getRawBody(event: APIGatewayProxyEventV2): string {
  if (!event.body) return "";
  if (event.isBase64Encoded) {
    return Buffer.from(event.body, "base64").toString("utf8");
  }
  return event.body;
}

function getSvixHeaders(
  rawHeaders: APIGatewayProxyEventV2["headers"],
): Record<string, string> {
  // APIGW v2 lowercases header names but the Svix verifier accepts
  // arbitrary case via Record<string, string>; keep the lookup
  // case-insensitive defensively.
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(rawHeaders ?? {})) {
    if (value !== undefined) {
      out[key.toLowerCase()] = value;
    }
  }
  return out;
}

function isOrganizationMembershipCreated(
  parsed: ParsedClerkEvent,
): parsed is ClerkOrganizationMembershipPayload {
  if (parsed.type !== "organizationMembership.created") return false;
  const data = parsed.data as Partial<ClerkOrganizationMembershipPayload["data"]>;
  if (!data || typeof data !== "object") return false;
  if (typeof data.organization?.id !== "string" || data.organization.id.length === 0) return false;
  if (typeof data.public_user_data?.user_id !== "string" || data.public_user_data.user_id.length === 0) return false;
  if (typeof data.role !== "string" || data.role.length === 0) return false;
  return true;
}

function reply(statusCode: number, body: Record<string, unknown>): APIGatewayProxyResultV2 {
  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

export interface HandlerOverrides {
  service?: ReturnType<typeof createProvisioningService>;
  webhookSecret?: string;
  clerkClient?: ClerkClient;
  adminRoles?: ReadonlySet<string>;
}

export function createClerkHandler(overrides: HandlerOverrides = {}) {
  return async function clerkHandler(
    event: APIGatewayProxyEventV2,
    _context?: Context,
  ): Promise<APIGatewayProxyResultV2> {
    let parsed: ParsedClerkEvent;
    try {
      const secret = overrides.webhookSecret ?? getWebhookSecret();
      const rawBody = getRawBody(event);
      const svixHeaders = getSvixHeaders(event.headers);
      const wh = new Webhook(secret);
      // svix's verify() returns the parsed payload on success and
      // throws WebhookVerificationError on signature failure.
      const verified = wh.verify(rawBody, svixHeaders) as ParsedClerkEvent | null;
      if (!verified || typeof verified !== "object" || typeof verified.type !== "string") {
        console.warn("Clerk webhook verified but payload shape is unexpected", {
          svixId: svixHeaders["svix-id"],
        });
        return reply(400, { error: "malformed_payload" });
      }
      parsed = verified;
    } catch (error) {
      if (error instanceof WebhookVerificationError) {
        console.warn("Clerk webhook signature verification failed", {
          message: error.message,
        });
        return reply(401, { error: "invalid_signature" });
      }
      // CLERK_WEBHOOK_SECRET missing or other startup error — fail
      // loud so the platform alarm fires.
      console.error("Clerk webhook handler failed before verification", {
        error: error instanceof Error ? error.message : String(error),
      });
      return reply(500, { error: "internal_error" });
    }

    if (parsed.type !== "organizationMembership.created") {
      console.info("Skipping non-provisioning event", { type: parsed.type });
      return reply(200, { skipped: true, reason: "unsubscribed_event_type", type: parsed.type });
    }

    if (!isOrganizationMembershipCreated(parsed)) {
      console.warn("organizationMembership.created payload missing required fields", {
        type: parsed.type,
      });
      return reply(400, { error: "malformed_payload", type: parsed.type });
    }

    const { data } = parsed;
    const adminRoles = overrides.adminRoles ?? getAdminRoles();
    if (!adminRoles.has(data.role)) {
      console.info("Skipping non-admin organizationMembership.created", {
        orgId: data.organization.id,
        userId: data.public_user_data.user_id,
        role: data.role,
      });
      return reply(200, { skipped: true, reason: "non_admin_membership", role: data.role });
    }

    // Resolve the verified primary email from Clerk Backend API.
    // public_user_data.identifier could be a phone, username, or
    // OAuth handle depending on the Clerk app's auth config — we
    // need a real email for Stripe customer creation + the welcome
    // email path.
    let clerkClient: ClerkClient;
    try {
      clerkClient = overrides.clerkClient ?? getDefaultClerkClient();
    } catch (error) {
      console.error("Clerk client initialisation failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      return reply(500, { error: "internal_error" });
    }

    const emailLookup = await resolvePrimaryEmail(clerkClient, data.public_user_data.user_id);
    switch (emailLookup.kind) {
      case "transient_failure":
        console.error("Clerk Backend API lookup failed (transient)", {
          orgId: data.organization.id,
          userId: data.public_user_data.user_id,
          error: emailLookup.error.message,
        });
        return reply(500, { error: "retryable_failure", reason: "clerk_api_lookup_failed" });
      case "not_found":
        // User has no primary email at all (phone-first / OAuth-only
        // signup, or operator deleted the email post-signup). Cannot
        // provision — operator must add a primary email in the Clerk
        // dashboard, then "Resend" the failed message.
        console.error("User has no primary email — cannot provision", {
          orgId: data.organization.id,
          userId: data.public_user_data.user_id,
        });
        return reply(500, { error: "fatal_failure", reason: "user_has_no_primary_email" });
      case "not_verified":
        // Primary email exists but verification didn't complete
        // (unverified | failed | expired | transferable). Forwarding
        // an unverified email to Stripe + SES would create a customer
        // record against a typoed / unconfirmed address. Operator fix
        // is "verify your primary email" or "set a verified email as
        // primary in Clerk dashboard", then "Resend" the failed
        // message.
        console.error("Primary email is not verified — cannot provision", {
          orgId: data.organization.id,
          userId: data.public_user_data.user_id,
          verificationStatus: emailLookup.verificationStatus,
        });
        return reply(500, { error: "fatal_failure", reason: "primary_email_unverified" });
      case "found":
        break;
    }

    const service = overrides.service ?? getProvisioningService();
    const result = await service.provisionOrg({
      orgId: data.organization.id,
      ownerEmail: emailLookup.email,
      actorId: data.public_user_data.user_id,
      source: "clerk-webhook",
    });

    switch (result.status) {
      case "already_exists":
        console.info("ORG envelope exists", {
          orgId: data.organization.id,
          stripeCustomerId: result.stripeCustomerId,
        });
        return reply(200, { ok: true, status: "already_exists" });
      case "created":
        console.info("ORG envelope created", {
          orgId: data.organization.id,
          stripeCustomerId: result.stripeCustomerId,
          emailSent: result.emailSent,
        });
        return reply(200, { ok: true, status: "created", emailSent: result.emailSent });
      case "retryable_failure":
        console.error("ORG envelope provisioning retryable failure", {
          orgId: data.organization.id,
          stripeCustomerId: result.stripeCustomerId,
        });
        return reply(500, { error: "retryable_failure" });
      case "fatal_failure":
        console.error("ORG envelope provisioning fatal failure", {
          orgId: data.organization.id,
          stripeCustomerId: result.stripeCustomerId,
        });
        return reply(500, { error: "fatal_failure" });
    }

    return reply(500, { error: "internal_error" });
  };
}

export const handler = createClerkHandler();
