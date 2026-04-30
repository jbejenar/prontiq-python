import test from "node:test";
import assert from "node:assert/strict";
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { Webhook } from "svix";
import type { ClerkClient } from "@clerk/backend";
import type {
  OwnerEmailSyncInput,
  OwnerEmailSyncResult,
  ProvisioningInput,
  ProvisioningResult,
} from "@prontiq/control-plane";
import { createClerkHandler } from "./clerk.js";

// 32-byte secret encoded as `whsec_<base64>` per Svix convention.
const TEST_SECRET = "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw";

interface FakeService {
  provisionOrg: (input: ProvisioningInput) => Promise<ProvisioningResult>;
  syncOwnerEmail: (input: OwnerEmailSyncInput) => Promise<OwnerEmailSyncResult>;
  calls: ProvisioningInput[];
  syncCalls: OwnerEmailSyncInput[];
}

function makeFakeService(
  result: ProvisioningResult,
  syncResult: OwnerEmailSyncResult = { status: "updated", keysUpdated: 0 },
): FakeService {
  const calls: ProvisioningInput[] = [];
  const syncCalls: OwnerEmailSyncInput[] = [];
  return {
    calls,
    syncCalls,
    async provisionOrg(input: ProvisioningInput) {
      calls.push(input);
      return result;
    },
    async syncOwnerEmail(input: OwnerEmailSyncInput) {
      syncCalls.push(input);
      return syncResult;
    },
  };
}

interface FakeClerkClient {
  client: ClerkClient;
  getUserCalls: string[];
  membershipListCalls: string[];
}

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

function makeFakeClerkClient(opts: {
  user?: ClerkUserStub;
  memberships?: Array<{ organization: { id: string }; role: string }>;
  throwOnGetMembershipList?: Error;
  throwOnGetUser?: Error;
}): FakeClerkClient {
  const getUserCalls: string[] = [];
  const membershipListCalls: string[] = [];
  const client = {
    users: {
      async getUser(userId: string) {
        getUserCalls.push(userId);
        if (opts.throwOnGetUser) throw opts.throwOnGetUser;
        return (
          opts.user ?? {
            primaryEmailAddressId: "idn_default",
            emailAddresses: [verifiedEmail("idn_default", "default@example.com")],
          }
        );
      },
      async getOrganizationMembershipList(params: { limit?: number; offset?: number; userId: string }) {
        membershipListCalls.push(params.userId);
        if (opts.throwOnGetMembershipList) throw opts.throwOnGetMembershipList;
        const allMemberships = opts.memberships ?? [
          { organization: { id: "org_test_admin" }, role: "org:admin" },
        ];
        const offset = params.offset ?? 0;
        const limit = params.limit ?? allMemberships.length;
        return {
          data: allMemberships.slice(offset, offset + limit),
        };
      },
    },
  } as unknown as ClerkClient;
  return { client, getUserCalls, membershipListCalls };
}

const STANDARD_USER: ClerkUserStub = {
  firstName: "Admin",
  lastName: "User",
  primaryEmailAddressId: "idn_admin",
  emailAddresses: [
    verifiedEmail("idn_admin", "admin@example.com"),
    verifiedEmail("idn_secondary", "alt@example.com"),
  ],
};

function signedEvent(payload: object): APIGatewayProxyEventV2 {
  const body = JSON.stringify(payload);
  const wh = new Webhook(TEST_SECRET);
  const msgId = `msg_${Date.now()}`;
  const timestamp = new Date();
  const signature = wh.sign(msgId, timestamp, body);
  return {
    version: "2.0",
    routeKey: "POST /webhooks/clerk",
    rawPath: "/webhooks/clerk",
    rawQueryString: "",
    headers: {
      "content-type": "application/json",
      "svix-id": msgId,
      "svix-timestamp": String(Math.floor(timestamp.getTime() / 1000)),
      "svix-signature": signature,
    },
    requestContext: {
      accountId: "test",
      apiId: "test",
      domainName: "test",
      domainPrefix: "test",
      http: {
        method: "POST",
        path: "/webhooks/clerk",
        protocol: "HTTP/1.1",
        sourceIp: "127.0.0.1",
        userAgent: "svix-webhooks/test",
      },
      requestId: "test",
      routeKey: "POST /webhooks/clerk",
      stage: "$default",
      time: new Date().toISOString(),
      timeEpoch: Date.now(),
    },
    body,
    isBase64Encoded: false,
  };
}

function adminMembershipPayload(orgId = "org_test_admin", role = "org:admin"): object {
  return {
    type: "organizationMembership.created",
    data: {
      organization: { id: orgId, name: "Test Org" },
      public_user_data: {
        user_id: "user_admin_1",
        // identifier deliberately set to a non-email value to prove the
        // handler resolves the real email via Clerk Backend API rather
        // than trusting this field (Bug 2).
        identifier: "+15551234567",
      },
      role,
      created_at: Date.now(),
    },
  };
}

