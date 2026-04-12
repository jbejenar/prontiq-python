import type { Handler } from "aws-lambda";
import { currentAliasIndex, deleteIndexIfExists, getProductConfig, indexNameFor } from "./lib.js";
import type { Manifest } from "@prontiq/shared";

/**
 * Step Function Catch handler: cleans up the candidate index on pipeline failure.
 *
 * Derives indexName from $.manifest via indexNameFor() — does NOT rely on $.indexName
 * being in the state (CreateIndex only adds it on success).
 *
 * If no manifest exists (ReadManifest failed), there's nothing to clean up.
 *
 * Safety: if the alias already points to the candidate index (AliasSwap succeeded
 * but the Lambda crashed before returning), do NOT delete the live index.
 *
 * State is preserved via ResultPath: "$.error" on Catch blocks, so $.manifest
 * and other fields remain accessible.
 */
export async function onFailure(event: {
  manifest?: Manifest;
  indexName?: string;
  error?: { Error?: string; Cause?: string };
}) {
  const errorInfo = event.error ?? {};
  console.error(`Ingestion failed: ${errorInfo.Error ?? "unknown"} — ${errorInfo.Cause ?? ""}`);

  if (!event.manifest) {
    console.log("No manifest in state — ReadManifest likely failed, nothing to clean up");
    return { ...event, cleaned: false };
  }

  const indexName = event.indexName ?? indexNameFor(event.manifest);

  try {
    const config = getProductConfig(event.manifest.product);
    const aliasTarget = await currentAliasIndex(config.alias);
    if (aliasTarget === indexName) {
      console.log(
        `Alias ${config.alias} already points to ${indexName} — swap succeeded, NOT deleting`,
      );
      return { ...event, cleaned: false, reason: "alias_points_to_candidate" };
    }

    await deleteIndexIfExists(indexName);
    console.log(`Deleted candidate index ${indexName}`);
    return { ...event, cleaned: true, cleanedIndex: indexName };
  } catch (cleanupError) {
    const message = cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
    console.error(`Failed to delete candidate index ${indexName}: ${message}`);
    return { ...event, cleaned: false, cleanupError: message };
  }
}

export const handler: Handler = async (event) => onFailure(event);
