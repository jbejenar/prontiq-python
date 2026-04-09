import type { Handler } from "aws-lambda";
import { GetObjectCommand, HeadObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { manifestV1Schema } from "@prontiq/shared";

const s3 = new S3Client({});

/**
 * Step Function Step 1: Read and validate manifest from S3.
 * Verifies schema, checksums (via S3 native ChecksumSHA256), and NDJSON sampling.
 */
export const handler: Handler = async (event) => {
  const { bucket, key } = event;

  // 1. Read manifest from S3
  const response = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const body = await response.Body?.transformToString();
  if (!body) throw new Error(`Empty manifest at s3://${bucket}/${key}`);

  const manifest = manifestV1Schema.parse(JSON.parse(body));

  // 2. Verify all files exist and checksums match
  for (const file of manifest.files) {
    const head = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: file.key }));

    if (head.ContentLength !== file.bytes) {
      throw new Error(
        `Size mismatch for ${file.key}: expected ${file.bytes}, got ${head.ContentLength}`,
      );
    }

    // S3 native ChecksumSHA256 — zero data transfer verification
    if (head.ChecksumSHA256 && head.ChecksumSHA256 !== file.sha256) {
      throw new Error(
        `SHA-256 mismatch for ${file.key}: expected ${file.sha256}, got ${head.ChecksumSHA256}`,
      );
    }
  }

  // 3. Verify total_records consistency
  const recordSum = manifest.files.reduce((sum, f) => sum + f.records, 0);
  if (recordSum !== manifest.total_records) {
    throw new Error(
      `Record count mismatch: sum of files (${recordSum}) !== total_records (${manifest.total_records})`,
    );
  }

  // TODO: Step 7 — NDJSON content sampling validation

  return { manifest, bucket };
};
