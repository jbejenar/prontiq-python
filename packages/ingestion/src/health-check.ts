import type { Handler } from "aws-lambda";
import type { Manifest } from "@prontiq/shared";
import { countDocuments, refreshAndForceMerge, runKnownGoodQuery } from "./lib.js";

/**
 * Step Function Step 5: Pre-swap validation against the NEW index.
 * - Re-enable refresh and force merge (index was built with refresh_interval: -1)
 * - Doc count matches manifest.total_records
 * - Known-good sample query returns expected result
 */
export async function healthCheck(event: {
  manifest: Manifest;
  indexName: string;
  skipAliasSwap?: boolean;
}) {
  const { manifest, indexName } = event;

  // Refresh BEFORE counting — bulk ingest runs with refresh disabled,
  // so documents are not searchable/countable until refresh happens.
  await refreshAndForceMerge(indexName);

  const count = await countDocuments(indexName);
  if (count !== manifest.total_records) {
    throw new Error(
      `Health check failed for ${indexName}: expected ${manifest.total_records} docs, got ${count}`,
    );
  }

  await runKnownGoodQuery(indexName, manifest);

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
