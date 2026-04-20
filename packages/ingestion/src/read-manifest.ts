import { SERVICE_NAMES, wrapLambdaHandler } from "@prontiq/observability";
import {
  assertManifestVersionProgression,
  currentAliasIndex,
  getProductConfig,
  readManifestJson,
  verifyManifestFiles,
} from "./lib.js";

/**
 * Step Function Step 1: Read and validate manifest from S3.
 * Verifies schema and source-object integrity.
 * Checks version progression (rejects stale versions unless force=true).
 */
export async function readManifest(event: { bucket: string; key: string; force?: boolean }) {
  const { bucket, key, force = false } = event;
  const manifest = await readManifestJson(bucket, key);
  await verifyManifestFiles(manifest, bucket);

  const productConfig = getProductConfig(manifest.product);
  const liveIndex = await currentAliasIndex(productConfig.alias);
  assertManifestVersionProgression({
    product: manifest.product,
    manifestVersion: manifest.version,
    currentLiveIndex: liveIndex,
    force,
  });

  return { ...event, manifest };
}

async function readManifestHandler(event: { bucket: string; key: string; force?: boolean }) {
  return readManifest(event);
}

export const handler = wrapLambdaHandler({
  attributes: () => ({
    "prontiq.ingestion.step": "read_manifest",
    "prontiq.stage": process.env.PRONTIQ_STAGE ?? "unknown",
  }),
  handler: readManifestHandler,
  serviceName: SERVICE_NAMES.ingestion,
  spanName: "prontiq-ingestion.read-manifest",
});
