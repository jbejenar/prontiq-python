import type { Handler } from "aws-lambda";
import {
  SFNClient,
  StartExecutionCommand,
  ExecutionAlreadyExists,
} from "@aws-sdk/client-sfn";
import { createLogger } from "@prontiq/shared";
import { readManifestJson, getProductConfig } from "./lib.js";

const sfn = new SFNClient({});
const logger = createLogger("ingestion-router");

const STATE_MACHINE_ARN = process.env.STATE_MACHINE_ARN;

interface EventBridgeS3Event {
  detail: {
    bucket: { name: string };
    object: { key: string };
  };
}

/**
 * EventBridge target Lambda: routes manifest uploads to the ingestion Step Function.
 *
 * 1. Validates the S3 key is a manifest (.json in manifests/ prefix)
 * 2. Reads manifest from S3 to extract product + version
 * 3. Validates product against PRODUCT_REGISTRY
 * 4. Starts PqIngest Step Function with execution name ingest-{product}-{version}
 *
 * Concurrency: two versions of the same product CAN run concurrently. This is safe
 * because each creates its own versioned index, alias swap is atomic (last writer wins),
 * and orphaned indices are cleaned up by the scheduled PqIngestCleanup Lambda.
 * Duplicate manifest suppression is handled by ExecutionAlreadyExists (same name = same
 * product+version = already processing).
 *
 * Phase 2: add DynamoDB conditional-write lock for strict single-product serialization.
 */
export const handler: Handler = async (event: EventBridgeS3Event) => {
  if (!STATE_MACHINE_ARN) {
    throw new Error("STATE_MACHINE_ARN environment variable is not set");
  }

  const bucket = event.detail.bucket.name;
  const key = event.detail.object.key;

  if (!key.endsWith(".json")) {
    logger.info("Ignoring non-JSON object", { key });
    return { key, status: "ignored" };
  }

  const manifest = await readManifestJson(bucket, key);
  getProductConfig(manifest.product); // throws for unknown products

  const executionName = `ingest-${manifest.product}-${manifest.version}`;

  try {
    await sfn.send(
      new StartExecutionCommand({
        stateMachineArn: STATE_MACHINE_ARN,
        name: executionName,
        input: JSON.stringify({
          bucket,
          key,
          product: manifest.product,
          version: manifest.version,
          force: false,
        }),
      }),
    );
  } catch (error) {
    if (error instanceof ExecutionAlreadyExists) {
      logger.info("Execution already exists", { executionName });
      return { executionName, status: "already_exists" };
    }
    throw error;
  }

  logger.info("Started execution", { executionName });
  return { executionName, status: "started" };
};
