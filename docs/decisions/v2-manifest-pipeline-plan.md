# Prontiq Platform v2 Manifest Migration + Automated Ingestion Pipeline

## Context

The flat-white pipeline publishes `address-2026-02-7.json` as a v2 manifest where:
- `files[]` = full data-file inventory (state files + all.ndjson.gz)
- `index.source_keys[]` = subset to ingest (just `all.ndjson.gz`)
- `total_records` = sum of records for source_keys entries only (15,015,573)

The platform currently only accepts v1 manifests, has no deployed ingestion infrastructure, and relies on `manual-run.ts`. This migration:
1. Adds v2 manifest support
2. Deploys automated ingestion: S3 manifest upload → Router → Step Function → Lambda/Fargate
3. Full auto including alias swap, product-agnostic routing
4. Keeps manual-run CLI for operator overrides

---

## Audit Corrections (found in final review)

**19 issues found across 4 audit rounds:**

1. **CRITICAL: Version progression check missing from Step Function pipeline.** `assertManifestVersionProgression` is only called in `manual-run.ts` (line 69). None of the Step Function handlers call it. The automated pipeline would happily ingest a stale version and swap the alias backwards. **Fix**: Add the check to `read-manifest.ts` or `create-index.ts`. See A3 below.

2. **read-manifest.ts drops `force` from state.** Returns `{ manifest, bucket }`, losing `force` and `key` from the Step Function input. Subsequent states never see `force`. **Fix**: Change to `return { ...event, manifest }` to preserve all input fields through the pipeline.

3. **Don't pass MANIFEST_JSON as Fargate env var.** Manifest JSON can be 2-3KB+ and env vars have encoding issues (quotes, newlines) and an 8KB total limit. **Fix**: Pass `{ bucket, key, indexName, taskToken }` to Fargate. The task reads the manifest from S3 itself using `readManifestJson`.

4. **Router doesn't need OPENSEARCH_ENDPOINT.** The OpenSearch client in lib.ts is lazy-initialized — only created when `getOpenSearchClient()` is called. The Router only calls `readManifestJson` (S3) and Step Functions APIs.

5. **Catch state uses wrong Lambda.** `PqIngestCleanup` is the 6-hour scheduled retention cleanup. The failure Catch state needs to delete a SPECIFIC candidate index. These are different operations. **Fix**: Add `PqIngestOnFailure` Lambda (new file: `on-failure.ts`) that reads `indexName` from the error state and calls `deleteIndexIfExists`.

6. **Catch state must handle missing indexName.** If ReadManifest fails, `$.indexName` doesn't exist yet. The failure cleanup Lambda must check `if (indexName)` before attempting deletion.

7. **Missing ECS execution role.** Plan only mentions the Fargate task role (app permissions). ECS also needs an execution role for ECR image pull and CloudWatch Logs. **Fix**: Add execution role with `ecr:GetAuthorizationToken`, `ecr:BatchGetImage`, `ecr:GetDownloadUrlForLayer`, `logs:CreateLogStream`, `logs:PutLogEvents`.

8. **S3 `put-bucket-notification-configuration` replaces entire config.** If the flat-white bucket has existing Lambda/SQS/SNS notifications, they'd be wiped. **Fix**: GET current config first, add EventBridge section, then PUT the merged config.

9. **Minor: Fargate task doesn't need `es:ESHttpGet`.** `streamBulkIngest` only does `client.bulk()` (POST). Remove `es:ESHttpGet` from Fargate permissions.

10. **CRITICAL: BulkIngest state needs `ResultPath: "$.bulkResult"`.** Without it, Fargate's `SendTaskSuccess({ output: { ingested, failed } })` REPLACES the entire Step Function state. HealthCheck then receives `{ ingested, failed }` with no `manifest` or `indexName` — it crashes. Every Lambda state works because they return `{ ...event, newFields }`, but the Fargate callback only returns its own output.

11. **CRITICAL: All Catch blocks need `ResultPath: "$.error"`.** Default Catch `ResultPath` is `$` — replaces entire state with the error object. OnFailure would receive `{ Error, Cause }` with no `manifest` or `indexName` — can't compute the index name to delete. Fix: `Catch: [{ ErrorEquals: ["States.ALL"], ResultPath: "$.error", Next: "OnFailure" }]`.

12. **Diagram (B1 line 174) still says PqIngestCleanup.** Should say PqIngestOnFailure.

13. **Router must catch `ExecutionAlreadyExists` and return success.** If it throws, EventBridge retries, hitting the same error 3 times for nothing. Same manifest = already being processed = success.

14. **Router Lambda needs 660s timeout, not 60s.** If it waits up to 10 minutes for a running execution, 60 seconds isn't enough. Set to 660 seconds (11 minutes).

