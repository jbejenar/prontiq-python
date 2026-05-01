import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const sstConfig = fs.readFileSync("sst.config.ts", "utf8");

function extractApiGatewayCorsAllowHeaders() {
  const apiConfigStart = sstConfig.indexOf('new sst.aws.ApiGatewayV2("PqApi"');
  assert.notEqual(apiConfigStart, -1, "PqApi ApiGatewayV2 config must exist");

  const allowHeadersStart = sstConfig.indexOf("allowHeaders:", apiConfigStart);
  assert.notEqual(allowHeadersStart, -1, "PqApi CORS allowHeaders must exist");

  const allowHeadersEnd = sstConfig.indexOf("]", allowHeadersStart);
  assert.notEqual(allowHeadersEnd, -1, "PqApi CORS allowHeaders array must close");

  const allowHeadersExpression = sstConfig.slice(allowHeadersStart, allowHeadersEnd + 1);
  return [...allowHeadersExpression.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
}

test("PqApi gateway CORS allows every browser header used by account API routes", () => {
  const allowHeaders = extractApiGatewayCorsAllowHeaders();

  assert.ok(allowHeaders.includes("Authorization"), "Clerk JWT browser calls need Authorization");
  assert.ok(allowHeaders.includes("Content-Type"), "JSON account API requests need Content-Type");
  assert.ok(
    allowHeaders.includes("Idempotency-Key"),
    "billing plan-change browser preflight needs Idempotency-Key at API Gateway, not only Lambda CORS",
  );
  assert.ok(allowHeaders.includes("X-Api-Key"), "public address API browser calls need X-Api-Key");
});
