# P1B.04b Auth/Billing Cutover Runbook

## Scope

This runbook covers the internal-only cutover from the legacy raw-key `ApiKeyTable` model to the v2.2 `prontiq-keys` and `prontiq-usage` tables.

## Preconditions

1. Deploy the branch containing the P1B.04b runtime cutover.
2. Confirm the API Lambda has `KEYS_TABLE_NAME` and `USAGE_TABLE_NAME` set.
3. Confirm the legacy `ApiKeyTable` still exists and remains untouched.
4. Start DynamoDB Local in dev if you need to rehearse the migration end-to-end before prod.

## Dev Rehearsal

1. Export the table names for the target stage.
2. Run `pnpm --filter @prontiq/api migrate:api-keys`.
3. Verify at least one migrated key row in `prontiq-keys`.
4. Verify at least one migrated monthly counter row in `prontiq-usage`.
5. Confirm legacy free-tier keys retained their existing product entitlements after migration rather than being normalized to the new default free plan.
6. If the migration reports any `conflictKeys`, stop and resolve the divergent target rows before proceeding.
7. Run the targeted auth integration tests:
   `node --test packages/api/dist/middleware/auth.integration.test.js packages/api/dist/middleware/redirect-gsi.integration.test.js`
8. Smoke the API with a migrated key and confirm:
   - valid request succeeds
   - free-tier quota reaches zero cleanly
   - growth-tier overage returns `X-RateLimit-Over: true`

## Prod Cutover

1. Deploy the runtime cutover.
2. Run `pnpm --filter @prontiq/api migrate:api-keys` against prod credentials.
3. If the migration exits non-zero or reports `conflictKeys`, stop the cutover and inspect the conflicting rows before serving traffic from the new runtime.
4. Generate and distribute a replacement for the internal legacy seed key if it still uses the `pq_live_prod_` prefix.
5. Verify the replacement key works on `/v1/address/*`.
6. Revoke the old seed key manually after the replacement has been confirmed.
7. Keep `ApiKeyTable` intact for the soak window.

## Verification

1. Confirm a known free-tier key authenticates via the new hash-based path.
2. Confirm a known paid key can exceed quota and emits `X-RateLimit-Over: true`.
3. Confirm the API returns `RATE_LIMITED` for burst exhaustion.
4. Confirm a REDIRECT record resolves to the new key hash exactly once.

## Rollback

1. Redeploy the previous API runtime that still points at `ApiKeyTable`.
2. Restore the old Lambda environment contract if required.
3. Do not delete any data from `prontiq-keys` or `prontiq-usage` during rollback.
4. Investigate the failed cutover while the legacy table remains authoritative.

## Soak Window

- Keep the legacy `ApiKeyTable` for a short operational soak only.
- Do not maintain dual-runtime compatibility after the cutover deploy.
- Delete the legacy table only after the new runtime and migrated keys have been stable for the agreed soak period.