function nonAdminMembershipPayload(role = "org:member"): object {
  return {
    type: "organizationMembership.created",
    data: {
      organization: { id: "org_test_invited" },
      public_user_data: {
        user_id: "user_invitee",
        identifier: "invitee@example.com",
      },
      role,
      created_at: Date.now(),
    },
  };
}

function userUpdatedPayload(userId = "user_admin_1"): object {
  return {
    type: "user.updated",
    data: { id: userId },
  };
}

function decodeBody(result: APIGatewayProxyResultV2): {
  statusCode: number;
  body: Record<string, unknown>;
} {
  if (typeof result === "string") {
    return { statusCode: 200, body: JSON.parse(result) as Record<string, unknown> };
  }
  const sc = result.statusCode ?? 200;
  const raw = typeof result.body === "string" ? result.body : "{}";
  return { statusCode: sc, body: JSON.parse(raw) as Record<string, unknown> };
}

test("valid signature + admin membership + new org → 200 + provisionOrg called with verified primary email (NOT identifier)", async () => {
  const orgId = "org_admin_new";
  const service = makeFakeService({
    status: "created",
    emailSent: true,
    stripeCustomerId: null,
    orgEnvelope: {
      apiKeyHash: `ORG#${orgId}`,
      stripeCustomerId: null,
      ownerEmail: "admin@example.com",
      paymentOverdue: false,
      stripeSubscriptionId: null,
      subscriptionItems: {},
      tier: "free",
      products: ["address"],
      hasFirstKey: false,
      completedAt: "2026-04-17T00:00:00.000Z",
    },
  });
  const { client: clerkClient, getUserCalls } = makeFakeClerkClient({ user: STANDARD_USER });
  const handler = createClerkHandler({
    service,
    webhookSecret: TEST_SECRET,
    clerkClient,
  });
  const event = signedEvent(adminMembershipPayload(orgId));
  const result = await handler(event);
  const { statusCode, body } = decodeBody(result);
  assert.equal(statusCode, 200);
  assert.equal(body.status, "created");
  assert.equal(service.calls.length, 1);
  assert.equal(service.calls[0]?.orgId, orgId);
  // Bug 2 regression: ownerEmail is resolved via Clerk Backend API,
  // NOT the identifier (which is "+15551234567" in this fixture).
  assert.equal(service.calls[0]?.ownerEmail, "admin@example.com");
  assert.equal(service.calls[0]?.ownerName, "Admin User");
  assert.equal(service.calls[0]?.actorId, "user_admin_1");
  assert.equal(service.calls[0]?.source, "clerk-webhook");
  assert.equal(getUserCalls.length, 1);
  assert.equal(getUserCalls[0], "user_admin_1");
});

test("valid signature + admin membership + already_exists → 200 zero new side-effects (replay safe)", async () => {
  const orgId = "org_admin_replay";
  const service = makeFakeService({
    status: "already_exists",
    emailSent: false,
    stripeCustomerId: null,
    orgEnvelope: {
      apiKeyHash: `ORG#${orgId}`,
      stripeCustomerId: null,
      ownerEmail: "admin@example.com",
      paymentOverdue: false,
      stripeSubscriptionId: null,
      subscriptionItems: {},
      tier: "free",
      products: ["address"],
      hasFirstKey: false,
      completedAt: "2026-04-17T00:00:00.000Z",
    },
  });
  const { client: clerkClient } = makeFakeClerkClient({ user: STANDARD_USER });
  const handler = createClerkHandler({ service, webhookSecret: TEST_SECRET, clerkClient });
  const event = signedEvent(adminMembershipPayload(orgId));
  const result = await handler(event);
  const { statusCode, body } = decodeBody(result);
  assert.equal(statusCode, 200);
  assert.equal(body.status, "already_exists");
});

test("valid signature + non-admin role (org:member) → 200 zero provision calls (invite flow)", async () => {
  const service = makeFakeService({ status: "created", emailSent: false });
  const { client: clerkClient, getUserCalls } = makeFakeClerkClient({ user: STANDARD_USER });
  const handler = createClerkHandler({ service, webhookSecret: TEST_SECRET, clerkClient });
  const event = signedEvent(nonAdminMembershipPayload());
  const result = await handler(event);
  const { statusCode, body } = decodeBody(result);
  assert.equal(statusCode, 200);
  assert.equal(body.skipped, true);
  assert.equal(body.reason, "non_admin_membership");
  assert.equal(service.calls.length, 0, "non-admin must not trigger provisioning");
  assert.equal(getUserCalls.length, 0, "no Clerk lookup until role gate passes");
});

