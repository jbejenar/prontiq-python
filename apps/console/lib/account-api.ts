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

export interface AccountSetupResult {
  status: "created" | "already_exists";
  orgId: string;
  emailSent?: boolean;
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
  if (!response.ok) {
    const error = body as {
      error?: { code?: string; message?: string; status?: number };
    };
    throw new AccountApiError(
      error.error?.message ?? "Account API request failed",
      error.error?.code ?? "ACCOUNT_API_ERROR",
      error.error?.status ?? response.status,
    );
  }

  return body as T;
}

export const accountApi = {
  getStatus: (getToken: GetToken) =>
    authedFetch<AccountStatus>(getToken, "/v1/account/status"),
  runSetup: (getToken: GetToken) =>
    authedFetch<AccountSetupResult>(getToken, "/v1/account/setup", { method: "POST" }),
  listKeys: (getToken: GetToken) =>
    authedFetch<{ keys: ListedKey[] }>(getToken, "/v1/account/keys"),
  createKey: (getToken: GetToken, input: { label?: string }) =>
    authedFetch<CreatedKey>(getToken, "/v1/account/keys/create", {
      method: "POST",
      body: JSON.stringify(input.label ? { label: input.label } : {}),
    }),
};
