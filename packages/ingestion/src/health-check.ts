import { SERVICE_NAMES, wrapLambdaHandler } from "@prontiq/observability";
import { createLogger, type Manifest } from "@prontiq/shared";
import { KnownGoodQueryNoHitsError, countDocuments, forceMergeIndex, refreshIndex, runKnownGoodQuery } from "./lib.js";

/**
 * Step Function Step 5: Pre-swap validation against the NEW index.
 *
 * Order matters:
 * 1. refreshIndex — fast (~seconds), makes bulk-ingested docs searchable
 * 2. countDocuments — verify doc count matches manifest
 * 3. runKnownGoodQuery — with retry + delay (search_as_you_type needs a moment after refresh on large indices)
 * 4. forceMergeIndex — slow, best-effort
 */
const logger = createLogger("ingestion-health-check");

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

  // Known-good query with retry for transient post-refresh lag only.
  // search_as_you_type sub-fields (2gram, 3gram) may not be queryable
  // immediately after refresh on large indices.
  const queryRetryDelays = [5_000, 10_000, 15_000, 20_000, 25_000];
  let queryPassed = false;
  let lastQueryError: Error | undefined;

  for (let attempt = 0; attempt <= queryRetryDelays.length; attempt += 1) {
    try {
      await runKnownGoodQuery(indexName, manifest);
      queryPassed = true;
      break;
    } catch (error) {
      lastQueryError = error instanceof Error ? error : new Error(String(error));
      // Only retry transient no-hits — any other error (auth, mapping, transport, geo) fails immediately
      if (!(lastQueryError instanceof KnownGoodQueryNoHitsError)) {
        throw lastQueryError;
      }
      if (attempt < queryRetryDelays.length) {
        const delayMs = queryRetryDelays[attempt]!;
        logger.info("Known-good query returned no hits; retrying", {
          attempt: attempt + 1,
          delay_seconds: delayMs / 1000,
          total_attempts: queryRetryDelays.length + 1,
        });
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }

  if (!queryPassed) {
    throw lastQueryError!;
  }

  // Force merge is best-effort — index is already validated
  try {
    await forceMergeIndex(indexName);
  } catch (mergeError) {
    const msg = mergeError instanceof Error ? mergeError.message : String(mergeError);
    logger.warn("Force merge failed (non-fatal)", { error: msg, indexName });
  }

  return { ...event, healthy: true };
}

async function healthCheckHandler(event: {
  manifest: Manifest;
  indexName: string;
  skipAliasSwap?: boolean;
}) {
  return healthCheck(event);
}

export const handler = wrapLambdaHandler({
  attributes: (event) => {
    const input = event as {
      manifest: Manifest;
      indexName: string;
    };
    return {
      "prontiq.ingestion.step": "health_check",
      "prontiq.ingestion.version": input.manifest.version,
      "prontiq.product": input.manifest.product,
      "prontiq.stage": process.env.PRONTIQ_STAGE ?? "unknown",
    };
  },
  handler: healthCheckHandler,
  serviceName: SERVICE_NAMES.ingestion,
  spanName: "prontiq-ingestion.health-check",
});
