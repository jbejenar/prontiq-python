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

// Mock helpers for lookupSuburb's two-stage flow.
function exactProbeResponse(hit: boolean): AnyRecord {
  return {
    body: {
      hits: {
        hits: hit ? [{ _id: "hit1" }] : [],
        total: { value: hit ? 1 : 0 },
      },
    },
  };
}
/**
 * Build a collapsed phase-1b response: one hit per distinct locality, as
 * OpenSearch returns when `collapse: {field: "localityName"}` is used.
 * Within-sample frequency is NOT simulated — by design, collapse prevents
 * document-multiplicity flooding entirely.
 *
 * The `count` field here represents what the doc count WOULD be in a real
 * index (passed through to the collapse hit's `_score` so tests can assert
 * relevance ordering if needed), but phase 1b itself never reads counts
 * from this response — real counts come from the separate tiebreak agg.
 */
function fuzzyCandidatesResponse(
  candidates: Array<{ key: string }>,
): AnyRecord {
  return {
    body: {
      hits: {
        hits: candidates.map((c, i) => ({
          _id: `h${i}`,
          _score: 1 - i * 0.01,
          _source: { localityName: c.key },
          fields: { localityName: [c.key] },
        })),
        total: { value: candidates.length },
      },
    },
  };
}

test("lookupSuburb: phase 1a is a cheap existence probe (size 1, terminate_after, _source:false)", async () => {
  const phase1a = exactProbeResponse(true);
  const phase2Agg = emptyHits();
  const { client, calls } = makeMockClient([phase1a, phase2Agg]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  __setClientForTesting(client as any);

  await queries.lookupSuburb("bondi beach", undefined, 10);

  assert.equal(calls.length, 2, "exact-matched suburb must skip the fuzzy phase");

  const probe = calls[0]!.body;
  assert.equal(probe.size, 1, "probe must not request more than 1 hit");
  assert.equal(probe.terminate_after, 1, "probe must early-exit each shard after 1 match");
  assert.equal(probe._source, false, "probe must not deserialize _source");
  assert.notEqual(
    probe.track_total_hits,
    true,
    "probe must NOT force full-hit counting on populous suburbs",
  );
  assert.deepEqual(probe.query.bool.must[0], { term: { localityName: "BONDI BEACH" } });

  // Phase 2 runs the real aggregation.
  const phase2 = calls[1]!.body;
  assert.deepEqual(phase2.query.bool.must[0], { term: { localityName: "BONDI BEACH" } });
  assert.equal(phase2.aggs.postcodes.terms.size, 10);

  __setClientForTesting(undefined);
});

test("lookupSuburb: phase 1b dedupes at OpenSearch (collapse), not in app — prevents document flooding", async () => {
  // Regression guard for a subtle bug: fetching raw address hits and
  // deduping in app is unsafe. A populous suburb (e.g. SYDNEY with 40k
  // matching docs) can fill the entire hit window with its own duplicates,
  // crowding out rarer-but-equally-close (or closer) candidates that
  // never reach app-side ranking. Collapse dedupes at query time so each
  // distinct locality contributes exactly ONE representative hit.
  const phase1a = exactProbeResponse(false);
  // Collapsed response: one hit per distinct locality, NOT duplicates.
  // Emit populous first — app ranking must still pick closer rare winner.
  const phase1b = fuzzyCandidatesResponse([
    { key: "AVOCADO" },
    { key: "AVOCA" },
  ]);
  const phase2Agg = emptyHits();
  const { client, calls } = makeMockClient([phase1a, phase1b, phase2Agg]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  __setClientForTesting(client as any);

  await queries.lookupSuburb("avocal", undefined, 10);

  assert.equal(calls.length, 3, "fuzzy fallback path runs 1a + 1b + phase 2");

  // Phase 1b structural guarantees:
  const body1b = calls[1]!.body;

  //  1. `collapse` dedupes at query time — the critical anti-flooding
  //     control. Missing or wrong-field collapse reintroduces the bug.
  assert.deepEqual(
    body1b.collapse,
    { field: "localityName" },
    "phase 1b MUST collapse on localityName so populous suburbs can't flood the hit window with duplicates",
  );

  //  2. `match` with `fuzziness` (NOT `fuzzy` query) — match keeps
  //     per-term scoring so closer matches survive any truncation at
  //     `size`. `fuzzy`'s default rewrite strips scoring.
  const matchClause = body1b.query.bool.must[0].match;
  assert.ok(matchClause, "phase 1b must use `match` with fuzziness, not bare `fuzzy` query");
  assert.equal(matchClause.localityName.query, "AVOCAL");
  assert.equal(matchClause.localityName.fuzziness, "AUTO");
  assert.equal(matchClause.localityName.prefix_length, 1);

  //  3. `size` is the DISTINCT-candidate limit, not a doc-flood sample size.
  assert.ok(
    typeof body1b.size === "number" && body1b.size >= 50,
    `phase 1b collapse size must bound distinct candidates (>= 50), got ${body1b.size}`,
  );

  //  4. No `aggs` section — aggs reintroduce the count-ordered bucket
  //     truncation bug.
  assert.equal(
    body1b.aggs,
    undefined,
    "phase 1b must NOT use a terms aggregation — count-ordered buckets truncate the tail before app-side ranking",
  );

  //  5. Only localityName loaded from _source (hot-path I/O discipline).
  assert.deepEqual(
    body1b._source,
    ["localityName"],
    "phase 1b must only load localityName from _source",
  );

  //  6. Default _score sort per collapsed group — no explicit `sort`.
  assert.equal(
    body1b.sort,
    undefined,
    "phase 1b must rely on default _score desc sort (best per-group representative)",
  );

  // Phase 2: resolved to the closer rare candidate despite populous one
  // appearing first in the mock hit stream (order-invariance proof).
  const phase2 = calls[2]!.body;
  assert.deepEqual(
    phase2.query.bool.must[0],
    { term: { localityName: "AVOCA" } },
    "closer rare suburb (edit distance 1) must beat farther populous suburb (edit distance 2)",
  );

  __setClientForTesting(undefined);
});

/**
 * Build a tiebreak response: a terms agg over only the shortlisted
 * equal-distance candidate names, ordered by real doc_count desc.
 */
function tiebreakAggResponse(
  buckets: Array<{ key: string; count: number }>,
): AnyRecord {
  return {
    body: {
      hits: { hits: [], total: { value: 0 } },
      aggregations: {
        tiebreak: {
          buckets: buckets.map((b) => ({ key: b.key, doc_count: b.count })),
        },
      },
    },
  };
}

test("lookupSuburb: equal-distance candidates break tie via real-count agg (tiebreak query)", async () => {
  // "BIGTOWS" → BIGTOWN (1 edit) and BIGTOWM (1 edit). App ranks both at
  // distance 1, triggering the real-count tiebreak agg. Phase 1b (now
  // collapsed) returns one hit per distinct locality — the result must
  // come from the scoped terms-agg tiebreak, not from any phase-1b-side
  // signal like hit order.
  const phase1a = exactProbeResponse(false);
  // Collapsed: populous-first in hit order — tiebreak must still pick
  // the winner via real counts, not hit order.
  const phase1b = fuzzyCandidatesResponse([
    { key: "BIGTOWM" },
    { key: "BIGTOWN" },
  ]);
  // Real counts: BIGTOWN wins (4 vs 1 in prod/fixtures).
  const phase1c = tiebreakAggResponse([
    { key: "BIGTOWN", count: 4 },
    { key: "BIGTOWM", count: 1 },
  ]);
  const phase2Agg = emptyHits();
  const { client, calls } = makeMockClient([
    phase1a,
    phase1b,
    phase1c,
    phase2Agg,
  ]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  __setClientForTesting(client as any);

  await queries.lookupSuburb("bigtows", undefined, 10);

  assert.equal(calls.length, 4, "tiebreak path runs 1a + 1b + 1c + phase 2");

  // Phase 1c query must be scoped to the shortlisted equal-distance names.
  const body1c = calls[2]!.body;
  const tiebreakTerms = body1c.query.bool.must[0].terms.localityName as string[];
  assert.deepEqual(
    tiebreakTerms.sort(),
    ["BIGTOWM", "BIGTOWN"],
    "tiebreak must filter on the shortlisted names, not all fuzzy matches",
  );
  const tbAgg = body1c.aggs.tiebreak.terms;
  assert.equal(tbAgg.field, "localityName");
  assert.deepEqual(
    tbAgg.order,
    { _count: "desc" },
    "tiebreak is the ONLY place where count ordering is correct (equal-distance band)",
  );

  // Final result follows REAL counts from the tiebreak agg, not any
  // phase-1b-side signal.
  const phase2 = calls[3]!.body;
  assert.deepEqual(
    phase2.query.bool.must[0],
    { term: { localityName: "BIGTOWN" } },
    "winner must come from the tiebreak agg (real counts)",
  );

  __setClientForTesting(undefined);
});

test("lookupSuburb: single closest candidate skips the tiebreak query", async () => {
  // AVOCA alone at distance 1 → no tiebreak needed → 3 queries (1a + 1b + 2).
  const phase1a = exactProbeResponse(false);
  const phase1b = fuzzyCandidatesResponse([
    { key: "AVOCADO" }, // distance 2, not in closest band
    { key: "AVOCA" }, // distance 1, sole closest
  ]);
  const phase2Agg = emptyHits();
  const { client, calls } = makeMockClient([phase1a, phase1b, phase2Agg]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  __setClientForTesting(client as any);

  await queries.lookupSuburb("avocal", undefined, 10);

  assert.equal(calls.length, 3, "no tiebreak needed when closest band has one candidate");
  const phase2 = calls[2]!.body;
  assert.deepEqual(phase2.query.bool.must[0], { term: { localityName: "AVOCA" } });

  __setClientForTesting(undefined);
});

test("lookupSuburb: state filter applied to phase 1a, 1b, tiebreak, AND phase 2", async () => {
  // Force the tiebreak path so we can assert state carries through all 4 queries.
  const phase1a = exactProbeResponse(false);
  const phase1b = fuzzyCandidatesResponse([
    { key: "BIGTOWM" },
    { key: "BIGTOWN" },
  ]);
  const phase1c = tiebreakAggResponse([
    { key: "BIGTOWN", count: 4 },
    { key: "BIGTOWM", count: 1 },
  ]);
  const phase2Agg = emptyHits();
  const { client, calls } = makeMockClient([phase1a, phase1b, phase1c, phase2Agg]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  __setClientForTesting(client as any);

  await queries.lookupSuburb("bigtows", "wa", 10);

  assert.deepEqual(calls[0]!.body.query.bool.must[1], { term: { state: "WA" } }, "1a");
  assert.deepEqual(calls[1]!.body.query.bool.must[1], { term: { state: "WA" } }, "1b");
  assert.deepEqual(calls[2]!.body.query.bool.must[1], { term: { state: "WA" } }, "tiebreak");
  assert.deepEqual(calls[3]!.body.query.bool.must[1], { term: { state: "WA" } }, "phase 2");

  __setClientForTesting(undefined);
});

test("lookupSuburb: state OMITTED → phase 2 does NOT filter by state (Bug 4 regression test)", async () => {
  const phase1a = exactProbeResponse(true);
  const phase2Agg = emptyHits();
  const { client, calls } = makeMockClient([phase1a, phase2Agg]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  __setClientForTesting(client as any);

  const result = await queries.lookupSuburb("richmond", undefined, 10);

  assert.equal(calls[0]!.body.query.bool.must.length, 1, "phase 1a: no state filter");
  assert.equal(calls[1]!.body.query.bool.must.length, 1, "phase 2: no state filter");
  assert.deepEqual(calls[1]!.body.query.bool.must[0], { term: { localityName: "RICHMOND" } });
  assert.equal(result.state, undefined);
  assert.equal(result.suburb, "RICHMOND");

  __setClientForTesting(undefined);
});

test("lookupSuburb: no match (exact 0 + fuzzy 0 candidates) returns clean empty response", async () => {
  const phase1a = exactProbeResponse(false);
  const phase1b = fuzzyCandidatesResponse([]);
  const { client } = makeMockClient([phase1a, phase1b]);
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
