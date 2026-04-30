import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const publicSpec = JSON.parse(fs.readFileSync("packages/docs/openapi.json", "utf8"));
const privateSpec = JSON.parse(fs.readFileSync("packages/api/openapi.private.json", "utf8"));
const docsConfig = JSON.parse(fs.readFileSync("packages/docs/docs.json", "utf8"));

test("public OpenAPI spec excludes private account routes", () => {
  const paths = Object.keys(publicSpec.paths ?? {});
  assert.ok(paths.length > 0, "public OpenAPI spec should contain public routes");
  assert.deepEqual(
    paths.filter((path) => path.startsWith("/v1/account")),
    [],
  );
  assert.deepEqual(Object.keys(publicSpec.components?.securitySchemes ?? {}), ["ApiKeyAuth"]);
});

test("private OpenAPI spec contains account routes", () => {
  const paths = Object.keys(privateSpec.paths ?? {});
  assert.ok(paths.includes("/v1/account/setup"));
  assert.ok(paths.includes("/v1/account/usage"));
  assert.equal(paths.includes("/v1/account/billing"), false);
  assert.equal(paths.includes("/v1/account/billing/plan-change"), false);
  assert.equal(paths.includes("/v1/account/billing/portal-session"), false);
  assert.deepEqual(Object.keys(privateSpec.components?.securitySchemes ?? {}), ["ClerkJwt"]);
});

test("public docs navigation excludes private account API reference pages", () => {
  const serialized = JSON.stringify(docsConfig);
  assert.equal(serialized.includes("api-reference/account"), false);
});

// ────────────────────────────────────────────────────────────────────
// PR 175 holistic-fix v3 (Bot Review #3 Bug 4): /keys/rotate and
// /keys/revoke compose `requireReverification` after `clerkAdminOnly`,
// producing TWO mutually-exclusive 403 bodies — `{ error: { code:
// "INSUFFICIENT_ROLE", ... } }` (standard envelope, admin gate) and
// `{ clerk_error: { type: "forbidden", reason: "reverification-error",
// metadata: { reverification: { level, afterMinutes } } } }`
// (Clerk-native, stale fva).
// The 403 OpenAPI response must document BOTH branches via union/oneOf
// or generated clients / contract tests will mis-type the runtime body.
// ────────────────────────────────────────────────────────────────────

function assertStepUp403Union(routePath) {
  const route = privateSpec.paths?.[routePath]?.post;
  assert.ok(route, `route ${routePath} must exist`);
  const response403 = route.responses?.["403"];
  assert.ok(response403, `${routePath} must declare a 403 response`);
  const schema = response403.content?.["application/json"]?.schema;
  assert.ok(schema, `${routePath} 403 schema missing`);

  // zod-to-openapi maps z.union → anyOf (semantically equivalent to
  // oneOf for our purposes; both express "exactly one of these
  // shapes"). Accept either keyword to avoid coupling the test to
  // a specific zod-to-openapi minor version.
  const branches = schema.anyOf ?? schema.oneOf;
  assert.ok(
    Array.isArray(branches) && branches.length >= 2,
    `${routePath} 403 must be a union of 2+ branches; got: ${JSON.stringify(Object.keys(schema))}`,
  );

  const standardBranch = branches.find(
    (b) => b.type === "object" && b.properties?.error,
  );
  assert.ok(
    standardBranch,
    `${routePath} 403 union must include the standard { error: ... } envelope (INSUFFICIENT_ROLE path)`,
  );

  const clerkBranch = branches.find(
    (b) => b.type === "object" && b.properties?.clerk_error,
  );
  assert.ok(
    clerkBranch,
    `${routePath} 403 union must include the Clerk-native { clerk_error: ... } body (reverification-error path)`,
  );
  // Pin the EXACT runtime keys so a refactor in clerk-jwt.ts that
  // changes the body shape will fail this test, not silently desync.
  const clerkErrorProps = clerkBranch.properties.clerk_error.properties;
  assert.ok(clerkErrorProps?.type, "clerk_error.type required");
  assert.ok(clerkErrorProps?.reason, "clerk_error.reason required");
  assert.ok(
    clerkErrorProps?.metadata?.properties?.reverification?.properties?.level,
    "clerk_error.metadata.reverification.level required",
  );
  assert.ok(
    clerkErrorProps?.metadata?.properties?.reverification?.properties?.afterMinutes,
    "clerk_error.metadata.reverification.afterMinutes required",
  );
  // The literal values clerk_error.{type,reason} take are the only
  // ones the frontend's useReverification() hook matches against.
  assert.deepEqual(clerkErrorProps.type.enum, ["forbidden"]);
  assert.deepEqual(clerkErrorProps.reason.enum, ["reverification-error"]);
}

test("private OpenAPI: /v1/account/keys/rotate 403 documents both INSUFFICIENT_ROLE and Clerk-native reverification body", () => {
  assertStepUp403Union("/v1/account/keys/rotate");
});

test("private OpenAPI: /v1/account/keys/revoke 403 documents both INSUFFICIENT_ROLE and Clerk-native reverification body", () => {
  assertStepUp403Union("/v1/account/keys/revoke");
});
