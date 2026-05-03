import { z } from "zod";

const serverEnvSchema = z.object({
  CLERK_ADMIN_ROLES: z.string().min(1).optional(),
  CLERK_SECRET_KEY: z.string().min(1).optional(),
  LAGO_API_KEY: z.string().min(1).optional(),
  LAGO_API_URL: z.string().min(1).optional(),
  PRONTIQ_ALLOW_KEYLESS_CLERK: z.enum(["1"]).optional(),
  PRONTIQ_BILLING_CATALOG_ENV: z.enum(["dev", "prod", "all"]).optional(),
  PRONTIQ_CONSOLE_PLAYGROUND_DEMO_API_KEY: z.string().min(1).optional(),
  PRONTIQ_CONSOLE_PLAYGROUND_DEMO_BACKEND_POLICY_CONFIRMED: z.enum(["1"]).optional(),
});

export const serverEnv = serverEnvSchema.parse({
  CLERK_ADMIN_ROLES: process.env.CLERK_ADMIN_ROLES,
  CLERK_SECRET_KEY: process.env.CLERK_SECRET_KEY,
  LAGO_API_KEY: process.env.LAGO_API_KEY,
  LAGO_API_URL: process.env.LAGO_API_URL,
  PRONTIQ_ALLOW_KEYLESS_CLERK: process.env.PRONTIQ_ALLOW_KEYLESS_CLERK,
  PRONTIQ_BILLING_CATALOG_ENV: process.env.PRONTIQ_BILLING_CATALOG_ENV,
  PRONTIQ_CONSOLE_PLAYGROUND_DEMO_API_KEY:
    process.env.PRONTIQ_CONSOLE_PLAYGROUND_DEMO_API_KEY,
  PRONTIQ_CONSOLE_PLAYGROUND_DEMO_BACKEND_POLICY_CONFIRMED:
    process.env.PRONTIQ_CONSOLE_PLAYGROUND_DEMO_BACKEND_POLICY_CONFIRMED,
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

export function getPlaygroundServerEnv() {
  if (!serverEnv.PRONTIQ_CONSOLE_PLAYGROUND_DEMO_API_KEY) {
    throw new Error("Console playground requires PRONTIQ_CONSOLE_PLAYGROUND_DEMO_API_KEY.");
  }
  return {
    demoApiKey: serverEnv.PRONTIQ_CONSOLE_PLAYGROUND_DEMO_API_KEY,
    demoBackendPolicyConfirmed:
      serverEnv.PRONTIQ_CONSOLE_PLAYGROUND_DEMO_BACKEND_POLICY_CONFIRMED === "1",
  };
}

export type PlaygroundDemoStatus =
  | { execution: "enabled" }
  | {
      execution: "reference_only";
      reasonCode: "DEMO_KEY_NOT_CONFIGURED" | "DEMO_BACKEND_POLICY_NOT_CONFIRMED";
      message: string;
    };

export function getPlaygroundDemoStatusFromConfig(input: {
  demoApiKey?: string;
  demoBackendPolicyConfirmed?: "1";
}): PlaygroundDemoStatus {
  if (!input.demoApiKey) {
    return {
      execution: "reference_only",
      reasonCode: "DEMO_KEY_NOT_CONFIGURED",
      message: "Demo execution is unavailable on this deployment because the demo key is not configured.",
    };
  }
  if (input.demoBackendPolicyConfirmed !== "1") {
    return {
      execution: "reference_only",
      reasonCode: "DEMO_BACKEND_POLICY_NOT_CONFIRMED",
      message:
        "Demo execution is unavailable until backend quota and rate controls are confirmed for the demo key.",
    };
  }
  return { execution: "enabled" };
}

export function getPlaygroundDemoStatus(): PlaygroundDemoStatus {
  return getPlaygroundDemoStatusFromConfig({
    demoApiKey: serverEnv.PRONTIQ_CONSOLE_PLAYGROUND_DEMO_API_KEY,
    demoBackendPolicyConfirmed:
      serverEnv.PRONTIQ_CONSOLE_PLAYGROUND_DEMO_BACKEND_POLICY_CONFIRMED,
  });
}
