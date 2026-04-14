import { PRODUCT_REGISTRY } from "@prontiq/shared";
import { getOpenSearchClient } from "./client.js";

const ADDRESS_ALIAS = PRODUCT_REGISTRY["address"]!.alias;

function getTotalValue(total: unknown): number {
  if (typeof total === "number") return total;
  if (total && typeof total === "object" && "value" in total) {
    return (total as { value: number }).value;
  }
  return 0;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRecord = Record<string, any>;

function buildAutocompleteQuery(q: string, state: string | undefined, operator: "and" | "or"): AnyRecord {
  const must: AnyRecord[] = [
    {
      multi_match: {
        query: q,
        type: "bool_prefix",
        operator,
        fuzziness: "AUTO",
        fields: ["addressLabelSearch", "addressLabelSearch._2gram", "addressLabelSearch._3gram"],
      },
    },
  ];

  if (state) {
    must.push({ term: { state: state.toUpperCase() } });
  }

  return { bool: { must } };
}

export async function autocomplete(q: string, state?: string, limit = 5) {
  const client = getOpenSearchClient();
  const sourceFields = ["addressLabel", "localityName", "state", "postcode", "confidence"];

  // Phase 1: strict — operator AND requires every token (including the last as
  // prefix) to match. Gives the best ranking when the user is typing a valid
  // prefix (e.g. "16 heath cres" → CRESCENT ranks first).
  const strict = await client.search({
    index: ADDRESS_ALIAS,
    body: {
      size: limit,
      query: buildAutocompleteQuery(q, state, "and"),
      _source: sourceFields,
    },
  });

  let response = strict;
  let hits = strict.body.hits.hits as AnyRecord[];

  // Phase 2: lenient fallback — if strict returned no results, the prefix
  // token likely doesn't match anything (e.g. typo'd "crese"). Use OR so
  // partial matches still return SOMETHING. Slightly worse ranking but
  // never empty when partial matches exist.
  if (hits.length === 0) {
    const lenient = await client.search({
      index: ADDRESS_ALIAS,
      body: {
        size: limit,
        query: buildAutocompleteQuery(q, state, "or"),
        _source: sourceFields,
      },
    });
    response = lenient;
    hits = lenient.body.hits.hits as AnyRecord[];
  }

  return {
    suggestions: hits.map((hit) => ({
      id: hit._id as string,
      ...(hit._source as AnyRecord),
      score: hit._score as number,
    })),
    total: getTotalValue(response.body.hits.total),
  };
}

export async function validate(q: string) {
  const response = await getOpenSearchClient().search({
    index: ADDRESS_ALIAS,
    body: {
      size: 1,
      query: {
        multi_match: {
          query: q,
          type: "best_fields",
          fuzziness: "AUTO",
          fields: ["addressLabelSearch"],
        },
      },
    },
  });

  const hits = response.body.hits.hits as AnyRecord[];
  const hit = hits[0];

  if (!hit) {
    return { match: null, confidence: "none" as const };
  }

  const score = hit._score as number;
  const matchedSource = hit._source as AnyRecord;
  const matchedLabel = (matchedSource.addressLabelSearch ?? matchedSource.addressLabel ?? "") as string;
  const matchedPostcode = matchedSource.postcode as string | undefined;
  const matchedState = matchedSource.state as string | undefined;
  const matchedLocality = matchedSource.localityName as string | undefined;

  return {
    match: { id: hit._id as string, ...matchedSource },
    confidence: scoreToConfidence(score, q, matchedLabel, {
      postcode: matchedPostcode,
      state: matchedState,
      locality: matchedLocality,
    }),
  };
}

const STATE_PATTERN = /\b(NSW|VIC|QLD|SA|WA|TAS|NT|ACT)\b/;
const POSTCODE_PATTERN = /\b\d{4}\b/;
const STATES = new Set(["NSW", "VIC", "QLD", "SA", "WA", "TAS", "NT", "ACT"]);

/**
 * Levenshtein distance, bounded early at `limit` for efficiency.
 * Used to tell genuine typos apart from alien tokens (e.g. wrong locality).
 */
function editDistance(a: string, b: string, limit: number): number {
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  const prev: number[] = Array(b.length + 1);
  const curr: number[] = Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    let rowMin = curr[0]!;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1]! + 1, prev[j]! + 1, prev[j - 1]! + cost);
      if (curr[j]! < rowMin) rowMin = curr[j]!;
    }
    if (rowMin > limit) return limit + 1;
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j]!;
  }
  return prev[b.length]!;
}

