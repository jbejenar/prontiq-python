import { z } from "zod";

const serverEnvSchema = z.object({
  PRONTIQ_ALLOW_KEYLESS_CLERK: z.enum(["1"]).optional(),
  PRONTIQ_LANDING_DEMO_API_KEY: z.string().min(1).optional(),
  PRONTIQ_LANDING_UNLOCK_TOKEN: z.string().min(1).optional(),
});

export const serverEnv = serverEnvSchema.parse({
  PRONTIQ_ALLOW_KEYLESS_CLERK: process.env.PRONTIQ_ALLOW_KEYLESS_CLERK,
  PRONTIQ_LANDING_DEMO_API_KEY: process.env.PRONTIQ_LANDING_DEMO_API_KEY,
  PRONTIQ_LANDING_UNLOCK_TOKEN: process.env.PRONTIQ_LANDING_UNLOCK_TOKEN,
});
