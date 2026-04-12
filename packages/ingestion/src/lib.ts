import { GetObjectCommand, HeadObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { Client } from "@opensearch-project/opensearch";
import { AwsSigv4Signer } from "@opensearch-project/opensearch/aws";
import { PRODUCT_REGISTRY, manifestSchema } from "@prontiq/shared";
import type { Manifest, ManifestFile, ProductConfig } from "@prontiq/shared";
import { createGunzip } from "node:zlib";
import { Readable } from "node:stream";
import { createInterface } from "node:readline";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";

const s3 = new S3Client({});

let _client: Client | undefined;

export interface IngestionEvent {
  bucket: string;
  key?: string;
  manifest?: Manifest;
  indexName?: string;
  fileKey?: string;
  force?: boolean;
  skipAliasSwap?: boolean;
}

interface S3BodyWithTransforms {
  transformToString?: () => Promise<string>;
  transformToWebStream?: () => ReadableStream;
}

interface S3HeadSummary {
  contentLength: number;
  checksumSha256: string;
}

type JsonRecord = Record<string, unknown>;

interface BulkItemResult {
  status?: number;
  error?: unknown;
}

interface BulkResponseBody {
  errors?: boolean;
  items?: Array<Record<string, BulkItemResult>>;
}

interface AliasAction {
  add?: { index: string; alias: string };
  remove?: { index: string; alias: string };
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null;
}

function toNodeReadable(body: unknown): Readable {
  if (body instanceof Readable) {
    return body;
  }

  if (isRecord(body) && "pipe" in body && typeof body.pipe === "function") {
    return body as unknown as Readable;
  }

  if (
    isRecord(body) &&
    "transformToWebStream" in body &&
    typeof body.transformToWebStream === "function"
  ) {
    return Readable.fromWeb(
      (body as S3BodyWithTransforms).transformToWebStream!() as unknown as NodeReadableStream,
    );
  }

  throw new Error("S3 object body is not a readable stream");
}

function normalizeAddress(value: string): string {
  return value.toUpperCase().replace(/\s+/g, " ").trim();
}

export function getOpenSearchClient(): Client {
  if (!_client) {
    const endpoint = process.env.OPENSEARCH_ENDPOINT;
    if (!endpoint) {
      throw new Error("OPENSEARCH_ENDPOINT environment variable is not set");
    }

    _client = new Client({
      ...AwsSigv4Signer({
        region: process.env.AWS_REGION ?? "ap-southeast-2",
        service: "es",
      }),
      node: endpoint,
      maxRetries: 2,
      requestTimeout: 30_000,
    });
  }

  return _client;
}

export function indexNameFor(manifest: Manifest): string {
  return `${manifest.product}-${manifest.version}`;
}

export function versionFromIndexName(product: string, indexName: string): string | null {
  const prefix = `${product}-`;
  if (!indexName.startsWith(prefix)) {
    return null;
  }
  return indexName.slice(prefix.length);
}

export function hexSha256ToBase64(hex: string): string {
  return Buffer.from(hex, "hex").toString("base64");
}

export function compareOpaqueVersions(left: string, right: string): number {
  const tokenize = (value: string) => value.match(/\d+|[^\d]+/g) ?? [value];
  const leftTokens = tokenize(left);
  const rightTokens = tokenize(right);
  const max = Math.max(leftTokens.length, rightTokens.length);

  for (let index = 0; index < max; index += 1) {
    const leftToken = leftTokens[index];
    const rightToken = rightTokens[index];

    if (leftToken === undefined) return -1;
    if (rightToken === undefined) return 1;

    const leftIsNumber = /^\d+$/.test(leftToken);
    const rightIsNumber = /^\d+$/.test(rightToken);

    if (leftIsNumber && rightIsNumber) {
      const leftNumber = Number(leftToken);
      const rightNumber = Number(rightToken);
      if (leftNumber !== rightNumber) {
        return leftNumber < rightNumber ? -1 : 1;
      }
      continue;
    }

    if (leftToken !== rightToken) {
      return leftToken < rightToken ? -1 : 1;
    }
  }

  return 0;
}

export function assertManifestVersionProgression(args: {
  product: string;
  manifestVersion: string;
  currentLiveIndex: string | null;
  force?: boolean;
}): void {
  const { product, manifestVersion, currentLiveIndex, force = false } = args;

  if (force || !currentLiveIndex) {
    return;
  }

  const currentLiveVersion = versionFromIndexName(product, currentLiveIndex);
  if (!currentLiveVersion) {
    return;
  }

  const versionOrder = compareOpaqueVersions(manifestVersion, currentLiveVersion);

  if (versionOrder < 0) {
    throw new Error(
      `Manifest version ${manifestVersion} is older than live version ${currentLiveVersion}; rerun with --force only for an intentional rollback`,
    );
  }

  if (versionOrder === 0) {
    throw new Error(`Manifest version ${manifestVersion} already matches the live alias target`);
  }
}

export function buildAliasSwapActions(args: {
  alias: string;
  indexName: string;
  previousIndex: string | null;
}): AliasAction[] {
  const actions: AliasAction[] = [];

  if (args.previousIndex) {
    actions.push({ remove: { index: args.previousIndex, alias: args.alias } });
  }

  actions.push({ add: { index: args.indexName, alias: args.alias } });
  return actions;
}

export async function readManifestJson(bucket: string, key: string): Promise<Manifest> {
  const response = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const body = response.Body as S3BodyWithTransforms | undefined;
  const text = await body?.transformToString?.();
  if (!text) {
    throw new Error(`Empty manifest at s3://${bucket}/${key}`);
  }
  return manifestSchema.parse(JSON.parse(text));
}

export async function headObjectSummary(bucket: string, key: string): Promise<S3HeadSummary> {
  const head = await s3.send(
    new HeadObjectCommand({
      Bucket: bucket,
      Key: key,
      ChecksumMode: "ENABLED",
    }),
  );

  if (head.ContentLength === undefined) {
    throw new Error(`Missing ContentLength for s3://${bucket}/${key}`);
  }

  if (!head.ChecksumSHA256) {
    throw new Error(`Missing ChecksumSHA256 for s3://${bucket}/${key}`);
  }

  return {
    contentLength: head.ContentLength,
    checksumSha256: head.ChecksumSHA256,
  };
}

export function getProductConfig(product: string): ProductConfig {
  const config = PRODUCT_REGISTRY[product];
  if (!config) {
    throw new Error(`Unknown product: ${product}`);
  }
  return config;
}

/** Returns the S3 keys that should be ingested for this manifest. */
export function getSourceKeys(manifest: Manifest): string[] {
  if (manifest.manifest_version === 2) {
    return manifest.index.source_keys;
  }
  return manifest.files.map((f) => f.key);
}

/** Resolves source keys to their ManifestFile entries and applies ingestion policy checks. */
export function getSourceFiles(manifest: Manifest): ManifestFile[] {
  const sourceKeys = getSourceKeys(manifest);
  const config = getProductConfig(manifest.product);
  const policy = config.ingestion;

  // Reject duplicate source keys
  const uniqueKeys = new Set(sourceKeys);
  if (uniqueKeys.size !== sourceKeys.length) {
    throw new Error(
      `Duplicate source_keys in ${manifest.product} manifest: ${sourceKeys.join(", ")}`,
    );
  }

  const sourceFiles: ManifestFile[] = [];
  for (const key of sourceKeys) {
    const file = manifest.files.find((f) => f.key === key);
    if (!file) {
      throw new Error(
        `Source key "${key}" not found in manifest files[] for product ${manifest.product}`,
      );
    }
    sourceFiles.push(file);
  }

  if (policy?.mode === "single_file") {
    if (sourceFiles.length !== 1) {
      throw new Error(
        `${manifest.product} ingestion policy requires exactly one source file; found ${sourceFiles.length}`,
      );
    }

    const file = sourceFiles[0]!;

    if (policy.required_file_suffix && !file.key.endsWith(policy.required_file_suffix)) {
      throw new Error(
        `${manifest.product} source file must end with ${policy.required_file_suffix}; got ${file.key}`,
      );
    }

    if (
      policy.required_mappings_key_prefix &&
      !manifest.index.mappings_key.startsWith(policy.required_mappings_key_prefix)
    ) {
      throw new Error(
        `${manifest.product} mappings key must start with ${policy.required_mappings_key_prefix}; got ${manifest.index.mappings_key}`,
      );
    }
  }

  return sourceFiles;
}

export function resolveIndexSettings(manifest: Manifest): Record<string, string | number> {
  const config = getProductConfig(manifest.product);
  return {
    number_of_shards:
      config.ingestion?.phase1_shards ?? manifest.index.settings.number_of_shards ?? 1,
    number_of_replicas:
      config.ingestion?.phase1_replicas ?? manifest.index.settings.number_of_replicas ?? 0,
    refresh_interval: "-1",
    codec: "best_compression",
  };
}

export async function verifyManifestFiles(manifest: Manifest, bucket: string): Promise<void> {
  // Verify integrity of ALL inventory files (size + checksum)
  for (const file of manifest.files) {
    const head = await headObjectSummary(bucket, file.key);
    if (head.contentLength !== file.bytes) {
      throw new Error(
        `Size mismatch for ${file.key}: expected ${file.bytes}, got ${head.contentLength}`,
      );
    }

    const expectedChecksum = hexSha256ToBase64(file.sha256);
    if (head.checksumSha256 !== expectedChecksum) {
      throw new Error(
        `SHA-256 mismatch for ${file.key}: expected ${expectedChecksum}, got ${head.checksumSha256}`,
      );
    }
  }

  // For v2: validate source_keys entries exist in files[] and are unique
  if (manifest.manifest_version === 2) {
    const uniqueSourceKeys = new Set(manifest.index.source_keys);
    if (uniqueSourceKeys.size !== manifest.index.source_keys.length) {
      throw new Error(
        `Duplicate source_keys in manifest: ${manifest.index.source_keys.join(", ")}`,
      );
    }

    const fileKeys = new Set(manifest.files.map((f) => f.key));
    for (const sk of manifest.index.source_keys) {
      if (!fileKeys.has(sk)) {
        throw new Error(`source_keys entry "${sk}" not found in manifest files[]`);
      }
    }
  }

  // Validate record totals: v1 sums ALL files, v2 sums source_keys files only
  const sourceKeys = getSourceKeys(manifest);
  const sourceFiles = manifest.files.filter((f) => sourceKeys.includes(f.key));
  const recordSum = sourceFiles.reduce((sum, file) => sum + file.records, 0);
  if (recordSum !== manifest.total_records) {
    throw new Error(
      `Record count mismatch: sum of source files (${recordSum}) !== total_records (${manifest.total_records})`,
    );
  }
}

export async function readMappingsJson(bucket: string, key: string): Promise<JsonRecord> {
  const response = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const body = response.Body as S3BodyWithTransforms | undefined;
  const text = await body?.transformToString?.();
  if (!text) {
    throw new Error(`Empty mappings file at s3://${bucket}/${key}`);
  }

  const parsed = JSON.parse(text) as unknown;
  if (!isRecord(parsed)) {
    throw new Error(`Mappings file at s3://${bucket}/${key} must be a JSON object`);
  }
  return parsed;
}

export async function deleteIndexIfExists(indexName: string): Promise<void> {
  const client = getOpenSearchClient();
  const existsResponse = await client.indices.exists({ index: indexName });
  if (existsResponse.body === true) {
    await client.indices.delete({ index: indexName });
  }
}

export async function countDocuments(indexName: string): Promise<number> {
  const response = await getOpenSearchClient().count({ index: indexName });
  return response.body.count;
}

/**
 * Strip OpenSearch reserved metadata fields from a source document.
 * These fields cannot appear inside _source — they are document/bulk metadata only.
 * Legitimate application fields (even underscore-prefixed) are preserved.
 */
const RESERVED_METADATA_FIELDS = new Set([
  "_id", "_index", "_version", "_version_type", "_routing",
  "_seq_no", "_primary_term", "_source", "_ignored", "_field_names",
]);

export function sanitizeSourceDocument(doc: JsonRecord): JsonRecord {
  const source: JsonRecord = {};
  for (const [key, value] of Object.entries(doc)) {
    if (!RESERVED_METADATA_FIELDS.has(key)) {
      source[key] = value;
    }
  }
  return source;
}

export async function streamBulkIngest(
  bucket: string,
  fileKey: string,
  indexName: string,
): Promise<{ ingested: number; failed: number }> {
  const response = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: fileKey }));
  if (!response.Body) {
    throw new Error(`Empty source object at s3://${bucket}/${fileKey}`);
  }

  const input = toNodeReadable(response.Body);
  const gunzip = createGunzip();
  const lineReader = createInterface({
    input: input.pipe(gunzip),
    crlfDelay: Infinity,
  });

  let batch: Array<Record<string, unknown>> = [];
  let ingested = 0;
  let failed = 0;

  for await (const line of lineReader) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const parsed = JSON.parse(trimmed) as unknown;
    if (!isRecord(parsed)) {
      throw new Error(`Invalid NDJSON line in ${fileKey}: expected JSON object`);
    }

    const id = parsed._id;
    if (typeof id !== "string" || id.length === 0) {
      throw new Error(`Invalid NDJSON line in ${fileKey}: missing _id`);
    }

    const source = sanitizeSourceDocument(parsed);
    batch.push({ index: { _index: indexName, _id: id } });
    batch.push(source);

    if (batch.length >= 4_000) {
      const result = await flushBulkBatchWithRetry(batch);
      ingested += result.ingested;
      failed += result.failed;
      batch = [];
    }
  }

  if (batch.length > 0) {
    const result = await flushBulkBatchWithRetry(batch);
    ingested += result.ingested;
    failed += result.failed;
  }

  return { ingested, failed };
}