/** Matches OpenSearch's fuzziness: AUTO for our token-length buckets. */
function autoFuzzyLimit(len: number): number {
  if (len <= 2) return 0;
  if (len <= 5) return 1;
  return 2;
}

function hasFuzzyMatchIn(token: string, candidates: Set<string>): boolean {
  const limit = autoFuzzyLimit(token.length);
  if (limit === 0) return false;
  for (const candidate of candidates) {
    if (editDistance(token, candidate, limit) <= limit) return true;
  }
  return false;
}

/**
 * Combine BM25 score with token coverage AND critical-component matching
 * to bucket confidence.
 *
 * Pure BM25 overstates confidence on nonsense input. Pure token coverage
 * overstates confidence when critical components (postcode, state, or
 * locality) disagree — e.g. a query `... RICHMOND VIC 3188` can still
 * share 5/6 tokens with a doc for `... HAMPTON EAST VIC 3188` even though
 * the user explicitly asked for a DIFFERENT locality.
 *
 * Layered gates (most selective first):
 *   1. Explicit postcode/state mismatch → cap at "low".
 *   2. Alien-token detection: query has a non-structural word (4+ alpha
 *      chars, not a state, not a fuzzy-match of any label token) — likely
 *      a wrong locality or street → cap at "low".
 *   3. Token-coverage floor: < 40% exact overlap → "none" (nonsense).
 *   4. Score + coverage tiers for the remaining cases.
 */
function scoreToConfidence(
  score: number,
  query: string,
  matchedLabel: string,
  matched: { postcode?: string; state?: string; locality?: string },
): "high" | "medium" | "low" | "none" {
  const qUpper = query.toUpperCase();

  // Gate 1: explicit postcode/state mismatch.
  const queryPostcode = qUpper.match(POSTCODE_PATTERN)?.[0];
  if (queryPostcode && matched.postcode && queryPostcode !== matched.postcode) {
    return "low";
  }
  const queryState = qUpper.match(STATE_PATTERN)?.[0];
  if (queryState && matched.state && queryState !== matched.state) {
    return "low";
  }

  // Tokenize for gates 2 and 3.
  const queryTokens = qUpper.split(/[^A-Z0-9]+/).filter((t) => t.length >= 2);
  if (queryTokens.length === 0) return "none";

  const labelTokens = new Set(
    matchedLabel
      .toUpperCase()
      .split(/[^A-Z0-9]+/)
      .filter((t) => t.length >= 2),
  );

  // Gate 2: alien-token detection. A token that's 4+ alphabetic chars,
  // not a state code, not in the matched label, and not within fuzzy
  // edit distance of any label token — probably a wrong locality or
  // street name the user typed. Demote to "low" regardless of other
  // component matches.
  //
  // Example: query "16 heath crescent richmond vic 3188" against
  // matched "16 HEATH CRESCENT HAMPTON EAST VIC 3188":
  //   → RICHMOND is 4+ alpha, not a state, not in label, not fuzzy-near
  //     any label token → alien → "low"
  // Contrast: query "16 haeth crescent" against same matched doc:
  //   → HAETH is 5 chars, fuzzy-matches HEATH (edit distance 1) → NOT alien
  const aliens = queryTokens.filter(
    (t) =>
      /^[A-Z]+$/.test(t) &&
      t.length >= 4 &&
      !STATES.has(t) &&
      !labelTokens.has(t) &&
      !hasFuzzyMatchIn(t, labelTokens),
  );
  if (aliens.length > 0) return "low";

  // Gate 3: token coverage floor (nonsense filter).
  const exactMatches = queryTokens.filter((t) => labelTokens.has(t)).length;
  const coverage = exactMatches / queryTokens.length;

  if (coverage < 0.4) return "none";

  // Gate 4: score + coverage tiers. Calibrated against 15M-doc prod index.
  if (score > 20 && coverage >= 0.8) return "high";
  if (score > 10 && coverage >= 0.5) return "medium";
  return "low";
}

export async function enrich(id: string) {
  const response = await getOpenSearchClient().get({
    index: ADDRESS_ALIAS,
    id,
  });

  if (!response.body.found) {
    return null;
  }

  return { id: response.body._id, ...(response.body._source as AnyRecord) };
}

