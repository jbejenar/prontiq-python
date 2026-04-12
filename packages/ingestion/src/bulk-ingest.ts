import type { Handler } from "aws-lambda";
import { getSourceFiles, streamBulkIngest } from "./lib.js";
import type { Manifest } from "@prontiq/shared";

/**
 * Step Function Step 3: Stream NDJSON source files from S3
 * into OpenSearch via _bulk API.
 */
export async function bulkIngest(event: {
  manifest: Manifest;
  indexName: string;
  bucket: string;
  fileKey?: string;
}) {
  const { manifest, indexName, bucket } = event;

  if (event.fileKey) {
    const result = await streamBulkIngest(bucket, event.fileKey, indexName);
    return { ...event, ingested: result.ingested, failed: result.failed };
  }

  const sourceFiles = getSourceFiles(manifest);
  let totalIngested = 0;
  let totalFailed = 0;

  for (const file of sourceFiles) {
    const result = await streamBulkIngest(bucket, file.key, indexName);
    totalIngested += result.ingested;
    totalFailed += result.failed;
  }

  return { ...event, ingested: totalIngested, failed: totalFailed };
}

export const handler: Handler = async (event) =>
  bulkIngest(
    event as {
      manifest: Manifest;
      indexName: string;
      bucket: string;
      fileKey?: string;
    },
  );