test("valid signature + unsubscribed event type → 200 forward-compat no-op", async () => {
  const service = makeFakeService({
    status: "created",
    emailSent: false,
  });
  const handler = createClerkHandler({ service, webhookSecret: TEST_SECRET });
  const event = signedEvent({
    type: "user.created",
    data: { id: "user_xyz" },
  });
  const result = await handler(event);
  const { statusCode, body } = decodeBody(result);
  assert.equal(statusCode, 200);
  assert.equal(body.skipped, true);
  assert.equal(body.reason, "unsubscribed_event_type");
  assert.equal(service.calls.length, 0);
});

test("user.updated + admin membership → syncs verified primary email to local envelope and Lago", async () => {
  const service = makeFakeService(
    { status: "already_exists", emailSent: false },
    { status: "updated", keysUpdated: 2 },
  );
  const { client: clerkClient, getUserCalls, membershipListCalls } = makeFakeClerkClient({
    user: {
      firstName: "New",
      lastName: "Owner",
      primaryEmailAddressId: "idn_new",
      emailAddresses: [verifiedEmail("idn_new", "new-owner@example.com")],
    },
    memberships: [{ organization: { id: "org_email_sync" }, role: "org:admin" }],
  });
  const handler = createClerkHandler({ service, webhookSecret: TEST_SECRET, clerkClient });
  const result = await handler(signedEvent(userUpdatedPayload("user_owner")));
  const { statusCode, body } = decodeBody(result);
  assert.equal(statusCode, 200);
  assert.equal(body.status, "owner_email_synced");
  assert.equal(body.updated, 1);
  assert.equal(service.calls.length, 0, "user.updated must not reprovision the org");
  assert.equal(service.syncCalls.length, 1);
  assert.deepEqual(service.syncCalls[0], {
    actorId: "user_owner",
    orgId: "org_email_sync",
    ownerEmail: "new-owner@example.com",
    ownerName: "New Owner",
    source: "clerk-user-updated",
  });
  assert.deepEqual(getUserCalls, ["user_owner"]);
  assert.deepEqual(membershipListCalls, ["user_owner"]);
});

test("user.updated + member-only memberships → 200 skipped and no Lago/local sync", async () => {
  const service = makeFakeService({ status: "already_exists", emailSent: false });
  const { client: clerkClient } = makeFakeClerkClient({
    user: STANDARD_USER,
    memberships: [{ organization: { id: "org_member_only" }, role: "org:member" }],
  });
  const handler = createClerkHandler({ service, webhookSecret: TEST_SECRET, clerkClient });
  const result = await handler(signedEvent(userUpdatedPayload("user_member")));
  const { statusCode, body } = decodeBody(result);
  assert.equal(statusCode, 200);
  assert.equal(body.skipped, true);
  assert.equal(body.reason, "no_admin_memberships");
  assert.equal(service.syncCalls.length, 0);
});

test("user.updated + invited admin who is not recorded owner → 200 skipped with notOwner count", async () => {
  const service = makeFakeService(
    { status: "already_exists", emailSent: false },
    { status: "not_owner" },
  );
  const { client: clerkClient } = makeFakeClerkClient({
    user: STANDARD_USER,
    memberships: [{ organization: { id: "org_invited_admin" }, role: "org:admin" }],
  });
  const handler = createClerkHandler({ service, webhookSecret: TEST_SECRET, clerkClient });
  const result = await handler(signedEvent(userUpdatedPayload("user_invited_admin")));
  const { statusCode, body } = decodeBody(result);
  assert.equal(statusCode, 200);
  assert.equal(body.status, "owner_email_synced");
  assert.equal(body.updated, 0);
  assert.equal(body.notOwner, 1);
  assert.equal(body.ownerIdentityMissing, 0);
  assert.equal(service.syncCalls.length, 1);
});

test("user.updated + legacy envelope missing owner identity → 200 skipped with repair-visible count", async () => {
  const service = makeFakeService(
    { status: "already_exists", emailSent: false },
    { status: "owner_identity_missing" },
  );
  const { client: clerkClient } = makeFakeClerkClient({
    user: STANDARD_USER,
    memberships: [{ organization: { id: "org_missing_owner_identity" }, role: "org:admin" }],
  });
  const handler = createClerkHandler({ service, webhookSecret: TEST_SECRET, clerkClient });
  const result = await handler(signedEvent(userUpdatedPayload("user_owner")));
  const { statusCode, body } = decodeBody(result);
  assert.equal(statusCode, 200);
  assert.equal(body.status, "owner_email_synced");
  assert.equal(body.updated, 0);
  assert.equal(body.notOwner, 0);
  assert.equal(body.ownerIdentityMissing, 1);
  assert.equal(service.syncCalls.length, 1);
});

