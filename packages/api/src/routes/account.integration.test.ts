/**
 * `POST /v1/account/setup` end-to-end integration test (P1B.05 PR 3 DoD).
 *
 * Exercises the full request → middleware → route → provisioning →
 * DDB stack against a real DDB Local with a stubbed Lago + stubbed
 * Clerk Backend client + stubbed JWT verifier. Covers the four DoD
 * scenarios at ROADMAP.md:1502-1507:
 *   (a) Fresh org → 201 + envelope + audit row
 *   (b) Replay → 200 zero side-effects (idempotency)
 *   (c) DDB transient on first attempt → retry succeeds; exactly one
 *       Lago customer/subscription bootstrap + one envelope
 *   (d) `grep -rn "provisionOrg" packages/` shows webhook + account
 *       route + control-plane definition only (verified out-of-band
 *       in the PR description, not asserted here)
 *
 * Run locally:
 *   docker run -p 8000:8000 amazon/dynamodb-local:2.5.2
 *   pnpm --filter @prontiq/api test:integration
 *
 * In CI: runs as a service container (see .github/workflows/ci.yml).
 */
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import {
  DynamoDBClient,
  CreateTableCommand,
  DeleteTableCommand,
  DescribeTableCommand,
} from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { OpenAPIHono } from "@hono/zod-openapi";
import type { ClerkClient } from "@clerk/backend";
import {
  createProvisioningService,
  type EmailSender,
  type LagoProvisioningClient,
} from "@prontiq/control-plane";
import { clerkAdminOnly, clerkJwt, type ClerkVerifier } from "../middleware/clerk-jwt.js";
import { requestId } from "../middleware/request-id.js";
import { createAccountRoutes } from "./account.js";

const DDB_URL = process.env.DYNAMODB_TEST_URL ?? "http://localhost:8000";
const SUFFIX = Date.now().toString();
const KEYS_TABLE = `prontiq-keys-test-${SUFFIX}`;
const AUDIT_TABLE = `prontiq-audit-test-${SUFFIX}`;
const CUSTOMERS_TABLE = `prontiq-customers-test-${SUFFIX}`;

const ddbRaw = new DynamoDBClient({
  endpoint: DDB_URL,
  region: "ap-southeast-2",
  credentials: { accessKeyId: "test", secretAccessKey: "test" },
});
const ddb = DynamoDBDocumentClient.from(ddbRaw);

before(async () => {
  await ddbRaw.send(
    new CreateTableCommand({
      TableName: KEYS_TABLE,
      AttributeDefinitions: [
        { AttributeName: "apiKeyHash", AttributeType: "S" },
        { AttributeName: "orgId", AttributeType: "S" },
      ],
      KeySchema: [{ AttributeName: "apiKeyHash", KeyType: "HASH" }],
      GlobalSecondaryIndexes: [
        {
          IndexName: "orgId-index",
          KeySchema: [{ AttributeName: "orgId", KeyType: "HASH" }],
          Projection: { ProjectionType: "ALL" },
        },
      ],
      BillingMode: "PAY_PER_REQUEST",
    }),
  );
  await ddbRaw.send(
    new CreateTableCommand({
      TableName: AUDIT_TABLE,
      AttributeDefinitions: [
        { AttributeName: "orgId", AttributeType: "S" },
        { AttributeName: "timestamp#eventId", AttributeType: "S" },
      ],
      KeySchema: [
        { AttributeName: "orgId", KeyType: "HASH" },
        { AttributeName: "timestamp#eventId", KeyType: "RANGE" },
      ],
      BillingMode: "PAY_PER_REQUEST",
    }),
  );
  await ddbRaw.send(
    new CreateTableCommand({
      TableName: CUSTOMERS_TABLE,
      AttributeDefinitions: [
        { AttributeName: "orgId", AttributeType: "S" },
        { AttributeName: "customerId", AttributeType: "S" },
      ],
      KeySchema: [{ AttributeName: "orgId", KeyType: "HASH" }],
      GlobalSecondaryIndexes: [
        {
          IndexName: "customerId-index",
          KeySchema: [{ AttributeName: "customerId", KeyType: "HASH" }],
          Projection: { ProjectionType: "ALL" },
        },
      ],
      BillingMode: "PAY_PER_REQUEST",
    }),
  );
  for (const tableName of [KEYS_TABLE, AUDIT_TABLE, CUSTOMERS_TABLE]) {
    for (let i = 0; i < 20; i++) {
      const { Table } = await ddbRaw.send(new DescribeTableCommand({ TableName: tableName }));
      if (Table?.TableStatus === "ACTIVE") break;
      await new Promise((r) => setTimeout(r, 100));
    }
  }
});

