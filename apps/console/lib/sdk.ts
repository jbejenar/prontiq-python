import { Prontiq } from "@prontiq/sdk";

import { env } from "./env";

export function createSdk(apiKey: string): Prontiq {
  return new Prontiq({
    serverURL: env.NEXT_PUBLIC_API_URL,
    apiKeyAuth: apiKey,
  });
}
