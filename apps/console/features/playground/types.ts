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

export type PlaygroundInteractionTelemetryEvent =
  | {
      eventName: "palette_opened";
      mode: PlaygroundMode;
      source: "console_playground";
    }
  | {
      actionId: PlaygroundCommandActionId;
      eventName: "palette_action_selected";
      mode: PlaygroundMode;
      source: "console_playground";
    }
  | {
      eventName: "palette_operation_selected";
      mode: PlaygroundMode;
      operationId: string;
      source: "console_playground";
    };

export type PlaygroundCommandActionId =
  | "switch_to_demo"
  | "switch_to_account"
  | "run_request"
  | "copy_curl"
  | "clear_api_key"
  | "open_docs"
  | "reset_playground"
  | "focus_filter"
  | "focus_language_tabs";

export interface PlaygroundExecutionControls {
  canCopyCurl: boolean;
  canRun: boolean;
  copyCurl: () => Promise<void>;
  focusLanguageTabs: () => void;
  reset: () => void;
  run: () => void;
}
