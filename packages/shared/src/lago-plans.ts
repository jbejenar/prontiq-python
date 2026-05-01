export type LagoCatalogEnvironment = "all" | "dev" | "prod";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readBoolean(metadata: Record<string, unknown>, key: string): boolean {
  const value = metadata[key];
  return value === true || (typeof value === "string" && value.toLowerCase() === "true");
}

export function isLagoPlanVisible(input: {
  catalogEnv: LagoCatalogEnvironment;
  metadata: Record<string, unknown> | undefined;
}): boolean {
  const metadata = input.metadata ?? {};
  if (!readBoolean(metadata, "prontiq_console_visible")) return false;
  if (readBoolean(metadata, "prontiq_test") || readBoolean(metadata, "prontiq_internal")) {
    return false;
  }

  const metadataEnv = metadata.prontiq_environment;
  if (typeof metadataEnv !== "string" || metadataEnv.length === 0) return true;
  return metadataEnv === "all" || metadataEnv === input.catalogEnv || input.catalogEnv === "all";
}

export function extractLagoPlanMetadata(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value)) return undefined;
  const metadata = value.metadata;
  return isRecord(metadata) ? metadata : undefined;
}
