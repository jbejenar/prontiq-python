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
  // prefix (e.g. "9 endeavour cou" → COURT ranks first).
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

  // Coerce to string: OpenSearch type can vary (G-NAF numberFirst is usually
  // a string but other ingestion sources may emit it as a number). Coercing
  // keeps the === comparison in the gate reliable.
  const rawNumberFirst = matchedSource.numberFirst;
  const matchedNumberFirst =
    rawNumberFirst !== undefined && rawNumberFirst !== null
      ? String(rawNumberFirst)
      : undefined;

  return {
    match: { id: hit._id as string, ...matchedSource },
    confidence: scoreToConfidence(score, q, matchedLabel, {
      postcode: matchedPostcode,
      state: matchedState,
      locality: matchedLocality,
      numberFirst: matchedNumberFirst,
    }),
  };
}

const STATE_PATTERN = /\b(NSW|VIC|QLD|SA|WA|TAS|NT|ACT)\b/;
const POSTCODE_PATTERN = /\b\d{4}\b/;
const STATES = new Set(["NSW", "VIC", "QLD", "SA", "WA", "TAS", "NT", "ACT"]);

/**
 * Unit-type keywords whitelisted from the alien-token gate (4+ char members
 * only — shorter ones like LOT/APT already pass the gate's length floor).
 * Without this, a query like "unit 5 16 main ..." would be demoted to "low"
 * because UNIT isn't in any address label.
 *
 * This set is INDEPENDENT of the street-number parser below. It's used only
 * by `scoreToConfidence()` to prevent legitimate compound-address keywords
 * from being flagged as alien tokens regardless of where they appear.
 */
const UNIT_TOKENS = new Set(["UNIT", "LEVEL", "FLAT", "SHOP", "SUITE", "APARTMENT"]);

/** Token that prefixes a unit-before-street-number compound address. */
const UNIT_PREFIX = /^(UNIT|LEVEL|LOT|FLAT|SHOP|SUITE|APT|APARTMENT)$/;

/**
 * AU Post 4+ char street-type abbreviations. Exempted from the alien-token
 * gate so queries containing tokens like "CRES" or "BLVD" aren't demoted to
 * low confidence just because the abbreviation isn't in the matched doc's
 * label tokens (which carry the expanded form, e.g. "CRESCENT").
 *
 * Sourced from Australia Post Address Service Manual. Shorter abbreviations
 * (2-3 chars like ST, RD, AVE, TCE, CCT) already pass the `length >= 4` gate
 * threshold, so they don't need whitelisting.
 */
const STREET_TYPE_ABBREV = new Set([
  "BLVD", // BOULEVARD
  "CRES", // CRESCENT
  "ESPL", // ESPLANADE
  "GDNS", // GARDENS
  "PKWY", // PARKWAY
  "RDGE", // RIDGE
]);

const NUMBER_TOKEN = /^(\d+)[A-Z]?(?:-\d+[A-Z]?)?$/;
const SLASH_TOKEN = /^\d+[A-Z]?\/(\d+)[A-Z]?$/;

/**
 * Extract the street number from a single token, handling both slash-combined
 * (`5/16`) and plain numeric (`16`, `145A`, `16-18`) forms. Returns the
 * STREET number (post-slash for slash form, the leading digits otherwise).
 */
function streetNumFromToken(token: string): string | undefined {
  const slash = token.match(SLASH_TOKEN);
  if (slash) return slash[1];
  const num = token.match(NUMBER_TOKEN);
  return num ? num[1] : undefined;
}

/**
 * Extract the street number from the opening segment of an address query.
 *
 * Structural parsing — only the OPENING tokens are inspected, not the whole
 * query. A unit keyword appearing later in the string (e.g. in a street
 * name or suffix-unit form) does NOT disable street-number extraction.
 *
 * Supported forms:
 *   - Normal:            "16 main st"            → "16"
 *   - Alpha suffix:      "145A king st"          → "145"
 *   - Range:             "16-18 main st"         → "16"
 *   - Slash unit:        "5/16 main st"          → "16"  (post-slash)
 *   - Prefix + separate: "unit 5 16 main st"     → "16"  (skip unit + unit#)
 *   - Prefix + slash:    "unit 5/16 main st"     → "16"  (post-slash after keyword)
 *                        "apt 3/12 smith st"     → "12"
 *   - Suffix unit:       "16 main st unit 5"     → "16"  (leading is still street)
 *
 * Returns undefined only when the opening segment is legitimately ambiguous
 * (e.g. "lot 42 creek road" — no street number present). A bare street
 * name containing a word like "SHOP" or "FLAT" does NOT disable the gate.
 */
