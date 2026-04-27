import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import {
  autocompleteQuerySchema,
  validateQuerySchema,
  enrichQuerySchema,
  reverseQuerySchema,
  postcodeLookupSchema,
  suburbLookupSchema,
} from "@prontiq/shared";
import * as queries from "../search/queries.js";

const apiErrorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    status: z.number().int(),
    request_id: z.string(),
    details: z.record(z.string(), z.unknown()).optional(),
  }),
});

const geocodeSchema = z.object({
  latitude: z.number().openapi({ description: "Latitude in decimal degrees." }),
  longitude: z.number().openapi({ description: "Longitude in decimal degrees." }),
  type: z.string().optional().openapi({ description: "Geocoding method, e.g. PROPERTY CENTROID." }),
  reliability: z.number().int().optional().openapi({ description: "G-NAF geocode reliability (0-6, lower is better)." }),
});

const locationSchema = z.object({
  lat: z.number().openapi({ description: "Latitude." }),
  lon: z.number().openapi({ description: "Longitude." }),
}).openapi({ description: "OpenSearch geo_point format." });

const namedCodeSchema = z.object({
  name: z.string().openapi({ description: "Area name." }),
  code: z.string().optional().openapi({ description: "ABS area code." }),
});

const meshBlockSchema = z.object({
  code: z.string().openapi({ description: "ABS mesh block code." }),
  category: z.string().optional().openapi({ description: "Land use category, e.g. Residential, Commercial." }),
});

const boundariesSchema = z.object({
  lga: namedCodeSchema.optional().openapi({ description: "Local Government Area." }),
  stateElectorate: namedCodeSchema.optional().openapi({ description: "State electoral district." }),
  commonwealthElectorate: namedCodeSchema.optional().openapi({ description: "Federal electoral district." }),
  meshBlock: meshBlockSchema.optional().openapi({ description: "ABS smallest geographic unit." }),
  sa2: namedCodeSchema.optional().openapi({ description: "Statistical Area Level 2." }),
  sa3: namedCodeSchema.optional().openapi({ description: "Statistical Area Level 3." }),
  sa4: namedCodeSchema.optional().openapi({ description: "Statistical Area Level 4." }),
  gccsa: namedCodeSchema.optional().openapi({ description: "Greater Capital City Statistical Area." }),
}).openapi({ description: "Electoral, administrative, and statistical boundaries." });

const addressDocumentSchema = z.object({
  id: z.string().openapi({ description: "G-NAF persistent identifier." }),
  addressLabel: z.string().optional().openapi({ description: "Street address (number + street name)." }),
  localityName: z.string().optional().openapi({ description: "Suburb or locality name." }),
  state: z.string().optional().openapi({ description: "Australian state code (NSW, VIC, QLD, SA, WA, TAS, NT, ACT)." }),
  postcode: z.string().optional().openapi({ description: "4-digit Australian postcode." }),
  confidence: z.number().int().optional().openapi({ description: "G-NAF confidence level (0-2)." }),
  geocode: geocodeSchema.optional().openapi({ description: "Physical location and geocoding metadata." }),
  location: locationSchema.optional(),
  boundaries: boundariesSchema.optional(),
});

const addressSuggestionSchema = z.object({
  id: z.string().openapi({ description: "G-NAF persistent identifier." }),
  addressLabel: z.string().optional().openapi({ description: "Street address (number + street name)." }),
  localityName: z.string().optional().openapi({ description: "Suburb or locality name." }),
  state: z.string().optional().openapi({ description: "Australian state code." }),
  postcode: z.string().optional().openapi({ description: "4-digit Australian postcode." }),
  confidence: z.number().int().optional().openapi({ description: "G-NAF confidence level (0-2)." }),
  score: z.number().optional().openapi({ description: "Search relevance score." }),
});

const autocompleteResponseSchema = z.object({
  suggestions: z.array(addressSuggestionSchema),
  total: z.number().int().nonnegative().openapi({ description: "Total matching addresses." }),
});

