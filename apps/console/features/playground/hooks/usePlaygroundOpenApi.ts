"use client";

import { useQuery } from "@tanstack/react-query";

import type { PlaygroundOperation } from "../types.js";
import { parsePublicOpenApiOperations } from "../lib/openapi.js";

export function usePlaygroundOpenApi() {
  return useQuery({
    queryKey: ["playground", "openapi"],
    queryFn: async (): Promise<PlaygroundOperation[]> => {
      const response = await fetch("/api/playground/openapi", {
        headers: { Accept: "application/json" },
      });
      if (!response.ok) throw new Error("Could not load public API specification.");
      return parsePublicOpenApiOperations(await response.json());
    },
    staleTime: 5 * 60 * 1000,
  });
}