15. **Docker build context mismatch.** CI says `docker build ... packages/ingestion/` but Dockerfile does `COPY . .` from workspace root (needs `packages/shared`, root `node_modules`). Fix: either use esbuild to bundle everything into one standalone file (preferred), or set build context to repo root with `.dockerignore`.

16. **OnFailure should derive indexName from manifest via `indexNameFor()`.** Don't rely on `$.indexName` being in the state — CreateIndex adds it only on success. If CreateIndex partially fails (creates index then throws), indexName isn't in state but the index exists. Compute it from `manifest.product` + `manifest.version`. If no manifest (ReadManifest failed), nothing to clean up.

17. **B1/B3/B10 inconsistency: Step Function input must include `product` AND `version` as top-level fields.** B1 says `{ bucket, key, product, force }`, B3/B10 say `{ bucket, key, force }`. AlertFailure uses `$.product` and `$.version` — if ReadManifest fails, `$.manifest` doesn't exist, so these MUST be top-level. **Fix**: Router passes `{ bucket, key, product, version, force }`. Router already has these from parsing the manifest.

18. **Fargate container overrides should include `AWS_REGION=ap-southeast-2`.** The SigV4 signer has a hardcoded fallback so it works without it, but explicit is better. Lambda sets this automatically; Fargate does not.

19. **OnFailure and AlertFailure have no Catch blocks.** If cleanup or SNS publish fails, execution fails silently — no alert fires. Acceptable for Phase 1 (check Step Function execution history manually). Phase 2: add CloudWatch alarm on failed executions as a backstop.

---

## Part A: V2 Manifest Code Changes

### A1. Shared schema and types

**Files**: `packages/shared/src/validation.ts`, `packages/shared/src/types.ts`, `packages/shared/src/index.ts`

**validation.ts**:
- Add `manifestV2Schema`: same as v1 except `manifest_version: z.literal(2)` and `index` gains `source_keys: z.array(z.string().min(1)).min(1)`
- Add `manifestSchema = z.discriminatedUnion("manifest_version", [manifestV1Schema, manifestV2Schema])`
- Note: `z.discriminatedUnion` requires `ZodObject` members — `.refine()` wraps in `ZodEffects` and breaks it. Cross-validate source_keys against files[] at runtime in `verifyManifestFiles` instead.

**types.ts**:
- Add `ManifestV2` interface (same as ManifestV1 but `manifest_version: 2` and `index.source_keys: string[]`)
- Add `type Manifest = ManifestV1 | ManifestV2`

**index.ts** — export `ManifestV2`, `Manifest`, `manifestV2Schema`, `manifestSchema`

### A2. Update ingestion helpers (`packages/ingestion/src/lib.ts`)

**Import changes**: `manifestV1Schema` → `manifestSchema`, add `Manifest` type.

**`readManifestJson`** (line 212): parse with `manifestSchema`, return `Promise<Manifest>`.

**New helper `getSourceKeys(manifest: Manifest): string[]`**:
- v2: return `manifest.index.source_keys`
- v1: return `manifest.files.map(f => f.key)`
- Concentrates ALL version branching in one place

**Replace `getSourceFile` → `getSourceFiles(manifest: Manifest): ManifestFile[]`**:
- Uses `getSourceKeys()` to get target keys
- Resolves each key to its `ManifestFile` from `manifest.files[]`
- Throws if any source key not found in files[]
- Applies policy checks: `single_file` mode asserts exactly one source file + suffix check
- v1 backward compat preserved (source keys = all files, single_file checks files.length === 1)

**Update `verifyManifestFiles(manifest: Manifest, bucket: string)`**:
- Keep: HEAD every file in `manifest.files[]`, verify size and checksum
- Change record sum: use `getSourceKeys()` to determine which files to sum
  - v1: sum(ALL files.records) === total_records (unchanged)
  - v2: sum(source_keys files.records) === total_records
- Add for v2: validate every source_keys entry exists in files[].key (defense-in-depth)

**Update all other function signatures** (`indexNameFor`, `resolveIndexSettings`, `runKnownGoodQuery`): `ManifestV1` → `Manifest`. No logic changes.

### A3. Update pipeline step handlers

All files: replace `ManifestV1` imports/types/casts with `Manifest`.

**`bulk-ingest.ts`**: Import `getSourceFiles` instead of `getSourceFile`. Loop over source files, accumulate `{ ingested, failed }`. Fail-fast on error. Keep optional `fileKey` override.

**`health-check.ts`**: Type-only change. `count !== manifest.total_records` works for both versions — v2 total_records already equals source_keys record sum.

