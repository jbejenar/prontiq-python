import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";

const apiMocks = vi.hoisted(() => ({
  getStatus: vi.fn(),
  listKeys: vi.fn(),
}));

const authState = vi.hoisted(() => ({
  orgId: "org_123" as string | null,
}));

const toastMocks = vi.hoisted(() => ({
  success: vi.fn(),
}));

vi.mock("@clerk/nextjs", () => ({
  useAuth: () => ({
    getToken: vi.fn().mockResolvedValue("clerk_jwt"),
    isLoaded: true,
    orgId: authState.orgId,
  }),
}));

vi.mock("sonner", () => ({
  toast: toastMocks,
}));

vi.mock("../../lib/account-api.js", () => {
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

import { OverviewPanel } from "./overview-panel.js";

function renderWithQueryClient(children: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  function Wrapper({ children: wrapperChildren }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{wrapperChildren}</QueryClientProvider>;
  }

  return render(children, { wrapper: Wrapper });
}

beforeEach(() => {
  vi.clearAllMocks();
  authState.orgId = "org_123";
  apiMocks.listKeys.mockResolvedValue({ keys: [] });
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
});

test("does not call account API until a Clerk organization is active", async () => {
  authState.orgId = null;

  renderWithQueryClient(<OverviewPanel apiUrl="https://api.test.prontiq.dev" />);

  expect(await screen.findByText("Select an organization")).toBeInTheDocument();
  expect(apiMocks.getStatus).not.toHaveBeenCalled();
  expect(apiMocks.listKeys).not.toHaveBeenCalled();
});

test("missing org state links to the Keys page setup flow", async () => {
  apiMocks.getStatus.mockResolvedValue({
    orgId: "org_123",
    orgRole: "org:admin",
    canManageKeys: true,
    provisioned: false,
  });

  renderWithQueryClient(<OverviewPanel apiUrl="https://api.test.prontiq.dev" />);

  expect(await screen.findByText("Setup required")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /open account setup/i })).toHaveAttribute(
    "href",
    "/keys",
  );
  expect(apiMocks.listKeys).not.toHaveBeenCalled();
});

test("first-key state links to Keys without performing mutations", async () => {
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

  renderWithQueryClient(<OverviewPanel apiUrl="https://api.test.prontiq.dev" />);

  expect(await screen.findByRole("link", { name: /create first key/i })).toHaveAttribute(
    "href",
    "/keys",
  );
  expect(screen.getByText("0 / 2")).toBeInTheDocument();
  expect(screen.getByText("No active keys yet. Create your first key from the Keys page.")).toBeInTheDocument();
});

test("existing keys render masked metadata only", async () => {
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
        label: "Production",
        createdAt: "2026-04-29T00:00:00.000Z",
        lastUsedAt: null,
        active: true,
        products: ["address"],
      },
    ],
  });

  const { container } = renderWithQueryClient(
    <OverviewPanel apiUrl="https://api.test.prontiq.dev" />,
  );

  expect(await screen.findByText("pq_live_abcd••••")).toBeInTheDocument();
  expect(screen.getByText("Production")).toBeInTheDocument();
  expect(screen.getByText("Member")).toBeInTheDocument();
  expect(screen.queryByText(/apiKeyHash/i)).not.toBeInTheDocument();
  expect(container.textContent).not.toMatch(/pq_live_[a-f0-9]{48}/);
  expect(JSON.stringify(window.localStorage)).not.toMatch(/pq_live_[a-f0-9]{48}/);
  expect(JSON.stringify(window.sessionStorage)).not.toMatch(/pq_live_[a-f0-9]{48}/);
});

test("quickstart snippets use placeholders and the configured API URL", async () => {
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

  renderWithQueryClient(<OverviewPanel apiUrl="https://api.test.prontiq.dev" />);

  expect(await screen.findByText("Quickstart")).toBeInTheDocument();
  expect(screen.getByText(/https:\/\/api\.test\.prontiq\.dev\/v1\/address\/autocomplete/)).toBeInTheDocument();
  expect(screen.getAllByText(/<YOUR_API_KEY>/).length).toBeGreaterThan(0);

  await userEvent.click(screen.getAllByRole("button", { name: /copy/i })[0]!);

  expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining("<YOUR_API_KEY>"));
  expect(toastMocks.success).toHaveBeenCalledWith("Copied quickstart");
});

test("overview removes fake usage numbers and labels usage as future work", async () => {
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

  renderWithQueryClient(<OverviewPanel apiUrl="https://api.test.prontiq.dev" />);

  await screen.findByText("Usage charts next");
  expect(screen.queryByText("4,200 / 10,000")).not.toBeInTheDocument();
  expect(screen.getByText(/P1C\.04/)).toBeInTheDocument();
});

test("key-list errors render a retry action without pretending there are no keys", async () => {
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
  apiMocks.listKeys.mockRejectedValueOnce(new Error("List failed")).mockResolvedValueOnce({ keys: [] });

  renderWithQueryClient(<OverviewPanel apiUrl="https://api.test.prontiq.dev" />);

  expect(await screen.findByText("List failed")).toBeInTheDocument();
  expect(screen.queryByText("No active keys yet. Create your first key from the Keys page.")).not.toBeInTheDocument();

  await userEvent.click(screen.getByRole("button", { name: /retry key list/i }));

  await waitFor(() => expect(apiMocks.listKeys).toHaveBeenCalledTimes(2));
  expect(await screen.findByText("No active keys yet. Create your first key from the Keys page.")).toBeInTheDocument();
});