function extractQueryStreetNumber(queryUpper: string): string | undefined {
  const trimmed = queryUpper.trim();
  if (!trimmed) return undefined;
  const tokens = trimmed.split(/\s+/);
  const first = tokens[0]!;

  // Prefix-unit form: "UNIT 5 16 ..." OR "UNIT 5/16 ..." OR "APT 3/12 ...".
  // After the keyword, look for a slash-combined token first (carries the
  // street# directly); otherwise take the SECOND numeric token (the first
  // is the unit#).
  if (UNIT_PREFIX.test(first)) {
    for (const t of tokens.slice(1)) {
      const slash = t.match(SLASH_TOKEN);
      if (slash) return slash[1];
    }
    let numericsSeen = 0;
    for (const t of tokens.slice(1)) {
      const m = t.match(NUMBER_TOKEN);
      if (m) {
        numericsSeen++;
        if (numericsSeen === 2) return m[1];
      }
    }
    // Only a unit/lot number found (e.g. "LOT 42 CREEK ROAD") — no street
    // number to compare against, skip the gate.
    return undefined;
  }

  // Normal form OR bare slash form ("5/16 main"). The suffix-unit form
  // ("16 main st unit 5") also falls through here and extracts "16" from
  // the leading token — correct, because the first number IS the street#.
  return streetNumFromToken(first);
}

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
 * locality) disagree — e.g. a query `... RICHMOND VIC 3630` can still
 * share 5/6 tokens with a doc for `... SHEPPARTON VIC 3630` even though
 * the user explicitly asked for a DIFFERENT locality.
 *
 * Layered gates (most selective first):
 *   1. Explicit postcode/state mismatch → cap at "low".
 *   2. Street-number mismatch → cap at "low" (prevents "1 martin place"
 *      matching "2001 MARTIN PLACE" as high confidence).
 *   3. Alien-token detection: query has a non-structural word (4+ alpha
 *      chars, not a state, not a whitelisted street-type abbreviation or
 *      unit keyword, not a fuzzy-match of any label token) — likely a
 *      wrong locality or street → cap at "low".
 *   4. Token-coverage floor: < 40% exact overlap → "none" (nonsense).
 *   5. Score + coverage tiers for the remaining cases.
 */