after(async () => {
  await ddbRaw.send(new DeleteTableCommand({ TableName: KEYS_TABLE }));
  await ddbRaw.send(new DeleteTableCommand({ TableName: AUDIT_TABLE }));
  await ddbRaw.send(new DeleteTableCommand({ TableName: CUSTOMERS_TABLE }));
});

interface ClerkUserStub {
  primaryEmailAddressId: string;
  emailAddresses: Array<{
    id: string;
    emailAddress: string;
    verification: { status: string };
  }>;
}

function makeClerkClientStub(user: ClerkUserStub): ClerkClient {
  return {
    users: {
      async getUser() {
        return user;
      },
    },
  } as unknown as ClerkClient;
}

const VERIFIED_USER: ClerkUserStub = {
  primaryEmailAddressId: "idn_primary",
  emailAddresses: [
    { id: "idn_primary", emailAddress: "owner@example.com", verification: { status: "verified" } },
  ],
};

interface LagoStubControl {
  lagoClient: LagoProvisioningClient;
  callCount: () => number;
  resetCallCount: () => void;
}

function makeLagoStub(): LagoStubControl {
  let calls = 0;
  const subscriptions = new Set<string>();
  const lagoClient: LagoProvisioningClient = {
    async getSubscription(externalSubscriptionId) {
      if (!subscriptions.has(externalSubscriptionId)) {
        return null;
      }
      return {
        billingPeriodEndingAt: "2026-05-01T00:00:00Z",
        billingPeriodStartedAt: "2026-04-01T00:00:00Z",
        externalCustomerId: externalSubscriptionId.replace("pq_sub_", "pq_cust_"),
        externalSubscriptionId,
        planCode: "free",
        status: "active",
      };
    },
    async upsertCustomer() {
      calls += 1;
    },
    async upsertSubscription(input) {
      calls += 1;
      subscriptions.add(input.externalSubscriptionId);
    },
  };
  return {
    lagoClient,
    callCount: () => calls,
    resetCallCount: () => {
      calls = 0;
    },
  };
}

const noopEmail: EmailSender = async () => true;
const noopLogger = { error: () => {}, info: () => {}, warn: () => {} };
type BillingServiceOverride = NonNullable<
  Parameters<typeof createAccountRoutes>[0]
>["billingService"];
type ProvisioningServiceOverride = NonNullable<
  Parameters<typeof createAccountRoutes>[0]
>["service"];

interface BuildAppOpts {
  orgId: string;
  userId?: string;
  /**
   * Caller's org role embedded in the verified JWT. Defaults to
   * `org:admin` so happy-path tests work unchanged. Pass `org:member`
   * (or any non-admin string) to exercise the clerkAdminOnly() gate.
   * Pass `null` to omit the org_role claim entirely (operator JWT-
   * template gap scenario).
   */
  orgRole?: string | null;
  lagoClient: LagoProvisioningClient;
  clerkClient: ClerkClient;
  ddbOverride?: DynamoDBDocumentClient;
  billingService?: BillingServiceOverride;
  provisioningService?: ProvisioningServiceOverride;
}

