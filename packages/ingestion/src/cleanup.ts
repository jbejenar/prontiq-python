import { SERVICE_NAMES, wrapLambdaHandler } from "@prontiq/observability";
import { PRODUCT_REGISTRY, createLogger } from "@prontiq/shared";

/**
 * Scheduled Lambda (every 6 hours): Delete expired indices per product retention policy.
 * Also verifies latest automated OpenSearch snapshot is < 48 hours old.
 */
const logger = createLogger("ingestion-cleanup");

async function cleanupHandler() {
  for (const product of Object.keys(PRODUCT_REGISTRY)) {
    const config = PRODUCT_REGISTRY[product];
    if (!config) {
      continue;
    }

    // TODO: List all indices matching {product}-*
    // TODO: Identify which index the alias currently points to
    // TODO: Delete indices older than config.retention_hours
    // TODO: Never delete if it's the only index for this product

    logger.info("Would clean up expired indices", {
      product,
      retention_hours: config.retention_hours,
    });
  }

  // TODO: Verify latest automated snapshot age < 48h, alert if stale

  return { cleaned: true };
}

export const handler = wrapLambdaHandler({
  attributes: () => ({
    "prontiq.ingestion.step": "cleanup",
    "prontiq.stage": process.env.PRONTIQ_STAGE ?? "unknown",
  }),
  handler: cleanupHandler,
  serviceName: SERVICE_NAMES.ingestion,
  spanName: "prontiq-ingestion.cleanup",
});
