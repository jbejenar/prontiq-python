import test from "node:test";
import assert from "node:assert/strict";
import type { ClerkClient } from "@clerk/backend";
import { DEFAULT_ADMIN_ROLES, getAdminRoles, resolvePrimaryEmail } from "./clerk.js";

interface ClerkEmailAddressStub {
  id: string;
  emailAddress: string;
  verification: { status: string } | null;
}

interface ClerkUserStub {
  firstName?: string | null;
  lastName?: string | null;
  primaryEmailAddressId: string | null;
  emailAddresses: ClerkEmailAddressStub[];
}

function verifiedEmail(id: string, address: string): ClerkEmailAddressStub {
  return { id, emailAddress: address, verification: { status: "verified" } };
}

function makeFakeClerkClient(opts: { user?: ClerkUserStub; throwOnGetUser?: unknown }): {
  client: ClerkClient;
  getUserCalls: string[];
} {
  const getUserCalls: string[] = [];
  const client = {
    users: {
      async getUser(userId: string) {
        getUserCalls.push(userId);
        if (opts.throwOnGetUser !== undefined) throw opts.throwOnGetUser;
        return (
          opts.user ?? {
            primaryEmailAddressId: "idn_default",
            emailAddresses: [verifiedEmail("idn_default", "default@example.com")],
          }
        );
      },
    },
  } as unknown as ClerkClient;
  return { client, getUserCalls };
}

test("found: verified primary email returns kind 'found' with the email", async () => {
  const { client, getUserCalls } = makeFakeClerkClient({
    user: {
      firstName: "Ada",
      lastName: "Lovelace",
      primaryEmailAddressId: "idn_admin",
      emailAddresses: [verifiedEmail("idn_admin", "admin@example.com")],
    },
  });
  const result = await resolvePrimaryEmail(client, "user_abc");
  assert.deepEqual(result, {
    kind: "found",
    email: "admin@example.com",
    displayName: "Ada Lovelace",
  });
  assert.deepEqual(getUserCalls, ["user_abc"]);
});

test("found: verified primary email falls back to null displayName when first and last name are blank", async () => {
  const { client } = makeFakeClerkClient({
    user: {
      firstName: "  ",
      lastName: null,
      primaryEmailAddressId: "idn_admin",
      emailAddresses: [verifiedEmail("idn_admin", "admin@example.com")],
    },
  });
  const result = await resolvePrimaryEmail(client, "user_abc");
  assert.deepEqual(result, {
    kind: "found",
    email: "admin@example.com",
    displayName: null,
  });
});

test("not_found: user has no primaryEmailAddressId (phone-first / OAuth-only signup)", async () => {
  const { client } = makeFakeClerkClient({
    user: { primaryEmailAddressId: null, emailAddresses: [] },
  });
  const result = await resolvePrimaryEmail(client, "user_abc");
  assert.deepEqual(result, { kind: "not_found" });
});

test("not_found: primaryEmailAddressId set but no matching entry in emailAddresses", async () => {
  const { client } = makeFakeClerkClient({
    user: {
      primaryEmailAddressId: "idn_missing",
      emailAddresses: [verifiedEmail("idn_other", "other@example.com")],
    },
  });
  const result = await resolvePrimaryEmail(client, "user_abc");
  assert.deepEqual(result, { kind: "not_found" });
});

test("not_found: matching entry has empty emailAddress string", async () => {
  const { client } = makeFakeClerkClient({
    user: {
      primaryEmailAddressId: "idn_blank",
      emailAddresses: [{ id: "idn_blank", emailAddress: "", verification: { status: "verified" } }],
    },
  });
  const result = await resolvePrimaryEmail(client, "user_abc");
  assert.deepEqual(result, { kind: "not_found" });
});

test("not_verified: verification status 'unverified' surfaces verificationStatus", async () => {
  const { client } = makeFakeClerkClient({
    user: {
      primaryEmailAddressId: "idn_unv",
      emailAddresses: [
        { id: "idn_unv", emailAddress: "typo@exmaple.com", verification: { status: "unverified" } },
      ],
    },
  });
  const result = await resolvePrimaryEmail(client, "user_abc");
  assert.deepEqual(result, { kind: "not_verified", verificationStatus: "unverified" });
});

test("not_verified: verification status 'failed' (defensive — not silently accepted)", async () => {
  const { client } = makeFakeClerkClient({
    user: {
      primaryEmailAddressId: "idn_fail",
      emailAddresses: [
        { id: "idn_fail", emailAddress: "x@example.com", verification: { status: "failed" } },
      ],
    },
  });
  const result = await resolvePrimaryEmail(client, "user_abc");
  assert.deepEqual(result, { kind: "not_verified", verificationStatus: "failed" });
});

test("not_verified: verification status 'expired'", async () => {
  const { client } = makeFakeClerkClient({
    user: {
      primaryEmailAddressId: "idn_exp",
      emailAddresses: [
        { id: "idn_exp", emailAddress: "x@example.com", verification: { status: "expired" } },
      ],
    },
  });
  const result = await resolvePrimaryEmail(client, "user_abc");
  assert.deepEqual(result, { kind: "not_verified", verificationStatus: "expired" });
});