function buildApp(opts: BuildAppOpts) {
  const verifier: ClerkVerifier = async () => {
    const claims: Record<string, unknown> = {
      sub: opts.userId ?? "user_acct_test",
      org_id: opts.orgId,
    };
    const role = opts.orgRole === undefined ? "org:admin" : opts.orgRole;
    if (role !== null) {
      claims.org_role = role;
    }
    return claims;
  };

  const service =
    opts.provisioningService ??
    createProvisioningService({
      ddb: opts.ddbOverride ?? ddb,
      keysTableName: KEYS_TABLE,
      customersTableName: CUSTOMERS_TABLE,
      auditTableName: AUDIT_TABLE,
      lagoClient: opts.lagoClient,
      lagoPaymentProviderCode: "stripe-main",
      sendWelcomeEmail: noopEmail,
      logger: noopLogger,
      sleep: async () => {},
    });

  const accountRoutes = createAccountRoutes({
    billingService: opts.billingService,
    clerkClient: opts.clerkClient,
    service,
  });

  const app = new OpenAPIHono();
  app.use("*", requestId());
  app.onError((err, c) => {
    return c.json(
      {
        error: {
          code: "INTERNAL_ERROR",
          message: err.message,
          status: 500,
          request_id: c.get("requestId"),
        },
      },
      500,
    );
  });
  // Production stack mounts BOTH clerkJwt and clerkAdminOnly on
  // /v1/account/* (see account-handler.ts). The integration test
  // mirrors that exactly so the admin-role gate is exercised end-to-
  // end alongside the JWT verification.
  app.use("/v1/account/*", clerkJwt({ verifier }));
  app.use("/v1/account/*", clerkAdminOnly());
  app.route("/v1/account", accountRoutes);
  return app;
}

async function callSetup(
  app: OpenAPIHono,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await app.request("/v1/account/setup", {
    method: "POST",
    headers: { Authorization: "Bearer good_token" },
  });
  const body = (await res.json()) as Record<string, unknown>;
  return { status: res.status, body };
}

test("DoD scenario (a): fresh org → 201 created + envelope + audit row", async () => {
  const orgId = `org_acct_a_${SUFFIX}`;
  const { lagoClient } = makeLagoStub();
  const app = buildApp({ orgId, lagoClient, clerkClient: makeClerkClientStub(VERIFIED_USER) });

  const { status, body } = await callSetup(app);
  assert.equal(status, 201);
  assert.equal(body.status, "created");
  assert.equal(typeof body.customerId, "string");
  assert.equal(body.stripeCustomerId, undefined);

  const envelope = await ddb.send(
    new GetCommand({ TableName: KEYS_TABLE, Key: { apiKeyHash: `ORG#${orgId}` } }),
  );
  assert.ok(envelope.Item, "envelope must be present in keys table");
  assert.equal(envelope.Item?.tier, "free");
  assert.equal(envelope.Item?.ownerEmail, "owner@example.com");
  assert.equal(envelope.Item?.hasFirstKey, false);

  const auditRows = await ddb.send(
    new QueryCommand({
      TableName: AUDIT_TABLE,
      KeyConditionExpression: "orgId = :o",
      ExpressionAttributeValues: { ":o": orgId },
    }),
  );
  assert.equal(auditRows.Count, 1, "exactly one audit row written");
  assert.equal(auditRows.Items?.[0]?.action, "ORG_PROVISIONED");
  assert.equal(auditRows.Items?.[0]?.actorId, "user_acct_test");
  const metadata = auditRows.Items?.[0]?.metadata as Record<string, unknown> | undefined;
  assert.equal(metadata?.source, "account-setup");
});

