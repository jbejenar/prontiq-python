"use client";

import { useApiClient } from "@scalar/api-client-react";
import "@scalar/api-client-react/style.css";
import "./scalar-client-overrides.css";

import type { PlaygroundOperation } from "../types.js";
import { Button } from "../../../components/ui/button.js";

type ScalarMethod = "options" | "post" | "delete" | "get" | "put" | "patch" | "head" | "trace";

export function ScalarClientAdapter({
  baseUrl,
  operation,
}: {
  baseUrl: string;
  operation: PlaygroundOperation;
}) {
  const client = useApiClient({
    configuration: {
      url: "/api/playground/openapi",
      baseServerURL: baseUrl,
      servers: [{ url: baseUrl, description: "Prontiq public API" }],
      hiddenClients: [],
    },
  });

  return (
    <Button
      type="button"
      variant="outline"
      onClick={() =>
        client?.open({ path: operation.path, method: operation.method.toLowerCase() as ScalarMethod })
      }
    >
      Open advanced Scalar client
    </Button>
  );
}