test("not_verified: verification status 'transferable' (transient signup state)", async () => {
  const { client } = makeFakeClerkClient({
    user: {
      primaryEmailAddressId: "idn_xfer",
      emailAddresses: [
        { id: "idn_xfer", emailAddress: "x@example.com", verification: { status: "transferable" } },
      ],
    },
  });
  const result = await resolvePrimaryEmail(client, "user_abc");
  assert.deepEqual(result, { kind: "not_verified", verificationStatus: "transferable" });
});

test("not_verified: null verification object treated as unverified (defensive)", async () => {
  const { client } = makeFakeClerkClient({
    user: {
      primaryEmailAddressId: "idn_null",
      emailAddresses: [{ id: "idn_null", emailAddress: "x@example.com", verification: null }],
    },
  });
  const result = await resolvePrimaryEmail(client, "user_abc");
  assert.deepEqual(result, { kind: "not_verified", verificationStatus: null });
});

test("not_verified: primary unverified + secondary verified → STILL not_verified (no fallback policy)", async () => {
  // Senior-Fellow policy: do not fall back to a non-primary verified
  // email. The primary is the user's explicit identity choice;
  // falling back would make Lago customer email unpredictable from
  // the operator's perspective ("which one did we send the receipt
  // to?"). Operator fix: verify the primary, or set a verified email
  // as primary in the Clerk dashboard.
  const { client } = makeFakeClerkClient({
    user: {
      primaryEmailAddressId: "idn_primary_unv",
      emailAddresses: [
        {
          id: "idn_primary_unv",
          emailAddress: "primary@example.com",
          verification: { status: "unverified" },
        },
        verifiedEmail("idn_secondary_v", "secondary@example.com"),
      ],
    },
  });
  const result = await resolvePrimaryEmail(client, "user_abc");
  assert.deepEqual(result, { kind: "not_verified", verificationStatus: "unverified" });
});

test("transient_failure: Clerk SDK throws Error → wrapped in result, never escapes", async () => {
  const apiError = new Error("Clerk 503 upstream");
  const { client } = makeFakeClerkClient({ throwOnGetUser: apiError });
  const result = await resolvePrimaryEmail(client, "user_abc");
  assert.equal(result.kind, "transient_failure");
  if (result.kind === "transient_failure") {
    assert.equal(result.error, apiError);
  }
});

test("transient_failure: Clerk SDK throws non-Error → wrapped into Error, never escapes", async () => {
  const { client } = makeFakeClerkClient({ throwOnGetUser: "raw string failure" });
  const result = await resolvePrimaryEmail(client, "user_abc");
  assert.equal(result.kind, "transient_failure");
  if (result.kind === "transient_failure") {
    assert.ok(result.error instanceof Error);
    assert.equal(result.error.message, "raw string failure");
  }
});

// ─── getAdminRoles ────────────────────────────────────────────────────
//
// Org-admin role gate shared between the Clerk webhook (gates on
// `data.role`) and the JWT-authenticated /v1/account/setup endpoint
// (gates on the `org_role` claim). Centralising in @prontiq/control-plane
// means a single CLERK_ADMIN_ROLES env override applies uniformly to
// both ingress paths — no risk of the two diverging.

function withEnv<T>(key: string, value: string | undefined, fn: () => T): T {
  const prev = process.env[key];
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
  try {
    return fn();
  } finally {
    if (prev === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = prev;
    }
  }
}

test("getAdminRoles: defaults to org:admin + admin when env unset", () => {
  withEnv("CLERK_ADMIN_ROLES", undefined, () => {
    const roles = getAdminRoles();
    assert.deepEqual([...roles].sort(), [...DEFAULT_ADMIN_ROLES].sort());
  });
});

test("getAdminRoles: defaults when env is empty string", () => {
  withEnv("CLERK_ADMIN_ROLES", "", () => {
    const roles = getAdminRoles();
    assert.deepEqual([...roles].sort(), [...DEFAULT_ADMIN_ROLES].sort());
  });
});

test("getAdminRoles: env override accepts a custom comma-separated set", () => {
  withEnv("CLERK_ADMIN_ROLES", "owner,principal", () => {
    const roles = getAdminRoles();
    assert.deepEqual([...roles].sort(), ["owner", "principal"]);
  });
});

test("getAdminRoles: trims whitespace per token", () => {
  withEnv("CLERK_ADMIN_ROLES", "  owner  ,   principal  ", () => {
    const roles = getAdminRoles();
    assert.deepEqual([...roles].sort(), ["owner", "principal"]);
  });
});

test("getAdminRoles: whitespace-only env falls back to defaults (operator typo guard)", () => {
  withEnv("CLERK_ADMIN_ROLES", "   ,   ,   ", () => {
    const roles = getAdminRoles();
    assert.deepEqual([...roles].sort(), [...DEFAULT_ADMIN_ROLES].sort());
  });
});

test("getAdminRoles: single role override (no commas) works", () => {
  withEnv("CLERK_ADMIN_ROLES", "owner", () => {
    const roles = getAdminRoles();
    assert.deepEqual([...roles], ["owner"]);
  });
});
