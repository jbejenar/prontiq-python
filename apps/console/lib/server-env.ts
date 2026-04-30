import { z } from "zod";

const serverEnvSchema = z.object({
  BILLING_ACTIONS_AWS_ACCESS_KEY_ID: z.string().min(1).optional(),
  BILLING_ACTIONS_AWS_REGION: z.string().min(1).optional(),
  BILLING_ACTIONS_AWS_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  BILLING_ACTIONS_TABLE_NAME: z.string().min(1).optional(),
  CLERK_ADMIN_ROLES: z.string().min(1).optional(),
  CLERK_SECRET_KEY: z.string().min(1).optional(),
  LAGO_API_KEY: z.string().min(1).optional(),
  LAGO_API_URL: z.string().min(1).optional(),
  PRONTIQ_BILLING_PLAN_CHANGE_ALLOWED_ORG_IDS: z.string().optional(),
  PRONTIQ_BILLING_PLAN_CHANGES_ENABLED: z.enum(["true", "false"]).optional(),
  PRONTIQ_ALLOW_KEYLESS_CLERK: z.enum(["1"]).optional(),
  PRONTIQ_BILLING_CATALOG_ENV: z.enum(["dev", "prod", "all"]).optional(),
});

export const serverEnv = serverEnvSchema.parse({
  BILLING_ACTIONS_AWS_ACCESS_KEY_ID: process.env.BILLING_ACTIONS_AWS_ACCESS_KEY_ID,
  BILLING_ACTIONS_AWS_REGION: process.env.BILLING_ACTIONS_AWS_REGION,
  BILLING_ACTIONS_AWS_SECRET_ACCESS_KEY: process.env.BILLING_ACTIONS_AWS_SECRET_ACCESS_KEY,
  BILLING_ACTIONS_TABLE_NAME: process.env.BILLING_ACTIONS_TABLE_NAME,
  CLERK_ADMIN_ROLES: process.env.CLERK_ADMIN_ROLES,
  CLERK_SECRET_KEY: process.env.CLERK_SECRET_KEY,
  LAGO_API_KEY: process.env.LAGO_API_KEY,
  LAGO_API_URL: process.env.LAGO_API_URL,
  PRONTIQ_BILLING_PLAN_CHANGE_ALLOWED_ORG_IDS:
    process.env.PRONTIQ_BILLING_PLAN_CHANGE_ALLOWED_ORG_IDS,
  PRONTIQ_BILLING_PLAN_CHANGES_ENABLED: process.env.PRONTIQ_BILLING_PLAN_CHANGES_ENABLED,
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

export function getBillingActionsServerEnv() {
  const enabled = serverEnv.PRONTIQ_BILLING_PLAN_CHANGES_ENABLED === "true";
  if (!enabled) {
    return {
      accessKeyId: "",
      allowedOrgIds: parseAllowedOrgIds(serverEnv.PRONTIQ_BILLING_PLAN_CHANGE_ALLOWED_ORG_IDS),
      enabled,
      region: serverEnv.BILLING_ACTIONS_AWS_REGION ?? "ap-southeast-2",
      secretAccessKey: "",
      tableName: serverEnv.BILLING_ACTIONS_TABLE_NAME ?? "",
    };
  }

  const required = {
    accessKeyId: serverEnv.BILLING_ACTIONS_AWS_ACCESS_KEY_ID,
    region: serverEnv.BILLING_ACTIONS_AWS_REGION,
    secretAccessKey: serverEnv.BILLING_ACTIONS_AWS_SECRET_ACCESS_KEY,
    tableName: serverEnv.BILLING_ACTIONS_TABLE_NAME,
  };
  const missing = Object.entries(required)
    .filter(([, value]) => !value)
    .map(([key]) => key);
  if (missing.length > 0) {
    throw new Error(`Console billing actions require ${missing.join(", ")}.`);
  }
  const { accessKeyId, region, secretAccessKey, tableName } = required as {
    accessKeyId: string;
    region: string;
    secretAccessKey: string;
    tableName: string;
  };

  return {
    accessKeyId,
    allowedOrgIds: parseAllowedOrgIds(serverEnv.PRONTIQ_BILLING_PLAN_CHANGE_ALLOWED_ORG_IDS),
    enabled,
    region,
    secretAccessKey,
    tableName,
  };
}

function parseAllowedOrgIds(value: string | undefined) {
  if (!value) return null;
  const ids = value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return ids.length > 0 ? new Set(ids) : null;
}
