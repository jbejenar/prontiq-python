export const HONEYCOMB_TRACES_URL_US = "https://api.honeycomb.io/v1/traces";

export const SERVICE_NAMES = {
  api: "prontiq-api",
  billing: "prontiq-billing",
  ingestion: "prontiq-ingestion",
  webhooks: "prontiq-webhooks",
} as const;

export interface HoneycombConfig {
  apiKey: string;
  enabled: boolean;
  stage: string;
  tracesUrl: string;
}

export interface TelemetryStateSnapshot {
  enabled: boolean;
  serviceName: string | null;
}

function trimEnv(name: string): string {
  const raw = process.env[name];
  return raw === undefined ? "" : raw.trim();
}

export function getHoneycombConfig(): HoneycombConfig {
  const customTracesUrl = trimEnv("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT");
  const apiKey = trimEnv("HONEYCOMB_API_KEY");
  const enabledFlag = trimEnv("HONEYCOMB_ENABLED").toLowerCase();

  return {
    apiKey,
    enabled: apiKey.length > 0 && enabledFlag !== "false",
    stage: trimEnv("PRONTIQ_STAGE") || trimEnv("SST_STAGE") || "unknown",
    tracesUrl: customTracesUrl || HONEYCOMB_TRACES_URL_US,
  };
}

let currentState: TelemetryStateSnapshot = {
  enabled: false,
  serviceName: null,
};

export function setCurrentTelemetryState(snapshot: TelemetryStateSnapshot): void {
  currentState = snapshot;
}

export function getCurrentTelemetryState(): TelemetryStateSnapshot {
  return currentState;
}
