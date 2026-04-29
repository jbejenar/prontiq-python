import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";

const apiMocks = vi.hoisted(() => ({
  createKey: vi.fn(),
  getStatus: vi.fn(),
  listKeys: vi.fn(),
  revokeKey: vi.fn(),
  rotateKey: vi.fn(),
  runSetup: vi.fn(),
}));

const authState = vi.hoisted(() => ({
  orgId: "org_123" as string | null,
}));

const toastMocks = vi.hoisted(() => ({
  error: vi.fn(),
  success: vi.fn(),
}));

vi.mock("@clerk/nextjs", () => ({
  useAuth: () => ({
    getToken: vi.fn().mockResolvedValue("clerk_jwt"),
    isLoaded: true,
    orgId: authState.orgId,
  }),
  useReverification: <TArgs extends unknown[], TResult>(
    fetcher: (...args: TArgs) => Promise<TResult>,
  ) =>
    async (...args: TArgs) => {
      const result = await fetcher(...args);
      if (
        typeof result === "object" &&
        result !== null &&
        "clerk_error" in result
      ) {
        return fetcher(...args);
      }
      return result;
    },
}));

vi.mock("sonner", () => ({
  toast: toastMocks,
}));

vi.mock("../../../lib/account-api.js", () => {
  class AccountApiError extends Error {
    readonly code: string;
    readonly status: number;

    constructor(message: string, code: string, status: number) {
      super(message);
      this.name = "AccountApiError";
      this.code = code;
      this.status = status;
    }
  }

  return {
    AccountApiError,
    accountApi: apiMocks,
  };
});

import { AccountApiError } from "../../../lib/account-api.js";
import { KeysPanel } from "./keys-panel.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });

  return { promise, reject, resolve };
}

function clerkReverificationError() {
  return {
    clerk_error: {
      type: "forbidden",
      reason: "reverification-error",
      metadata: { reverification: { level: "second_factor", afterMinutes: 10 } },
    },
  };
}

function renderWithQueryClient(children: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  });

  function Wrapper({ children: wrapperChildren }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{wrapperChildren}</QueryClientProvider>;
  }

  return { queryClient, ...render(children, { wrapper: Wrapper }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  authState.orgId = "org_123";
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
});

test("does not call account API until a Clerk organization is active", async () => {
  authState.orgId = null;

  renderWithQueryClient(<KeysPanel />);

  expect(await screen.findByText("Select an organization")).toBeInTheDocument();
  expect(apiMocks.getStatus).not.toHaveBeenCalled();
  expect(apiMocks.listKeys).not.toHaveBeenCalled();
});

test("missing org admin can run setup and transition to first-key CTA", async () => {
  apiMocks.getStatus
    .mockResolvedValueOnce({
      orgId: "org_123",
      orgRole: "org:admin",
      canManageKeys: true,
      provisioned: false,
    })
    .mockResolvedValueOnce({
      orgId: "org_123",
      orgRole: "org:admin",
      canManageKeys: true,
      provisioned: true,
      hasFirstKey: false,
      activeKeyCount: 0,
      tier: "free",
      maxKeys: 2,
    });
  apiMocks.runSetup.mockResolvedValue({ orgId: "org_123", status: "created" });

  renderWithQueryClient(<KeysPanel />);

  await screen.findByRole("button", { name: /set up account/i });
  await userEvent.click(screen.getByRole("button", { name: /set up account/i }));

  expect(apiMocks.runSetup).toHaveBeenCalledTimes(1);
  await screen.findByRole("button", { name: /create first key/i });
});

test("missing org member sees admin-required setup state", async () => {
  apiMocks.getStatus.mockResolvedValue({
    orgId: "org_123",
    orgRole: "org:member",
    canManageKeys: false,
    provisioned: false,
  });

  renderWithQueryClient(<KeysPanel />);

  expect(await screen.findByText("Account setup required")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /set up account/i })).not.toBeInTheDocument();
});

