/**
 * Fixture addresses for integration tests. Minimal set chosen to exercise
 * all the search semantics edge cases we care about:
 *
 * - Multiple HEATH ___ variants (ROAD, STREET, CRESCENT) for ranking tests
 * - HEATH CRESCENT in two states (NSW, VIC) for multi-state suburb tests
 * - BONDI BEACH for suburb fuzzy match tests
 * - RICHMOND in three states for multi-state aggregation tests
 * - SYDNEY / HAYMARKET for postcode-lookup tests
 */
export const fixtureAddresses = [
  {
    id: "F_GANSW704893526",
    addressLabel: "16 HEATH CRESCENT",
    addressLabelSearch: "16 HEATH CRESCENT GRIFFITH NSW 2680",
    localityName: "GRIFFITH",
    state: "NSW",
    postcode: "2680",
    confidence: 2,
    location: { lat: -34.293, lon: 146.039 },
  },
  {
    id: "F_GAVIC420559144",
    addressLabel: "16 HEATH CRESCENT",
    addressLabelSearch: "16 HEATH CRESCENT HAMPTON EAST VIC 3188",
    localityName: "HAMPTON EAST",
    state: "VIC",
    postcode: "3188",
    confidence: 2,
    location: { lat: -37.9376, lon: 145.0295 },
  },
  {
    id: "F_GANSW720158070",
    addressLabel: "16 HEATH ROAD",
    addressLabelSearch: "16 HEATH ROAD LEPPINGTON NSW 2179",
    localityName: "LEPPINGTON",
    state: "NSW",
    postcode: "2179",
    confidence: 2,
    location: { lat: -33.979, lon: 150.811 },
  },
  {
    id: "F_GASA_415543154",
    addressLabel: "16 HEATH STREET",
    addressLabelSearch: "16 HEATH STREET BIRKENHEAD SA 5015",
    localityName: "BIRKENHEAD",
    state: "SA",
    postcode: "5015",
    confidence: 2,
    location: { lat: -34.838, lon: 138.498 },
  },
  {
    id: "F_GANSW706085480",
    addressLabel: "16 HEATH AVENUE",
    addressLabelSearch: "16 HEATH AVENUE TUNCURRY NSW 2428",
    localityName: "TUNCURRY",
    state: "NSW",
    postcode: "2428",
    confidence: 2,
    location: { lat: -32.175, lon: 152.507 },
  },
  {
    id: "F_BONDI_BEACH_1",
    addressLabel: "1 BONDI ROAD",
    addressLabelSearch: "1 BONDI ROAD BONDI BEACH NSW 2026",
    localityName: "BONDI BEACH",
    state: "NSW",
    postcode: "2026",
    confidence: 2,
    location: { lat: -33.892, lon: 151.277 },
  },
  {
    id: "F_BONDI_BEACH_2",
    addressLabel: "2 CAMPBELL PARADE",
    addressLabelSearch: "2 CAMPBELL PARADE BONDI BEACH NSW 2026",
    localityName: "BONDI BEACH",
    state: "NSW",
    postcode: "2026",
    confidence: 2,
    location: { lat: -33.891, lon: 151.278 },
  },
  {
    id: "F_RICHMOND_VIC",
    addressLabel: "1 BRIDGE ROAD",
    addressLabelSearch: "1 BRIDGE ROAD RICHMOND VIC 3121",
    localityName: "RICHMOND",
    state: "VIC",
    postcode: "3121",
    confidence: 2,
    location: { lat: -37.818, lon: 144.998 },
  },
  {
    id: "F_RICHMOND_NSW",
    addressLabel: "1 WINDSOR STREET",
    addressLabelSearch: "1 WINDSOR STREET RICHMOND NSW 2753",
    localityName: "RICHMOND",
    state: "NSW",
    postcode: "2753",
    confidence: 2,
    location: { lat: -33.598, lon: 150.749 },
  },
  {
    id: "F_RICHMOND_TAS",
    addressLabel: "1 BRIDGE STREET",
    addressLabelSearch: "1 BRIDGE STREET RICHMOND TAS 7025",
    localityName: "RICHMOND",
    state: "TAS",
    postcode: "7025",
    confidence: 2,
    location: { lat: -42.735, lon: 147.438 },
  },
  {
    id: "F_SYDNEY_1",
    addressLabel: "1 MARTIN PLACE",
    addressLabelSearch: "1 MARTIN PLACE SYDNEY NSW 2000",
    localityName: "SYDNEY",
    state: "NSW",
    postcode: "2000",
    confidence: 2,
    location: { lat: -33.867, lon: 151.209 },
  },
  {
    id: "F_HAYMARKET_1",
    addressLabel: "1 GEORGE STREET",
    addressLabelSearch: "1 GEORGE STREET HAYMARKET NSW 2000",
    localityName: "HAYMARKET",
    state: "NSW",
    postcode: "2000",
    confidence: 2,
    location: { lat: -33.878, lon: 151.205 },
  },
];

/**
 * Minimal OpenSearch mappings matching prod for the fields our queries use.
 * The real prod mapping includes many more fields (G-NAF enrichment data),
 * but these are the ones required for queries in queries.ts.
 */
export const fixtureMappings = {
  properties: {
    addressLabelSearch: { type: "search_as_you_type" },
    addressLabel: { type: "keyword" },
    localityName: { type: "keyword" },
    state: { type: "keyword" },
    postcode: { type: "keyword" },
    confidence: { type: "integer" },
    location: { type: "geo_point" },
  },
} as const;
