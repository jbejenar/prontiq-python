import assert from "node:assert/strict";
import test from "node:test";

import { type SmokeFetch, runAddressSmoke } from "./smoke-test.js";

function okJson(body: unknown): Awaited<ReturnType<SmokeFetch>> {
  return {
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

function textResponse(status: number, body: string): Awaited<ReturnType<SmokeFetch>> {
  return {
    ok: false,
    status,
    json: async () => {
      throw new Error("json should not be read for non-200 responses");
    },
    text: async () => body,
  };
}

const responseByPath = new Map<string, unknown>([
  [
    "/v1/address/autocomplete?q=9+endeavour+cou&limit=5",
    {
      suggestions: [{ addressLabel: "9 ENDEAVOUR COURT" }, { addressLabel: "10 ENDEAVOUR COURT" }],
    },
  ],
  [
    "/v1/address/autocomplete?q=9+endeavour+cuo&limit=5",
    { suggestions: [{ addressLabel: "9 ENDEAVOUR COURT" }] },
  ],
  [
    "/v1/address/autocomplete?q=9+endevour+court&limit=3",
    { suggestions: [{ addressLabel: "9 ENDEAVOUR COURT" }] },
  ],
  ["/v1/address/validate?q=9+endeavour+court+coffin+bay+sa+5607", { confidence: "high" }],
  ["/v1/address/validate?q=zzz1234+nonexistent+nowhere", { confidence: "none" }],
  ["/v1/address/validate?q=9+endeavour+court+coffin+bay+sa+9999", { confidence: "low" }],
  ["/v1/address/validate?q=9+endeavour+court+richmond+sa+5607", { confidence: "low" }],
  ["/v1/address/lookup/suburb?suburb=bondi+beech", { suburb: "BONDI BEACH" }],
  ["/v1/address/lookup/suburb?suburb=richmond", { postcodes: ["3121", "2753", "5033"] }],
  ["/v1/address/lookup/postcode?postcode=2000&limit=3", { localities: [{}, {}, {}] }],
]);

function createPassingFetch(seenUrls: string[]): SmokeFetch {
  return async (url, init) => {
    assert.equal(init.headers["X-Api-Key"], "pq_live_test");
    seenUrls.push(url);
    const parsed = new URL(url);
    const body = responseByPath.get(`${parsed.pathname}${parsed.search}`);
    assert.notEqual(body, undefined, `unexpected smoke URL ${url}`);
    return okJson(body);
  };
}

test("runAddressSmoke passes all address cases and trims trailing API slash", async () => {
  const logs: string[] = [];
  const seenUrls: string[] = [];
  let clock = 0;

  const result = await runAddressSmoke({
    apiUrl: "https://api.example.test/",
    apiKey: "pq_live_test",
    fetchImpl: createPassingFetch(seenUrls),
    log: (message) => logs.push(message),
    now: () => (clock += 5),
  });

  assert.deepEqual(result, { passed: 10, failed: 0, total: 10 });
  assert.equal(seenUrls.length, 10);
  assert.ok(seenUrls.every((url) => url.startsWith("https://api.example.test/v1/address/")));
  assert.ok(logs.some((line) => line.includes("HTTP 200")));
  assert.ok(
    !logs.join("\n").includes("pq_live_test"),
    "smoke logs must never include raw API keys",
  );
});

test("runAddressSmoke records HTTP failures without reading JSON", async () => {
  const logs: string[] = [];
  const result = await runAddressSmoke({
    apiUrl: "https://api.example.test",
    apiKey: "pq_live_test",
    fetchImpl: async () => textResponse(401, "invalid key"),
    log: (message) => logs.push(message),
    now: () => 0,
  });

  assert.equal(result.failed, 10);
  assert.ok(logs.some((line) => line.includes("HTTP 401")));
  assert.ok(logs.some((line) => line.includes("invalid key")));
  assert.ok(!logs.join("\n").includes("pq_live_test"));
});

test("runAddressSmoke records semantic response failures", async () => {
  const logs: string[] = [];
  const result = await runAddressSmoke({
    apiUrl: "https://api.example.test",
    apiKey: "pq_live_test",
    fetchImpl: async () => okJson({ suggestions: [] }),
    log: (message) => logs.push(message),
    now: () => 0,
  });

  assert.ok(result.failed > 0, "semantic failures should be detected");
  assert.ok(logs.some((line) => line.includes("0 results")));
});

test("runAddressSmoke records thrown fetch failures", async () => {
  const logs: string[] = [];
  const result = await runAddressSmoke({
    apiUrl: "https://api.example.test",
    apiKey: "pq_live_test",
    fetchImpl: async () => {
      throw new Error("network down");
    },
    log: (message) => logs.push(message),
    now: () => 0,
  });

  assert.equal(result.failed, 10);
  assert.ok(logs.some((line) => line.includes("network down")));
});
