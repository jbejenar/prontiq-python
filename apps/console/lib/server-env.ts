import { z } from "zod";

const serverEnvSchema = z.object({
  CLERK_SECRET_KEY: z.string().min(1).optional(),
  PRONTIQ_ALLOW_KEYLESS_CLERK: z.enum(["1"]).optional(),
});

export const serverEnv = serverEnvSchema.parse({
  CLERK_SECRET_KEY: process.env.CLERK_SECRET_KEY,
  PRONTIQ_ALLOW_KEYLESS_CLERK: process.env.PRONTIQ_ALLOW_KEYLESS_CLERK,
});