export async function reverse(lat: number, lon: number, radius: number, limit: number) {
  const response = await getOpenSearchClient().search({
    index: ADDRESS_ALIAS,
    body: {
      size: limit,
      query: {
        geo_distance: {
          distance: `${radius}m`,
          location: { lat, lon },
        },
      },
      sort: [
        {
          _geo_distance: {
            location: { lat, lon },
            order: "asc",
            unit: "m",
          },
        },
      ],
    },
  });

  const hits = response.body.hits.hits as AnyRecord[];

  return {
    results: hits.map((hit) => ({
      id: hit._id as string,
      ...(hit._source as AnyRecord),
      distance_m: (hit.sort as number[])?.[0],
    })),
    total: getTotalValue(response.body.hits.total),
  };
}

export async function lookupPostcode(postcode: string, limit: number) {
  const response = await getOpenSearchClient().search({
    index: ADDRESS_ALIAS,
    body: {
      size: 0,
      query: { term: { postcode } },
      aggs: {
        localities: {
          terms: { field: "localityName", size: limit },
          aggs: {
            state: { terms: { field: "state", size: 1 } },
          },
        },
      },
    },
  });

  const aggs = response.body.aggregations as AnyRecord | undefined;
  const buckets = (aggs?.localities?.buckets ?? []) as AnyRecord[];

  return {
    postcode,
    localities: buckets.map((b) => ({
      name: b.key as string,
      state: (b.state?.buckets as AnyRecord[])?.[0]?.key as string | undefined,
      address_count: b.doc_count as number,
    })),
  };
}

export async function lookupSuburb(suburb: string, state: string | undefined, limit: number) {
  const client = getOpenSearchClient();
  const inputUpper = suburb.toUpperCase();
  const stateUpper = state?.toUpperCase();

  // Phase 1: Identify the matched suburb NAME via fuzzy search. State is only
  // used to filter the match step if the caller supplied one. The matched
  // state is NOT carried forward to phase 2 unless the caller asked for it —
  // ambiguous suburb names (e.g. RICHMOND in VIC, NSW, TAS) should aggregate
  // across all states by default.
  const matchMust: AnyRecord[] = [
    {
      fuzzy: {
        localityName: {
          value: inputUpper,
          fuzziness: "AUTO",
          prefix_length: 1,
        },
      },
    },
  ];
  if (stateUpper) {
    matchMust.push({ term: { state: stateUpper } });
  }

  const matchResponse = await client.search({
    index: ADDRESS_ALIAS,
    body: {
      size: 1,
      query: { bool: { must: matchMust } },
      _source: ["localityName"],
    },
  });

  const topHit = (matchResponse.body.hits.hits as AnyRecord[])[0];

  if (!topHit) {
    return {
      suburb: inputUpper,
      state: stateUpper,
      postcodes: [],
      bounds: undefined,
      address_count: 0,
    };
  }

  const matchedSource = topHit._source as { localityName?: string };
  const matchedSuburb = matchedSource.localityName ?? inputUpper;

  // Phase 2: Aggregate within the matched suburb name. If the caller filtered
  // by state, scope to that state. Otherwise aggregate across all states with
  // the matched name (preserving multi-state ambiguity in the response).
  const aggMust: AnyRecord[] = [{ term: { localityName: matchedSuburb } }];
  if (stateUpper) {
    aggMust.push({ term: { state: stateUpper } });
  }

  const aggResponse = await client.search({
    index: ADDRESS_ALIAS,
    body: {
      size: 0,
      query: { bool: { must: aggMust } },
      aggs: {
        postcodes: {
          terms: { field: "postcode", size: limit },
        },
        bounds: {
          geo_bounds: { field: "location" },
        },
      },
    },
  });

  const aggs = aggResponse.body.aggregations as AnyRecord | undefined;
  const postcodeBuckets = (aggs?.postcodes?.buckets ?? []) as AnyRecord[];

  return {
    suburb: matchedSuburb,
    state: stateUpper,
    postcodes: postcodeBuckets.map((b) => b.key as string),
    bounds: aggs?.bounds?.bounds as AnyRecord | undefined,
    address_count: getTotalValue(aggResponse.body.hits.total),
  };
}
