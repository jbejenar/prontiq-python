import { z } from "zod";

export const manifestFileSchema = z.object({
  key: z.string().min(1),
  records: z.number().int().positive(),
  bytes: z.number().int().positive(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/i, "Must be a valid SHA-256 hex string"),
});

export const manifestV1Schema = z.object({
  manifest_version: z.literal(1),
  product: z.string().min(1),
  version: z.string().min(1),
  created_at: z.string().datetime(),
  pipeline: z.object({
    repo: z.string(),
    commit: z.string(),
    run_id: z.string(),
  }),
  source: z.object({
    name: z.string(),
    release: z.string(),
    url: z.string().url(),
  }),
  files: z.array(manifestFileSchema).min(1),
  total_records: z.number().int().positive(),
  index: z.object({
    mappings_key: z.string().min(1),
    settings: z.object({
      number_of_shards: z.number().int().positive().default(1),
      number_of_replicas: z.number().int().min(0).default(0),
    }),
  }),
});

export const apiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    status: z.number().int(),
    request_id: z.string(),
    details: z.record(z.string(), z.unknown()).optional(),
  }),
});

export const autocompleteQuerySchema = z.object({
  q: z.string().min(1).max(200),
  state: z.string().length(2).toUpperCase().optional(),
  limit: z.coerce.number().int().min(1).max(20).default(5),
});

export const validateQuerySchema = z.object({
  q: z.string().min(1).max(500),
});

export const enrichQuerySchema = z.object({
  id: z.string().min(1),
});

export const reverseQuerySchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lon: z.coerce.number().min(-180).max(180),
  radius: z.coerce.number().min(1).max(50000).default(100),
  limit: z.coerce.number().int().min(1).max(20).default(5),
});

export const postcodeLookupSchema = z.object({
  postcode: z.string().regex(/^\d{4}$/),
});

export const suburbLookupSchema = z.object({
  suburb: z.string().min(1).max(100),
  state: z.string().length(2).toUpperCase().optional(),
});
