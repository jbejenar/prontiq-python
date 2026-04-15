# Ingestion Runbook

Phase 1 uses one shared OpenSearch domain. Data rollout is blue/green by versioned index and alias swap, not dev-to-prod promotion.

## Preconditions

- Manifest exists at `manifests/{product}-{version}.json`
- Mappings exists at `data/{product}/{version}/mappings.json`
- Every published data artifact is listed in `manifest.files[]`
- Address Phase 1 manifest `index.source_keys[]` lists exactly one ingestion source: `data/address/{version}/all.ndjson.gz`
- Source object has `ChecksumSHA256` available through `HeadObject`
- Operator can read S3 and write to OpenSearch

## Automated Pipeline

The normal ingestion path is fully automated:

1. Pipeline uploads manifest to `s3://bucket/manifests/{product}-{version}.json`
2. EventBridge fires → PqIngestRouter Lambda reads manifest, extracts product
3. Router starts PqIngest Step Function with execution name `ingest-{product}-{version}`
4. Step Function: ReadManifest → CreateIndex → BulkIngest (Fargate) → HealthCheck → AliasSwap
5. On failure: candidate index deleted, SNS alert published

No operator action required for routine data updates.

## Manual Override (CLI)

For debugging, force-reingest, or dry runs:

```bash
# Dry run (no alias swap, cleanup after)
node dist/manual-run.js \
  --bucket flat-white-address-493712557159-ap-southeast-2-an \
  --manifest-key manifests/address-2026-02-7.json

# Live cutover
node dist/manual-run.js \
  --bucket flat-white-address-493712557159-ap-southeast-2-an \
  --manifest-key manifests/address-2026-02-7.json \
  --apply-alias-swap

# Force reingest (overwrite existing index)
node dist/manual-run.js \
  --bucket flat-white-address-493712557159-ap-southeast-2-an \
  --manifest-key manifests/address-2026-02-7.json \
  --force --apply-alias-swap
```

## Manual Step Function trigger with force

```bash
aws stepfunctions start-execution \
  --state-machine-arn <PqIngest ARN> \
  --name ingest-address-2026-02-7 \
  --input '{"bucket":"flat-white-address-493712557159-ap-southeast-2-an","key":"manifests/address-2026-02-7.json","product":"address","version":"2026-02-7","force":true}'
```

## Rehearsal Sequence

Run these in order before the first live Address cutover:

1. Fixture rehearsal
   - use a small test manifest and fixture gzip NDJSON
   - ingest into a clearly non-live index such as `address-fixture-{timestamp}`
   - do not attach the live alias
2. Full dry run
   - use the real Address manifest
   - create the real candidate index `address-{version}`
   - ingest and health-check it
   - run with alias swap disabled
   - delete the candidate index afterwards unless it is being kept for inspection
3. First live cutover
   - rerun against the real manifest with alias swap enabled

## Live Ingestion Procedure

1. Read and validate the manifest
2. Apply product-specific ingestion policy
3. Verify every inventory file size and checksum, then resolve ingest sources
4. Create candidate index `{product}-{version}`
5. Apply mappings and index settings
6. Bulk ingest only the manifest source key(s)
7. Re-enable refresh and force merge
8. Run health checks against the candidate index directly
9. Atomically move the live alias to the candidate index
10. Confirm the previous live index still exists for rollback

## Post-Cutover Verification

- `GET /_alias/addresses` points at the new index
- `GET /address-{version}/_count` matches `manifest.total_records`
- Known-good query returns expected results:
  - `9 ENDEAVOUR COURT COFFIN BAY SA 5607`
- Reverse-style geo query works against `location`

## Rollback

Rollback is alias reassignment.

1. Identify the previous live index
2. Issue a single `_aliases` request removing the current target and restoring the old target
3. Verify `GET /_alias/addresses`
4. Leave the failed candidate index in place for inspection until cleanup is approved

## Cleanup

- Delete failed rehearsal or failed candidate indices once inspection is complete
- Keep the prior live index according to retention policy
- Do not delete the only index backing a live alias

## Measured Performance (t3.small, Apr 2026)

- Throughput: ~2,500 docs/sec
- 15M docs ingest time: ~100 minutes
- Index size: ~10 GB
- Batch size: 3,000 docs
- Step Function BulkIngest timeout: 4 hours
- Health check refresh: ~seconds; force merge (5 segments): 5-15 minutes on 10GB
- Disk: 20GB gp3 fits one Address index (~10GB). Increase to 50GB before second quarterly ingest (retention = 2 indices).