**`read-manifest.ts`**: Type change + TWO behavioral fixes:
1. Change return to `{ ...event, manifest }` (preserve `force`, `key` through Step Function pipeline)
2. Add `assertManifestVersionProgression` call after manifest validation — this is currently ONLY in manual-run.ts and missing from the automated pipeline. Needs `currentAliasIndex` + `getProductConfig` + the assertion. Respects `event.force` to skip the check.

**`create-index.ts`**, **`alias-swap.ts`**: Type-only changes.

**`manual-run.ts`**: No changes needed — types flow through. Version progression check stays here too (defense-in-depth, different from read-manifest.ts check which runs in the Step Function).

### A4. Full type-signature audit

| # | File | Line | Change |
|---|------|------|--------|
| 1 | `lib.ts` | 4 | import `manifestSchema` instead of `manifestV1Schema` |
| 2 | `lib.ts` | 5 | add `Manifest` to type imports |
| 3 | `lib.ts` | 18 | `IngestionEvent.manifest` → `Manifest` |
| 4 | `lib.ts` | 118 | `indexNameFor` param → `Manifest` |
| 5 | `lib.ts` | 212 | `readManifestJson` return → `Promise<Manifest>` |
| 6 | `lib.ts` | 219 | parse with `manifestSchema` |
| 7 | `lib.ts` | 253 | `getSourceFile` → `getSourceFiles`, param → `Manifest`, return → `ManifestFile[]` |
| 8 | `lib.ts` | 294 | `resolveIndexSettings` param → `Manifest` |
| 9 | `lib.ts` | 306 | `verifyManifestFiles` param → `Manifest` |
| 10 | `lib.ts` | 469 | `runKnownGoodQuery` param → `Manifest` |
| 11 | `bulk-ingest.ts` | 2-3 | import `getSourceFiles`, `Manifest` |
| 12 | `bulk-ingest.ts` | 9 | event type → `Manifest` |
| 13 | `bulk-ingest.ts` | 24 | handler cast → `Manifest` |
| 14 | `health-check.ts` | 2 | import → `Manifest` |
| 15 | `health-check.ts` | 10 | event type → `Manifest` |
| 16 | `health-check.ts` | 31 | handler cast → `Manifest` |
| 17 | `create-index.ts` | 3 | import → `Manifest` |
| 18 | `create-index.ts` | 16 | event type → `Manifest` |
| 19 | `create-index.ts` | 61 | handler cast → `Manifest` |
| 20 | `alias-swap.ts` | 3 | import → `Manifest` |
| 21 | `alias-swap.ts` | 11 | event type → `Manifest` |
| 22 | `alias-swap.ts` | 39 | handler cast → `Manifest` |
| 23 | `read-manifest.ts` | 12 | Change `return { manifest, bucket }` → `return { ...event, manifest }` |
| 24 | `read-manifest.ts` | — | Add `assertManifestVersionProgression` call (import from lib.ts) |
| 25 | `lib.test.ts` | 13 | import → add `Manifest` (keep `ManifestV1` for v1 fixture) |

### A5. Tests (`packages/ingestion/src/lib.test.ts`)

**Keep** existing `makeAddressManifest()` as v1 fixture.

**Add** `makeAddressManifestV2()` fixture: 10+ files in inventory, 1 source key (`all.ndjson.gz`), total_records = 15,015,573 (source key records only).

**New test cases**:
1. `manifestSchema` parses v1 correctly (backward compat)
2. `manifestSchema` parses v2 correctly
3. `manifestSchema` rejects manifest_version: 3
4. `getSourceKeys` returns source_keys for v2, all file keys for v1
5. `getSourceFiles` returns single source file for v2 Address
6. `getSourceFiles` throws if source key references non-existent file
7. `getSourceFiles` enforces single_file policy count on v2
8. v2 record sum validation: sum(source_keys records) == total_records
9. v2 record sum validation: sum(source_keys records) != total_records throws

**Update** existing `getSourceFile` test → `getSourceFiles` (returns array, assert `[0].key`).

---

## Part B: Automated Ingestion Pipeline

### B1. Architecture

```
S3 PutObject (manifests/*.json)
  → EventBridge rule (prefix: manifests/, suffix: .json)
    → PqIngestRouter (Lambda)
        — reads manifest JSON from S3 (lightweight: just parse, no file verification)
        — extracts product, validates against PRODUCT_REGISTRY
        — concurrency gate: ListExecutions(RUNNING), filter for ingest-{product}-*
          — if running: wait with 30s backoff, abort after 10 minutes
        — starts PqIngest Step Function
          — execution name: ingest-{product}-{version} (unique, idempotent)
          — input: { bucket, key, product, version, force: false }
      → PqIngest (Step Function)
          → PqIngestReadManifest    (Lambda)   — full validation + file integrity
          → PqIngestCreateIndex     (Lambda)   — create versioned OpenSearch index
          → PqIngestBulk            (Fargate)  — stream NDJSON → OpenSearch bulk API
          → PqIngestHealthCheck     (Lambda)   — doc count + known-good query + force-merge
          → PqIngestAliasSwap       (Lambda)   — alias swap + API Gateway cache flush
          → [Catch: PqIngestOnFailure (derive indexName from manifest, delete if exists) + SNS alert]
```

