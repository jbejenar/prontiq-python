/**
 * Integration tests against a real OpenSearch instance.
 *
 * Requires OpenSearch running at OPENSEARCH_TEST_URL (default:
 * http://localhost:9200). Catches the class of bugs DSL unit tests cannot —
 * e.g. `crese=0` (operator AND vs real indexed-term prefix behavior) and
 * fuzziness semantics against `search_as_you_type` n-gram subfields.
 *
 * Run locally:
 *   docker run -p 9200:9200 -e discovery.type=single-node \
 *     -e DISABLE_SECURITY_PLUGIN=true -e OPENSEARCH_INITIAL_ADMIN_PASSWORD=... \
 *     opensearchproject/opensearch:2.19.0
 *   pnpm --filter @prontiq/api test:integration
 *
 * In CI: runs as a service container (see .github/workflows/ci.yml).
 *
 * Fixture dataset is small (12 addresses) so tests are fast (~5s total
 * including index create + seed).
 */
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@opensearch-project/opensearch";
import { PRODUCT_REGISTRY } from "@prontiq/shared";
import { __setClientForTesting } from "./client.js";
import * as queries from "./queries.js";
import { fixtureAddresses, fixtureMappings } from "./__fixtures__/addresses.js";

const OPENSEARCH_URL = process.env.OPENSEARCH_TEST_URL ?? "http://localhost:9200";
const ADDRESS_ALIAS = PRODUCT_REGISTRY["address"]!.alias;
const TEST_INDEX = `${ADDRESS_ALIAS}-test-${Date.now()}`;

const client = new Client({ node: OPENSEARCH_URL });

before(async () => {
  // Create test index with required mappings
  await client.indices.create({
    index: TEST_INDEX,
    body: {
      settings: { number_of_shards: 1, number_of_replicas: 0 },
      mappings: fixtureMappings,
    },
  });

  // Alias so queries.ts (which uses the product-registry alias) hits our test index
  await client.indices.putAlias({ index: TEST_INDEX, name: ADDRESS_ALIAS });

  // Bulk index fixture data
  const body = fixtureAddresses.flatMap((doc) => {
    const { id, ...source } = doc;
    return [{ index: { _index: TEST_INDEX, _id: id } }, source];
  });
  await client.bulk({ body, refresh: true });

  // Point queries.ts at our unsigned local client
  __setClientForTesting(client);
});

