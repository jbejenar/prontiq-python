import type { Handler } from "aws-lambda";

/**
 * Step Function Step 3 (parallel map): Stream one NDJSON file from S3
 * into OpenSearch via _bulk API.
 *
 * Configured: 10GB memory, 15 minute timeout.
 * One Lambda instance per NDJSON file, running in parallel.
 */
export const handler: Handler = async (event) => {
  const { indexName, bucket, fileKey } = event as {
    indexName: string;
    bucket: string;
    fileKey: string;
  };

  // TODO: Stream S3 object → parse NDJSON lines → batch _bulk POST to OpenSearch
  // TODO: Track ingested count, report errors per batch

  console.log(`Would bulk ingest ${fileKey} into ${indexName}`, { bucket });

  return { indexName, fileKey, ingested: 0 };
};
