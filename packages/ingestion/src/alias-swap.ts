import type { Handler } from "aws-lambda";
import { PRODUCT_REGISTRY } from "@prontiq/shared";
import type { ManifestV1 } from "@prontiq/shared";

/**
 * Step Function Step 6: Atomic alias swap.
 * Removes old index from alias, adds new index — single _aliases API call.
 * Zero downtime.
 */
export const handler: Handler = async (event) => {
  const { manifest, indexName } = event as {
    manifest: ManifestV1;
    indexName: string;
  };

  const productConfig = PRODUCT_REGISTRY[manifest.product];
  if (!productConfig) {
    throw new Error(`Unknown product: ${manifest.product}`);
  }

  const alias = productConfig.alias;

  // TODO: GET /_alias/{alias} to find current index
  // TODO: POST /_aliases with atomic remove + add actions
  // TODO: Invalidate API Gateway cache for this product's routes

  console.log(`Would swap alias '${alias}' to index '${indexName}'`);

  return { ...event, alias, swapped: true };
};
