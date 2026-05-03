import { beforeEach, describe, expect, test, vi } from "vitest";

const authMocks = vi.hoisted(() => ({
  getBillingPrincipal: vi.fn(),
  requireSameOrigin: vi.fn(),
}));

const envMocks = vi.hoisted(() => ({
  demoBackendPolicyConfirmed: true,
  demoApiKey: "demo_key",
}));

vi.mock("../../../../lib/billing-auth.js", () => authMocks);
vi.mock("../../../../lib/env.js", () => ({
  env: { NEXT_PUBLIC_API_URL: "https://api.prontiq.dev" },
}));
vi.mock("../../../../lib/server-env.js", () => ({
  getPlaygroundServerEnv: () => envMocks,
}));

import { POST } from "./route.js";

describe("POST /api/playground/demo", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    envMocks.demoBackendPolicyConfirmed = true;
    envMocks.demoApiKey = "demo_key";
  });

  test("requires browser origin before proxying", async () => {
    const response = await POST(
      new Request("https://console.prontiq.dev/api/playground/demo", {
        body: JSON.stringify({
          bodyText: "",
          method: "GET",
          path: "/v1/address/autocomplete",
          pathParams: {},
          queryParams: { q: "melbourne" },
        }),
        method: "POST",
      }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "PLAYGROUND_ORIGIN_REQUIRED" },
    });
  });

  test("rejects browser-supplied API keys in demo mode", async () => {
    authMocks.requireSameOrigin.mockReturnValue(null);

    const response = await POST(
      new Request("https://console.prontiq.dev/api/playground/demo", {
        body: JSON.stringify({
          bodyText: "",
          method: "GET",
          path: "/v1/address/autocomplete",
          pathParams: {},
          queryParams: { q: "melbourne" },
        }),
        headers: {
          host: "console.prontiq.dev",
          origin: "https://console.prontiq.dev",
          "x-api-key": "customer_key",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "DEMO_PROXY_REJECTED_USER_KEY" },
    });
  });

  test("fails closed when the demo backend quota policy is not confirmed", async () => {
    authMocks.requireSameOrigin.mockReturnValue(null);
    authMocks.getBillingPrincipal.mockResolvedValue({
      canManageBilling: true,
      orgId: "org_123",
      orgRole: "org:admin",
      userId: "user_123",
    });
    envMocks.demoBackendPolicyConfirmed = false;

    const response = await POST(
      new Request("https://console.prontiq.dev/api/playground/demo", {
        body: JSON.stringify({
          bodyText: "",
          method: "GET",
          path: "/v1/address/autocomplete",
          pathParams: {},
          queryParams: { q: "melbourne" },
        }),
        headers: {
          host: "console.prontiq.dev",
          origin: "https://console.prontiq.dev",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "DEMO_BACKEND_POLICY_NOT_CONFIRMED" },
    });
  });

  test("rejects oversized demo proxy requests before parsing", async () => {
    authMocks.requireSameOrigin.mockReturnValue(null);

    const response = await POST(
      new Request("https://console.prontiq.dev/api/playground/demo", {
        body: JSON.stringify({
          bodyText: "",
          method: "GET",
          path: "/v1/address/autocomplete",
          pathParams: {},
          queryParams: { q: "melbourne" },
        }),
        headers: {
          "content-length": "32769",
          host: "console.prontiq.dev",
          origin: "https://console.prontiq.dev",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "DEMO_PROXY_REQUEST_TOO_LARGE" },
    });
    expect(authMocks.getBillingPrincipal).not.toHaveBeenCalled();
  });

  test("rejects oversized demo proxy requests without relying on content-length", async () => {
    authMocks.requireSameOrigin.mockReturnValue(null);
    authMocks.getBillingPrincipal.mockResolvedValue({
      canManageBilling: true,
      orgId: "org_123",
      orgRole: "org:admin",
      userId: "user_123",
    });

    const response = await POST(
      new Request("https://console.prontiq.dev/api/playground/demo", {
        body: JSON.stringify({
          bodyText: "x".repeat(33_000),
          method: "GET",
          path: "/v1/address/autocomplete",
          pathParams: {},
          queryParams: { q: "melbourne" },
        }),
        headers: {
          host: "console.prontiq.dev",
          origin: "https://console.prontiq.dev",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "DEMO_PROXY_REQUEST_TOO_LARGE" },
    });
  });

  test("validates method and path against the public OpenAPI spec before proxying", async () => {
    authMocks.requireSameOrigin.mockReturnValue(null);
    authMocks.getBillingPrincipal.mockResolvedValue({
      canManageBilling: true,
      orgId: "org_123",
      orgRole: "org:admin",
      userId: "user_123",
    });

    const response = await POST(
      new Request("https://console.prontiq.dev/api/playground/demo", {
        body: JSON.stringify({
          bodyText: "",
          method: "GET",
          path: "/v1/account/keys",
          pathParams: {},
          queryParams: {},
        }),
        headers: {
          host: "console.prontiq.dev",
          origin: "https://console.prontiq.dev",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "UNSUPPORTED_DEMO_PATH" },
    });
  });

  test("rejects undeclared query parameters before proxying", async () => {
    authMocks.requireSameOrigin.mockReturnValue(null);
    authMocks.getBillingPrincipal.mockResolvedValue({
      canManageBilling: true,
      orgId: "org_123",
      orgRole: "org:admin",
      userId: "user_123",
    });

    const response = await POST(
      new Request("https://console.prontiq.dev/api/playground/demo", {
        body: JSON.stringify({
          bodyText: "",
          method: "GET",
          path: "/v1/address/autocomplete",
          pathParams: {},
          queryParams: { q: "melbourne", unexpected: "value" },
        }),
        headers: {
          host: "console.prontiq.dev",
          origin: "https://console.prontiq.dev",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "UNDECLARED_DEMO_PARAMETER" },
    });
  });

  test("proxies declared public operations with the server-held demo key", async () => {
    authMocks.requireSameOrigin.mockReturnValue(null);
    authMocks.getBillingPrincipal.mockResolvedValue({
      canManageBilling: true,
      orgId: "customer_org",
      orgRole: "org:admin",
      userId: "user_123",
    });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ suggestions: [] }), {
        headers: { "content-type": "application/json", "x-request-id": "req_123" },
        status: 200,
        statusText: "OK",
      }),
    );

    const response = await POST(
      new Request("https://console.prontiq.dev/api/playground/demo", {
        body: JSON.stringify({
          bodyText: "",
          method: "GET",
          path: "/v1/address/autocomplete",
          pathParams: {},
          queryParams: { q: "melbourne" },
        }),
        headers: {
          host: "console.prontiq.dev",
          origin: "https://console.prontiq.dev",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.prontiq.dev/v1/address/autocomplete?q=melbourne",
      expect.objectContaining({
        headers: expect.objectContaining({ "X-Api-Key": "demo_key" }),
        method: "GET",
      }),
    );
    expect(fetchMock).not.toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({ "X-Api-Key": "customer_org" }),
      }),
    );
    fetchMock.mockRestore();
  });

  test("returns a controlled error when the upstream backend cannot be reached", async () => {
    authMocks.requireSameOrigin.mockReturnValue(null);
    authMocks.getBillingPrincipal.mockResolvedValue({
      canManageBilling: true,
      orgId: "customer_org",
      orgRole: "org:admin",
      userId: "user_123",
    });
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new TypeError("network down"));

    const response = await POST(
      new Request("https://console.prontiq.dev/api/playground/demo", {
        body: JSON.stringify({
          bodyText: "",
          method: "GET",
          path: "/v1/address/autocomplete",
          pathParams: {},
          queryParams: { q: "melbourne" },
        }),
        headers: {
          host: "console.prontiq.dev",
          origin: "https://console.prontiq.dev",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "DEMO_UPSTREAM_UNAVAILABLE" },
    });
    fetchMock.mockRestore();
  });
});