**Why a Router Lambda in front of the Step Function:**
- The manifest content is authoritative (ARCHITECTURE.MD) — can't derive product from filename
- The product must be known BEFORE starting the Step Function to set the execution name `ingest-{product}-{version}`
- Concurrency control (ListExecutions) belongs here, not inside the Step Function — reject duplicates BEFORE burning time on validation
- EventBridge can't read S3 objects or do conditional logic — it needs a Lambda target

**Why `ingest-{product}-{version}` as execution name (not `ingest-{product}`):**
- Step Functions execution names must be unique within the state machine for 90 days
- `ingest-address` would fail on the second Address release
- `ingest-address-2026-02-7` is unique per release AND gives natural idempotency: uploading the same manifest twice → same execution name → `ExecutionAlreadyExists` → safe no-op

**Why Fargate for bulk ingest:**
- 15M docs at 10K/batch ≈ 25-125 minutes. Lambda caps at 15 minutes.
- gzip source can't be seeked, ruling out Step Function loop patterns
- Fargate has no timeout, runs the same Node.js code
- OpenSearch endpoint is public (no VPC needed for Fargate)
- Quarterly runs = ~$0.02 per execution. Negligible cost.

**Why EventBridge** (not direct S3 notification): Decoupled, filterable, supports multiple targets, consistent with ARCHITECTURE.MD Phase 2 design. One rule, all products, forever.

### B2. SST component naming (`Pq` prefix convention)

| Resource | SST Component Name | Generated AWS Name |
|---|---|---|
| Router Lambda | `PqIngestRouter` | `prontiq-{stage}-PqIngestRouter-{hash}` |
| Step Function | `PqIngest` | `prontiq-{stage}-PqIngest-{hash}` |
| Read Manifest Lambda | `PqIngestReadManifest` | `prontiq-{stage}-PqIngestReadManifest-{hash}` |
| Create Index Lambda | `PqIngestCreateIndex` | `prontiq-{stage}-PqIngestCreateIndex-{hash}` |
| Bulk Ingest ECS Cluster | `PqIngestCluster` | `prontiq-{stage}-PqIngestCluster-{hash}` |
| Bulk Ingest Fargate Task | `PqIngestBulk` | `prontiq-{stage}-PqIngestBulk-{hash}` |
| Bulk Ingest ECR Repo | `PqIngestBulkRepo` | `prontiq-{stage}-PqIngestBulkRepo-{hash}` |
| Health Check Lambda | `PqIngestHealthCheck` | `prontiq-{stage}-PqIngestHealthCheck-{hash}` |
| Alias Swap Lambda | `PqIngestAliasSwap` | `prontiq-{stage}-PqIngestAliasSwap-{hash}` |
| Cleanup Lambda (scheduled) | `PqIngestCleanup` | `prontiq-{stage}-PqIngestCleanup-{hash}` |
| Failure Cleanup Lambda | `PqIngestOnFailure` | `prontiq-{stage}-PqIngestOnFailure-{hash}` |
| EventBridge Rule | `PqIngestTrigger` | `prontiq-{stage}-PqIngestTrigger-{hash}` |
| SNS Topic | `PqIngestAlerts` | `prontiq-{stage}-PqIngestAlerts-{hash}` |

### B3. Router Lambda (`packages/ingestion/src/router.ts` — NEW FILE)

```ts
// EventBridge delivers: { detail: { bucket: { name }, object: { key } } }
// Router:
// 1. Read manifest JSON from S3 (readManifestJson — already exists)
// 2. Extract product, version from parsed manifest
// 3. Validate product against PRODUCT_REGISTRY
// 4. ListExecutions(RUNNING) on PqIngest — filter for ingest-{product}-*
//    If running: poll every 30s, abort after 10 min
// 5. StartExecution on PqIngest:
//    executionName: `ingest-${product}-${version}`
//    input: { bucket, key, product, version, force: false }
```

Environment variables needed: `STATE_MACHINE_ARN` (no OPENSEARCH_ENDPOINT — Router never touches OpenSearch; the client in lib.ts is lazy-initialized)
Timeout: **660 seconds (11 minutes)** — must accommodate 10-minute concurrency wait
Permissions: `s3:GetObject` on data bucket, `states:StartExecution` + `states:ListExecutions` on PqIngest