test("DoD scenario (b): replay → 200 already_exists + zero new side-effects (idempotency)", async () => {
  const orgId = `org_acct_b_${SUFFIX}`;
  const { lagoClient, callCount } = makeLagoStub();
  const app = buildApp({ orgId, lagoClient, clerkClient: makeClerkClientStub(VERIFIED_USER) });

  const first = await callSetup(app);
  assert.equal(first.status, 201);
  assert.equal(callCount(), 2, "first call bootstraps one Lago customer/subscription pair");

  const replay = await callSetup(app);
  assert.equal(replay.status, 200);
  assert.equal(replay.body.status, "already_exists");
  assert.equal(replay.body.customerId, first.body.customerId);
  assert.equal(replay.body.stripeCustomerId, undefined);
  assert.equal(callCount(), 2, "replay MUST NOT bootstrap Lago again");

  const auditRows = await ddb.send(
    new QueryCommand({
      TableName: AUDIT_TABLE,
      KeyConditionExpression: "orgId = :o",
      ExpressionAttributeValues: { ":o": orgId },
    }),
  );
  assert.equal(auditRows.Count, 1, "no new audit rows on replay");
});

test("account setup fails closed when an existing legacy envelope lacks customerId", async () => {
  const orgId = `org_acct_missing_customer_${SUFFIX}`;
  const { lagoClient } = makeLagoStub();
  const app = buildApp({
    orgId,
    lagoClient,
    clerkClient: makeClerkClientStub(VERIFIED_USER),
    provisioningService: {
      async provisionOrg() {
        return {
          emailSent: false,
          orgEnvelope: {
            apiKeyHash: `ORG#${orgId}`,
            completedAt: "2026-04-26T00:00:00.000Z",
            hasFirstKey: false,
            ownerEmail: "owner@example.com",
            paymentOverdue: false,
            products: ["address"],
            stripeCustomerId: "cus_legacy_missing_customer",
            stripeSubscriptionId: null,
            subscriptionItems: {},
            tier: "free",
          },
          status: "already_exists",
        };
      },
    },
  });

  const { status, body } = await callSetup(app);
  assert.equal(status, 409);
  const error = body.error as Record<string, unknown> | undefined;
  assert.equal(error?.code, "CUSTOMER_MAPPING_MISSING");
});

test("account setup returns forward-mode customer contract without Stripe linkage", async () => {
  const orgId = `org_acct_forward_${SUFFIX}`;
  const customerId = "pq_cust_01HYZ6Q4X6DJP2X9Q9FQKX4T7A";
  const { lagoClient } = makeLagoStub();
  const app = buildApp({
    orgId,
    lagoClient,
    clerkClient: makeClerkClientStub(VERIFIED_USER),
    provisioningService: {
      async provisionOrg() {
        return {
          customerId,
          emailSent: true,
          orgEnvelope: {
            apiKeyHash: `ORG#${orgId}`,
            completedAt: "2026-04-26T00:00:00.000Z",
            customerId,
            hasFirstKey: false,
            ownerEmail: "owner@example.com",
            paymentOverdue: false,
            products: ["address"],
            stripeCustomerId: null,
            stripeSubscriptionId: null,
            subscriptionItems: {},
            tier: "free",
          },
          status: "created",
        };
      },
    },
  });

  const { status, body } = await callSetup(app);
  assert.equal(status, 201);
  assert.equal(body.status, "created");
  assert.equal(body.customerId, customerId);
  assert.equal(body.stripeCustomerId, undefined);
  assert.equal(body.emailSent, true);
});