test("user.updated paginates Clerk memberships before filtering admin orgs", async () => {
  const service = makeFakeService(
    { status: "already_exists", emailSent: false },
    { status: "updated", keysUpdated: 0 },
  );
  const memberships = Array.from({ length: 101 }, (_, index) => ({
    organization: { id: `org_page${index}` },
    role: index === 100 ? "org:admin" : "org:member",
  }));
  const { client: clerkClient, membershipListCalls } = makeFakeClerkClient({
    user: STANDARD_USER,
    memberships,
  });
  const handler = createClerkHandler({ service, webhookSecret: TEST_SECRET, clerkClient });

  const result = await handler(signedEvent(userUpdatedPayload("user_many_orgs")));
  const { statusCode, body } = decodeBody(result);

  assert.equal(statusCode, 200);
  assert.equal(body.updated, 1);
  assert.equal(service.syncCalls.length, 1);
  assert.equal(service.syncCalls[0]?.orgId, "org_page100");
  assert.deepEqual(membershipListCalls, ["user_many_orgs", "user_many_orgs"]);
});

test("user.updated + unverified primary email → 200 skipped so Svix does not retry forever", async () => {
  const service = makeFakeService({ status: "already_exists", emailSent: false });
  const { client: clerkClient } = makeFakeClerkClient({
    user: {
      primaryEmailAddressId: "idn_unverified",
      emailAddresses: [
        {
          id: "idn_unverified",
          emailAddress: "new-owner@example.com",
          verification: { status: "unverified" },
        },
      ],
    },
  });
  const handler = createClerkHandler({ service, webhookSecret: TEST_SECRET, clerkClient });
  const result = await handler(signedEvent(userUpdatedPayload("user_unverified")));
  const { statusCode, body } = decodeBody(result);
  assert.equal(statusCode, 200);
  assert.equal(body.skipped, true);
  assert.equal(body.reason, "primary_email_unverified");
  assert.equal(service.syncCalls.length, 0);
});

test("user.updated + Clerk membership lookup failure → 500 retryable", async () => {
  const service = makeFakeService({ status: "already_exists", emailSent: false });
  const { client: clerkClient } = makeFakeClerkClient({
    user: STANDARD_USER,
    throwOnGetMembershipList: new Error("Clerk memberships unavailable"),
  });
  const handler = createClerkHandler({ service, webhookSecret: TEST_SECRET, clerkClient });
  const result = await handler(signedEvent(userUpdatedPayload("user_lookup_fail")));
  const { statusCode, body } = decodeBody(result);
  assert.equal(statusCode, 500);
  assert.equal(body.error, "retryable_failure");
  assert.equal(body.reason, "clerk_membership_lookup_failed");
  assert.equal(service.syncCalls.length, 0);
});

test("user.updated + owner email sync failure → 500 so Svix retries", async () => {
  const service = makeFakeService(
    { status: "already_exists", emailSent: false },
    { status: "retryable_failure" },
  );
  const { client: clerkClient } = makeFakeClerkClient({
    user: STANDARD_USER,
    memberships: [{ organization: { id: "org_sync_retry" }, role: "org:admin" }],
  });
  const handler = createClerkHandler({ service, webhookSecret: TEST_SECRET, clerkClient });
  const result = await handler(signedEvent(userUpdatedPayload("user_sync_retry")));
  const { statusCode, body } = decodeBody(result);
  assert.equal(statusCode, 500);
  assert.equal(body.error, "retryable_failure");
  assert.equal(body.reason, "owner_email_sync_failed");
  assert.equal(service.syncCalls.length, 1);
});

test("invalid signature → 401 (Clerk does not retry)", async () => {
  const service = makeFakeService({
    status: "created",
    emailSent: false,
  });
  const handler = createClerkHandler({ service, webhookSecret: TEST_SECRET });
  const event = signedEvent(adminMembershipPayload());
  // Mutate body after signing — should fail verification.
  event.body = (event.body as string) + " ";
  const result = await handler(event);
  const { statusCode, body } = decodeBody(result);
  assert.equal(statusCode, 401);
  assert.equal(body.error, "invalid_signature");
  assert.equal(service.calls.length, 0);
});

test("missing svix headers → 401 (verification fails)", async () => {
  const service = makeFakeService({
    status: "created",
    emailSent: false,
  });
  const handler = createClerkHandler({ service, webhookSecret: TEST_SECRET });
  const event = signedEvent(adminMembershipPayload());
  delete event.headers["svix-signature"];
  const result = await handler(event);
  const { statusCode } = decodeBody(result);
  assert.equal(statusCode, 401);
  assert.equal(service.calls.length, 0);
});

test("malformed payload after verification → 400 (not 200; force redeliver via operator)", async () => {
  // Signature valid, payload missing required fields.
  const service = makeFakeService({
    status: "created",
    emailSent: false,
  });
  const handler = createClerkHandler({ service, webhookSecret: TEST_SECRET });
  const event = signedEvent({
    type: "organizationMembership.created",
    data: { organization: { id: "org_x" } /* missing public_user_data, role */ },
  });
  const result = await handler(event);
  const { statusCode, body } = decodeBody(result);
  assert.equal(statusCode, 400);
  assert.equal(body.error, "malformed_payload");
  assert.equal(service.calls.length, 0);
});