test("create key reveals raw key once and does not persist it to browser storage", async () => {
  const raw = `pq_live_${"a".repeat(48)}`;
  apiMocks.getStatus.mockResolvedValue({
    orgId: "org_123",
    orgRole: "org:admin",
    canManageKeys: true,
    provisioned: true,
    hasFirstKey: false,
    activeKeyCount: 0,
    tier: "free",
    maxKeys: 2,
  });
  apiMocks.createKey.mockResolvedValue({
    keyId: "key_01HX0000000000000000000000",
    keyPrefix: "pq_live_aaaa",
    raw,
    createdAt: "2026-04-29T00:00:00.000Z",
  });

  renderWithQueryClient(<KeysPanel />);

  await userEvent.type(await screen.findByPlaceholderText(/production/i), "Production");
  await userEvent.click(screen.getByRole("button", { name: /create first key/i }));

  expect(await screen.findByText(raw)).toBeInTheDocument();
  expect(JSON.stringify(window.localStorage)).not.toContain(raw);
  expect(JSON.stringify(window.sessionStorage)).not.toContain(raw);

  await userEvent.click(screen.getByRole("button", { name: /close/i }));

  await waitFor(() => expect(screen.queryByText(raw)).not.toBeInTheDocument());
});

test("switching active org clears reveal-once raw key state", async () => {
  const raw = `pq_live_${"b".repeat(48)}`;
  apiMocks.getStatus.mockResolvedValue({
    orgId: "org_123",
    orgRole: "org:admin",
    canManageKeys: true,
    provisioned: true,
    hasFirstKey: false,
    activeKeyCount: 0,
    tier: "free",
    maxKeys: 2,
  });
  apiMocks.createKey.mockResolvedValue({
    keyId: "key_01HX0000000000000000000000",
    keyPrefix: "pq_live_bbbb",
    raw,
    createdAt: "2026-04-29T00:00:00.000Z",
  });

  const view = renderWithQueryClient(<KeysPanel />);

  await userEvent.click(await screen.findByRole("button", { name: /create first key/i }));
  expect(await screen.findByText(raw)).toBeInTheDocument();

  authState.orgId = "org_456";
  view.rerender(<KeysPanel />);

  await waitFor(() => expect(screen.queryByText(raw)).not.toBeInTheDocument());
});

test("stale create responses after org switch are ignored", async () => {
  const raw = `pq_live_${"c".repeat(48)}`;
  const create = deferred<{
    keyId: string;
    keyPrefix: string;
    raw: string;
    createdAt: string;
  }>();
  apiMocks.getStatus.mockResolvedValue({
    orgId: "org_123",
    orgRole: "org:admin",
    canManageKeys: true,
    provisioned: true,
    hasFirstKey: false,
    activeKeyCount: 0,
    tier: "free",
    maxKeys: 2,
  });
  apiMocks.createKey.mockReturnValue(create.promise);

  const view = renderWithQueryClient(<KeysPanel />);

  await userEvent.click(await screen.findByRole("button", { name: /create first key/i }));
  authState.orgId = "org_456";
  view.rerender(<KeysPanel />);

  await act(async () => {
    create.resolve({
      keyId: "key_01HX0000000000000000000000",
      keyPrefix: "pq_live_cccc",
      raw,
      createdAt: "2026-04-29T00:00:00.000Z",
    });
    await create.promise;
  });

  await waitFor(() => expect(screen.queryByText(raw)).not.toBeInTheDocument());
  expect(screen.getByRole("button", { name: /create first key/i })).not.toBeDisabled();
});

test("key-list errors render as errors, not as an empty list", async () => {
  apiMocks.getStatus.mockResolvedValue({
    orgId: "org_123",
    orgRole: "org:admin",
    canManageKeys: true,
    provisioned: true,
    hasFirstKey: true,
    activeKeyCount: 1,
    tier: "free",
    maxKeys: 2,
  });
  apiMocks.listKeys
    .mockRejectedValueOnce(new Error("List failed"))
    .mockResolvedValueOnce({ keys: [] });

  renderWithQueryClient(<KeysPanel />);

  expect(await screen.findByText("List failed")).toBeInTheDocument();
  expect(screen.queryByText("No active keys yet.")).not.toBeInTheDocument();

  await userEvent.click(screen.getByRole("button", { name: /retry key list/i }));

  expect(await screen.findByText("No active keys yet.")).toBeInTheDocument();
  expect(apiMocks.listKeys).toHaveBeenCalledTimes(2);
});