test("DoD scenario (c): DDB transient on first attempt → retry succeeds; exactly 1 Lago bootstrap + 1 envelope", async () => {
  const orgId = `org_acct_c_${SUFFIX}`;
  const { lagoClient, callCount } = makeLagoStub();

  // Wrap the doc client to inject a transient TransactWrite failure
  // on the FIRST TransactWriteItems call only. Subsequent calls fall
  // through to the real DDB Local. The provisioning state machine's
  // retry loop must recover without a second Lago bootstrap.
  let transactWriteAttempts = 0;
  const flakeyDdb = new Proxy(ddb, {
    get(target, prop, receiver) {
      if (prop === "send") {
        return async (command: { constructor: { name: string } }) => {
          if (command.constructor.name === "TransactWriteCommand") {
            transactWriteAttempts += 1;
            if (transactWriteAttempts === 1) {
              const err = new Error("ProvisionedThroughputExceededException simulated") as Error & {
                name: string;
              };
              err.name = "ProvisionedThroughputExceededException";
              throw err;
            }
          }
          return target.send(command as never);
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  });

  const app = buildApp({
    orgId,
    lagoClient,
    clerkClient: makeClerkClientStub(VERIFIED_USER),
    ddbOverride: flakeyDdb,
  });

  const result = await callSetup(app);
  assert.equal(result.status, 201, "retry must succeed after the simulated transient");
  assert.equal(
    callCount(),
    2,
    "Lago customer/subscription bootstrapped exactly once across both attempts",
  );
  assert.ok(
    transactWriteAttempts >= 2,
    "TransactWrite was retried at least once after the transient",
  );

  const envelope = await ddb.send(
    new GetCommand({ TableName: KEYS_TABLE, Key: { apiKeyHash: `ORG#${orgId}` } }),
  );
  assert.ok(envelope.Item, "exactly one envelope present after retry");
});

test("middleware integration: missing Authorization → 401 INVALID_TOKEN (no provisioning attempted)", async () => {
  const orgId = `org_acct_missing_auth_${SUFFIX}`;
  const { lagoClient, callCount } = makeLagoStub();
  const app = buildApp({ orgId, lagoClient, clerkClient: makeClerkClientStub(VERIFIED_USER) });

  const res = await app.request("/v1/account/setup", { method: "POST" });
  assert.equal(res.status, 401);
  const body = (await res.json()) as { error: { code: string } };
  assert.equal(body.error.code, "INVALID_TOKEN");
  assert.equal(callCount(), 0, "no Lago bootstrap when auth fails");

  const envelope = await ddb.send(
    new GetCommand({ TableName: KEYS_TABLE, Key: { apiKeyHash: `ORG#${orgId}` } }),
  );
  assert.equal(envelope.Item, undefined, "no envelope written when auth fails");
});

test("not_verified email → 500 fatal_failure with primary_email_unverified reason (no provisioning attempted)", async () => {
  const orgId = `org_acct_unverif_${SUFFIX}`;
  const { lagoClient, callCount } = makeLagoStub();
  const unverifiedUser: ClerkUserStub = {
    primaryEmailAddressId: "idn_unv",
    emailAddresses: [
      { id: "idn_unv", emailAddress: "typo@exmaple.com", verification: { status: "unverified" } },
    ],
  };
  const app = buildApp({
    orgId,
    lagoClient,
    clerkClient: makeClerkClientStub(unverifiedUser),
  });

  const { status, body } = await callSetup(app);
  assert.equal(status, 500);
  const error = body.error as {
    code: string;
    details: { reason: string; verificationStatus: string };
  };
  assert.equal(error.code, "FATAL_FAILURE");
  assert.equal(error.details.reason, "primary_email_unverified");
  assert.equal(error.details.verificationStatus, "unverified");
  assert.equal(callCount(), 0, "MUST NOT forward unverified email to Lago");

  const envelope = await ddb.send(
    new GetCommand({ TableName: KEYS_TABLE, Key: { apiKeyHash: `ORG#${orgId}` } }),
  );
  assert.equal(envelope.Item, undefined, "no envelope written for unverified primary email");
});

test("admin-gate: non-admin org member (org_role: org:member) → 403 INSUFFICIENT_ROLE; zero side-effects (Bug 1 regression)", async () => {
  // Bot review PR #101 Bug 1: without the clerkAdminOnly() gate, an
  // invited org:member could race a delayed Clerk webhook and become
  // the recorded ownerEmail / Lago customer / welcome-email
  // recipient for the org. This regression test pins the fix: an
  // org:member calling the recovery endpoint receives 403 with NO
  // Lago call and NO envelope write.
  const orgId = `org_acct_member_${SUFFIX}`;
  const { lagoClient, callCount } = makeLagoStub();
  const app = buildApp({
    orgId,
    orgRole: "org:member",
    lagoClient,
    clerkClient: makeClerkClientStub(VERIFIED_USER),
  });

  const { status, body } = await callSetup(app);
  assert.equal(status, 403);
  const error = body.error as { code: string; status: number; details: { role: string } };
  assert.equal(error.code, "INSUFFICIENT_ROLE");
  assert.equal(error.status, 403);
  assert.equal(error.details.role, "org:member");
  assert.equal(callCount(), 0, "MUST NOT bootstrap Lago for non-admin caller");

  const envelope = await ddb.send(
    new GetCommand({ TableName: KEYS_TABLE, Key: { apiKeyHash: `ORG#${orgId}` } }),
  );
  assert.equal(envelope.Item, undefined, "no envelope written when admin gate rejects");
});

test("admin-gate: missing org_role claim → 400 NO_ROLE_CLAIM; zero side-effects (operator JWT-template gap)", async () => {
  const orgId = `org_acct_missing_role_${SUFFIX}`;
  const { lagoClient, callCount } = makeLagoStub();
  const app = buildApp({
    orgId,
    orgRole: null, // omits the claim entirely
    lagoClient,
    clerkClient: makeClerkClientStub(VERIFIED_USER),
  });

  const { status, body } = await callSetup(app);
  assert.equal(status, 400);
  const error = body.error as { code: string; message: string };
  assert.equal(error.code, "NO_ROLE_CLAIM");
  assert.match(error.message, /JWT template/, "operator-helpful message");
  assert.equal(callCount(), 0);

  const envelope = await ddb.send(
    new GetCommand({ TableName: KEYS_TABLE, Key: { apiKeyHash: `ORG#${orgId}` } }),
  );
  assert.equal(envelope.Item, undefined);
});

test("admin-gate: bare 'admin' role (legacy default) → 200 (matches webhook's role policy)", async () => {
  const orgId = `org_acct_legacy_admin_${SUFFIX}`;
  const { lagoClient } = makeLagoStub();
  const app = buildApp({
    orgId,
    orgRole: "admin",
    lagoClient,
    clerkClient: makeClerkClientStub(VERIFIED_USER),
  });

  const { status, body } = await callSetup(app);
  assert.equal(status, 201, "bare 'admin' is in DEFAULT_ADMIN_ROLES — same as webhook");
  assert.equal(body.status, "created");
});

test("billing summary route is admin-only and returns the account billing contract", async () => {
  const orgId = `org_acct_billing_${SUFFIX}`;
  const { lagoClient } = makeLagoStub();
  const app = buildApp({
    orgId,
    lagoClient,
    clerkClient: makeClerkClientStub(VERIFIED_USER),
    billingService: {
      async getBillingSummary(principal) {
        assert.equal(principal.orgId, orgId);
        return {
          allowedActions: { canOpenPortal: true, canRequestPlanChange: true },
          billingPeriod: { endsAt: null, key: null, startsAt: null },
          customer: {
            customerId: "pq_cust_01HYZ6Q4X6DJP2X9Q9FQKX4T7A",
            lagoCustomerId: null,
            orgId,
          },
          invoices: { portalRequired: true },
          payment: { overdue: false, overdueInvoiceId: null },
          plan: {
            current: "free",
            lagoPlanCode: "free",
            pending: {
              downgradePlanDate: null,
              nextPlanCode: null,
              previousPlanCode: null,
              status: null,
            },
            supportedSelfServeTargets: ["free", "payg"],
          },
          subscription: {
            externalId: "pq_sub_01HYZ6Q4X6DJP2X9Q9FQKX4T7A",
            status: "active",
          },
        };
      },
      async requestPlanChange() {
        throw new Error("not used");
      },
      async createPortalSession() {
        throw new Error("not used");
      },
    },
  });

  const res = await app.request("/v1/account/billing", {
    method: "GET",
    headers: { Authorization: "Bearer good_token" },
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { customer: { orgId: string }; plan: { current: string } };
  assert.equal(body.customer.orgId, orgId);
  assert.equal(body.plan.current, "free");
});

test("plan-change route requires Idempotency-Key and forwards target plan to billing service", async () => {
  const orgId = `org_acct_plan_change_${SUFFIX}`;
  const { lagoClient } = makeLagoStub();
  const app = buildApp({
    orgId,
    lagoClient,
    clerkClient: makeClerkClientStub(VERIFIED_USER),
    billingService: {
      async getBillingSummary() {
        throw new Error("not used");
      },
      async requestPlanChange(input) {
        assert.equal(input.principal.orgId, orgId);
        assert.equal(input.idempotencyKey, "idem_plan_change");
        assert.equal(input.targetPlanCode, "payg");
        return {
          currentPlanCode: "free",
          effectiveAt: null,
          status: "submitted",
          subscriptionExternalId: "pq_sub_01HYZ6Q4X6DJP2X9Q9FQKX4T7A",
          targetPlanCode: "payg",
        };
      },
      async createPortalSession() {
        throw new Error("not used");
      },
    },
  });

  const res = await app.request("/v1/account/billing/plan-change", {
    method: "POST",
    headers: {
      Authorization: "Bearer good_token",
      "Content-Type": "application/json",
      "Idempotency-Key": "idem_plan_change",
    },
    body: JSON.stringify({ targetPlanCode: "payg" }),
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { status: string; targetPlanCode: string };
  assert.equal(body.status, "submitted");
  assert.equal(body.targetPlanCode, "payg");
});

test("mutating billing routes reject missing or blank Idempotency-Key before service dispatch", async () => {
  const orgId = `org_acct_billing_idem_${SUFFIX}`;
  const { lagoClient } = makeLagoStub();
  let planChangeCalls = 0;
  let portalSessionCalls = 0;
  const app = buildApp({
    orgId,
    lagoClient,
    clerkClient: makeClerkClientStub(VERIFIED_USER),
    billingService: {
      async getBillingSummary() {
        throw new Error("not used");
      },
      async requestPlanChange() {
        planChangeCalls += 1;
        throw new Error("plan-change service must not be called");
      },
      async createPortalSession() {
        portalSessionCalls += 1;
        throw new Error("portal-session service must not be called");
      },
    },
  });

  const missingPlanChange = await app.request("/v1/account/billing/plan-change", {
    method: "POST",
    headers: {
      Authorization: "Bearer good_token",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ targetPlanCode: "payg" }),
  });
  assert.equal(missingPlanChange.status, 400);

  const blankPlanChange = await app.request("/v1/account/billing/plan-change", {
    method: "POST",
    headers: {
      Authorization: "Bearer good_token",
      "Content-Type": "application/json",
      "Idempotency-Key": "   ",
    },
    body: JSON.stringify({ targetPlanCode: "payg" }),
  });
  assert.equal(blankPlanChange.status, 400);

  const missingPortal = await app.request("/v1/account/billing/portal-session", {
    method: "POST",
    headers: { Authorization: "Bearer good_token" },
  });
  assert.equal(missingPortal.status, 400);

  const blankPortal = await app.request("/v1/account/billing/portal-session", {
    method: "POST",
    headers: {
      Authorization: "Bearer good_token",
      "Idempotency-Key": "   ",
    },
  });
  assert.equal(blankPortal.status, 400);

  assert.equal(planChangeCalls, 0);
  assert.equal(portalSessionCalls, 0);
});