const validateResponseSchema = z.object({
  match: addressDocumentSchema.nullable().openapi({ description: "Best matching address, or null if no match." }),
  confidence: z.enum(["high", "medium", "low", "none"]).openapi({
    description: "Match confidence: high (score > 20), medium (10-20), low (< 10), or none (no match).",
  }),
});

const reverseResultSchema = addressDocumentSchema.extend({
  distance_m: z.number().optional().openapi({ description: "Distance from query point in meters." }),
});

const reverseResponseSchema = z.object({
  results: z.array(reverseResultSchema),
  total: z.number().int().nonnegative().openapi({ description: "Total addresses within radius." }),
});

const postcodeLookupResponseSchema = z.object({
  postcode: z.string().openapi({ description: "The queried postcode." }),
  localities: z.array(
    z.object({
      name: z.string().openapi({ description: "Locality/suburb name." }),
      state: z.string().optional().openapi({ description: "State code." }),
      address_count: z.number().int().nonnegative().openapi({ description: "Number of addresses in this locality." }),
    }),
  ),
});

const geoBoundsSchema = z.object({
  top_left: locationSchema.openapi({ description: "North-west corner of bounding box." }),
  bottom_right: locationSchema.openapi({ description: "South-east corner of bounding box." }),
}).openapi({ description: "Geographic bounding box of the suburb." });

const suburbLookupResponseSchema = z.object({
  suburb: z.string().openapi({ description: "Normalised suburb name (uppercase)." }),
  state: z.string().optional().openapi({ description: "State filter applied, if any." }),
  postcodes: z.array(z.string()).openapi({ description: "Postcodes covering this suburb." }),
  bounds: geoBoundsSchema.optional(),
  address_count: z.number().int().nonnegative().openapi({ description: "Total addresses in this suburb." }),
});

const jsonResponse = (schema: z.ZodType, description: string) => ({
  content: {
    "application/json": {
      schema,
    },
  },
  description,
});

const usageResponseHeaders = {
  "X-Request-Id": {
    description: "Unique request identifier for support and debugging.",
    schema: { type: "string" as const },
  },
  "X-RateLimit-Product": {
    description: "API family whose monthly credit counter was updated, for example `address`.",
    schema: { type: "string" as const },
  },
  "X-RateLimit-Reset": {
    description: "ISO timestamp when the current credit window resets.",
    schema: { type: "string" as const, format: "date-time" },
  },
  "X-RateLimit-Limit": {
    description:
      "Configured included-credit threshold for keys with a monthly quota. Present for hard-cap and soft-overage plans; omitted for PAYG or uncapped plans.",
    schema: { type: "integer" as const, minimum: 0 },
  },
  "X-RateLimit-Remaining": {
    description:
      "Included credits remaining in the current window, floored at zero. Present for hard-cap and soft-overage plans; omitted for PAYG or uncapped plans.",
    schema: { type: "integer" as const, minimum: 0 },
  },
  "X-RateLimit-Over": {
    description: "`true` when the request succeeded as soft-overage after included credits were exceeded.",
    schema: { type: "string" as const, enum: ["true"] },
  },
  "X-Payment-Overdue": {
    description: "`true` when the account is past due but still inside the billing grace window.",
    schema: { type: "string" as const, enum: ["true"] },
  },
};

const jsonResponseWithUsageHeaders = (schema: z.ZodType, description: string) => ({
  ...jsonResponse(schema, description),
  headers: usageResponseHeaders,
});

const errorResponses = {
  400: jsonResponse(apiErrorResponseSchema, "Invalid query parameters"),
  401: jsonResponse(apiErrorResponseSchema, "Missing or invalid API key"),
  403: jsonResponse(apiErrorResponseSchema, "Product not included in plan"),
  429: jsonResponse(apiErrorResponseSchema, "Rate limit or quota exceeded"),
  500: jsonResponse(apiErrorResponseSchema, "Internal server error"),
};

const apiKeySecurity = [{ ApiKeyAuth: [] }];

export const addressRoutes = new OpenAPIHono({
  defaultHook: (result, c) => {
    if (result.success) return;

    return c.json(
      {
        error: {
          code: "INVALID_PARAMETERS",
          message: "Invalid query parameters",
          status: 400,
          request_id: c.get("requestId"),
          details: result.error.flatten().fieldErrors,
        },
      },
      400,
    );
  },
});

