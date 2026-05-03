export type PlaygroundMode = "demo" | "account";

export interface OpenApiParameter {
  name: string;
  in: "path" | "query" | "header" | "cookie";
  required?: boolean;
  schema?: unknown;
  description?: string;
  example?: unknown;
}

export interface PlaygroundOperation {
  operationId: string;
  method: string;
  path: string;
  tag: string;
  summary: string;
  description?: string;
  parameters: OpenApiParameter[];
  hasJsonRequestBody: boolean;
  requestBodyExample?: unknown;
  requiresApiKey: boolean;
}

export interface PlaygroundRequestConfig {
  bodyText: string;
  pathParams: Record<string, string>;
  queryParams: Record<string, string>;
}

export interface PlaygroundResponse {
  bodyText: string;
  durationMs: number;
  headers: Record<string, string>;
  ok: boolean;
  status: number;
  statusText: string;
}

export type PlaygroundDemoStatus =
  | { execution: "enabled" }
  | {
      execution: "reference_only";
      reasonCode: "DEMO_KEY_NOT_CONFIGURED" | "DEMO_BACKEND_POLICY_NOT_CONFIRMED";
      message: string;
    };

export interface PlaygroundTelemetryEvent {
  errorCategory?: string;
  latencyMs?: number;
  method: string;
  mode: PlaygroundMode;
  operationId: string;
  pathTemplate: string;
  source: "console_playground";
  status?: number;
}
