import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

const DEFAULT_NEXT_PUBLIC_API_URL = "https://api.prontiq.dev";

export const env = createEnv({
  server: {},
  client: {
    NEXT_PUBLIC_API_URL: z.url(),
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: z.string().min(1).optional(),
  },
  runtimeEnv: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL ?? DEFAULT_NEXT_PUBLIC_API_URL,
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
  },
  emptyStringAsUndefined: true,
});