test("provisionOrg returns retryable_failure → 500 (Svix redelivers)", async () => {
  const service = makeFakeService({
    status: "retryable_failure",
    emailSent: false,
    stripeCustomerId: null,
  });
  const { client: clerkClient } = makeFakeClerkClient({ user: STANDARD_USER });
  const handler = createClerkHandler({ service, webhookSecret: TEST_SECRET, clerkClient });
  const event = signedEvent(adminMembershipPayload("org_retry"));
  const result = await handler(event);
  const { statusCode, body } = decodeBody(result);
  assert.equal(statusCode, 500);
  assert.equal(body.error, "retryable_failure");
});

test("provisionOrg returns fatal_failure → 500 (Svix retries; if persistent → DLQ alarm)", async () => {
  const service = makeFakeService({
    status: "fatal_failure",
    emailSent: false,
    stripeCustomerId: null,
  });
  const { client: clerkClient } = makeFakeClerkClient({ user: STANDARD_USER });
  const handler = createClerkHandler({ service, webhookSecret: TEST_SECRET, clerkClient });
  const event = signedEvent(adminMembershipPayload("org_fatal"));
  const result = await handler(event);
  const { statusCode, body } = decodeBody(result);
  assert.equal(statusCode, 500);
  assert.equal(body.error, "fatal_failure");
});

test("body is base64-encoded → still verifies and processes", async () => {
  const service = makeFakeService({ status: "created", emailSent: true });
  const { client: clerkClient } = makeFakeClerkClient({ user: STANDARD_USER });
  const handler = createClerkHandler({ service, webhookSecret: TEST_SECRET, clerkClient });
  const event = signedEvent(adminMembershipPayload("org_b64"));
  // Re-encode the existing body as base64 and flip the flag.
  const rawBody = event.body as string;
  event.body = Buffer.from(rawBody, "utf8").toString("base64");
  event.isBase64Encoded = true;
  const result = await handler(event);
  const { statusCode, body } = decodeBody(result);
  assert.equal(statusCode, 200);
  assert.equal(body.status, "created");
  assert.equal(service.calls.length, 1);
});

test("CLERK_WEBHOOK_SECRET unset → 500 (loud failure for platform alarm)", async () => {
  const service = makeFakeService({
    status: "created",
    emailSent: false,
  });
  // Pass undefined override → falls through to env var lookup.
  const previous = process.env.CLERK_WEBHOOK_SECRET;
  delete process.env.CLERK_WEBHOOK_SECRET;
  try {
    const handler = createClerkHandler({ service }); // no override
    const event = signedEvent(adminMembershipPayload("org_no_secret"));
    const result = await handler(event);
    const { statusCode, body } = decodeBody(result);
    assert.equal(statusCode, 500);
    assert.equal(body.error, "internal_error");
    assert.equal(service.calls.length, 0);
  } finally {
    if (previous !== undefined) {
      process.env.CLERK_WEBHOOK_SECRET = previous;
    }
  }
});

// ---------------------------------------------------------------------------
// Bug 1 regression — admin role gate must match Clerk's namespaced role values
// ---------------------------------------------------------------------------

test("Bug 1: org:admin (Clerk's canonical creator role) triggers provisioning", async () => {
  const service = makeFakeService({ status: "created", emailSent: true });
  const { client: clerkClient } = makeFakeClerkClient({ user: STANDARD_USER });
  const handler = createClerkHandler({ service, webhookSecret: TEST_SECRET, clerkClient });
  const event = signedEvent(adminMembershipPayload("org_org_admin", "org:admin"));
  const result = await handler(event);
  const { statusCode, body } = decodeBody(result);
  assert.equal(statusCode, 200);
  assert.equal(body.status, "created");
  assert.equal(service.calls.length, 1, "org:admin must be recognised as the creator role");
});

test("Bug 1: bare 'admin' (legacy / custom config) also triggers provisioning by default", async () => {
  const service = makeFakeService({ status: "created", emailSent: true });
  const { client: clerkClient } = makeFakeClerkClient({ user: STANDARD_USER });
  const handler = createClerkHandler({ service, webhookSecret: TEST_SECRET, clerkClient });
  const event = signedEvent(adminMembershipPayload("org_bare_admin", "admin"));
  const result = await handler(event);
  const { statusCode, body } = decodeBody(result);
  assert.equal(statusCode, 200);
  assert.equal(body.status, "created");
  assert.equal(service.calls.length, 1);
});

