/**
 * DSL unit tests for OpenSearch queries.
 *
 * SCOPE: These tests verify query CONSTRUCTION — that the code emits the
 * expected request body shape (operator, fuzziness, fields, limits, etc.)
 * They use a mock OpenSearch client and DO NOT execute against real
 * OpenSearch.
 *
 * WHAT THESE TESTS CATCH:
 * - Accidental regressions in query DSL (e.g. removing `operator: "and"`)
 * - Phase-2 fallback chains and their conditions
 * - Default values (limits, source filters)
 * - Parameter wiring from route → query function
 *
 * WHAT THESE TESTS DO NOT CATCH:
 * - Real OpenSearch ranking behavior (e.g. whether `crese` actually
 *   returns 0 with operator AND — discovered post-deploy in PR #38)
 * - Fuzziness behavior on `search_as_you_type` n-gram subfields
 * - Aggregation accuracy against real data
 * - Latency / timeouts
 *
 * Integration tests against a fixture OpenSearch index are tracked in P1A.12.
 * Until those exist, post-deploy manual verification on dev is required for
 * search behavior changes.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { __setClientForTesting } from "./client.js";
import * as queries from "./queries.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRecord = Record<string, any>;

interface RecordedCall {
  index: string;
  body: AnyRecord;
  id?: string;
}

interface MockClient {
  search: (req: AnyRecord) => Promise<AnyRecord>;
  get: (req: AnyRecord) => Promise<AnyRecord>;
}

function makeMockClient(searchResponses: AnyRecord[]): {
  client: MockClient;
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  let searchIndex = 0;
  const client: MockClient = {
    search: async (req) => {
      calls.push({ index: req.index, body: req.body });
      const response = searchResponses[searchIndex] ?? { body: { hits: { hits: [], total: { value: 0 } } } };
      searchIndex++;
      return response;
    },
    get: async (req) => {
      calls.push({ index: req.index, body: {}, id: req.id });
      return { body: { found: false } };
    },
  };
  return { client, calls };
}

function emptyHits(): AnyRecord {
  return { body: { hits: { hits: [], total: { value: 0 } } } };
}

function hits(addresses: { id: string; addressLabel: string; localityName: string; state: string; postcode: string }[]): AnyRecord {
  return {
    body: {
      hits: {
        hits: addresses.map((a) => ({
          _id: a.id,
          _score: 10,
          _source: {
            addressLabel: a.addressLabel,
            localityName: a.localityName,
            state: a.state,
            postcode: a.postcode,
          },
        })),
        total: { value: addresses.length },
      },
    },
  };
}

test("autocomplete: phase 1 uses bool_prefix with operator AND and fuzziness AUTO", async () => {
  const phase1Result = hits([{ id: "GA1", addressLabel: "16 HEATH CRESCENT", localityName: "GRIFFITH", state: "NSW", postcode: "2680" }]);
  const { client, calls } = makeMockClient([phase1Result]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  __setClientForTesting(client as any);

  await queries.autocomplete("16 heath cres");

  assert.equal(calls.length, 1, "only phase 1 needed when results found");
  const body = calls[0]!.body;
  assert.equal(body.size, 5, "default limit is 5");
  const mm = body.query.bool.must[0].multi_match;
  assert.equal(mm.type, "bool_prefix");
  assert.equal(mm.operator, "and", "phase 1 must use AND for best ranking");
  assert.equal(mm.fuzziness, "AUTO", "fuzziness must be AUTO for typo tolerance");
  assert.deepEqual(mm.fields, [
    "addressLabelSearch",
    "addressLabelSearch._2gram",
    "addressLabelSearch._3gram",
  ]);
  assert.deepEqual(body._source, ["addressLabel", "localityName", "state", "postcode", "confidence"]);

  __setClientForTesting(undefined);
});

test("autocomplete: phase 2 fallback to OR when phase 1 returns 0 (typo'd prefix like 'crese')", async () => {
  const phase2Result = hits([
    { id: "GA1", addressLabel: "16 HEATH ROAD", localityName: "LEPPINGTON", state: "NSW", postcode: "2179" },
    { id: "GA2", addressLabel: "16 HEATH CRESCENT", localityName: "GRIFFITH", state: "NSW", postcode: "2680" },
  ]);
  const { client, calls } = makeMockClient([emptyHits(), phase2Result]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  __setClientForTesting(client as any);

  const result = await queries.autocomplete("16 heath crese");

  assert.equal(calls.length, 2, "phase 2 must run when phase 1 is empty");
  // Phase 1: AND
  assert.equal(calls[0]!.body.query.bool.must[0].multi_match.operator, "and");
  // Phase 2: OR
  assert.equal(calls[1]!.body.query.bool.must[0].multi_match.operator, "or");
  // Phase 2 still has fuzziness
  assert.equal(calls[1]!.body.query.bool.must[0].multi_match.fuzziness, "AUTO");
  // Returns the lenient results, not empty
  assert.equal(result.suggestions.length, 2);

  __setClientForTesting(undefined);
});

test("autocomplete: state filter adds term filter to BOTH phases", async () => {
  const { client, calls } = makeMockClient([emptyHits(), emptyHits()]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  __setClientForTesting(client as any);

  await queries.autocomplete("16 heath", "vic", 10);

  // Phase 1
  assert.equal(calls[0]!.body.size, 10);
  assert.deepEqual(calls[0]!.body.query.bool.must[1], { term: { state: "VIC" } });
  // Phase 2 fallback also has state
  assert.deepEqual(calls[1]!.body.query.bool.must[1], { term: { state: "VIC" } });

  __setClientForTesting(undefined);
});

test("validate: uses best_fields with fuzziness AUTO", async () => {
  const { client, calls } = makeMockClient([emptyHits()]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  __setClientForTesting(client as any);

  await queries.validate("16 heath crescent hampton east vic 3188");

  const body = calls[0]!.body;
  assert.equal(body.size, 1);
  const mm = body.query.multi_match;
  assert.equal(mm.type, "best_fields");
  assert.equal(mm.fuzziness, "AUTO");

  __setClientForTesting(undefined);
});

test('validate: returns confidence "none" (not 0) when no match', async () => {
  const { client } = makeMockClient([emptyHits()]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  __setClientForTesting(client as any);

  const result = await queries.validate("nonexistent address");
  assert.equal(result.confidence, "none");
  assert.equal(result.match, null);

  __setClientForTesting(undefined);
});

test("lookupPostcode: uses limit param for terms aggregation size", async () => {
  const { client, calls } = makeMockClient([emptyHits()]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  __setClientForTesting(client as any);

  await queries.lookupPostcode("2000", 10);

  const body = calls[0]!.body;
  assert.equal(body.size, 0);
  assert.deepEqual(body.query, { term: { postcode: "2000" } });
  assert.equal(body.aggs.localities.terms.size, 10);

  __setClientForTesting(undefined);
});

test("lookupSuburb: phase 1 fuzzy match with prefix_length 1", async () => {
  const phase1Response = {
    body: {
      hits: {
        hits: [{ _source: { localityName: "BONDI BEACH" } }],
        total: { value: 1 },
      },
    },
  };
  const phase2Response = emptyHits();
  const { client, calls } = makeMockClient([phase1Response, phase2Response]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  __setClientForTesting(client as any);

  await queries.lookupSuburb("bondi beech", undefined, 10);

  assert.equal(calls.length, 2, "must be a two-phase query");

  // Phase 1: fuzzy
  const phase1 = calls[0]!.body;
  assert.equal(phase1.size, 1);
  const fuzzy = phase1.query.bool.must[0].fuzzy.localityName;
  assert.equal(fuzzy.value, "BONDI BEECH");
  assert.equal(fuzzy.fuzziness, "AUTO");
  assert.equal(fuzzy.prefix_length, 1, "prefix_length 1 prevents first-char overmatching");
  assert.deepEqual(phase1._source, ["localityName"]);

  // Phase 2: exact term filter on matched suburb
  const phase2 = calls[1]!.body;
  assert.equal(phase2.size, 0);
  assert.deepEqual(phase2.query.bool.must[0], { term: { localityName: "BONDI BEACH" } });
  assert.equal(phase2.aggs.postcodes.terms.size, 10);

  __setClientForTesting(undefined);
});

test("lookupSuburb: state filter applied to phase 1 AND phase 2", async () => {
  const phase1Response = {
    body: {
      hits: {
        hits: [{ _source: { localityName: "RICHMOND" } }],
        total: { value: 1 },
      },
    },
  };
  const phase2Response = emptyHits();
  const { client, calls } = makeMockClient([phase1Response, phase2Response]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  __setClientForTesting(client as any);

  await queries.lookupSuburb("richmond", "vic", 10);

  // Phase 1 must filter by state
  const phase1Must = calls[0]!.body.query.bool.must;
  assert.deepEqual(phase1Must[1], { term: { state: "VIC" } });

  // Phase 2 must filter by state
  const phase2Must = calls[1]!.body.query.bool.must;
  assert.deepEqual(phase2Must[1], { term: { state: "VIC" } });

  __setClientForTesting(undefined);
});

test("lookupSuburb: state OMITTED → phase 2 does NOT filter by state (Bug 4 regression test)", async () => {
  const phase1Response = {
    body: {
      hits: {
        // RICHMOND exists in VIC, NSW, etc. Top hit happens to be VIC.
        hits: [{ _source: { localityName: "RICHMOND" } }],
        total: { value: 1 },
      },
    },
  };
  const phase2Response = emptyHits();
  const { client, calls } = makeMockClient([phase1Response, phase2Response]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  __setClientForTesting(client as any);

  const result = await queries.lookupSuburb("richmond", undefined, 10);

  // Phase 1: no state filter
  const phase1Must = calls[0]!.body.query.bool.must;
  assert.equal(phase1Must.length, 1, "phase 1 should only have fuzzy clause when no state");

  // Phase 2: must NOT carry forward a state from the top hit
  const phase2Must = calls[1]!.body.query.bool.must;
  assert.equal(phase2Must.length, 1, "phase 2 must NOT add a state filter when caller omitted state");
  assert.deepEqual(phase2Must[0], { term: { localityName: "RICHMOND" } });

  // Response state is undefined (preserves multi-state ambiguity)
  assert.equal(result.state, undefined);
  assert.equal(result.suburb, "RICHMOND");

  __setClientForTesting(undefined);
});

test("lookupSuburb: no match returns clean empty response", async () => {
  const { client } = makeMockClient([emptyHits()]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  __setClientForTesting(client as any);

  const result = await queries.lookupSuburb("zzz nonexistent", "VIC", 10);
  assert.equal(result.suburb, "ZZZ NONEXISTENT");
  assert.equal(result.state, "VIC");
  assert.deepEqual(result.postcodes, []);
  assert.equal(result.bounds, undefined);
  assert.equal(result.address_count, 0);

  __setClientForTesting(undefined);
});
