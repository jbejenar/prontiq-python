import {
  SFNClient,
  SendTaskSuccessCommand,
  SendTaskFailureCommand,
} from "@aws-sdk/client-sfn";
import { getSourceFiles, readManifestJson, streamBulkIngest } from "./lib.js";

/**
 * Standalone Node.js entry point for the Fargate bulk ingest task.
 * NOT a Lambda handler — runs as a long-lived container process.
 *
 * Reads coordinates from environment variables (set via Step Function container overrides):
 *   BUCKET, MANIFEST_KEY, INDEX_NAME, TASK_TOKEN, OPENSEARCH_ENDPOINT, AWS_REGION
 *
 * Reports results back to the Step Function via SendTaskSuccess/SendTaskFailure.
 */

const BUCKET = process.env.BUCKET;
const MANIFEST_KEY = process.env.MANIFEST_KEY;
const INDEX_NAME = process.env.INDEX_NAME;
const TASK_TOKEN = process.env.TASK_TOKEN;

async function main() {
  if (!BUCKET || !MANIFEST_KEY || !INDEX_NAME || !TASK_TOKEN) {
    throw new Error(
      "Required environment variables: BUCKET, MANIFEST_KEY, INDEX_NAME, TASK_TOKEN",
    );
  }

  const sfn = new SFNClient({});

  try {
    const manifest = await readManifestJson(BUCKET, MANIFEST_KEY);
    const sourceFiles = getSourceFiles(manifest);

    let totalIngested = 0;
    let totalFailed = 0;

    for (const file of sourceFiles) {
      console.log(`Ingesting ${file.key} (${file.records} records) into ${INDEX_NAME}`);
      const result = await streamBulkIngest(BUCKET, file.key, INDEX_NAME);
      totalIngested += result.ingested;
      totalFailed += result.failed;
      console.log(`  ingested=${result.ingested} failed=${result.failed}`);
    }

    await sfn.send(
      new SendTaskSuccessCommand({
        taskToken: TASK_TOKEN,
        output: JSON.stringify({ ingested: totalIngested, failed: totalFailed }),
      }),
    );

    console.log(`Bulk ingest complete: ingested=${totalIngested} failed=${totalFailed}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;
    console.error(`Bulk ingest failed: ${message}`);
    if (stack) console.error(`Stack: ${stack}`);
    // Log safe metadata only — never dump raw request bodies or credentials
    if (error instanceof Error && "meta" in error) {
      const meta = (error as { meta?: { statusCode?: number; headers?: unknown } }).meta;
      if (meta?.statusCode) {
        console.error(`OpenSearch status: ${meta.statusCode}`);
      }
    }

    await sfn.send(
      new SendTaskFailureCommand({
        taskToken: TASK_TOKEN,
        error: "BulkIngestFailure",
        cause: message.slice(0, 256),
      }),
    );

    process.exitCode = 1;
  }
}

void main();
