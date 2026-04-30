import { auth } from "@clerk/nextjs/server";

import { serverEnv } from "./server-env.js";

export interface BillingPrincipal {
  fva?: number[];
  orgId: string;
  orgRole: string;
  userId: string;
  canManageBilling: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getString(value: unknown, paths: string[][]): string | null {
  for (const path of paths) {
    let cursor = value;
    for (const segment of path) {
      cursor = isRecord(cursor) ? cursor[segment] : undefined;
    }
    if (typeof cursor === "string" && cursor.length > 0) return cursor;
  }
  return null;
}

function adminRoles() {
  return new Set(
    (serverEnv.CLERK_ADMIN_ROLES ?? "org:admin,admin")
      .split(",")
      .map((role) => role.trim())
      .filter(Boolean),
  );
}

function getFva(claims: Record<string, unknown>) {
  const raw = claims.fva;
  return Array.isArray(raw) && raw.every((item) => typeof item === "number")
    ? (raw as number[])
    : undefined;
}

export async function getBillingPrincipal(): Promise<BillingPrincipal | Response> {
  const session = await auth();
  const claims = isRecord(session.sessionClaims) ? session.sessionClaims : {};
  const userId = session.userId ?? getString(claims, [["sub"]]);
  const orgId = session.orgId ?? getString(claims, [["org_id"], ["o", "id"]]);
  const orgRole = session.orgRole ?? getString(claims, [["org_role"], ["o", "rol"]]);
  const fva = getFva(claims);

  if (!userId) {
    return Response.json(
      { error: { code: "NO_CLERK_SESSION", message: "Sign in is required.", status: 401 } },
      { status: 401 },
    );
  }
  if (!orgId || !orgRole) {
    return Response.json(
      {
        error: {
          code: "NO_ACTIVE_ORG",
          message: "Select an organization before using billing.",
          status: 403,
        },
      },
      { status: 403 },
    );
  }

  const canManageBilling = adminRoles().has(orgRole);
  return { orgId, orgRole, userId, canManageBilling, ...(fva ? { fva } : {}) };
}

export function requireBillingAdmin(principal: BillingPrincipal): Response | null {
  if (principal.canManageBilling) return null;
  return Response.json(
    {
      error: {
        code: "INSUFFICIENT_ROLE",
        message: "Only organization admins can manage billing payment links.",
        status: 403,
      },
    },
    { status: 403 },
  );
}

export function requireBillingReverification(
  principal: BillingPrincipal,
  input: { maxFirstFactorAgeMinutes?: number } = {},
): Response | null {
  const max = input.maxFirstFactorAgeMinutes ?? 10;
  if (!principal.fva || !Array.isArray(principal.fva)) {
    return Response.json(
      {
        error: {
          code: "STEP_UP_MISCONFIGURED",
          message: "Step-up enforcement is not configured. Contact support.",
          status: 500,
        },
      },
      { status: 500 },
    );
  }

  const firstFactorAgeMinutes = principal.fva[0];
  if (
    typeof firstFactorAgeMinutes !== "number" ||
    firstFactorAgeMinutes < 0 ||
    firstFactorAgeMinutes > max
  ) {
    return Response.json(
      {
        clerk_error: {
          type: "forbidden",
          reason: "reverification-error",
          metadata: {
            reverification: {
              level: "first_factor",
              afterMinutes: max,
            },
          },
        },
      },
      { status: 403 },
    );
  }

  return null;
}

export function requireSameOrigin(request: Request): Response | null {
  const origin = request.headers.get("origin");
  if (!origin) return null;

  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const forwardedProto = request.headers.get("x-forwarded-proto") ?? "https";
  if (!host) {
    return Response.json(
      {
        error: {
          code: "BILLING_ORIGIN_CHECK_FAILED",
          message: "Billing request origin could not be verified.",
          status: 403,
        },
      },
      { status: 403 },
    );
  }

  const expectedOrigin = `${forwardedProto}://${host}`;
  if (origin !== expectedOrigin) {
    return Response.json(
      {
        error: {
          code: "BILLING_ORIGIN_CHECK_FAILED",
          message: "Billing request origin is not allowed.",
          status: 403,
        },
      },
      { status: 403 },
    );
  }

  return null;
}
