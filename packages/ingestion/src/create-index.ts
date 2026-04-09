import type { Handler } from "aws-lambda";
import type { ManifestV1 } from "@prontiq/shared";

/**
 * Step Function Step 2: Create versioned OpenSearch index with mappings.
 * Index name: {product}-{version}. Refresh disabled during bulk load.
 */
export const handler: Handler = async (event) => {
  const { manifest, bucket } = event as { manifest: ManifestV1; bucket: string };

  const indexName = `${manifest.product}-${manifest.version}`;

  // TODO: Read mappings from S3 (manifest.index.mappings_key)
  // TODO: Create index with mappings + settings (refresh_interval: -1)
  // TODO: Check if index already exists (idempotency / force flag)

  console.log(`Would create index: ${indexName}`, { bucket });

  return { ...event, indexName };
};