function scoreToConfidence(
  score: number,
  query: string,
  matchedLabel: string,
  matched: {
    postcode?: string;
    state?: string;
    locality?: string;
    numberFirst?: string;
  },
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

  // Gate 2: street-number mismatch. Only fires when BOTH sides have a number
  // (query leading token parses AND matched doc has numberFirst). Unit
  // addresses ("unit 5 16 main") skip this gate — the leading "5" is a unit
  // number, not a street number.
  const queryNumber = extractQueryStreetNumber(qUpper);
  if (queryNumber && matched.numberFirst && queryNumber !== matched.numberFirst) {
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
  // Example: query "9 endeavour court richmond sa 5607" against
  // matched "9 ENDEAVOUR COURT COFFIN BAY SA 5607":
  //   → RICHMOND is 4+ alpha, not a state, not in label, not fuzzy-near
  //     any label token → alien → "low"
  // Contrast: query "9 endevour court" against same matched doc:
  //   → ENDEVOUR is 8 chars, fuzzy-matches ENDEAVOUR (edit distance 1) → NOT alien
  const aliens = queryTokens.filter(
    (t) =>
      /^[A-Z]+$/.test(t) &&
      t.length >= 4 &&
      !STATES.has(t) &&
      !STREET_TYPE_ABBREV.has(t) &&
      !UNIT_TOKENS.has(t) &&
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
  const response = await getOpenSearchClient().get(
    { index: ADDRESS_ALIAS, id },
    // Suppress the client's throw on 404 so we can distinguish doc-missing
    // (benign) from index-missing (infrastructure failure).
    { ignore: [404] },
  );

  // Benign: document not found (index exists, id doesn't).
  if (response.statusCode === 404 && response.body?.found === false) {
    return null;
  }

  // Any other non-2xx (including 404 without `found: false` — e.g. index
  // missing) is an infrastructure failure. Surface as 500 via the global
  // handler rather than masquerading as "doc not found".
  if (
    response.statusCode != null &&
    (response.statusCode < 200 || response.statusCode >= 300)
  ) {
    throw new Error(
      `OpenSearch enrich returned ${response.statusCode}: ${JSON.stringify(response.body)}`,
    );
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

  // Phase 1a: Cheap existence probe. Only answers "does this exact name
  // have any addresses?" — no counting, no scoring. `terminate_after: 1`
  // stops each shard after the first match, so populous suburbs don't pay
  // a counting cost on the hot path. Exact-first lets rare real suburbs
  // (e.g. tiny "BONDO") beat populous fuzzy neighbours (BONDI).
  const exactMust: AnyRecord[] = [{ term: { localityName: inputUpper } }];
  if (stateUpper) {
    exactMust.push({ term: { state: stateUpper } });
  }

  const exactResponse = await client.search({
    index: ADDRESS_ALIAS,
    body: {
      size: 1,
      _source: false,
      terminate_after: 1,
      query: { bool: { must: exactMust } },
    },
  });
  const exactMatched =
    (exactResponse.body.hits.hits as AnyRecord[]).length > 0;

  let matchedSuburb: string;

  if (exactMatched) {
    matchedSuburb = inputUpper;
  } else {
    // Phase 1b: Fuzzy fallback. Candidate selection is driven by
    // FUZZY RELEVANCE at the LOCALITY level (not the document level),
    // then edit distance in app code (primary ranking), then a bounded
    // follow-up agg for REAL address count (secondary tiebreak).
    //
    // Why locality-level selection: an earlier version fetched the top-N
    // raw address hits and deduped in app. That was vulnerable to
    // "document-multiplicity flooding" — a populous suburb with 40k
    // matching docs would consume the entire hit window with its own
    // duplicates, pushing rarer-but-equally-close (or CLOSER) candidates
    // out of the sample before app-side distance ranking saw them.
    //
    // `collapse: {field: "localityName"}` dedupes at query time: each
    // distinct locality contributes exactly ONE representative hit,
    // regardless of how many addresses it has. `match` with `fuzziness`
    // gives proper per-term scoring (unlike the `fuzzy` query whose
    // default rewrite strips relevance), so closer matches rank higher
    // per-bucket and survive any truncation at `size`.
    //
    // Three-step flow:
    //   Step A — collapsed candidate discovery (size = 100 distinct
    //            localities, ordered by best-representative _score)
    //   Step B — edit-distance-band selection in app code
    //   Step C — real-count tiebreak (only if >1 at min distance)
    const fuzzyMust: AnyRecord[] = [
      {
        match: {
          localityName: {
            query: inputUpper,
            fuzziness: "AUTO",
            prefix_length: 1,
          },
        },
      },
    ];
    if (stateUpper) {
      fuzzyMust.push({ term: { state: stateUpper } });
    }

    // 100 DISTINCT localities is well above realistic AU fuzzy cardinality
    // (a single-token fuzzy query with AUTO + prefix_length=1 rarely
    // matches more than a few dozen distinct locality names). If the
    // cardinality ever exceeds this, `match` scoring ensures closer
    // candidates are the ones that survive.
    const CANDIDATE_LIMIT = 100;
    const fuzzyResponse = await client.search({
      index: ADDRESS_ALIAS,
      body: {
        size: CANDIDATE_LIMIT,
        query: { bool: { must: fuzzyMust } },
        _source: ["localityName"],
        collapse: { field: "localityName" },
        // default sort: _score desc (relevance-first per collapsed group).
      },
    });

    const hits = fuzzyResponse.body.hits.hits as AnyRecord[];
    if (hits.length === 0) {
      return {
        suburb: inputUpper,
        state: stateUpper,
        postcodes: [],
        bounds: undefined,
        address_count: 0,
      };
    }

    // Step B: dedupe (collapse already guarantees this at query time;
    // Set guards against any future query-shape change) and pick the
    // closest-distance band.
    const seenNames = new Set<string>();
    for (const hit of hits) {
      const name = ((hit._source as AnyRecord | undefined)?.localityName ??
        "") as string;
      if (name) seenNames.add(name);
    }
    if (seenNames.size === 0) {
      return {
        suburb: inputUpper,
        state: stateUpper,
        postcodes: [],
        bounds: undefined,
        address_count: 0,
      };
    }

    const scored = Array.from(seenNames).map((name) => ({
      name,
      distance: editDistance(
        inputUpper,
        name,
        Math.max(inputUpper.length, name.length),
      ),
    }));
    scored.sort((a, b) => a.distance - b.distance);
    const minDistance = scored[0]!.distance;
    const closestBand = scored.filter((c) => c.distance === minDistance);

    if (closestBand.length === 1) {
      matchedSuburb = closestBand[0]!.name;
    } else {
      // Step C: real-count tiebreak among equal-distance candidates.
      // Scoped to just the shortlisted names → bounded, deterministic,
      // independent of sample-size truncation effects.
      const tiebreakMust: AnyRecord[] = [
        { terms: { localityName: closestBand.map((c) => c.name) } },
      ];
      if (stateUpper) {
        tiebreakMust.push({ term: { state: stateUpper } });
      }
      const tiebreakResponse = await client.search({
        index: ADDRESS_ALIAS,
        body: {
          size: 0,
          query: { bool: { must: tiebreakMust } },
          aggs: {
            tiebreak: {
              terms: {
                field: "localityName",
                size: closestBand.length,
                order: { _count: "desc" },
              },
            },
          },
        },
      });
      const tbBuckets = ((tiebreakResponse.body.aggregations as
        | AnyRecord
        | undefined)?.tiebreak?.buckets ?? []) as Array<{
        key: string;
        doc_count: number;
      }>;
      // Fall back to the first closest-band name if the agg returns
      // nothing (shouldn't happen — all names came from an earlier hit
      // sample — but keeps the code total).
      matchedSuburb = (tbBuckets[0]?.key as string) ?? closestBand[0]!.name;
    }
  }

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