test("existing keys render masked metadata without hashes", async () => {
  apiMocks.getStatus.mockResolvedValue({
    orgId: "org_123",
    orgRole: "org:admin",
    canManageKeys: true,
    provisioned: true,
    hasFirstKey: true,
    activeKeyCount: 1,
    tier: "free",
    maxKeys: 2,
  });
  apiMocks.listKeys.mockResolvedValue({
    keys: [
      {
        keyId: "key_01HX0000000000000000000000",
        keyPrefix: "pq_live_abcd",
        label: "Production",
        createdAt: "2026-04-29T00:00:00.000Z",
        lastUsedAt: null,
        active: true,
        products: ["address"],
      },
    ],
  });

  renderWithQueryClient(<KeysPanel />);

  expect(await screen.findByText("pq_live_abcd••••")).toBeInTheDocument();
  expect(screen.getByText("Production")).toBeInTheDocument();
  expect(screen.queryByText(/apiKeyHash/i)).not.toBeInTheDocument();
});

test("admin can rotate a listed key and sees the new raw key once", async () => {
  const raw = `pq_live_${"d".repeat(48)}`;
  apiMocks.getStatus.mockResolvedValue({
    orgId: "org_123",
    orgRole: "org:admin",
    canManageKeys: true,
    provisioned: true,
    hasFirstKey: true,
    activeKeyCount: 1,
    tier: "free",
    maxKeys: 2,
  });
  apiMocks.listKeys.mockResolvedValue({
    keys: [
      {
        keyId: "key_01HX0000000000000000000000",
        keyPrefix: "pq_live_abcd",
        label: "Production",
        createdAt: "2026-04-29T00:00:00.000Z",
        lastUsedAt: null,
        active: true,
        products: ["address"],
      },
    ],
  });
  apiMocks.rotateKey.mockResolvedValue({
    keyId: "key_01HX0000000000000000000000",
    keyPrefix: "pq_live_dddd",
    raw,
    createdAt: "2026-04-29T00:00:00.000Z",
    rotatedAt: "2026-04-29T01:00:00.000Z",
  });

  renderWithQueryClient(<KeysPanel />);

  await userEvent.click(await screen.findByRole("button", { name: /rotate/i }));

  expect(apiMocks.rotateKey).toHaveBeenCalledWith(expect.any(Function), {
    keyId: "key_01HX0000000000000000000000",
  });
  expect(await screen.findByText(raw)).toBeInTheDocument();
  expect(screen.getByText(/copy your rotated api key now/i)).toBeInTheDocument();
});

test("rotate retries through Clerk reverification before showing the new raw key", async () => {
  const raw = `pq_live_${"e".repeat(48)}`;
  apiMocks.getStatus.mockResolvedValue({
    orgId: "org_123",
    orgRole: "org:admin",
    canManageKeys: true,
    provisioned: true,
    hasFirstKey: true,
    activeKeyCount: 1,
    tier: "free",
    maxKeys: 2,
  });
  apiMocks.listKeys.mockResolvedValue({
    keys: [
      {
        keyId: "key_01HX0000000000000000000000",
        keyPrefix: "pq_live_abcd",
        createdAt: "2026-04-29T00:00:00.000Z",
        lastUsedAt: null,
        active: true,
        products: ["address"],
      },
    ],
  });
  apiMocks.rotateKey
    .mockResolvedValueOnce(clerkReverificationError())
    .mockResolvedValueOnce({
      keyId: "key_01HX0000000000000000000000",
      keyPrefix: "pq_live_eeee",
      raw,
      createdAt: "2026-04-29T00:00:00.000Z",
      rotatedAt: "2026-04-29T01:00:00.000Z",
    });

  renderWithQueryClient(<KeysPanel />);

  await userEvent.click(await screen.findByRole("button", { name: /rotate/i }));

  await screen.findByText(raw);
  expect(apiMocks.rotateKey).toHaveBeenCalledTimes(2);
  expect(toastMocks.success).toHaveBeenCalledWith("API key rotated");
});

