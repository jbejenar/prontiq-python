import type { Handler } from "aws-lambda";
import type { Manifest } from "@prontiq/shared";
import { countDocuments, forceMergeIndex, refreshIndex, runKnownGoodQuery } from "./lib.js";

/**
 * Step Function Step 5: Pre-swap validation against the NEW index.
 *
 * Order matters:
 * 1. refreshIndex — fast (~seconds), makes bulk-ingested docs searchable
 * 2. countDocuments — verify doc count matches manifest
 * 3. runKnownGoodQuery — verify data quality
 * 4. forceMergeIndex — slow (~5-15 min on 10GB), merge segments for read perf
 *
 * Validation runs before the expensive merge so a timeout during merge
 * doesn't kill a healthy ingest.
 */
export async function healthCheck(event: {
  manifest: Manifest;
  indexName: string;
  skipAliasSwap?: boolean;
}) {
  const { manifest, indexName } = event;

  await refreshIndex(indexName);

  const count = await countDocuments(indexName);
  if (count !== manifest.total_records) {
    throw new Error(
      `Health check failed for ${indexName}: expected ${manifest.total_records} docs, got ${count}`,
    );
  }

  await runKnownGoodQuery(indexName, manifest);

  // Force merge is a best-effort optimization, not a correctness requirement.
  // If it fails or times out, the index is still valid and ready for alias swap.
  try {
    await forceMergeIndex(indexName);
  } catch (mergeError) {
    const msg = mergeError instanceof Error ? mergeError.message : String(mergeError);
    console.warn(`Force merge failed (non-fatal): ${msg}`);
  }

  return { ...event, healthy: true };
}

export const handler: Handler = async (event) =>
  healthCheck(
    event as {
      manifest: Manifest;
      indexName: string;
      skipAliasSwap?: boolean;
    },
  );
