import { afterEach, beforeEach, expect, test, vi } from "vitest";

const envMock = vi.hoisted(() => ({
  NEXT_PUBLIC_API_URL: "https://api.test.prontiq.dev",
  NEXT_PUBLIC_CLERK_JWT_TEMPLATE: undefined as string | undefined,
}));

vi.mock("./env.js", () => ({
  env: envMock,
}));

import { accountApi } from "./account-api.js";

beforeEach(() => {
  envMock.NEXT_PUBLIC_CLERK_JWT_TEMPLATE = undefined;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

test("account API uses the default Clerk session token when no template is configured", async () => {
  const getToken = vi.fn().mockResolvedValue("default-session-jwt");
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        orgId: "org_123",
        orgRole: "org:admin",
        canManageKeys: true,
        provisioned: false,
      }),
      { status: 200 },
    ),
  );
  vi.stubGlobal("fetch", fetchMock);

  await accountApi.getStatus(getToken);

  expect(getToken).toHaveBeenCalledWith(undefined);
  expect(fetchMock).toHaveBeenCalledWith(
    "https://api.test.prontiq.dev/v1/account/status",
    expect.objectContaining({
      headers: expect.objectContaining({
        Authorization: "Bearer default-session-jwt",
      }),
    }),
  );
});

test("account API passes the configured Clerk JWT template to getToken", async () => {
  envMock.NEXT_PUBLIC_CLERK_JWT_TEMPLATE = "account-api";
  const getToken = vi.fn().mockResolvedValue("templated-jwt");
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          orgId: "org_123",
          orgRole: "org:admin",
          canManageKeys: true,
          provisioned: false,
        }),
        { status: 200 },
      ),
    ),
  );

  await accountApi.getStatus(getToken);

  expect(getToken).toHaveBeenCalledWith({ template: "account-api" });
});

test("account API fails before fetch when Clerk returns no token", async () => {
  const getToken = vi.fn().mockResolvedValue(null);
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);

  await expect(accountApi.getStatus(getToken)).rejects.toMatchObject({
    code: "NO_CLERK_SESSION",
    status: 401,
  });
  expect(fetchMock).not.toHaveBeenCalled();
});