**Edge cases the Router must handle:**
- `ExecutionAlreadyExists` from StartExecution → return success (manifest already being processed, don't let EventBridge retry)
- Concurrency wait exceeds 10 min → throw error (EventBridge retries with backoff)
- Unknown product in manifest → throw error with descriptive message

### B4. Fargate bulk ingest implementation details

**New file: `packages/ingestion/src/fargate-bulk-ingest.ts`**

Entry point for the Fargate task. NOT a Lambda handler — a standalone Node.js process:
```ts
// Reads coordinates from environment variables (set via Step Function container overrides):
//   BUCKET, MANIFEST_KEY, INDEX_NAME, TASK_TOKEN, OPENSEARCH_ENDPOINT
// Reads manifest from S3 using readManifestJson(bucket, manifestKey)
//   (do NOT pass manifest JSON as env var — encoding issues, 8KB limit)
// Calls getSourceFiles(manifest) and loops over streamBulkIngest()
// On success: calls SFN SendTaskSuccess with { ingested, failed }
// On failure: calls SFN SendTaskFailure with error details
// Exit code 0 on success, 1 on failure
```

**Step Function → Fargate integration pattern: Task Token**

The Step Function's bulk-ingest state uses `arn:aws:states:::ecs:runTask.waitForTaskToken`:
- Passes a `$$.Task.Token` to the Fargate task via container override environment variable `TASK_TOKEN`
- The Fargate task calls `SendTaskSuccess({ taskToken, output: { ingested, failed } })` on completion
- The Fargate task calls `SendTaskFailure({ taskToken, error, cause })` on failure
- The Step Function blocks until the callback arrives — no polling, no timeout workaround

This is the standard pattern for long-running ECS tasks in Step Functions. It allows the Fargate task to return structured result data (ingested/failed counts) back into the Step Function state.

**Dockerfile** (`packages/ingestion/Dockerfile` — NEW FILE):
```dockerfile
FROM node:20-slim AS builder
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile && pnpm --filter @prontiq/ingestion build

FROM node:20-slim
WORKDIR /app
COPY --from=builder /app/packages/ingestion/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
ENV NODE_ENV=production
CMD ["node", "dist/fargate-bulk-ingest.js"]
```

Note: The exact Dockerfile depends on how the workspace dependencies resolve. May need esbuild bundling to create a standalone file (same approach SST uses for Lambda handlers). Investigate during implementation.

**ECR Repository**: Created via Pulumi `aws.ecr.Repository` in sst.config.ts. Docker image built and pushed during `pnpm deploy:dev` (via Pulumi's `docker.Image` resource or a build script).

**Fargate task definition**:
- `cpu: "1024"` (1 vCPU), `memory: "2048"` (2GB)
- Fargate ALWAYS requires VPC subnets. Use default VPC public subnets in ap-southeast-2 with `assignPublicIp: "ENABLED"` so the task can reach the public OpenSearch endpoint and S3
- Task role: `s3:GetObject` on data bucket, `es:ESHttpPost` on flat-white domain, `states:SendTaskSuccess` + `states:SendTaskFailure`
- Execution role: ECR pull permissions + CloudWatch Logs (see B9 for full list)

### B5. Step Function state machine definition

```
{
  StartAt: "ReadManifest",
  States: {
    ReadManifest: {
      Type: "Task",
      Resource: PqIngestReadManifest.arn,
      Next: "CreateIndex",
      Catch: [{ ErrorEquals: ["States.ALL"], ResultPath: "$.error", Next: "OnFailure" }]
    },
    CreateIndex: {
      Type: "Task",
      Resource: PqIngestCreateIndex.arn,
      Next: "BulkIngest",
      Catch: [{ ErrorEquals: ["States.ALL"], ResultPath: "$.error", Next: "OnFailure" }]
    },
    BulkIngest: {
      Type: "Task",
      Resource: "arn:aws:states:::ecs:runTask.waitForTaskToken",
      Parameters: {
        Cluster: PqIngestCluster.arn,
        TaskDefinition: PqIngestBulk.arn,
        LaunchType: "FARGATE",
        NetworkConfiguration: {
          AwsvpcConfiguration: {
            Subnets: [...],     // default VPC public subnets
            AssignPublicIp: "ENABLED"
          }
        },
        Overrides: {
          ContainerOverrides: [{
            Name: "bulk-ingest",
            Environment: [
              { Name: "BUCKET", "Value.$": "$.bucket" },
              { Name: "MANIFEST_KEY", "Value.$": "$.key" },
              { Name: "INDEX_NAME", "Value.$": "$.indexName" },
              { Name: "TASK_TOKEN", "Value.$": "$$.Task.Token" },
              { Name: "OPENSEARCH_ENDPOINT", Value: OPENSEARCH_ENDPOINT_DEFAULT },
              { Name: "AWS_REGION", Value: "ap-southeast-2" }
            ]
          }]
        }
      },
      ResultPath: "$.bulkResult",  // CRITICAL: merge result, don't replace state
      Next: "HealthCheck",
      Catch: [{ ErrorEquals: ["States.ALL"], ResultPath: "$.error", Next: "OnFailure" }],
      TimeoutSeconds: 7200  // 2 hours max for bulk ingest
    },
    HealthCheck: {
      Type: "Task",
      Resource: PqIngestHealthCheck.arn,
      Next: "AliasSwap",
      Catch: [{ ErrorEquals: ["States.ALL"], ResultPath: "$.error", Next: "OnFailure" }]
    },
    AliasSwap: {
      Type: "Task",
      Resource: PqIngestAliasSwap.arn,
      Next: "Success",
      Catch: [{ ErrorEquals: ["States.ALL"], ResultPath: "$.error", Next: "OnFailure" }]
    },
    Success: { Type: "Succeed" },
    OnFailure: {
      Type: "Task",
      Resource: PqIngestOnFailure.arn,  // NOT PqIngestCleanup (that's the 6-hour scheduled cleanup)
      // State preserved via ResultPath: "$.error" on Catch blocks
      // Derives indexName from $.manifest via indexNameFor() — do NOT rely on $.indexName
      //   (CreateIndex only adds indexName on success; partial failure = index exists but no $.indexName)
      // If no $.manifest (ReadManifest failed): nothing to clean up, just pass through to alert
      Next: "AlertFailure"
    },
    AlertFailure: {
      Type: "Task",
      Resource: "arn:aws:states:::sns:publish",
      Parameters: {
        TopicArn: PqIngestAlerts.arn,
        Message.$: "States.Format('Ingestion failed for {}/{}', $.product, $.version)"
      },
      Next: "Fail"
    },
    Fail: { Type: "Fail" }
  }
}
```

### B6. Alias swap: add API Gateway cache flush

**File**: `packages/ingestion/src/alias-swap.ts`

After successful alias swap, flush the API Gateway cache:
```ts
// After updateAliases succeeds:
import { APIGatewayClient, FlushStageCacheCommand } from "@aws-sdk/client-api-gateway";
// Flush cache for the product's routes
// Requires API_GATEWAY_REST_API_ID and STAGE_NAME environment variables
// Requires apigateway:FlushStageCache IAM permission
```

Note: The current API uses API Gateway V2 (HTTP API), which does NOT have built-in response caching. API Gateway V1 (REST API) has caching. Check whether caching is actually enabled before adding this. If using CloudFront caching instead, invalidate the CloudFront distribution. If no caching is configured yet, skip this step and add it when caching is enabled.

### B7. Scheduled cleanup Lambda

**File**: `packages/ingestion/src/cleanup.ts` (stub exists)

Deploy as `PqIngestCleanup` on 6-hour EventBridge schedule:
- For each product in PRODUCT_REGISTRY:
  - List all `{product}-*` indices via `GET /_cat/indices/{product}-*`
  - Identify which index the alias currently points to
  - Delete indices older than `retention_hours` (from product config)
  - Never delete the only index for a product
- Verify latest automated snapshot < 48 hours old, alert via SNS if stale

### B8. EventBridge rule

```json
{
  "source": ["aws.s3"],
  "detail-type": ["Object Created"],
  "detail": {
    "bucket": { "name": ["flat-white-address-493712557159-ap-southeast-2-an"] },
    "object": { "key": [{ "prefix": "manifests/" }, { "suffix": ".json" }] }
  }
}
```

Target: `PqIngestRouter` Lambda (NOT the Step Function directly).

**Prerequisite**: S3 Event Notifications to EventBridge must be enabled on the flat-white bucket. **WARNING**: `put-bucket-notification-configuration` REPLACES the entire config. If existing Lambda/SQS/SNS notifications exist, they'd be wiped. Safe approach:
```bash
# 1. GET current config
aws s3api get-bucket-notification-configuration \
  --bucket flat-white-address-493712557159-ap-southeast-2-an > current-notif.json

# 2. Add EventBridgeConfiguration to existing config (merge, don't replace)
# 3. PUT merged config
aws s3api put-bucket-notification-configuration \
  --bucket flat-white-address-493712557159-ap-southeast-2-an \
  --notification-configuration file://merged-notif.json
```

### B9. IAM permissions summary

| Principal | Permissions |
|---|---|
| PqIngestRouter | `s3:GetObject` on data bucket, `states:StartExecution` + `states:ListExecutions` on PqIngest |
| PqIngestReadManifest | `s3:GetObject` + `s3:HeadObject` on data bucket, `es:ESHttpGet` on `flat-white/*` (for currentAliasIndex in version progression check) |
| PqIngestCreateIndex | `s3:GetObject` on data bucket, `es:ESHttpPut` + `es:ESHttpGet` + `es:ESHttpHead` + `es:ESHttpDelete` on `flat-white/*` |
| PqIngestBulk (Fargate task role) | `s3:GetObject` on data bucket, `es:ESHttpPost` on `flat-white/*`, `states:SendTaskSuccess` + `states:SendTaskFailure` on PqIngest |
| PqIngestBulk (ECS execution role) | `ecr:GetAuthorizationToken` + `ecr:BatchGetImage` + `ecr:GetDownloadUrlForLayer` on PqIngestBulkRepo, `logs:CreateLogStream` + `logs:PutLogEvents` |
| PqIngestOnFailure | `es:ESHttpGet` + `es:ESHttpHead` + `es:ESHttpDelete` on `flat-white/*` |
| PqIngestHealthCheck | `es:ESHttpGet` + `es:ESHttpPost` + `es:ESHttpPut` on `flat-white/*` |
| PqIngestAliasSwap | `es:ESHttpPost` + `es:ESHttpGet` on `flat-white/*`, `apigateway:*` on PqApi (if caching enabled) |
| PqIngestCleanup | `es:ESHttpGet` + `es:ESHttpDelete` on `flat-white/*`, `sns:Publish` on PqIngestAlerts |
| Step Function role | `lambda:InvokeFunction` on all ingestion Lambdas, `ecs:RunTask` on PqIngestBulk, `iam:PassRole` on Fargate roles, `sns:Publish` on PqIngestAlerts |
| EventBridge rule | `lambda:InvokeFunction` on PqIngestRouter |

### B10. `force` parameter flow

- **EventBridge-triggered (normal)**: Router passes `{ bucket, key, product, version, force: false }` to Step Function
- **Manual re-ingestion**: `aws stepfunctions start-execution --name ingest-address-2026-02-7 --input '{"bucket":"...","key":"...","force":true}'` (bypasses router, starts Step Function directly)
- **manual-run.ts**: Still works with `--force` flag for local operator use

### B11. Deferred to Phase 2 (in ARCHITECTURE.MD but NOT in scope)

- NDJSON content sampling (first 500 records, validate field types against mappings)
- Doc count tolerance (±0.1% — current exact match is fine)
- P95 latency check on sample queries
- Schema spot-check (random doc field validation)
- Parallel Map state for multi-file bulk ingest

---

## Part C: Docs Updates

- **ARCHITECTURE.MD**: v2 manifest semantics, Router + Step Function pipeline, Fargate for bulk ingest, update section 5.1.2 for v2 contract
- **ROADMAP.md**: Update P1E.01/P1E.03/P1E.04 wording from "single-file files[]" to "source_keys"
- **docs/operations/ingestion-runbook.md**: automated pipeline, manual-run for overrides, how to manually trigger with `force`

---

## Part D: Verification

### Local checks
```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

### Post-implementation grep
```bash
grep -r "ManifestV1" packages/ingestion/src/  # only in test fixture + v1 schema
```

### Deploy to dev
```bash
pnpm deploy:dev  # creates all new AWS resources
```

### Pre-deploy checklist
- [ ] Enable S3 EventBridge notifications on flat-white bucket
- [ ] Docker image builds and pushes to ECR
- [ ] SNS subscription (your email) on PqIngestAlerts

### End-to-end test
1. Upload v2 manifest to `s3://flat-white-address-.../manifests/address-2026-02-7.json`
2. Verify EventBridge → Router → Step Function starts with name `ingest-address-2026-02-7`
3. Verify full pipeline: manifest validated → index created → bulk ingest (Fargate) → health check → alias swapped
4. Verify `addresses` alias points to `address-2026-02-7`
5. Query the API to confirm data is live
6. Upload same manifest again → Router returns `ExecutionAlreadyExists` → idempotent

### Idempotency test
- Same manifest uploaded twice → same execution name → Step Functions rejects → safe no-op

### Concurrency test
- Upload two different product manifests simultaneously → both pipelines run in parallel (independent products)
- Upload two versions of same product manifest → router detects running execution → waits/rejects

### Manual-run still works
```bash
node dist/manual-run.js \
  --bucket flat-white-address-493712557159-ap-southeast-2-an \
  --manifest-key manifests/address-2026-02-7.json \
  --apply-alias-swap
```

---

## Implementation Order

### Step 0: Commit existing work + branch hygiene
- We're on `docs-ingestion-plan` (same commit as main, 12 modified + 3 untracked files)
- Commit the existing ingestion code (lib.ts, manual-run.ts, step handlers, tests, etc.) on this branch
- Layer all v2 + infrastructure changes on top
- PR to main when CI passes

### Step 1: CI/CD fixes (unblock everything else)
- **Uncomment `pnpm test`** in `.github/workflows/ci.yml`
- **Add Docker build/push step** to ci.yml deploy-dev job:
  - `aws-actions/amazon-ecr-login` after AWS credentials
  - `docker build -t $ECR_REPO:$COMMIT_SHA packages/ingestion/`
  - `docker push $ECR_REPO:$COMMIT_SHA`
  - SST references the image tag in the Fargate task definition
- **Update IAM deploy role** (`prontiq-platform-deploy-role`) with new permissions:
  - `ecs:*`, `ecr:*` (Fargate + ECR)
  - `states:*` (Step Functions)
  - `events:*` (EventBridge rules)
  - `sns:*` (alerts topic)
  - `iam:CreateRole`, `iam:PassRole` (ECS task/execution roles)
  - `logs:*` (CloudWatch log groups for Fargate)

### Step 2: Part A — v2 manifest code changes + tests (validate locally)

### Step 3: Part B.1-B4 — Router, Fargate entry point, on-failure handler, Dockerfile (new code)

### Step 4: Part B.5-B10 — sst.config.ts infrastructure (depends on all handler code)

### Step 5: Part C — docs

### Step 6: Part D — deploy + verify (PR to main, CI runs, deploy-dev fires on merge)

---

## Risk Analysis

| Risk | Mitigation |
|------|------------|
| v1 manifest regression | Discriminated union parses both; v1 test fixture preserved |
| source_keys references non-existent file | Runtime validation in verifyManifestFiles |
| Fargate cold start | Acceptable for quarterly runs (~30-60s startup) |
| Fargate Docker build complexity | esbuild bundle into standalone file, minimal Dockerfile |
| EventBridge not enabled on external bucket | Deployment checklist item; one-time `put-bucket-notification-configuration` |
| Concurrent ingestion of same product | Router checks ListExecutions(RUNNING) before starting |
| Duplicate manifest upload | Execution name `ingest-{product}-{version}` → `ExecutionAlreadyExists` → safe |
| Bulk ingest partial failure | Fail-fast + Catch state deletes candidate index + SNS alert |
| API Gateway cache serves stale data | Cache flush after alias swap (if caching is enabled) |
| Fargate task hangs forever | Step Function TimeoutSeconds: 7200 (2 hours) on BulkIngest state |
| Router Lambda fails | EventBridge built-in retry (2 retries with backoff) |

## New Files

| File | Purpose |
|------|---------|
| `packages/ingestion/src/router.ts` | EventBridge → read manifest → concurrency check → start Step Function |
| `packages/ingestion/src/fargate-bulk-ingest.ts` | Standalone Node.js entry point for Fargate bulk ingest with Task Token |
| `packages/ingestion/src/on-failure.ts` | Step Function Catch handler — delete candidate index if it exists |
| `packages/ingestion/Dockerfile` | Container image for Fargate bulk ingest |

## Modified Files

| File | Nature of change |
|------|-----------------|
| `packages/shared/src/validation.ts` | Add manifestV2Schema, manifestSchema |
| `packages/shared/src/types.ts` | Add ManifestV2, Manifest |
| `packages/shared/src/index.ts` | Export new types and schemas |
| `packages/ingestion/src/lib.ts` | getSourceKeys, getSourceFiles, verifyManifestFiles v2 path, all type signatures |
| `packages/ingestion/src/bulk-ingest.ts` | Loop over source files, type update |
| `packages/ingestion/src/health-check.ts` | Type update only |
| `packages/ingestion/src/create-index.ts` | Type update only |
| `packages/ingestion/src/alias-swap.ts` | Type update + API Gateway cache flush (if applicable) |
| `packages/ingestion/src/read-manifest.ts` | Return `{...event, manifest}` to preserve `force`/`key` + add version progression check |
| `packages/ingestion/src/cleanup.ts` | Implement scheduled cleanup (stub exists) |
| `packages/ingestion/src/manual-run.ts` | No code changes needed (types flow through) |
| `packages/ingestion/src/lib.test.ts` | v2 fixture, new tests, getSourceFile→getSourceFiles |
| `packages/ingestion/package.json` | Add `@aws-sdk/client-sfn` dependency (for router + Fargate task token) |
| `.github/workflows/ci.yml` | Uncomment pnpm test, add Docker build/push for ECR |
| `sst.config.ts` | All infrastructure: Router, Lambdas, ECS, Fargate, Step Function, EventBridge, SNS |
| `ARCHITECTURE.MD` | v2 manifest + automated pipeline architecture |
| `ROADMAP.md` | P1E wording updates |
| `docs/operations/ingestion-runbook.md` | Automated pipeline + manual override docs |