async function flushBulkBatchWithRetry(
  batch: Array<Record<string, unknown>>,
  maxRetries = 8,
): Promise<{ ingested: number; failed: number }> {
  let currentBatch = batch;
  let totalIngested = 0;
  let totalFailed = 0;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    let body: BulkResponseBody;
    try {
      const response = await getOpenSearchClient().bulk({
        body: currentBatch,
        refresh: false,
      });
      body = response.body as BulkResponseBody;
    } catch (error) {
      // Transport-level 429 — retry the entire batch
      const is429 =
        error instanceof Error &&
        "meta" in error &&
        (error as { meta?: { statusCode?: number } }).meta?.statusCode === 429;
      if (!is429 || attempt === maxRetries) {
        throw error;
      }
      const backoffMs = Math.min(1000 * 2 ** attempt, 30_000);
      console.log(`Bulk transport 429 — retrying ${currentBatch.length / 2} docs in ${backoffMs}ms (attempt ${attempt + 1}/${maxRetries})`);
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
      continue;
    }

    if (!body.errors) {
      totalIngested += currentBatch.length / 2;
      return evaluateFailureThreshold(totalIngested, totalFailed, []);
    }

    // Separate successful, retryable (429), and permanent failures
    const retryBatch: Array<Record<string, unknown>> = [];
    const errorSamples: string[] = [];
    let batchIngested = 0;
    let permanentFailed = 0;

    for (let i = 0; i < (body.items ?? []).length; i += 1) {
      const item = body.items![i]!;
      const [result] = Object.values(item);
      if (result?.status && result.status >= 200 && result.status < 300) {
        batchIngested += 1;
      } else if (result?.status === 429) {
        // Item-level 429 — collect for retry
        retryBatch.push(currentBatch[i * 2]!);
        retryBatch.push(currentBatch[i * 2 + 1]!);
      } else {
        permanentFailed += 1;
        if (errorSamples.length < 3 && result?.error) {
          errorSamples.push(JSON.stringify(result.error).slice(0, 500));
        }
      }
    }

    totalIngested += batchIngested;
    totalFailed += permanentFailed;

    if (retryBatch.length === 0) {
      // No retryable failures — evaluate permanent failures against threshold
      return evaluateFailureThreshold(totalIngested, totalFailed, errorSamples);
    }

    if (attempt === maxRetries) {
      totalFailed += retryBatch.length / 2;
      return evaluateFailureThreshold(totalIngested, totalFailed, errorSamples);
    }

    const backoffMs = Math.min(1000 * 2 ** attempt, 30_000);
    console.log(`Bulk item-level 429 — retrying ${retryBatch.length / 2} docs in ${backoffMs}ms (attempt ${attempt + 1}/${maxRetries})`);
    await new Promise((resolve) => setTimeout(resolve, backoffMs));
    currentBatch = retryBatch;
  }

  return evaluateFailureThreshold(totalIngested, totalFailed, []);
}

