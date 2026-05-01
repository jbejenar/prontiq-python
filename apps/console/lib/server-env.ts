import { z } from "zod";

const serverEnvSchema = z.object({
  CLERK_ADMIN_ROLES: z.string().min(1).optional(),
  CLERK_SECRET_KEY: z.string().min(1).optional(),
  LAGO_API_KEY: z.string().min(1).optional(),
  LAGO_API_URL: z.string().min(1).optional(),
  PRONTIQ_ALLOW_KEYLESS_CLERK: z.enum(["1"]).optional(),
  PRONTIQ_BILLING_CATALOG_ENV: z.enum(["dev", "prod", "all"]).optional(),
});

export const serverEnv = serverEnvSchema.parse({
  CLERK_ADMIN_ROLES: process.env.CLERK_ADMIN_ROLES,
  CLERK_SECRET_KEY: process.env.CLERK_SECRET_KEY,
  LAGO_API_KEY: process.env.LAGO_API_KEY,
  LAGO_API_URL: process.env.LAGO_API_URL,
  PRONTIQ_ALLOW_KEYLESS_CLERK: process.env.PRONTIQ_ALLOW_KEYLESS_CLERK,
  PRONTIQ_BILLING_CATALOG_ENV: process.env.PRONTIQ_BILLING_CATALOG_ENV,
});

export function getBillingServerEnv() {
  if (!serverEnv.LAGO_API_KEY || !serverEnv.LAGO_API_URL) {
    throw new Error("Console billing requires LAGO_API_URL and LAGO_API_KEY.");
  }

  const inferredCatalogEnv = process.env.VERCEL_ENV === "production" ? "prod" : "dev";
  return {
    lagoApiKey: serverEnv.LAGO_API_KEY,
    lagoApiUrl: serverEnv.LAGO_API_URL,
    billingCatalogEnv: serverEnv.PRONTIQ_BILLING_CATALOG_ENV ?? inferredCatalogEnv,
  };
}
