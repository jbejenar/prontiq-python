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
  assert.equal(paths.includes("/v1/account/billing"), false);
  assert.equal(paths.includes("/v1/account/billing/plan-change"), false);
  assert.equal(paths.includes("/v1/account/billing/portal-session"), false);
  assert.deepEqual(Object.keys(privateSpec.components?.securitySchemes ?? {}), ["ClerkJwt"]);
});

test("public docs navigation excludes private account API reference pages", () => {
  const serialized = JSON.stringify(docsConfig);
  assert.equal(serialized.includes("api-reference/account"), false);
});
