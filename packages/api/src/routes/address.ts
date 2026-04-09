import { Hono } from "hono";
import type { Context } from "hono";
import {
  autocompleteQuerySchema,
  validateQuerySchema,
  enrichQuerySchema,
  reverseQuerySchema,
  postcodeLookupSchema,
  suburbLookupSchema,
} from "@prontiq/shared";
import * as queries from "../search/queries.js";

export const addressRoutes = new Hono();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function validationError(c: Context<any, any, any>, details: unknown) {
  return c.json(
    {
      error: {
        code: "INVALID_PARAMETERS",
        message: "Invalid query parameters",
        status: 400,
        request_id: c.get("requestId"),
        details,
      },
    },
    400,
  );
}

addressRoutes.get("/autocomplete", async (c) => {
  const parsed = autocompleteQuerySchema.safeParse(c.req.query());
  if (!parsed.success) return validationError(c, parsed.error.flatten().fieldErrors);

  const { q, state, limit } = parsed.data;
  const result = await queries.autocomplete(q, state, limit);
  return c.json(result);
});

addressRoutes.get("/validate", async (c) => {
  const parsed = validateQuerySchema.safeParse(c.req.query());
  if (!parsed.success) return validationError(c, parsed.error.flatten().fieldErrors);

  const result = await queries.validate(parsed.data.q);
  return c.json(result);
});

addressRoutes.get("/enrich", async (c) => {
  const parsed = enrichQuerySchema.safeParse(c.req.query());
  if (!parsed.success) return validationError(c, parsed.error.flatten().fieldErrors);

  const result = await queries.enrich(parsed.data.id);
  if (!result) {
    return c.json(
      {
        error: {
          code: "NOT_FOUND",
          message: `Address not found: ${parsed.data.id}`,
          status: 404,
          request_id: c.get("requestId"),
        },
      },
      404,
    );
  }

  return c.json(result);
});

addressRoutes.get("/reverse", async (c) => {
  const parsed = reverseQuerySchema.safeParse(c.req.query());
  if (!parsed.success) return validationError(c, parsed.error.flatten().fieldErrors);

  const { lat, lon, radius, limit } = parsed.data;
  const result = await queries.reverse(lat, lon, radius, limit);
  return c.json(result);
});

addressRoutes.get("/lookup/postcode", async (c) => {
  const parsed = postcodeLookupSchema.safeParse(c.req.query());
  if (!parsed.success) return validationError(c, parsed.error.flatten().fieldErrors);

  const result = await queries.lookupPostcode(parsed.data.postcode);
  return c.json(result);
});

addressRoutes.get("/lookup/suburb", async (c) => {
  const parsed = suburbLookupSchema.safeParse(c.req.query());
  if (!parsed.success) return validationError(c, parsed.error.flatten().fieldErrors);

  const { suburb, state } = parsed.data;
  const result = await queries.lookupSuburb(suburb, state);
  return c.json(result);
});