test("STEP_UP_MISCONFIGURED during rotate is surfaced as an error without retry loop", async () => {
  apiMocks.getStatus.mockResolvedValue({
    orgId: "org_123",
    orgRole: "org:admin",
    canManageKeys: true,
    provisioned: true,
    hasFirstKey: true,
    activeKeyCount: 1,
    tier: "free",
    maxKeys: 2,
  });
  apiMocks.listKeys.mockResolvedValue({
    keys: [
      {
        keyId: "key_01HX0000000000000000000000",
        keyPrefix: "pq_live_abcd",
        createdAt: "2026-04-29T00:00:00.000Z",
        lastUsedAt: null,
        active: true,
        products: ["address"],
      },
    ],
  });
  apiMocks.rotateKey.mockRejectedValue(
    new AccountApiError(
      "Step-up enforcement is not configured. Contact support.",
      "STEP_UP_MISCONFIGURED",
      500,
    ),
  );

  renderWithQueryClient(<KeysPanel />);

  await userEvent.click(await screen.findByRole("button", { name: /rotate/i }));

  await waitFor(() => expect(apiMocks.rotateKey).toHaveBeenCalledTimes(1));
  expect(toastMocks.error).toHaveBeenCalledWith(
    "Step-up enforcement is not configured. Contact support.",
  );
  expect(screen.queryByText(/copy your rotated api key now/i)).not.toBeInTheDocument();
});

test("cancelled rotate reverification leaves the key list unchanged without success UI", async () => {
  apiMocks.getStatus.mockResolvedValue({
    orgId: "org_123",
    orgRole: "org:admin",
    canManageKeys: true,
    provisioned: true,
    hasFirstKey: true,
    activeKeyCount: 1,
    tier: "free",
    maxKeys: 2,
  });
  apiMocks.listKeys.mockResolvedValue({
    keys: [
      {
        keyId: "key_01HX0000000000000000000000",
        keyPrefix: "pq_live_abcd",
        createdAt: "2026-04-29T00:00:00.000Z",
        lastUsedAt: null,
        active: true,
        products: ["address"],
      },
    ],
  });
  apiMocks.rotateKey.mockResolvedValue(null);

  const { queryClient } = renderWithQueryClient(<KeysPanel />);
  const invalidate = vi.spyOn(queryClient, "invalidateQueries");

  await userEvent.click(await screen.findByRole("button", { name: /rotate/i }));

  await waitFor(() => expect(screen.getByRole("button", { name: /rotate/i })).not.toBeDisabled());
  expect(toastMocks.success).not.toHaveBeenCalledWith("API key rotated");
  expect(screen.queryByText(/copy your rotated api key now/i)).not.toBeInTheDocument();
  expect(invalidate).not.toHaveBeenCalledWith(expect.objectContaining({ queryKey: ["account-status", "org_123"] }));
  expect(invalidate).not.toHaveBeenCalledWith(expect.objectContaining({ queryKey: ["account-keys", "org_123"] }));
});

