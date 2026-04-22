# SES Suppression Runbook

Operating, verifying, and manually recovering the SES bounce / complaint suppression flow used by welcome emails, quota emails, and legacy Stripe `past_due` billing emails.

## Scope

Implemented in P1B.08:

- stage-specific SES configuration sets
- SNS delivery of SES `BOUNCE` and `COMPLAINT` events
- `PqSesFeedback` Lambda subscriber
- suppression-aware SES send helper used by:
  - Clerk welcome email
  - Stripe `past_due` billing email
  - quota 80% / 100% emails
- async quota email worker `PqQuotaEmailWorker`

## Current Configuration

One SES service/account/region is shared across stages in `ap-southeast-2`.

What differs by stage:

- Lambda environments
- DynamoDB table names
- SES configuration set name

What is shared:

- SES sender domain identity: `prontiq.dev`

Ownership model:

- the `prod` SST stack owns the SES domain identity resource
- each stage owns its own SES configuration set and SNS feedback destination
- DNS is managed manually in Vercel, not by SST

Configuration-set naming:

- `prod`: `prontiq-transactional`
- non-prod: `prontiq-transactional-<stage>`

Current rollout state as of 2026-04-19:

- `prontiq.dev` is verified in SES in `ap-southeast-2`
- DKIM status is `SUCCESS`
- SES simulator positive-send, bounce, and complaint flows have been exercised in both `dev` and `prod`
- both `PqQuotaEmailWorker` roles now include the SES configuration-set ARN in `ses:SendEmail` / `ses:SendRawEmail` permissions
- the AWS SES account is still in sandbox, so simulator validation is complete but normal-recipient delivery is still blocked until production access is enabled

## DNS Records

Because DNS is hosted in Vercel, SST creates the SES identity with `dns: false` and does not write DNS automatically.

After the prod stack creates the SES identity, fetch the records with:

```bash
aws sesv2 get-email-identity --email-identity prontiq.dev --region ap-southeast-2
```

Add the returned verification / DKIM records in Vercel DNS.

Expected record classes:

- SES domain verification TXT
- DKIM CNAME records
- SPF TXT if not already present
- DMARC TXT if not already present

## Tables and Records

Suppression state lives in `prontiq-ses-suppressions` / `prontiq-ses-suppressions-<stage>`.

Record shape:

- `email`
- `reason`
  - `hard_bounce`
  - `soft_bounce`
  - `complaint`
- `bounceCount`
- `softBounceWindowStartedAt`
- `lastEventAt`
- `ttl`

Semantics:

- hard bounce: immediate suppression, TTL 90 days
- soft bounce: suppress on the third bounce inside a 30-day window, TTL 90 days once suppressed
- complaint: permanent suppression, no TTL

Reason precedence:

- `complaint` overrides everything
- `hard_bounce` overrides `soft_bounce`
- weaker events never downgrade a stronger suppression state

## Quota Emails

`PqQuotaEmailWorker` sends quota emails asynchronously after the API hot path records usage.

Thresholds:

- `80%` warning email
- `100%` limit / overage email

Important behavior:

- worker target email is `ORG#{orgId}.ownerEmail`
- state is tracked per usage row (`{product}#{yearMonth}`)
- `warningEmailPendingAt` and `limitEmailPendingAt` are short worker leases, not durable sent markers
- a suppressed email address still finalizes the send state as skipped, so the worker does not retry forever

## Verification

### AWS-side checks

1. Confirm the stage configuration set exists.
2. Confirm bounce and complaint events publish to the SES feedback SNS topic.
3. Confirm `PqSesFeedback` has recent successful invocations.
4. Confirm `PqQuotaEmailWorker` is invoked by the API Lambda when thresholds are crossed.
5. Confirm the SES account is out of sandbox before treating normal-recipient delivery as production-ready.

### DynamoDB checks

Example suppression lookup:

```bash
aws dynamodb get-item \
  --table-name prontiq-ses-suppressions-<stage> \
  --key '{"email":{"S":"user@example.com"}}'
```

### SES simulator guidance

Use SES simulator addresses in non-prod to validate feedback handling:

- hard bounce simulator
- complaint simulator
- success simulator

After sending, confirm:

- SNS delivery occurred
- `PqSesFeedback` ran successfully
- the suppression row matches the expected reason/TTL
- for positive-send quota tests, `warningEmailSent` / `limitEmailSent` finalizes on the usage row

### Verified live checks (2026-04-19)

The following were exercised live after deploy:

- direct SES simulator sends accepted in `dev` and `prod`
- bounce simulator wrote `hard_bounce` rows in `prontiq-ses-suppressions-dev` and `prontiq-ses-suppressions`
- complaint simulator wrote `complaint` rows in both stages
- `PqQuotaEmailWorker` finalized a positive-send warning email in `dev`
- `PqQuotaEmailWorker` finalized a positive-send limit email in `prod`

## Failure Triage

### Welcome email skipped

Likely causes:

- recipient suppressed in `prontiq-ses-suppressions`
- SES sender rejected request
- SES domain or production-access issue

Provisioning durability is unaffected.

### `past_due` email skipped

This is best-effort by design. Billing state must still reconcile even if email is suppressed or SES rejects the send.

### Quota email not sent

Check:

1. usage row crossed threshold after the last increment
2. `warningEmailSent` / `limitEmailSent`
3. `warningEmailPendingAt` / `limitEmailPendingAt`
4. `ORG#{orgId}.ownerEmail`
5. suppression row for the owner email
6. `PqQuotaEmailWorkerErrors`

## Manual Unsuppression

There is no UI for this in Phase 1.

Operator recovery is a DynamoDB delete for bounce-based suppressions once the address is known good again.

Do not remove complaint suppressions casually.

Example:

```bash
aws dynamodb delete-item \
  --table-name prontiq-ses-suppressions-<stage> \
  --key '{"email":{"S":"user@example.com"}}'
```

## Alarms

- `PqSesFeedbackErrors`
- `PqQuotaEmailWorkerErrors`

These page via the shared `PqIngestAlerts` Phase 1 alert path. See `docs/runbooks/monitoring-alerting.md`.
