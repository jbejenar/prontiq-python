# Lago Webhook Reconciliation Runbook

Operator guidance for reconciling Lago commercial state back into Prontiq
enforcement state.

## Purpose

In the target commercial architecture:

- Lago owns subscription and billing truth
- Prontiq owns request-time enforcement counters
- webhook reconciliation keeps those two views aligned without putting Lago on
  the hot path

## Scope

This runbook is for `POST /webhooks/lago`. It does not replace the current
legacy Stripe webhook while the migration is in progress.

## Preconditions

- GitHub Environment secret `LAGO_WEBHOOK_HMAC_SECRET` exists for the target
  stage.
- GitHub Environment variable `LAGO_WEBHOOK_RECONCILIATION_ENABLED` is set
  deliberately. Keep it `false` until the Lago endpoint is ready to retry
  503 responses during rollout.
- GitHub Environment variable `COUNTER_PERIOD_SOURCE` is `calendar` until
  webhook reconciliation has populated billing-period fields for the target
  environment.
- Lago webhook endpoint is configured with `signature_algo = hmac`, not JWT.
- Lago plans use codes that exactly match Prontiq tiers, currently `free` and
  `payg` for the forward commercial surface.
- Lago customers use `external_id = customerId`.
- Lago subscriptions use `external_id = pq_sub_<same ulid as customerId>`.

## Expected behavior

1. Lago emits a consumed commercial-state event.
2. `POST /webhooks/lago` verifies `X-Lago-Signature-Algorithm=hmac`,
   `X-Lago-Signature`, and `X-Lago-Unique-Key`.
3. The handler claims `X-Lago-Unique-Key` in `prontiq-lago-webhook-events`.
4. The platform resolves `customerId`, fetches the current Lago subscription,
   and updates denormalized local state in `prontiq-keys`.
5. Only Lago `active` subscriptions grant paid/local plan entitlements.
   `subscription.terminated`, `terminated`, `canceled`, and `pending` snapshots
   downgrade local entitlements to Free even if Lago still returns the historical
   paid `plan_code`.
6. Prior Lago-period `prontiq-usage` rows are marked `closed=true` when a new
   billing period key appears or when local entitlements are downgraded and the
   billing-period key is cleared.
7. Replayed completed/ignored events return 200 without additional mutation.

## Consumed Events

- `subscription.started`
- `subscription.terminated`
- `invoice.created`
- `invoice.payment_overdue`
- `invoice.payment_status_updated`

All other Lago webhook types are ignored after ledger claim and return 200.

## Customer resolution

1. Read the Lago webhook customer `external_id`.
2. Treat that value as Prontiq `customerId`.
3. Resolve the customer through `prontiq-customers.customerId-index`.
4. If no row exists, or more than one row matches, fail closed and alert for
   operator reconciliation.
5. If Lago's provider-owned `lago_id` differs from cached `lagoCustomerId`, do
   not silently rewrite the mapping; mark the row `migration_conflict` unless
   the operator confirms a legitimate provider-side migration.

Stripe customer IDs are migration/payment-rail linkage only and are not used to
resolve Lago webhooks.

## Rollout

1. Deploy code with `LAGO_WEBHOOK_RECONCILIATION_ENABLED=false`.
2. Configure `LAGO_WEBHOOK_HMAC_SECRET` in the GitHub Environment.
3. Redeploy and confirm `/webhooks/lago` returns 400 for unsigned requests.
4. In Lago, create the webhook endpoint using HMAC and subscribe only to the
   consumed events above.
5. Set `LAGO_WEBHOOK_RECONCILIATION_ENABLED=true` and redeploy.
6. Send or replay one low-risk test event from the repo-owned test Lago org.
7. Verify `prontiq-lago-webhook-events.status = completed`.
8. Verify matching `prontiq-keys` org/key rows have Lago plan, subscription,
   and billing-period fields.
9. Only after several successful reconciliations, consider
   `COUNTER_PERIOD_SOURCE=lago`.

Do not configure the Lago endpoint while the flag is false unless you are
intentionally testing Lago retries.

## Drift Handling

- Missing customer external id: fix Lago customer/subscription external ids,
  then replay.
- Unknown plan code: rename/fix Lago plan code or add a deliberate platform tier
  in a separate ticket, then replay. Inactive subscriptions do not need a known
  paid plan code to downgrade locally.
- Unknown Lago subscription status: confirm the status in Lago docs and add an
  explicit entitlement rule before replaying; unknown statuses fail closed.
- Same unique key with different payload hash: treat as provider/operator drift;
  do not manually edit the ledger unless the original payload has been reviewed.
- Subscription external id mismatch: fix Lago subscription external id to
  `pq_sub_<customer ulid>`, then replay.
- `processing` for longer than the Lambda timeout plus the safety buffer means
  the prior invocation likely crashed or timed out; replay/retry can atomically
  reclaim that row, while a fresh `processing` row should be left for the active
  worker to finish.
- `drift` and `failed_retryable` are retryable evidence states. Fix the upstream
  configuration or dependency issue first, then replay the same Lago delivery.

## Rollback

- Set `LAGO_WEBHOOK_RECONCILIATION_ENABLED=false` and redeploy. Valid signed
  Lago deliveries will return 503 and Lago will retry.
- If the API is accidentally using Lago periods too early, set
  `COUNTER_PERIOD_SOURCE=calendar` and redeploy. Existing Lago-period rows remain
  evidence and do not affect calendar-scope enforcement.
- Do not delete `prontiq-lago-webhook-events` rows during rollback; they are the
  replay audit trail.

## Verification

- confirm the Lago event resolves to exactly one Prontiq `customerId`
- confirm the resolved row has `lagoExternalCustomerId = customerId`
- confirm billing-state updates are idempotent on replay
- confirm counters and plan metadata converge to the intended state
- confirm no request-path dependency on direct Lago availability
- confirm `PAYG` has `quotaPerProduct = null` and remains uncapped but tracked
- confirm hard-capped Free still returns `429 QUOTA_EXCEEDED` at limit