test("Bug 1: org:member is correctly skipped (not the creator role)", async () => {
  const service = makeFakeService({ status: "created", emailSent: false });
  const { client: clerkClient, getUserCalls } = makeFakeClerkClient({ user: STANDARD_USER });
  const handler = createClerkHandler({ service, webhookSecret: TEST_SECRET, clerkClient });
  const event = signedEvent(adminMembershipPayload("org_member", "org:member"));
  const result = await handler(event);
  const { statusCode, body } = decodeBody(result);
  assert.equal(statusCode, 200);
  assert.equal(body.skipped, true);
  assert.equal(body.reason, "non_admin_membership");
  assert.equal(service.calls.length, 0);
  assert.equal(getUserCalls.length, 0);
});

test("Bug 1: CLERK_ADMIN_ROLES env override accepts a custom role set", async () => {
  const service = makeFakeService({ status: "created", emailSent: true });
  const { client: clerkClient } = makeFakeClerkClient({ user: STANDARD_USER });
  const previous = process.env.CLERK_ADMIN_ROLES;
  process.env.CLERK_ADMIN_ROLES = "owner,principal";
  try {
    const handler = createClerkHandler({ service, webhookSecret: TEST_SECRET, clerkClient });
    const event = signedEvent(adminMembershipPayload("org_custom_role", "owner"));
    const result = await handler(event);
    const { statusCode, body } = decodeBody(result);
    assert.equal(statusCode, 200);
    assert.equal(body.status, "created");
    assert.equal(service.calls.length, 1);
  } finally {
    if (previous === undefined) {
      delete process.env.CLERK_ADMIN_ROLES;
    } else {
      process.env.CLERK_ADMIN_ROLES = previous;
    }
  }
});

test("Bug 1 / hotfix: whitespace-only CLERK_ADMIN_ROLES falls back to defaults (does NOT silently disable provisioning)", async () => {
  // Operator typo case: setting CLERK_ADMIN_ROLES to "  " or ", , ,"
  // would parse to an empty Set and skip every event as non-admin —
  // silent provisioning failure with 200 responses. Must fall back
  // to defaults instead.
  const cases = ["   ", ",,,", " , , ", "\t\n"];
  for (const value of cases) {
    const service = makeFakeService({ status: "created", emailSent: true });
    const { client: clerkClient } = makeFakeClerkClient({ user: STANDARD_USER });
    const previous = process.env.CLERK_ADMIN_ROLES;
    process.env.CLERK_ADMIN_ROLES = value;
    try {
      const handler = createClerkHandler({ service, webhookSecret: TEST_SECRET, clerkClient });
      // org:admin is in the DEFAULT set — should still trigger provisioning
      // when the override parses to empty.
      const event = signedEvent(adminMembershipPayload(`org_ws_${value.length}`, "org:admin"));
      const result = await handler(event);
      const { statusCode, body } = decodeBody(result);
      assert.equal(
        statusCode,
        200,
        `whitespace-only override "${JSON.stringify(value)}" must fall back to defaults`,
      );
      assert.equal(body.status, "created");
      assert.equal(service.calls.length, 1);
    } finally {
      if (previous === undefined) {
        delete process.env.CLERK_ADMIN_ROLES;
      } else {
        process.env.CLERK_ADMIN_ROLES = previous;
      }
    }
  }
});

test("Bug 1: explicit adminRoles override takes precedence over default + env", async () => {
  const service = makeFakeService({ status: "created", emailSent: true });
  const { client: clerkClient } = makeFakeClerkClient({ user: STANDARD_USER });
  const handler = createClerkHandler({
    service,
    webhookSecret: TEST_SECRET,
    clerkClient,
    adminRoles: new Set(["root"]),
  });
  // org:admin is NOT in the override set
  const eventBlocked = signedEvent(adminMembershipPayload("org_blocked", "org:admin"));
  const blocked = await handler(eventBlocked);
  assert.equal(decodeBody(blocked).body.skipped, true);
  // root IS in the override set
  const eventAllowed = signedEvent(adminMembershipPayload("org_allowed", "root"));
  const allowed = await handler(eventAllowed);
  assert.equal(decodeBody(allowed).body.status, "created");
});

// ---------------------------------------------------------------------------
// Bug 2 regression — verified primary email via Clerk Backend API
// ---------------------------------------------------------------------------

test("Bug 2: identifier value is IGNORED — ownerEmail comes from Clerk's verified primary email", async () => {
  const service = makeFakeService({ status: "created", emailSent: true });
  const userWithCustomPrimary: ClerkUserStub = {
    primaryEmailAddressId: "idn_primary",
    emailAddresses: [
      verifiedEmail("idn_primary", "real-owner@example.com"),
      verifiedEmail("idn_other", "other@example.com"),
    ],
  };
  const { client: clerkClient } = makeFakeClerkClient({ user: userWithCustomPrimary });
  const handler = createClerkHandler({ service, webhookSecret: TEST_SECRET, clerkClient });
  // adminMembershipPayload sets identifier to "+15551234567" (a phone)
  const event = signedEvent(adminMembershipPayload("org_phone_identifier"));
  const result = await handler(event);
  assert.equal(decodeBody(result).statusCode, 200);
  assert.equal(service.calls.length, 1);
  assert.equal(
    service.calls[0]?.ownerEmail,
    "real-owner@example.com",
    "ownerEmail MUST be the verified primary, not the identifier",
  );
});

