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

export const manifestV2Schema = z.object({
  manifest_version: z.literal(2),
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
    source_keys: z.array(z.string().min(1)).min(1),
  }),
});

export const manifestSchema = z.discriminatedUnion("manifest_version", [
  manifestV1Schema,
  manifestV2Schema,
]);

export const apiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    status: z.number().int(),
    request_id: z.string(),
    details: z.record(z.string(), z.unknown()).optional(),
  }),
});

const australianStateSchema = z
  .string()
  .toUpperCase()
  .pipe(z.enum(["NSW", "VIC", "QLD", "SA", "WA", "TAS", "NT", "ACT"]))
  .describe("Australian state code.");

export const autocompleteQuerySchema = z.object({
  q: z.string().min(1).max(200).describe("Partial address query."),
  state: australianStateSchema.optional(),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(20)
    .default(5)
    .describe("Maximum number of suggestions to return."),
});

export const validateQuerySchema = z.object({
  q: z.string().min(1).max(500).describe("Full address string to validate."),
});

export const enrichQuerySchema = z.object({
  id: z.string().min(1).describe("G-NAF address document ID."),
});

const requiredCoercedNumber = (description: string, min: number, max: number) =>
  z
    .preprocess(
      (value) => (value === "" || value === null ? undefined : value),
      z.coerce.number().min(min).max(max),
    )
    .describe(description);

export const reverseQuerySchema = z.object({
  lat: requiredCoercedNumber("Latitude in decimal degrees.", -90, 90),
  lon: requiredCoercedNumber("Longitude in decimal degrees.", -180, 180),
  radius: z.coerce.number().min(1).max(50000).default(100).describe("Search radius in metres."),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(20)
    .default(5)
    .describe("Maximum number of nearby addresses to return."),
});

export const postcodeLookupSchema = z.object({
  postcode: z
    .string()
    .regex(/^\d{4}$/)
    .describe("Australian 4-digit postcode."),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(50)
    .default(10)
    .describe("Maximum number of localities to return."),
});

export const suburbLookupSchema = z.object({
  suburb: z.string().min(1).max(100).describe("Suburb/locality name."),
  state: australianStateSchema.optional(),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(20)
    .default(10)
    .describe("Maximum number of postcodes to return."),
});
