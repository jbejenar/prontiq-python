import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

const DEFAULT_NEXT_PUBLIC_API_URL = "https://api.prontiq.dev";

export const env = createEnv({
  server: {},
  client: {
    NEXT_PUBLIC_ACCOUNT_URL: z.url().optional(),
    NEXT_PUBLIC_API_URL: z.url(),
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: z.string().min(1).optional(),
    NEXT_PUBLIC_STRIPE_PRICING_TABLE_ID: z.string().min(1).optional(),
    NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: z.string().min(1).optional(),
  },
  runtimeEnv: {
    NEXT_PUBLIC_ACCOUNT_URL: process.env.NEXT_PUBLIC_ACCOUNT_URL,
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL ?? DEFAULT_NEXT_PUBLIC_API_URL,
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
    NEXT_PUBLIC_STRIPE_PRICING_TABLE_ID: process.env.NEXT_PUBLIC_STRIPE_PRICING_TABLE_ID,
    NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY,
  },
  emptyStringAsUndefined: true,
});
