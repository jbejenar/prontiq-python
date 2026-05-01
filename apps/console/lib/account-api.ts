import { env } from "./env.js";

export type AccountStatus =
  | {
      orgId: string;
      orgRole: string;
      canManageKeys: boolean;
      provisioned: false;
    }
  | {
      orgId: string;
      orgRole: string;
      canManageKeys: boolean;
      provisioned: true;
      hasFirstKey: boolean;
      activeKeyCount: number;
      tier: string;
      maxKeys: number;
    };

export interface ListedKey {
  keyId: string;
  keyPrefix: string;
  label?: string;
  createdAt: string;
  lastUsedAt: string | null;
  active: boolean;
  products: string[];
}

export interface CreatedKey {
  keyId: string;
  raw: string;
  keyPrefix: string;
  createdAt: string;
  label?: string;
}

export interface RotatedKey {
  keyId: string;
  raw: string;
  keyPrefix: string;
  createdAt: string;
  rotatedAt: string;
}

export interface RevokedKey {
  keyId: string;
  revokedAt: string;
}

export interface AccountAuditEvent {
  action: string;
  actorId: string;
  timestamp: string;
  metadata?: {
    keyId?: string;
    label?: string;
  };
  ip?: string;
  userAgent?: string;
}

export interface AccountSetupResult {
  status: "created" | "already_exists";
  orgId: string;
  emailSent?: boolean;
}

export type UsageGranularity = "daily" | "weekly" | "monthly";
export type UsageSeriesPointKind = "baseline" | "projected" | "total";

export interface AccountUsageProduct {
  product: string;
  displayName: string;
  includedInCurrentPlan: boolean;
  usedCredits: number;
  quotaCredits: number | null;
  remainingCredits: number | null;
  overageCredits: number | null;
  enforcementMode: "hard_cap" | "soft_overage" | "uncapped_tracked";
  rateLimitPerSecond: number | null;
  series: Array<{
    bucket: string;
    label: string;
    credits: number;
    kind: UsageSeriesPointKind;
    sortKey: string;
  }>;
}

export interface AccountUsage {
  generatedAt: string;
  granularity: UsageGranularity;
  period: {
    key: string;
    startedAt: string | null;
    endingAt: string | null;
    source: "calendar" | "lago";
    entitlementsSyncedAt: string | null;
    scopeConsistency: "single_period" | "mixed_key_periods";
  };
  products: AccountUsageProduct[];
}

export interface BillingPlanChangeResult {
  currentPlanCode: string | null;
  downgradePlanDate: string | null;
  nextPlanCode: string | null;
  reconciliationState: "not_required" | "pending_lago_webhook";
  status: "accepted" | "noop" | "pending";
  targetPlanCode: string;
}

type GetToken = (options?: { template?: string }) => Promise<string | null>;

export class AccountApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(message: string, code: string, status: number) {
    super(message);
    this.name = "AccountApiError";
    this.code = code;
    this.status = status;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isClerkReverificationHint(value: unknown) {
  if (!isRecord(value) || !isRecord(value.clerk_error)) return false;
  const clerkError = value.clerk_error;
  if (clerkError.type !== "forbidden" || clerkError.reason !== "reverification-error") {
    return false;
  }
  if (!isRecord(clerkError.metadata) || !isRecord(clerkError.metadata.reverification)) {
    return false;
  }
  const reverification = clerkError.metadata.reverification;
  return (
    typeof reverification.level === "string" && typeof reverification.afterMinutes === "number"
  );
}

async function authedFetch<T>(
  getToken: GetToken,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const token = await getToken(
    env.NEXT_PUBLIC_CLERK_JWT_TEMPLATE
      ? { template: env.NEXT_PUBLIC_CLERK_JWT_TEMPLATE }
      : undefined,
  );
  if (!token) {
    throw new AccountApiError("No active Clerk session", "NO_CLERK_SESSION", 401);
  }

  const response = await fetch(`${env.NEXT_PUBLIC_API_URL}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
  });

  const body = (await response.json().catch(() => ({}))) as unknown;
  if (!response.ok && isClerkReverificationHint(body)) {
    return body as T;
  }

  if (!response.ok) {
    const error = isRecord(body) && isRecord(body.error) ? body.error : {};
    throw new AccountApiError(
      typeof error.message === "string" ? error.message : "Account API request failed",
      typeof error.code === "string" ? error.code : "ACCOUNT_API_ERROR",
      typeof error.status === "number" ? error.status : response.status,
    );
  }

  return body as T;
}

export const accountApi = {
  getStatus: (getToken: GetToken) => authedFetch<AccountStatus>(getToken, "/v1/account/status"),
  runSetup: (getToken: GetToken) =>
    authedFetch<AccountSetupResult>(getToken, "/v1/account/setup", { method: "POST" }),
  listKeys: (getToken: GetToken) =>
    authedFetch<{ keys: ListedKey[] }>(getToken, "/v1/account/keys"),
  listAudit: (getToken: GetToken) =>
    authedFetch<{ events: AccountAuditEvent[] }>(getToken, "/v1/account/audit"),
  getUsage: (getToken: GetToken, granularity: UsageGranularity) =>
    authedFetch<AccountUsage>(
      getToken,
      `/v1/account/usage?granularity=${encodeURIComponent(granularity)}`,
    ),
  createKey: (getToken: GetToken, input: { label?: string }) =>
    authedFetch<CreatedKey>(getToken, "/v1/account/keys/create", {
      method: "POST",
      body: JSON.stringify(input.label ? { label: input.label } : {}),
    }),
  rotateKey: (getToken: GetToken, input: { keyId: string }) =>
    authedFetch<RotatedKey>(getToken, "/v1/account/keys/rotate", {
      method: "POST",
      body: JSON.stringify({ keyId: input.keyId }),
    }),
  revokeKey: (getToken: GetToken, input: { keyId: string }) =>
    authedFetch<RevokedKey>(getToken, "/v1/account/keys/revoke", {
      method: "POST",
      body: JSON.stringify({ keyId: input.keyId }),
    }),
  changeBillingPlan: (
    getToken: GetToken,
    input: { idempotencyKey: string; targetPlanCode: string },
  ) =>
    authedFetch<BillingPlanChangeResult>(getToken, "/v1/account/billing/plan-change", {
      method: "POST",
      headers: { "Idempotency-Key": input.idempotencyKey },
      body: JSON.stringify({ targetPlanCode: input.targetPlanCode }),
    }),
};
