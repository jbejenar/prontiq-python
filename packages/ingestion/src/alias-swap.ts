import type { Handler } from "aws-lambda";
import { PRODUCT_REGISTRY } from "@prontiq/shared";
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
      console.log(
        `Skipping alias swap: live version ${liveVersion} is newer than manifest version ${manifest.version}`,
      );
      return { ...event, alias, previousIndex, swapped: false, reason: "newer_version_live" };
    }
  }

  const actions = buildAliasSwapActions({ alias, indexName, previousIndex });

  await client.indices.updateAliases({
    body: { actions },
  });

  return { ...event, alias, previousIndex, swapped: true };
}

export const handler: Handler = async (event) =>
  aliasSwap(
    event as {
      manifest: Manifest;
      indexName: string;
      skipAliasSwap?: boolean;
      force?: boolean;
    },
  );
