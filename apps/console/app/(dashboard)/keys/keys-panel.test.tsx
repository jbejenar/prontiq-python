import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";

const apiMocks = vi.hoisted(() => ({
  createKey: vi.fn(),
  getStatus: vi.fn(),
  listKeys: vi.fn(),
  runSetup: vi.fn(),
}));

const authState = vi.hoisted(() => ({
  orgId: "org_123" as string | null,
}));

vi.mock("@clerk/nextjs", () => ({
  useAuth: () => ({
    getToken: vi.fn().mockResolvedValue("clerk_jwt"),
    isLoaded: true,
    orgId: authState.orgId,
  }),
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
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

function renderWithQueryClient(children: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  });

  function Wrapper({ children: wrapperChildren }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{wrapperChildren}</QueryClientProvider>;
  }

  return render(children, { wrapper: Wrapper });
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