test("Bug 2: user with no primary email → 500 fatal_failure (operator must fix in Clerk)", async () => {
  const service = makeFakeService({ status: "created", emailSent: false });
  const userWithoutEmail: ClerkUserStub = {
    primaryEmailAddressId: null,
    emailAddresses: [],
  };
  const { client: clerkClient } = makeFakeClerkClient({ user: userWithoutEmail });
  const handler = createClerkHandler({ service, webhookSecret: TEST_SECRET, clerkClient });
  const event = signedEvent(adminMembershipPayload("org_no_email"));
  const result = await handler(event);
  const { statusCode, body } = decodeBody(result);
  assert.equal(statusCode, 500);
  assert.equal(body.error, "fatal_failure");
  assert.equal(body.reason, "user_has_no_primary_email");
  assert.equal(service.calls.length, 0, "MUST NOT call provisionOrg without a real email");
});

test("Bug 2: user with primaryEmailAddressId pointing at a missing entry → 500 fatal_failure", async () => {
  // Defensive — Clerk shouldn't return this, but if it does we must
  // not silently ship a malformed email through to Lago.
  const service = makeFakeService({ status: "created", emailSent: false });
  const userWithDanglingId: ClerkUserStub = {
    primaryEmailAddressId: "idn_dangling",
    emailAddresses: [verifiedEmail("idn_other", "other@example.com")],
  };
  const { client: clerkClient } = makeFakeClerkClient({ user: userWithDanglingId });
  const handler = createClerkHandler({ service, webhookSecret: TEST_SECRET, clerkClient });
  const event = signedEvent(adminMembershipPayload("org_dangling"));
  const result = await handler(event);
  const { statusCode, body } = decodeBody(result);
  assert.equal(statusCode, 500);
  assert.equal(body.error, "fatal_failure");
  assert.equal(service.calls.length, 0);
});

test("Bug 2: Clerk API throws → 500 retryable_failure (Svix retries)", async () => {
  const service = makeFakeService({ status: "created", emailSent: false });
  const { client: clerkClient } = makeFakeClerkClient({
    throwOnGetUser: new Error("Network error / Clerk 5xx / etc."),
  });
  const handler = createClerkHandler({ service, webhookSecret: TEST_SECRET, clerkClient });
  const event = signedEvent(adminMembershipPayload("org_clerk_err"));
  const result = await handler(event);
  const { statusCode, body } = decodeBody(result);
  assert.equal(statusCode, 500);
  assert.equal(body.error, "retryable_failure");
  assert.equal(body.reason, "clerk_api_lookup_failed");
  assert.equal(service.calls.length, 0);
});

test("Bug 2: CLERK_SECRET_KEY unset (no override) → 500 internal_error (handler doesn't crash)", async () => {
  const service = makeFakeService({ status: "created", emailSent: false });
  const previous = process.env.CLERK_SECRET_KEY;
  delete process.env.CLERK_SECRET_KEY;
  try {
    // No clerkClient override → falls through to env-based lazy init
    // which throws "CLERK_SECRET_KEY is required". Handler must catch
    // and translate to 500 instead of throwing out of the Lambda.
    const handler = createClerkHandler({ service, webhookSecret: TEST_SECRET });
    const event = signedEvent(adminMembershipPayload("org_no_clerk_key"));
    const result = await handler(event);
    const { statusCode, body } = decodeBody(result);
    assert.equal(statusCode, 500);
    assert.equal(body.error, "internal_error");
    assert.equal(service.calls.length, 0);
  } finally {
    if (previous !== undefined) {
      process.env.CLERK_SECRET_KEY = previous;
    }
  }
});

// ---------------------------------------------------------------------------
// Bug 4 regression — primary email must be verified before forwarding to Lago/SES
// ---------------------------------------------------------------------------

test("Bug 4: verified primary email → found → provisioning proceeds", async () => {
  const service = makeFakeService({ status: "created", emailSent: true });
  const { client: clerkClient } = makeFakeClerkClient({ user: STANDARD_USER });
  const handler = createClerkHandler({ service, webhookSecret: TEST_SECRET, clerkClient });
  const event = signedEvent(adminMembershipPayload("org_v4_verified"));
  const result = await handler(event);
  const { statusCode, body } = decodeBody(result);
  assert.equal(statusCode, 200);
  assert.equal(body.status, "created");
  assert.equal(service.calls[0]?.ownerEmail, "admin@example.com");
});

