# Month-Close Runbook

`PqMonthClose` performs the final previous-month billing sweep for Prontiq.

## Purpose

At `00:30 UTC` on day 1, `PqMonthClose`:

- loads billable hashes from `REGISTRY#active-keys` and `REGISTRY#retired-billing-keys`
- discovers previous-month billable families using the same redirect-chain and usage-driven rules as `PqBillingCron`
- pushes any remaining Stripe meter delta
- marks the current-hash previous-month scope `closed=true`

Once a previous-month scope is closed, the hourly cron stops revisiting it.

## Schedule

- Lambda: `PqMonthClose`
- EventBridge schedule: `cron(30 0 1 * ? *)`
- Alarm: `PqMonthCloseErrors`

## Expected DynamoDB Behavior

For a finalized previous-month scope on the current hash:

- `lastPushedCumulativeCount` equals the total chain-attributed `requestCount`
- `pendingMeterEventIdentifier` is absent
- `pendingMeterTargetCumulativeCount` is absent
- `closed` is `true`

Predecessor rows are never closed by month-close. Only the current-hash scope is closed.

## Manual Invocation

Dev:

```bash
aws lambda invoke \
  --function-name PqMonthClose-dev \
  --payload '{}' \
  /tmp/month-close-dev.json
```

Prod:

```bash
aws lambda invoke \
  --function-name PqMonthClose-prod \
  --payload '{}' \
  /tmp/month-close-prod.json
```

Check:

- CloudWatch Logs for `PqMonthClose`
- Stripe meter-event acceptance
- the current-hash row in `prontiq-usage[-stage]`

## Operator Verification Checklist

1. Seed or identify a previous-month scope with remaining delta.
2. Invoke `PqMonthClose`.
3. Confirm:
   - exactly one Stripe meter event was accepted
   - `lastPushedCumulativeCount` advanced to the full previous-month total
   - `closed=true` on the current-hash row
4. Reinvoke `PqMonthClose`.
5. Confirm:
   - no second Stripe meter event
   - the row remains closed
6. Run or wait for the hourly cron and confirm the closed previous-month scope is skipped.

## Failure Triage

### Alarm firing: `PqMonthCloseErrors`

Check:

1. CloudWatch logs for `PqMonthClose`
2. Whether Stripe accepted a meter event but DynamoDB finalize failed
3. Whether the current-hash row still has a pending identifier
4. Whether the current-hash row was closed before the watermark advanced fully

### Previous-month scope was not billed

Check:

1. The hash still has Stripe linkage (`stripeCustomerId`)
2. The hash is still reachable from either active or retired registry
3. The redirect chain exists in `newHash-redirect-index`
4. The usage row lives under the expected `{product}#{yearMonth}` scope

### Scope was closed incorrectly

Recovery:

1. Remove `closed` from the current-hash previous-month row
2. Confirm `lastPushedCumulativeCount` vs. chain-attributed usage total
3. Reinvoke `PqMonthClose`
4. If Stripe already accepted an incorrect meter event, correct it manually in Stripe

## Notes

- `PqMonthClose` and `PqBillingCron` intentionally share the same pending-marker idempotency model.
- Stripe corrections are still manual. This runbook does not add refund or adjustment automation.