after(async () => {
  __setClientForTesting(undefined);
  await client.indices.delete({ index: TEST_INDEX, ignore_unavailable: true });
  await client.close();
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const label = (s: any): string => s.addressLabel as string;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const stateOf = (s: any): string => s.state as string;

test("autocomplete: '16 heath cres' ranks CRESCENT above ROAD/STREET/AVENUE", async () => {
  const result = await queries.autocomplete("16 heath cres", undefined, 5);
  assert.ok(result.suggestions.length > 0, "must return results");
  const topAddress = label(result.suggestions[0]);
  assert.ok(
    topAddress.includes("CRESCENT"),
    `top result should be CRESCENT, got "${topAddress}"`,
  );
});

test("autocomplete: typo'd prefix '16 heath crese' triggers phase-2 fallback (non-empty)", async () => {
  const result = await queries.autocomplete("16 heath crese", undefined, 5);
  assert.ok(
    result.suggestions.length > 0,
    "phase-2 fallback must return results for typo'd prefix",
  );
});

test("autocomplete: fuzzy tolerates typo in completed word ('16 haeth crescent')", async () => {
  const result = await queries.autocomplete("16 haeth crescent", undefined, 5);
  const labels = result.suggestions.map(label);
  assert.ok(
    labels.some((l) => l.includes("HEATH CRESCENT")),
    `expected HEATH CRESCENT in fuzzy results, got ${JSON.stringify(labels)}`,
  );
});

test("autocomplete: state filter restricts to that state", async () => {
  const result = await queries.autocomplete("16 heath", "VIC", 5);
  const states = result.suggestions.map(stateOf);
  assert.ok(states.length > 0, "must return results");
  assert.ok(
    states.every((s) => s === "VIC"),
    `state filter failed, got ${JSON.stringify(states)}`,
  );
});

test("validate: known full address matches correct doc", async () => {
  const result = await queries.validate("16 heath crescent hampton east vic 3188");
  // Note: BM25 scoring is IDF-sensitive, so confidence tiers ("high"/"medium"/
  // "low") are tuned against the 15M-doc prod index and differ on small
  // fixtures. Here we assert the MATCH is correct, not the threshold bucket.
  assert.ok(result.match, "must have a match");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const match = result.match as any;
  assert.equal(match.addressLabel, "16 HEATH CRESCENT");
  assert.equal(match.localityName, "HAMPTON EAST");
  assert.notEqual(result.confidence, "none");
});

test("validate: typo'd full address still matches via fuzzy", async () => {
  const result = await queries.validate("16 haeth crescent hampton east vic 3188");
  assert.ok(result.match, "fuzzy should still find a match");
  assert.notEqual(result.confidence, "none");
});

test('validate: nonsense input returns confidence "none" (token coverage gate)', async () => {
  const result = await queries.validate("zzz nonexistent nowhere xyzabc123");
  // Token coverage of "zzz/nonexistent/nowhere/xyzabc123" against any fixture
  // address is ~0% (no exact token overlap). The coverage gate in
  // scoreToConfidence() forces this to "none" regardless of BM25 score —
  // fixing the false-positive "medium" we previously had.
  assert.equal(result.confidence, "none");
});

test('validate: wrong postcode caps confidence at "low" (critical-component gate)', async () => {
  // Query postcode 9999 doesn't match any fixture doc. Even though 6/7 other
  // tokens match "16 HEATH CRESCENT HAMPTON EAST VIC 3188", the explicit
  // postcode conflict must prevent "medium" or "high" — a caller gating form
  // submission on confidence would be misled if we said "high" for a
  // semantically wrong address.
  const result = await queries.validate("16 heath crescent hampton east vic 9999");
  assert.equal(result.confidence, "low");
});

test('validate: wrong state caps confidence at "low"', async () => {
  // State QLD conflicts with matched doc's state (VIC or NSW for HEATH CRESCENT).
  const result = await queries.validate("16 heath crescent hampton east qld 3188");
  assert.equal(result.confidence, "low");
});

test("validate: postcode/state mismatch stays low even with high BM25 score", async () => {
  // Strong textual match in every other token, but postcode is explicitly wrong.
  const result = await queries.validate("16 heath crescent griffith nsw 0000");
  assert.notEqual(result.confidence, "high");
  assert.notEqual(result.confidence, "medium");
});

test('validate: wrong locality caps confidence at "low" even when postcode+state match', async () => {
  // Caller asks for RICHMOND but the best match is HAMPTON EAST (same state,
  // different postcode). This tests the alien-token gate: RICHMOND isn't in
  // the matched doc's label and isn't a fuzzy-near any label token →
  // demoted regardless of postcode/state alignment.
  //
  // The match here will be HAMPTON EAST because RICHMOND VIC (3121) and
  // HAMPTON EAST (3188) are separate fixture docs; the validate query's
  // postcode 3188 steers the match to HAMPTON EAST even though the query
  // text says RICHMOND.
  const result = await queries.validate("16 heath crescent richmond vic 3188");
  assert.equal(result.confidence, "low");
});

test("validate: alien-token detection doesn't penalize real typos", async () => {
  // "HAETH" isn't an exact label token, but it's within fuzzy edit distance
  // of HEATH (1 edit). Must NOT be flagged as alien.
  const result = await queries.validate("16 haeth crescent hampton east vic 3188");
  assert.ok(result.match, "fuzzy typo should still match");
  assert.notEqual(result.confidence, "none");
});

test("enrich: non-existent ID returns null (no throw)", async () => {
  // Regression: OpenSearch client throws on 404 by default, which surfaced as
  // HTTP 500 at the API boundary. enrich() must suppress the throw for
  // missing-doc 404s and return null (route handler maps null → HTTP 404).
  const result = await queries.enrich("GA_DOES_NOT_EXIST_XYZ_123");
  assert.equal(result, null);
});

test("enrich: valid ID returns full record (happy path unchanged)", async () => {
  const result = await queries.enrich("F_GAVIC420559144");
  assert.ok(result, "valid ID should return a record");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  assert.equal((result as any).addressLabel, "16 HEATH CRESCENT");
});

test("lookupPostcode: postcode 2000 returns SYDNEY and HAYMARKET", async () => {
  const result = await queries.lookupPostcode("2000", 10);
  const names = result.localities.map((l) => l.name);
  assert.ok(names.includes("SYDNEY"), `expected SYDNEY, got ${JSON.stringify(names)}`);
  assert.ok(names.includes("HAYMARKET"), `expected HAYMARKET, got ${JSON.stringify(names)}`);
});

test("lookupPostcode: limit caps the result count", async () => {
  const result = await queries.lookupPostcode("2000", 1);
  assert.equal(result.localities.length, 1);
});

test("lookupSuburb: typo 'bondi beech' resolves to BONDI BEACH via fuzzy", async () => {
  const result = await queries.lookupSuburb("bondi beech", undefined, 10);
  assert.equal(result.suburb, "BONDI BEACH");
  assert.deepEqual(result.postcodes, ["2026"]);
  assert.ok((result.address_count ?? 0) > 0);
});

test("lookupSuburb: no state filter aggregates RICHMOND across VIC/NSW/TAS", async () => {
  const result = await queries.lookupSuburb("richmond", undefined, 10);
  assert.equal(result.suburb, "RICHMOND");
  assert.equal(result.state, undefined, "response state must be undefined when caller omitted");
  const postcodes = result.postcodes.sort();
  // VIC 3121, NSW 2753, TAS 7025 — all three must be present
  assert.deepEqual(postcodes, ["2753", "3121", "7025"]);
});

test("lookupSuburb: state=VIC filter restricts RICHMOND to just VIC postcode", async () => {
  const result = await queries.lookupSuburb("richmond", "VIC", 10);
  assert.equal(result.state, "VIC");
  assert.deepEqual(result.postcodes, ["3121"]);
});

test("lookupSuburb: nonexistent suburb returns clean empty response", async () => {
  const result = await queries.lookupSuburb("zzzxxxnonexistent", undefined, 10);
  assert.equal(result.suburb, "ZZZXXXNONEXISTENT");
  assert.deepEqual(result.postcodes, []);
  assert.equal(result.address_count, 0);
});