function evaluateFailureThreshold(
  ingested: number,
  failed: number,
  errorSamples: string[],
): { ingested: number; failed: number } {
  const failureRate = failed / Math.max(ingested + failed, 1);
  if (failureRate > 0.001) {
    const sampleInfo = errorSamples.length > 0
      ? ` Sample errors: ${errorSamples.join(" | ")}`
      : "";
    throw new Error(
      `Bulk ingest failure rate ${failureRate.toFixed(4)} exceeded threshold with ${failed} failed documents.${sampleInfo}`,
    );
  }
  return { ingested, failed };
}

export function evaluateBulkResponse(
  documentCount: number,
  body: BulkResponseBody,
): { ingested: number; failed: number } {
  if (!body.errors) {
    return { ingested: documentCount, failed: 0 };
  }

  let ingested = 0;
  let failed = 0;

  const errorSamples: string[] = [];

  for (const item of body.items ?? []) {
    const [result] = Object.values(item);
    if (result?.status && result.status >= 200 && result.status < 300) {
      ingested += 1;
    } else {
      failed += 1;
      if (errorSamples.length < 3 && result?.error) {
        errorSamples.push(JSON.stringify(result.error).slice(0, 500));
      }
    }
  }

  const failureRate = failed / Math.max(ingested + failed, 1);
  if (failureRate > 0.001) {
    const sampleInfo = errorSamples.length > 0
      ? ` Sample errors: ${errorSamples.join(" | ")}`
      : "";
    throw new Error(
      `Bulk ingest failure rate ${failureRate.toFixed(4)} exceeded threshold with ${failed} failed documents.${sampleInfo}`,
    );
  }

  return { ingested, failed };
}

