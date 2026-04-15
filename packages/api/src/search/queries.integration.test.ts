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

test("autocomplete: '16 endeavour cres' ranks CRESCENT above ROAD/STREET/AVENUE", async () => {
  const result = await queries.autocomplete("16 endeavour cres", undefined, 5);
  assert.ok(result.suggestions.length > 0, "must return results");
  const topAddress = label(result.suggestions[0]);
  assert.ok(
    topAddress.includes("CRESCENT"),
    `top result should be CRESCENT, got "${topAddress}"`,
  );
});

test("autocomplete: typo'd prefix '16 endeavour crese' triggers phase-2 fallback (non-empty)", async () => {
  const result = await queries.autocomplete("16 endeavour crese", undefined, 5);
  assert.ok(
    result.suggestions.length > 0,
    "phase-2 fallback must return results for typo'd prefix",
  );
});

test("autocomplete: fuzzy tolerates typo in completed word ('16 endevour crescent')", async () => {
  const result = await queries.autocomplete("16 endevour crescent", undefined, 5);
  const labels = result.suggestions.map(label);
  assert.ok(
    labels.some((l) => l.includes("ENDEAVOUR CRESCENT")),
    `expected ENDEAVOUR CRESCENT in fuzzy results, got ${JSON.stringify(labels)}`,
  );
});

test("autocomplete: state filter restricts to that state", async () => {
  const result = await queries.autocomplete("16 endeavour", "VIC", 5);
  const states = result.suggestions.map(stateOf);
  assert.ok(states.length > 0, "must return results");
  assert.ok(
    states.every((s) => s === "VIC"),
    `state filter failed, got ${JSON.stringify(states)}`,
  );
});

test("validate: known full address matches correct doc", async () => {
  const result = await queries.validate("16 endeavour crescent shepparton vic 3630");
  // Note: BM25 scoring is IDF-sensitive, so confidence tiers ("high"/"medium"/
  // "low") are tuned against the 15M-doc prod index and differ on small
  // fixtures. Here we assert the MATCH is correct, not the threshold bucket.
  assert.ok(result.match, "must have a match");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const match = result.match as any;
  assert.equal(match.addressLabel, "16 ENDEAVOUR CRESCENT");
  assert.equal(match.localityName, "SHEPPARTON");
  assert.notEqual(result.confidence, "none");
});

test("validate: typo'd full address still matches via fuzzy", async () => {
  const result = await queries.validate("16 endevour crescent shepparton vic 3630");
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
  // tokens match "16 ENDEAVOUR CRESCENT SHEPPARTON VIC 3630", the explicit
  // postcode conflict must prevent "medium" or "high" — a caller gating form
  // submission on confidence would be misled if we said "high" for a
  // semantically wrong address.
  const result = await queries.validate("16 endeavour crescent shepparton vic 9999");
  assert.equal(result.confidence, "low");
});

test('validate: wrong state caps confidence at "low"', async () => {
  // State QLD conflicts with matched doc's state (VIC or NSW for ENDEAVOUR CRESCENT).
  const result = await queries.validate("16 endeavour crescent shepparton qld 3630");
  assert.equal(result.confidence, "low");
});

test("validate: postcode/state mismatch stays low even with high BM25 score", async () => {
  // Strong textual match in every other token, but postcode is explicitly wrong.
  const result = await queries.validate("16 endeavour crescent griffith nsw 0000");
  assert.notEqual(result.confidence, "high");
  assert.notEqual(result.confidence, "medium");
});

test('validate: wrong locality caps confidence at "low" even when postcode+state match', async () => {
  // Caller asks for RICHMOND but the best match is SHEPPARTON (same state,
  // different postcode). This tests the alien-token gate: RICHMOND isn't in
  // the matched doc's label and isn't a fuzzy-near any label token →
  // demoted regardless of postcode/state alignment.
  //
  // The match here will be SHEPPARTON because RICHMOND VIC (3121) and
  // SHEPPARTON (3630) are separate fixture docs; the validate query's
  // postcode 3630 steers the match to SHEPPARTON even though the query
  // text says RICHMOND.
  const result = await queries.validate("16 endeavour crescent richmond vic 3630");
  assert.equal(result.confidence, "low");
});

test("validate: alien-token detection doesn't penalize real typos", async () => {
  // "ENDEVOUR" isn't an exact label token, but it's within fuzzy edit distance
  // of ENDEAVOUR (1 edit). Must NOT be flagged as alien.
  const result = await queries.validate("16 endevour crescent shepparton vic 3630");
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
  const result = await queries.enrich("F_GAVIC999000002");
  assert.ok(result, "valid ID should return a record");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  assert.equal((result as any).addressLabel, "16 ENDEAVOUR CRESCENT");
});

test('validate: wrong street number caps confidence at "low"', async () => {
  // Query "1 MARTIN PLACE" matches the fixture doc (numberFirst=1) with
  // HIGH BM25 score — but "99 martin place sydney nsw 2000" has number 99,
  // which must demote to "low" even though every other token agrees.
  const result = await queries.validate("99 martin place sydney nsw 2000");
  assert.equal(result.confidence, "low");
});