test("admin can confirm revocation for a listed key", async () => {
  apiMocks.getStatus.mockResolvedValue({
    orgId: "org_123",
    orgRole: "org:admin",
    canManageKeys: true,
    provisioned: true,
    hasFirstKey: true,
    activeKeyCount: 1,
    tier: "free",
    maxKeys: 2,
  });
  apiMocks.listKeys.mockResolvedValue({
    keys: [
      {
        keyId: "key_01HX0000000000000000000000",
        keyPrefix: "pq_live_abcd",
        createdAt: "2026-04-29T00:00:00.000Z",
        lastUsedAt: null,
        active: true,
        products: ["address"],
      },
    ],
  });
  apiMocks.revokeKey.mockResolvedValue({
    keyId: "key_01HX0000000000000000000000",
    revokedAt: "2026-04-29T01:00:00.000Z",
  });

  renderWithQueryClient(<KeysPanel />);

  await userEvent.click(await screen.findByRole("button", { name: /^revoke$/i }));
  expect(await screen.findByText(/marks pq_live_abcd as inactive/i)).toBeInTheDocument();

  await userEvent.click(screen.getByRole("button", { name: /revoke key/i }));

  expect(apiMocks.revokeKey).toHaveBeenCalledWith(expect.any(Function), {
    keyId: "key_01HX0000000000000000000000",
  });
  await waitFor(() => expect(screen.queryByText(/revoke api key/i)).not.toBeInTheDocument());
});

test("revoke retries through Clerk reverification before closing the confirmation", async () => {
  apiMocks.getStatus.mockResolvedValue({
    orgId: "org_123",
    orgRole: "org:admin",
    canManageKeys: true,
    provisioned: true,
    hasFirstKey: true,
    activeKeyCount: 1,
    tier: "free",
    maxKeys: 2,
  });
  apiMocks.listKeys.mockResolvedValue({
    keys: [
      {
        keyId: "key_01HX0000000000000000000000",
        keyPrefix: "pq_live_abcd",
        createdAt: "2026-04-29T00:00:00.000Z",
        lastUsedAt: null,
        active: true,
        products: ["address"],
      },
    ],
  });
  apiMocks.revokeKey
    .mockResolvedValueOnce(clerkReverificationError())
    .mockResolvedValueOnce({
      keyId: "key_01HX0000000000000000000000",
      revokedAt: "2026-04-29T01:00:00.000Z",
    });

  renderWithQueryClient(<KeysPanel />);

  await userEvent.click(await screen.findByRole("button", { name: /^revoke$/i }));
  expect(await screen.findByText(/marks pq_live_abcd as inactive/i)).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: /revoke key/i }));

  await waitFor(() => expect(screen.queryByText(/revoke api key/i)).not.toBeInTheDocument());
  expect(apiMocks.revokeKey).toHaveBeenCalledTimes(2);
  expect(toastMocks.success).toHaveBeenCalledWith("API key revoked");
});

test("STEP_UP_MISCONFIGURED during revoke is surfaced as an error without retry loop", async () => {
  apiMocks.getStatus.mockResolvedValue({
    orgId: "org_123",
    orgRole: "org:admin",
    canManageKeys: true,
    provisioned: true,
    hasFirstKey: true,
    activeKeyCount: 1,
    tier: "free",
    maxKeys: 2,
  });
  apiMocks.listKeys.mockResolvedValue({
    keys: [
      {
        keyId: "key_01HX0000000000000000000000",
        keyPrefix: "pq_live_abcd",
        createdAt: "2026-04-29T00:00:00.000Z",
        lastUsedAt: null,
        active: true,
        products: ["address"],
      },
    ],
  });
  apiMocks.revokeKey.mockRejectedValue(
    new AccountApiError(
      "Step-up enforcement is not configured. Contact support.",
      "STEP_UP_MISCONFIGURED",
      500,
    ),
  );

  renderWithQueryClient(<KeysPanel />);

  await userEvent.click(await screen.findByRole("button", { name: /^revoke$/i }));
  expect(await screen.findByText(/marks pq_live_abcd as inactive/i)).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: /revoke key/i }));

  await waitFor(() => expect(apiMocks.revokeKey).toHaveBeenCalledTimes(1));
  expect(screen.getByText(/marks pq_live_abcd as inactive/i)).toBeInTheDocument();
  expect(toastMocks.error).toHaveBeenCalledWith(
    "Step-up enforcement is not configured. Contact support.",
  );
});