/** Re-enable refresh and make all bulk-ingested documents searchable. Fast (~seconds). */
export async function refreshIndex(indexName: string): Promise<void> {
  const client = getOpenSearchClient();
  await client.indices.putSettings({
    index: indexName,
    body: { index: { refresh_interval: "1s" } },
  });
  await client.indices.refresh({ index: indexName });
}

/** Merge index segments for read performance. Slow (~5-15 min on 10GB). */
export async function forceMergeIndex(indexName: string): Promise<void> {
  await getOpenSearchClient().indices.forcemerge({
    index: indexName,
    max_num_segments: 5,
  });
}

export async function runKnownGoodQuery(indexName: string, manifest: Manifest): Promise<void> {
  const config = getProductConfig(manifest.product);
  const queryConfig = config.ingestion?.known_good_query;
  if (!queryConfig) {
    return;
  }

  if (queryConfig.kind === "address_contains") {
    const response = await getOpenSearchClient().search({
      index: indexName,
      body: {
        size: 5,
        query: {
          multi_match: {
            query: queryConfig.query,
            type: "bool_prefix",
            fields: [
              "addressLabelSearch",
              "addressLabelSearch._2gram",
              "addressLabelSearch._3gram",
            ],
          },
        },
        _source: ["addressLabel", "location"],
      },
    });

    const hits = (
      (response.body as { hits?: { hits?: Array<{ _source?: JsonRecord }> } }).hits?.hits ?? []
    ).map((hit) => hit._source ?? {});

    const expectedFragment = normalizeAddress(queryConfig.expected_label_fragment);
    const match = hits.find((hit) => {
      const label = hit.addressLabel;
      return typeof label === "string" && normalizeAddress(label).includes(expectedFragment);
    });

    if (!match) {
      throw new Error(`Known-good query did not return expected Address hit for ${indexName}`);
    }

    const location = match.location;
    if (!isRecord(location) || typeof location.lat !== "number" || typeof location.lon !== "number") {
      throw new Error(`Known-good query result is missing geo_point location for ${indexName}`);
    }
  }
}

export async function currentAliasIndex(alias: string): Promise<string | null> {
  const response = await getOpenSearchClient().indices.getAlias(
    { name: alias },
    { ignore: [404] },
  );

  if (response.statusCode === 404) {
    return null;
  }

  const body = response.body as Record<string, unknown>;
  const indices = Object.keys(body);
  return indices[0] ?? null;
}