test("Bug 4: unverified primary → 500 fatal_failure with reason 'primary_email_unverified'", async () => {
  const service = makeFakeService({ status: "created", emailSent: false });
  const userUnverified: ClerkUserStub = {
    primaryEmailAddressId: "idn_unverified",
    emailAddresses: [
      {
        id: "idn_unverified",
        emailAddress: "typo@exmaple.com",
        verification: { status: "unverified" },
      },
    ],
  };
  const { client: clerkClient } = makeFakeClerkClient({ user: userUnverified });
  const handler = createClerkHandler({ service, webhookSecret: TEST_SECRET, clerkClient });
  const event = signedEvent(adminMembershipPayload("org_v4_unverified"));
  const result = await handler(event);
  const { statusCode, body } = decodeBody(result);
  assert.equal(statusCode, 500);
  assert.equal(body.error, "fatal_failure");
  assert.equal(body.reason, "primary_email_unverified");
  assert.equal(service.calls.length, 0, "MUST NOT forward unverified email to Lago");
});

test("Bug 4: failed verification status → 500 fatal_failure (not silently accepted)", async () => {
  const service = makeFakeService({ status: "created", emailSent: false });
  const userFailed: ClerkUserStub = {
    primaryEmailAddressId: "idn_failed",
    emailAddresses: [
      { id: "idn_failed", emailAddress: "x@example.com", verification: { status: "failed" } },
    ],
  };
  const { client: clerkClient } = makeFakeClerkClient({ user: userFailed });
  const handler = createClerkHandler({ service, webhookSecret: TEST_SECRET, clerkClient });
  const event = signedEvent(adminMembershipPayload("org_v4_failed"));
  const result = await handler(event);
  const { statusCode, body } = decodeBody(result);
  assert.equal(statusCode, 500);
  assert.equal(body.reason, "primary_email_unverified");
  assert.equal(service.calls.length, 0);
});

test("Bug 4: null verification object → 500 fatal_failure (defensive — treat as unverified)", async () => {
  const service = makeFakeService({ status: "created", emailSent: false });
  const userNullVerif: ClerkUserStub = {
    primaryEmailAddressId: "idn_null_v",
    emailAddresses: [{ id: "idn_null_v", emailAddress: "x@example.com", verification: null }],
  };
  const { client: clerkClient } = makeFakeClerkClient({ user: userNullVerif });
  const handler = createClerkHandler({ service, webhookSecret: TEST_SECRET, clerkClient });
  const event = signedEvent(adminMembershipPayload("org_v4_null_verif"));
  const result = await handler(event);
  const { statusCode, body } = decodeBody(result);
  assert.equal(statusCode, 500);
  assert.equal(body.reason, "primary_email_unverified");
});

test("Bug 4: primary unverified but secondary IS verified → STILL 500 (no fallback policy)", async () => {
  // Senior-Fellow policy decision documented in resolvePrimaryEmail's
  // doc-comment: do not fall back to a non-primary verified email.
  // The primary is the user's explicit identity; falling back makes
  // Lago customer email unpredictable from the operator's view.
  // The user-facing fix is "verify your primary" or "set a verified
  // email as primary in Clerk dashboard".
  const service = makeFakeService({ status: "created", emailSent: false });
  const userMixed: ClerkUserStub = {
    primaryEmailAddressId: "idn_unverified_primary",
    emailAddresses: [
      {
        id: "idn_unverified_primary",
        emailAddress: "primary@example.com",
        verification: { status: "unverified" },
      },
      verifiedEmail("idn_verified_secondary", "secondary@example.com"),
    ],
  };
  const { client: clerkClient } = makeFakeClerkClient({ user: userMixed });
  const handler = createClerkHandler({ service, webhookSecret: TEST_SECRET, clerkClient });
  const event = signedEvent(adminMembershipPayload("org_v4_mixed"));
  const result = await handler(event);
  const { statusCode, body } = decodeBody(result);
  assert.equal(statusCode, 500);
  assert.equal(body.reason, "primary_email_unverified");
  assert.equal(
    service.calls.length,
    0,
    "no fallback to secondary verified email — primary must be verified",
  );
});

test("Bug 4: transferable status → 500 fatal_failure (transient signup state, not verified)", async () => {
  const service = makeFakeService({ status: "created", emailSent: false });
  const userTransferable: ClerkUserStub = {
    primaryEmailAddressId: "idn_xfer",
    emailAddresses: [
      { id: "idn_xfer", emailAddress: "x@example.com", verification: { status: "transferable" } },
    ],
  };
  const { client: clerkClient } = makeFakeClerkClient({ user: userTransferable });
  const handler = createClerkHandler({ service, webhookSecret: TEST_SECRET, clerkClient });
  const event = signedEvent(adminMembershipPayload("org_v4_xfer"));
  const result = await handler(event);
  const { statusCode, body } = decodeBody(result);
  assert.equal(statusCode, 500);
  assert.equal(body.reason, "primary_email_unverified");
});
