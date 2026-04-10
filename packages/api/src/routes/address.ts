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

const addressDocumentSchema = z
  .object({
    id: z.string(),
    addressLabel: z.string().optional(),
    localityName: z.string().optional(),
    state: z.string().optional(),
    postcode: z.string().optional(),
  })
  .catchall(z.unknown());

const addressSuggestionSchema = addressDocumentSchema.extend({
  score: z.number().optional(),
});

const autocompleteResponseSchema = z.object({
  suggestions: z.array(addressSuggestionSchema),
  total: z.number().int().nonnegative(),
});

const validateResponseSchema = z.object({
  match: addressDocumentSchema.nullable(),
  confidence: z.union([z.literal("high"), z.literal("medium"), z.literal("low"), z.literal(0)]),
});

const reverseResultSchema = addressDocumentSchema.extend({
  distance_m: z.number().optional(),
});

const reverseResponseSchema = z.object({
  results: z.array(reverseResultSchema),
  total: z.number().int().nonnegative(),
});

const postcodeLookupResponseSchema = z.object({
  postcode: z.string(),
  localities: z.array(
    z.object({
      name: z.string(),
      state: z.string().optional(),
      address_count: z.number().int().nonnegative(),
    }),
  ),
});

const suburbLookupResponseSchema = z.object({
  suburb: z.string(),
  state: z.string().optional(),
  postcodes: z.array(z.string()),
  bounds: z.record(z.string(), z.unknown()).optional(),
  address_count: z.number().int().nonnegative(),
});

const jsonResponse = (schema: z.ZodType, description: string) => ({
  content: {
    "application/json": {
      schema,
    },
  },
  description,
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
    200: jsonResponse(autocompleteResponseSchema, "Address suggestions"),
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
    200: jsonResponse(validateResponseSchema, "Best address match"),
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
    200: jsonResponse(addressDocumentSchema, "Enriched address document"),
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
    200: jsonResponse(reverseResponseSchema, "Nearby addresses"),
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
    200: jsonResponse(postcodeLookupResponseSchema, "Postcode locality summary"),
    ...errorResponses,
  },
});

addressRoutes.openapi(postcodeLookupRoute, async (c) => {
  const { postcode } = c.req.valid("query");
  const result = await queries.lookupPostcode(postcode);
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
    200: jsonResponse(suburbLookupResponseSchema, "Suburb postcode summary"),
    ...errorResponses,
  },
});

addressRoutes.openapi(suburbLookupRoute, async (c) => {
  const { suburb, state } = c.req.valid("query");
  const result = await queries.lookupSuburb(suburb, state);
  return c.json(result, 200);
});
