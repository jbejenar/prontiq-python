"use client";

import { useQuery } from "@tanstack/react-query";

import type { PlaygroundDemoStatus } from "../types.js";

export function usePlaygroundDemoStatus() {
  return useQuery({
    queryKey: ["playground", "demo-status"],
    queryFn: async (): Promise<PlaygroundDemoStatus> => {
      const response = await fetch("/api/playground/demo/status", {
        headers: { Accept: "application/json" },
      });
      if (!response.ok) {
        throw new Error("Could not load playground demo availability.");
      }
      return (await response.json()) as PlaygroundDemoStatus;
    },
    staleTime: 60 * 1000,
  });
}