test("cancelled revoke reverification keeps the confirmation open without success UI", async () => {
  apiMocks.getStatus.mockResolvedValue({
    orgId: "org_123",
    orgRole: "org:admin",
    canManageKeys: true,
    provisioned: true,
    hasFirstKey: true,
    activeKeyCount: 1,
    tier: "free",
    maxKeys: 2,
  });
  apiMocks.listKeys.mockResolvedValue({
    keys: [
      {
        keyId: "key_01HX0000000000000000000000",
        keyPrefix: "pq_live_abcd",
        createdAt: "2026-04-29T00:00:00.000Z",
        lastUsedAt: null,
        active: true,
        products: ["address"],
      },
    ],
  });
  apiMocks.revokeKey.mockResolvedValue(null);

  const { queryClient } = renderWithQueryClient(<KeysPanel />);
  const invalidate = vi.spyOn(queryClient, "invalidateQueries");

  await userEvent.click(await screen.findByRole("button", { name: /^revoke$/i }));
  expect(await screen.findByText(/marks pq_live_abcd as inactive/i)).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: /revoke key/i }));

  await waitFor(() => expect(screen.getByRole("button", { name: /revoke key/i })).not.toBeDisabled());
  expect(screen.getByText(/marks pq_live_abcd as inactive/i)).toBeInTheDocument();
  expect(toastMocks.success).not.toHaveBeenCalledWith("API key revoked");
  expect(invalidate).not.toHaveBeenCalledWith(expect.objectContaining({ queryKey: ["account-status", "org_123"] }));
  expect(invalidate).not.toHaveBeenCalledWith(expect.objectContaining({ queryKey: ["account-keys", "org_123"] }));
});

test("counter-drifted org still lists active keys and explains key-limit create block", async () => {
  apiMocks.getStatus.mockResolvedValue({
    orgId: "org_123",
    orgRole: "org:admin",
    canManageKeys: true,
    provisioned: true,
    hasFirstKey: false,
    activeKeyCount: 2,
    tier: "free",
    maxKeys: 2,
  });
  apiMocks.listKeys.mockResolvedValue({
    keys: [
      {
        keyId: "key_01HX0000000000000000000000",
        keyPrefix: "pq_live_abcd",
        createdAt: "2026-04-29T00:00:00.000Z",
        lastUsedAt: null,
        active: true,
        products: ["address"],
      },
    ],
  });

  renderWithQueryClient(<KeysPanel />);

  expect(await screen.findByText("pq_live_abcd••••")).toBeInTheDocument();
  expect(apiMocks.listKeys).toHaveBeenCalledTimes(1);
  expect(screen.getByText(/reached its 2-key limit/i)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /create key/i })).toBeDisabled();
});

test("provisioned member can view but cannot create keys", async () => {
  apiMocks.getStatus.mockResolvedValue({
    orgId: "org_123",
    orgRole: "org:member",
    canManageKeys: false,
    provisioned: true,
    hasFirstKey: false,
    activeKeyCount: 0,
    tier: "free",
    maxKeys: 2,
  });

  renderWithQueryClient(<KeysPanel />);

  expect(await screen.findByText(/Members can view keys/i)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /create first key/i })).toBeDisabled();
});

test("provisioned member can view listed keys but cannot rotate or revoke them", async () => {
  apiMocks.getStatus.mockResolvedValue({
    orgId: "org_123",
    orgRole: "org:member",
    canManageKeys: false,
    provisioned: true,
    hasFirstKey: true,
    activeKeyCount: 1,
    tier: "free",
    maxKeys: 2,
  });
  apiMocks.listKeys.mockResolvedValue({
    keys: [
      {
        keyId: "key_01HX0000000000000000000000",
        keyPrefix: "pq_live_abcd",
        createdAt: "2026-04-29T00:00:00.000Z",
        lastUsedAt: null,
        active: true,
        products: ["address"],
      },
    ],
  });

  renderWithQueryClient(<KeysPanel />);

  expect(await screen.findByText("pq_live_abcd••••")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /rotate/i })).toBeDisabled();
  expect(screen.getByRole("button", { name: /^revoke$/i })).toBeDisabled();
  expect(apiMocks.rotateKey).not.toHaveBeenCalled();
  expect(apiMocks.revokeKey).not.toHaveBeenCalled();
});
