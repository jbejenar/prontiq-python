import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";

const apiMocks = vi.hoisted(() => ({
  getUsage: vi.fn(),
}));

const clerkState = vi.hoisted(() => ({
  orgId: "org_123" as string | null,
}));

vi.mock("@clerk/nextjs", () => ({
  useAuth: () => ({
    getToken: vi.fn().mockResolvedValue("clerk_jwt"),
  }),
  useOrganization: () => ({
    organization: clerkState.orgId ? { id: clerkState.orgId } : null,
  }),
}));

vi.mock("recharts", () => ({
  Area: () => <path data-testid="area" />,
  AreaChart: ({ children }: { children?: ReactNode }) => <svg data-testid="usage-chart">{children}</svg>,
  CartesianGrid: () => <g />,
  ResponsiveContainer: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Tooltip: () => <g />,
  XAxis: () => <g />,
  YAxis: () => <g />,
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
import { UsagePanel } from "./usage-panel.js";

function makeUsage() {
  return {
    generatedAt: "2026-04-30T00:00:00.000Z",
    granularity: "daily" as const,
    period: {
      key: "2026-04-25_2026-05-25",
      startedAt: "2026-04-25T00:00:00.000Z",
      endingAt: "2026-05-25T00:00:00.000Z",
      source: "lago" as const,
      entitlementsSyncedAt: "2026-04-25T00:00:00.000Z",
      scopeConsistency: "single_period" as const,
    },
    products: [
      {
        product: "address",
        displayName: "Address API",
        includedInCurrentPlan: true,
        usedCredits: 42,
        quotaCredits: 5_000,
        remainingCredits: 4_958,
        overageCredits: 0,
        enforcementMode: "hard_cap" as const,
        rateLimitPerSecond: 10,
        series: [{
          bucket: "2026-04-30",
          label: "30 Apr",
          credits: 42,
          kind: "projected" as const,
          sortKey: "2026-04-30#1000",
        }],
      },
    ],
  };
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
  clerkState.orgId = "org_123";
  apiMocks.getUsage.mockResolvedValue(makeUsage());
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

test("does not request usage until an organization is active", async () => {
  clerkState.orgId = null;

  renderWithQueryClient(<UsagePanel />);

  expect(await screen.findByText("Select an organization")).toBeInTheDocument();
  expect(apiMocks.getUsage).not.toHaveBeenCalled();
});

test("renders usage cards and chart from the private account usage API", async () => {
  renderWithQueryClient(<UsagePanel />);

  expect(await screen.findByText("Address API")).toBeInTheDocument();
  expect(screen.getByText("42 credits")).toBeInTheDocument();
  expect(screen.getByText("4,958 credits remaining")).toBeInTheDocument();
  expect(screen.getByTestId("usage-chart")).toBeInTheDocument();
  expect(apiMocks.getUsage).toHaveBeenCalledWith(expect.any(Function), "daily");
});

test("switches granularity through the usage API", async () => {
  renderWithQueryClient(<UsagePanel />);

  await screen.findByText("Address API");
  await userEvent.click(screen.getByRole("tab", { name: "weekly" }));

  await waitFor(() => expect(apiMocks.getUsage).toHaveBeenCalledWith(expect.any(Function), "weekly"));
});

test("exports CSV with date product and credits", async () => {
  let capturedBlobParts: unknown[] | undefined;
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
  vi.stubGlobal(
    "Blob",
    class FakeBlob {
      constructor(parts: unknown[]) {
        capturedBlobParts = parts;
      }
    },
  );
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: vi.fn((_blob: Blob) => {
      return "blob:usage";
    }),
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: vi.fn(),
  });

  renderWithQueryClient(<UsagePanel />);

  await screen.findByText("Address API");
  await userEvent.click(screen.getByRole("button", { name: /export csv/i }));

  const csv = String(capturedBlobParts?.[0]);
  expect(csv).toContain("bucket,product,credits,kind\n2026-04-30,address,42,projected");
});

test("explains baseline usage when projection is behind counters", async () => {
  apiMocks.getUsage.mockResolvedValueOnce({
    ...makeUsage(),
    products: [
      {
        ...makeUsage().products[0],
        series: [
          {
            bucket: "baseline#2026-04-25_2026-05-25",
            label: "Before chart tracking",
            credits: 30,
            kind: "baseline" as const,
            sortKey: "2026-04-25#0000",
          },
          {
            bucket: "2026-04-30",
            label: "30 Apr",
            credits: 12,
            kind: "projected" as const,
            sortKey: "2026-04-30#1000",
          },
        ],
      },
    ],
  });

  renderWithQueryClient(<UsagePanel />);

  expect(await screen.findByText("Address API")).toBeInTheDocument();
  expect(screen.getByText(/Some usage predates detailed chart buckets/i)).toBeInTheDocument();
});

test("surfaces private API errors with retry", async () => {
  apiMocks.getUsage.mockRejectedValueOnce(
    new AccountApiError("Account is not provisioned", "ORG_NOT_PROVISIONED", 404),
  );

  renderWithQueryClient(<UsagePanel />);

  expect(await screen.findByText("Could not load usage")).toBeInTheDocument();
  expect(screen.getByText("Account is not provisioned")).toBeInTheDocument();
});
