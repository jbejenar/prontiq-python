import type { Handler } from "aws-lambda";
import { PRODUCT_REGISTRY } from "@prontiq/shared";

/**
 * Scheduled Lambda (every 6 hours): Delete expired indices per product retention policy.
 * Also verifies latest automated OpenSearch snapshot is < 48 hours old.
 */
export const handler: Handler = async () => {
  for (const [product, config] of Object.entries(PRODUCT_REGISTRY)) {
    // TODO: List all indices matching {product}-*
    // TODO: Identify which index the alias currently points to
    // TODO: Delete indices older than config.retention_hours
    // TODO: Never delete if it's the only index for this product

    console.log(
      `Would clean up expired indices for '${product}' (retention: ${config.retention_hours}h)`,
    );
  }

  // TODO: Verify latest automated snapshot age < 48h, alert if stale

  return { cleaned: true };
};
