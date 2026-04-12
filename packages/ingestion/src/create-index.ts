import type { Handler } from "aws-lambda";
import { PRODUCT_REGISTRY } from "@prontiq/shared";
import type { Manifest } from "@prontiq/shared";
import {
  currentAliasIndex,
  getOpenSearchClient,
  indexNameFor,
  readMappingsJson,
  resolveIndexSettings,
} from "./lib.js";

/**
 * Step Function Step 2: Create versioned OpenSearch index with mappings.
 * Index name: {product}-{version}. Refresh disabled during bulk load.
 */
export async function createIndex(event: {
  manifest: Manifest;
  bucket: string;
  force?: boolean;
}) {
  const { manifest, bucket, force = false } = event;
  const client = getOpenSearchClient();
  const indexName = indexNameFor(manifest);
  const mappings = await readMappingsJson(bucket, manifest.index.mappings_key);
  const existsResponse = await client.indices.exists({ index: indexName });
  const alias = PRODUCT_REGISTRY[manifest.product]?.alias;

  if (existsResponse.body === true) {
    if (!force) {
      throw new Error(`Index ${indexName} already exists; rerun with force to replace it`);
    }

    if (!alias) {
      throw new Error(`Unknown product: ${manifest.product}`);
    }

    const currentLiveIndex = await currentAliasIndex(alias);
    if (currentLiveIndex === indexName) {
      throw new Error(
        `Refusing to delete live index ${indexName} while alias ${alias} points to it`,
      );
    }

    await client.indices.delete({ index: indexName });
  }

  await client.indices.create({
    index: indexName,
    body: {
      settings: {
        index: resolveIndexSettings(manifest),
      },
      mappings,
    },
  });

  return { ...event, indexName };
}

export const handler: Handler = async (event) =>
  createIndex(event as { manifest: Manifest; bucket: string; force?: boolean });