test('validate: prefix-unit form "unit 5 16 ..." extracts street number from after the unit', async () => {
  // Leading "UNIT" + unit number "5" → street number is the NEXT numeric
  // token (16). Must match matched doc's numberFirst=16 → not "low".
  const result = await queries.validate(
    "unit 5 16 endeavour crescent shepparton vic 3630",
  );
  assert.ok(result.match, "unit address should still match");
  assert.notEqual(result.confidence, "low");
});

test('validate: slash-unit form "5/16 ..." extracts street number from after the slash', async () => {
  // "5/16" = unit 5, street 16. Extractor must return 16 (not 5) so the
  // gate passes against matched numberFirst=16.
  const result = await queries.validate(
    "5/16 endeavour crescent shepparton vic 3630",
  );
  assert.ok(result.match, "slash form should still match");
  assert.notEqual(result.confidence, "low");
});

test('validate: prefix + slash "unit 5/16 ..." extracts street number from the slash token', async () => {
  // Common combined AU form: keyword + slash-combined unit/street. Parser
  // must handle this in one pass — earlier iteration returned undefined
  // because the loop was only looking for pure-numeric tokens after the
  // keyword, missing the slash token.
  const result = await queries.validate(
    "unit 5/16 endeavour crescent shepparton vic 3630",
  );
  assert.ok(result.match, "combined prefix+slash form should still match");
  assert.notEqual(result.confidence, "low");
});

test('validate: prefix + slash with WRONG street "unit 5/99 ..." still caps at low', async () => {
  // Negative counterpart: if the parser extracts the post-slash number
  // correctly (99), and matched numberFirst is 16, the gate must fire.
  // Proves the parser doesn't silently skip the gate for this form.
  const result = await queries.validate(
    "unit 5/99 endeavour crescent shepparton vic 3630",
  );
  assert.equal(
    result.confidence,
    "low",
    "wrong post-slash street number must still trigger the gate",
  );
});

test("validate: suffix-unit form still compares leading street number (regression for Bug 1)", async () => {
  // Regression for the bug where any UNIT keyword ANYWHERE in the query
  // disabled the street-number gate. Here the first token "99" IS the
  // street number; the trailing "UNIT 5" must NOT disable extraction.
  // Matched doc has numberFirst=16; query says 99 → must cap at "low".
  const result = await queries.validate(
    "99 endeavour crescent shepparton vic 3630 unit 5",
  );
  assert.equal(
    result.confidence,
    "low",
    "leading 99 vs matched 16 must fire the gate even when UNIT appears later",
  );
});

test('validate: "CRES" abbreviation does not trigger alien-token gate', async () => {
  // "cres" is 4 chars, not a state, not in label tokens ("CRESCENT" is),
  // and not within fuzzy edit distance of any label token (edit distance
  // to CRESCENT is 4, limit for 4-char token is 1). Without the whitelist,
  // this would demote to "low".
  const result = await queries.validate(
    "16 endeavour cres shepparton vic 3630",
  );
  assert.ok(result.match, "abbreviated street type should still match");
  assert.notEqual(result.confidence, "low");
  assert.notEqual(result.confidence, "none");
});

test("lookupSuburb: equal-distance fuzzy candidates break ties by address count", async () => {
  // "BIGTOWS" → BIGTOWN (1 edit, S→N, 4 docs) and BIGTOWM (1 edit, S→M,
  // 1 doc). SAME edit distance → tiebreak by count → populous BIGTOWN wins.
  const result = await queries.lookupSuburb("bigtows", undefined, 10);
  assert.equal(result.suburb, "BIGTOWN");
  assert.equal(result.address_count, 4);
});

test("lookupSuburb: closer rare suburb beats farther populous suburb (regression for Bug 2)", async () => {
  // "AVOCAL" → AVOCA (1 edit: delete L, 1 doc) and AVOCADO (2 edits: L→D
  // + insert O, 5 docs). Closer wins on lexical distance even though
  // AVOCADO is 5× more populous. Regression guard: population must only
  // tiebreak within an equal-distance band, never override closeness.
  const result = await queries.lookupSuburb("avocal", undefined, 10);
  assert.equal(result.suburb, "AVOCA");
  assert.equal(result.address_count, 1);
});

test("lookupSuburb: exact match wins over populous fuzzy neighbour", async () => {
  // BIGTOWM is a valid (rare) suburb. Exact query must return BIGTOWM even
  // though BIGTOWN (4 docs) is fuzzy-near. Without phase 1a, the fuzzy agg
  // would rewrite BIGTOWM → BIGTOWN based on address count.
  const result = await queries.lookupSuburb("BIGTOWM", undefined, 10);
  assert.equal(result.suburb, "BIGTOWM");
  assert.equal(result.address_count, 1);
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
