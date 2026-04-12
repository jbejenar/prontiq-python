import { parseArgs } from "node:util";
import { aliasSwap } from "./alias-swap.js";
import { bulkIngest } from "./bulk-ingest.js";
import { createIndex } from "./create-index.js";
import { healthCheck } from "./health-check.js";
import {
  deleteIndexIfExists,
  indexNameFor,
} from "./lib.js";
import { readManifest } from "./read-manifest.js";

interface CliOptions {
  bucket: string;
  manifestKey: string;
  force: boolean;
  applyAliasSwap: boolean;
  cleanupOnFailure: boolean;
  cleanupAfterDryRun: boolean;
}

function parseCliOptions(): CliOptions {
  const { values } = parseArgs({
    options: {
      bucket: { type: "string" },
      "manifest-key": { type: "string" },
      force: { type: "boolean", default: false },
      "apply-alias-swap": { type: "boolean", default: false },
      "cleanup-on-failure": { type: "boolean", default: true },
      "cleanup-after-dry-run": { type: "boolean", default: true },
    },
  });

  const bucket = values.bucket;
  const manifestKey = values["manifest-key"];

  if (!bucket || !manifestKey) {
    throw new Error(
      "Usage: node dist/manual-run.js --bucket <bucket> --manifest-key <manifests/product-version.json> [--apply-alias-swap]",
    );
  }

  return {
    bucket,
    manifestKey,
    force: values.force,
    applyAliasSwap: values["apply-alias-swap"],
    cleanupOnFailure: values["cleanup-on-failure"],
    cleanupAfterDryRun: values["cleanup-after-dry-run"],
  };
}

async function main() {
  const options = parseCliOptions();
  const skipAliasSwap = !options.applyAliasSwap;
  let indexName: string | undefined;
  let indexCreatedByThisRun = false;

  try {
    const manifestResult = await readManifest({
      bucket: options.bucket,
      key: options.manifestKey,
      force: options.force,
    });

    indexName = indexNameFor(manifestResult.manifest);

    const created = await createIndex({
      ...manifestResult,
      force: options.force,
    });
    indexCreatedByThisRun = true;

    const ingested = await bulkIngest(created);
    const checked = await healthCheck({
      manifest: ingested.manifest,
      indexName: ingested.indexName,
      skipAliasSwap,
    });

    const swapped = await aliasSwap({
      manifest: checked.manifest,
      indexName: checked.indexName,
      skipAliasSwap,
      force: options.force,
    });

    console.log(
      JSON.stringify(
        {
          manifestKey: options.manifestKey,
          indexName: swapped.indexName,
          alias: swapped.alias,
          swapped: swapped.swapped,
          dryRun: skipAliasSwap,
        },
        null,
        2,
      ),
    );

    if (skipAliasSwap && options.cleanupAfterDryRun && indexName) {
      await deleteIndexIfExists(indexName);
      console.log(`Deleted dry-run index ${indexName}`);
    }
  } catch (error) {
    // Only clean up if we actually created the index in this run.
    // Prevents deleting the live index if createIndex refused and threw.
    if (options.cleanupOnFailure && indexName && indexCreatedByThisRun) {
      await deleteIndexIfExists(indexName);
      console.error(`Deleted failed candidate index ${indexName}`);
    }

    throw error;
  }
}

void main();
