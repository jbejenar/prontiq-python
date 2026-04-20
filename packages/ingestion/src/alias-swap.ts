import { SERVICE_NAMES, withActiveSpan, wrapLambdaHandler } from "@prontiq/observability";
import { PRODUCT_REGISTRY, createLogger } from "@prontiq/shared";
import type { Manifest } from "@prontiq/shared";
import {
  buildAliasSwapActions,
  compareOpaqueVersions,
  currentAliasIndex,
  getOpenSearchClient,
  versionFromIndexName,
} from "./lib.js";

/**
 * Step Function Step 6: Atomic alias swap.
 * Removes old index from alias, adds new index — single _aliases API call.
 * Zero downtime.
 *
 * Safety: re-checks version progression immediately before swapping to prevent
 * a concurrent older execution from rolling the alias backwards — unless force
 * is true (intentional operator rollback).
 */
const logger = createLogger("ingestion-alias-swap");

export async function aliasSwap(event: {
  manifest: Manifest;
  indexName: string;
  skipAliasSwap?: boolean;
  force?: boolean;
}) {
  const { manifest, indexName, skipAliasSwap = false, force = false } = event;
  if (skipAliasSwap) {
    return { ...event, alias: PRODUCT_REGISTRY[manifest.product]?.alias, swapped: false };
  }

  const client = getOpenSearchClient();
  const productConfig = PRODUCT_REGISTRY[manifest.product];
  if (!productConfig) {
    throw new Error(`Unknown product: ${manifest.product}`);
  }

  const alias = productConfig.alias;
  const previousIndex = await currentAliasIndex(alias);

  // Guard: if a newer version already swapped in, do not roll back — unless forced
  if (!force && previousIndex) {
    const liveVersion = versionFromIndexName(manifest.product, previousIndex);
    if (liveVersion && compareOpaqueVersions(manifest.version, liveVersion) < 0) {
      logger.info("Skipping alias swap because a newer version is already live", {
        indexName,
        liveVersion,
        manifestVersion: manifest.version,
      });
      return { ...event, alias, previousIndex, swapped: false, reason: "newer_version_live" };
    }
  }

  const actions = buildAliasSwapActions({ alias, indexName, previousIndex });

  await withActiveSpan(
    "ingestion.indices.update_aliases",
    {
      "prontiq.ingestion.step": "alias_swap",
      "prontiq.ingestion.version": manifest.version,
      "prontiq.product": manifest.product,
      "prontiq.stage": process.env.PRONTIQ_STAGE ?? "unknown",
    },
    () =>
      client.indices.updateAliases({
        body: { actions },
      }),
  );

  return { ...event, alias, previousIndex, swapped: true };
}

async function aliasSwapHandler(event: {
  manifest: Manifest;
  indexName: string;
  skipAliasSwap?: boolean;
  force?: boolean;
}) {
  return aliasSwap(event);
}

export const handler = wrapLambdaHandler({
  attributes: (event) => {
    const input = event as {
      manifest: Manifest;
      indexName: string;
      skipAliasSwap?: boolean;
      force?: boolean;
    };
    return {
      "prontiq.ingestion.step": "alias_swap",
      "prontiq.ingestion.version": input.manifest.version,
      "prontiq.product": input.manifest.product,
      "prontiq.stage": process.env.PRONTIQ_STAGE ?? "unknown",
    };
  },
  handler: aliasSwapHandler,
  serviceName: SERVICE_NAMES.ingestion,
  spanName: "prontiq-ingestion.alias-swap",
});
