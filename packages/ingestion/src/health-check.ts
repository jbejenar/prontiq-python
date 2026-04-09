import type { Handler } from "aws-lambda";
import type { ManifestV1 } from "@prontiq/shared";

/**
 * Step Function Step 5: Pre-swap validation against the NEW index.
 * - Doc count matches manifest.total_records
 * - Sample queries return expected results
 * - p95 latency under threshold
 */
export const handler: Handler = async (event) => {
  const { manifest, indexName } = event as {
    manifest: ManifestV1;
    indexName: string;
  };

  // TODO: GET /{indexName}/_count — compare to manifest.total_records
  // TODO: Run sample queries directly against the new index (not alias)
  // TODO: Measure p95 latency of sample queries

  console.log(`Would health-check index: ${indexName}`, {
    expected: manifest.total_records,
  });

  return { ...event, healthy: true };
};
