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

export async function autocomplete(q: string, state?: string, limit = 5) {
  const must: AnyRecord[] = [
    {
      multi_match: {
        query: q,
        type: "bool_prefix",
        operator: "and",
        fuzziness: "AUTO",
        fields: ["addressLabelSearch", "addressLabelSearch._2gram", "addressLabelSearch._3gram"],
      },
    },
  ];

  if (state) {
    must.push({ term: { state: state.toUpperCase() } });
  }

  const response = await getOpenSearchClient().search({
    index: ADDRESS_ALIAS,
    body: {
      size: limit,
      query: { bool: { must } },
      _source: ["addressLabel", "localityName", "state", "postcode", "confidence"],
    },
  });

  const hits = response.body.hits.hits as AnyRecord[];

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
  return {
    match: { id: hit._id as string, ...(hit._source as AnyRecord) },
    confidence: score > 20 ? "high" : score > 10 ? "medium" : "low",
  };
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