addressRoutes.openAPIRegistry.registerComponent("securitySchemes", "ApiKeyAuth", {
  type: "apiKey",
  in: "header",
  name: "X-Api-Key",
});

const autocompleteRoute = createRoute({
  method: "get",
  path: "/autocomplete",
  summary: "Autocomplete addresses",
  security: apiKeySecurity,
  request: {
    query: autocompleteQuerySchema,
  },
  responses: {
    200: jsonResponseWithUsageHeaders(autocompleteResponseSchema, "Address suggestions"),
    ...errorResponses,
  },
});

addressRoutes.openapi(autocompleteRoute, async (c) => {
  const { q, state, limit } = c.req.valid("query");
  const result = await queries.autocomplete(q, state, limit);
  return c.json(result, 200);
});

const validateRoute = createRoute({
  method: "get",
  path: "/validate",
  summary: "Validate an address",
  security: apiKeySecurity,
  request: {
    query: validateQuerySchema,
  },
  responses: {
    200: jsonResponseWithUsageHeaders(validateResponseSchema, "Best address match"),
    ...errorResponses,
  },
});

addressRoutes.openapi(validateRoute, async (c) => {
  const { q } = c.req.valid("query");
  const result = await queries.validate(q);
  return c.json(result, 200);
});

const enrichRoute = createRoute({
  method: "get",
  path: "/enrich",
  summary: "Enrich an address by ID",
  security: apiKeySecurity,
  request: {
    query: enrichQuerySchema,
  },
  responses: {
    200: jsonResponseWithUsageHeaders(addressDocumentSchema, "Enriched address document"),
    404: jsonResponse(apiErrorResponseSchema, "Address not found"),
    ...errorResponses,
  },
});

addressRoutes.openapi(enrichRoute, async (c) => {
  const { id } = c.req.valid("query");
  const result = await queries.enrich(id);

  if (!result) {
    return c.json(
      {
        error: {
          code: "NOT_FOUND",
          message: `Address not found: ${id}`,
          status: 404,
          request_id: c.get("requestId"),
        },
      },
      404,
    );
  }

  return c.json(result, 200);
});

const reverseRoute = createRoute({
  method: "get",
  path: "/reverse",
  summary: "Reverse geocode nearby addresses",
  security: apiKeySecurity,
  request: {
    query: reverseQuerySchema,
  },
  responses: {
    200: jsonResponseWithUsageHeaders(reverseResponseSchema, "Nearby addresses"),
    ...errorResponses,
  },
});

addressRoutes.openapi(reverseRoute, async (c) => {
  const { lat, lon, radius, limit } = c.req.valid("query");
  const result = await queries.reverse(lat, lon, radius, limit);
  return c.json(result, 200);
});

const postcodeLookupRoute = createRoute({
  method: "get",
  path: "/lookup/postcode",
  summary: "Look up localities by postcode",
  security: apiKeySecurity,
  request: {
    query: postcodeLookupSchema,
  },
  responses: {
    200: jsonResponseWithUsageHeaders(postcodeLookupResponseSchema, "Postcode locality summary"),
    ...errorResponses,
  },
});

addressRoutes.openapi(postcodeLookupRoute, async (c) => {
  const { postcode, limit } = c.req.valid("query");
  const result = await queries.lookupPostcode(postcode, limit);
  return c.json(result, 200);
});

const suburbLookupRoute = createRoute({
  method: "get",
  path: "/lookup/suburb",
  summary: "Look up postcodes by suburb",
  security: apiKeySecurity,
  request: {
    query: suburbLookupSchema,
  },
  responses: {
    200: jsonResponseWithUsageHeaders(suburbLookupResponseSchema, "Suburb postcode summary"),
    ...errorResponses,
  },
});

addressRoutes.openapi(suburbLookupRoute, async (c) => {
  const { suburb, state, limit } = c.req.valid("query");
  const result = await queries.lookupSuburb(suburb, state, limit);
  return c.json(result, 200);
});
