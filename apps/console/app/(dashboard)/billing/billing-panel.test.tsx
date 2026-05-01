import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";

const apiMocks = vi.hoisted(() => ({
  changeBillingPlan: vi.fn(),
  createCheckout: vi.fn(),
  createInvoicePaymentUrl: vi.fn(),
  getSummary: vi.fn(),
}));

const clerkState = vi.hoisted(() => ({
  getToken: vi.fn(),
  isLoaded: true,
  orgId: "org_123" as string | null,
}));

vi.mock("@clerk/nextjs", () => ({
  useAuth: () => ({
    getToken: clerkState.getToken,
    isLoaded: clerkState.isLoaded,
    orgId: clerkState.orgId,
  }),
  useReverification:
    <TArgs extends unknown[], TResult>(fetcher: (...args: TArgs) => Promise<TResult>) =>
    async (...args: TArgs) => {
      const result = await fetcher(...args);
      if (typeof result === "object" && result !== null && "clerk_error" in result) {
        return fetcher(...args);
      }
      return result;
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
    accountApi: {
      changeBillingPlan: apiMocks.changeBillingPlan,
      getStatus: vi.fn(),
    },
  };
});

vi.mock("../../../lib/billing-api.js", () => {
  class BillingApiError extends Error {
    readonly code: string;
    readonly status: number;

    constructor(message: string, code: string, status: number) {
      super(message);
      this.name = "BillingApiError";
      this.code = code;
      this.status = status;
    }
  }

  return {
    BillingApiError,
    billingApi: apiMocks,
  };
});

import { BillingApiError } from "../../../lib/billing-api.js";
import { BillingPanel } from "./billing-panel.js";

function makeSummary() {
  return {
    orgId: "org_123",
    canManageBilling: true,
    generatedAt: "2026-04-30T00:00:00.000Z",
    subscription: {
      externalId: "lago_sub_org_123",
      externalCustomerId: "org_123",
      status: "active",
      planCode: "free",
      planName: "Free",
      currentBillingPeriodStartedAt: "2026-04-01T00:00:00.000Z",
      currentBillingPeriodEndingAt: "2026-05-01T00:00:00.000Z",
    },
    usage: {
      amountCents: 0,
      currency: "AUD",
      fromDatetime: "2026-04-01T00:00:00.000Z",
      toDatetime: "2026-05-01T00:00:00.000Z",
      chargesUsage: [],
    },
    plans: [
      {
        code: "free",
        name: "Free",
        description: "Free tier",
        interval: "monthly",
        currency: "AUD",
        amountCents: 0,
        charges: [
          {
            billableMetricCode: "prontiq_address_requests",
            name: "Address requests",
            chargeModel: "package",
            amountCents: 0,
            amountDecimal: "0.00",
            freeUnits: 5_000,
            packageSize: 5_000,
            pricingDescription: null,
          },
        ],
      },
      {
        code: "payg_aud",
        name: "Pay As You Go AUD",
        description: "PAYG plan",
        interval: "monthly",
        currency: "AUD",
        amountCents: 0,
        charges: [
          {
            billableMetricCode: "prontiq_address_requests",
            name: "Address requests",
            chargeModel: "standard",
            amountCents: 15,
            amountDecimal: "0.0015",
            freeUnits: null,
            packageSize: null,
            pricingDescription: null,
          },
        ],
      },
    ],
    invoices: [
      {
        id: "inv_123",
        number: "INV-123",
        status: "finalized",
        paymentStatus: "pending",
        totalAmountCents: 1500,
        currency: "AUD",
        issuingDate: "2026-04-30",
        invoiceUrl: null,
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
  clerkState.isLoaded = true;
  clerkState.orgId = "org_123";
  clerkState.getToken.mockResolvedValue("session.jwt");
  apiMocks.getSummary.mockResolvedValue(makeSummary());
  apiMocks.createCheckout.mockResolvedValue({
    checkoutUrl: "https://checkout.example",
    intendedPlanCode: "payg_aud",
  });
  apiMocks.changeBillingPlan.mockResolvedValue({
    currentPlanCode: "payg_aud",
    downgradePlanDate: null,
    nextPlanCode: null,
    reconciliationState: "pending_lago_webhook",
    status: "accepted",
    targetPlanCode: "payg_aud",
  });
  apiMocks.createInvoicePaymentUrl.mockResolvedValue({ paymentUrl: "https://pay.example" });
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { assign: vi.fn() },
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

test("renders billing state from the console billing BFF", async () => {
  renderWithQueryClient(<BillingPanel />);

  expect(await screen.findByText("Pay As You Go AUD")).toBeInTheDocument();
  expect(screen.getAllByText("Free")).toHaveLength(2);
  expect(screen.getByText("INV-123")).toBeInTheDocument();
  expect(apiMocks.getSummary).toHaveBeenCalledOnce();
});

test("does not request billing until an organization is active", async () => {
  clerkState.orgId = null;

  renderWithQueryClient(<BillingPanel />);

  expect(await screen.findByText("Select an organization")).toBeInTheDocument();
  expect(apiMocks.getSummary).not.toHaveBeenCalled();
});

test("admin checkout uses the selected Lago plan code for context", async () => {
  renderWithQueryClient(<BillingPanel />);

  await screen.findByText("Pay As You Go AUD");
  await userEvent.click(screen.getAllByRole("button", { name: /set up payment method/i })[1]!);

  await waitFor(() =>
    expect(apiMocks.createCheckout).toHaveBeenCalledWith({ intendedPlanCode: "payg_aud" }),
  );
  expect(window.location.assign).toHaveBeenCalledWith("https://checkout.example");
});

test("admin plan change sends the selected Lago plan code", async () => {
  renderWithQueryClient(<BillingPanel />);

  await userEvent.click(await screen.findByRole("button", { name: /change to pay as you go aud/i }));

  await waitFor(() =>
    expect(apiMocks.changeBillingPlan).toHaveBeenCalledWith(clerkState.getToken, {
      idempotencyKey: expect.any(String),
      targetPlanCode: "payg_aud",
    }),
  );
});

test("pending Lago transitions disable further billing actions", async () => {
  apiMocks.getSummary.mockResolvedValueOnce({
    ...makeSummary(),
    subscription: {
      ...makeSummary().subscription,
      nextPlanCode: "payg_aud",
      downgradePlanDate: "2026-05-01",
    },
  });

  renderWithQueryClient(<BillingPanel />);

  expect(await screen.findByText(/Pending plan: payg_aud/i)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /pending plan/i })).toBeDisabled();
  for (const button of screen.getAllByRole("button", { name: /set up payment method/i })) {
    expect(button).toBeDisabled();
  }
});

test("members can view plans but cannot create payment links", async () => {
  apiMocks.getSummary.mockResolvedValueOnce({ ...makeSummary(), canManageBilling: false });

  renderWithQueryClient(<BillingPanel />);

  expect(await screen.findByText("Pay As You Go AUD")).toBeInTheDocument();
  expect(screen.getAllByRole("button", { name: /admin required/i })[0]).toBeDisabled();
});

test("surfaces BFF errors with retry", async () => {
  apiMocks.getSummary.mockRejectedValueOnce(
    new BillingApiError("Lago is unavailable", "BILLING_LOAD_FAILED", 502),
  );

  renderWithQueryClient(<BillingPanel />);

  expect(await screen.findByText("Could not load billing")).toBeInTheDocument();
  expect(screen.getByText("Lago is unavailable")).toBeInTheDocument();
});
