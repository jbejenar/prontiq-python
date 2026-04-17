# Clerk Webhook Operator Runbook (P1B.05)

## Scope

Operating, debugging, and recovering the `POST /webhooks/clerk` endpoint that consumes Clerk's `organizationMembership.created` events and provisions the ORG envelope (Stripe customer + DDB record + audit row + best-effort welcome email). Per ARCHITECTURE.MD §5.7.1, this handler does NOT mint API keys — that's the user-driven `POST /v1/account/keys/create` (P1C.03).

## Endpoint

| Stage | URL |
|---|---|
| dev (`dev` SST stage) | `https://59jym47ia1.execute-api.ap-southeast-2.amazonaws.com/webhooks/clerk` |
| prod | `https://api.prontiq.dev/webhooks/clerk` |

The Clerk dashboard's webhook configuration points at the dev URL today. The prod URL must be configured separately on the production Clerk application.

## Preconditions (one-time per stage)

1. **SES domain identity verified** for `prontiq.dev` in `ap-southeast-2`. Add the DKIM CNAME records emitted by `aws ses verify-domain-identity --domain prontiq.dev` to Vercel DNS. Welcome emails fail silently (logged; `emailSent: false` in the response) until verified — provisioning durability is unaffected.
2. **SES sandbox removal** requested via AWS support case for `ap-southeast-2`. While in sandbox, only verified email addresses can receive welcome emails.
3. **SST secrets set per stage** — ALL THREE are now required by the webhook Lambda (CLERK_SECRET_KEY is no longer PR-3-only — the handler resolves the verified primary email via Clerk Backend API):
   ```sh
   sst secret set ClerkWebhookSecret <svix-signing-secret>   --stage <stage>
   sst secret set ClerkSecretKey     <clerk-backend-sk-key>  --stage <stage>
   sst secret set StripeSecretKey    <sk_test_or_live>       --stage <stage>
   ```
   The Lambda crashes with `CLERK_WEBHOOK_SECRET is required` (or the equivalent for the other two) at init if any value is unset. **Set BEFORE merging the PR that wires the consumers** (CI auto-deploys to dev on merge).
4. **Clerk dashboard configured**: `organizationMembership.created` event subscribed; signing secret matches the value set above.
5. **Optional — `CLERK_ADMIN_ROLES` env var**: Defaults to `"org:admin,admin"`. Override only if your Clerk app uses custom organization roles for the creator. Comma-separated list, e.g. `owner,principal`.

   **End-to-end configuration path** (so the override actually reaches the deployed Lambda):

   ```
   GitHub Environment vars (Settings → Environments → dev/prod → Variables → CLERK_ADMIN_ROLES)
     → deploy-{dev,prod}.yml exports as env: CLERK_ADMIN_ROLES
       → sst.config.ts reads process.env.CLERK_ADMIN_ROLES at deploy time
         → bakes into PqClerkWebhook Lambda env var
           → handler reads process.env.CLERK_ADMIN_ROLES at runtime
   ```

   To override: set the GitHub variable in the appropriate environment, then trigger a redeploy. No code change required.

   To verify the deployed value: `aws lambda get-function-configuration --function-name prontiq-<stage>-PqClerkWebhookFunction --query 'Environment.Variables.CLERK_ADMIN_ROLES'`.
6. **User email requirement**: This handler requires the org creator's Clerk user to have a verified primary email address. Phone-only / OAuth-only users without a primary email return 500 `fatal_failure` with `reason: "user_has_no_primary_email"`. Operator fix is to add a primary email in the Clerk dashboard, then "Resend" the failed message.

## Healthy delivery (golden path)

1. Clerk fires `organizationMembership.created` with `data.role === "admin"` (org creator).
2. Handler verifies Svix signature, extracts `orgId / userId / ownerEmail`, calls `provisionOrg`.
3. Service creates a Stripe customer (idempotency-keyed `clerk-provision-{orgId}`) and TransactWriteItems the ORG envelope + audit row.
4. Strong-read confirmation, optional best-effort SES welcome email, response: `200 { ok: true, status: "created", emailSent: true|false }`.
5. CloudWatch log: `ORG envelope created`. Stripe Dashboard shows the customer with `metadata.orgId`. DDB `prontiq-keys` has `ORG#{orgId}`. DDB `prontiq-audit` has the `ORG_PROVISIONED` row.

## Healthy redelivery (Svix retry)

The handler is idempotent at every layer:

- Preflight read finds the existing envelope → `200 { ok: true, status: "already_exists" }`. Zero side effects.
- Stripe `Idempotency-Key` returns the cached customer (24h window).
- Envelope `attribute_not_exists(apiKeyHash)` rejects duplicate writes.
- Audit row's conditional write rejects duplicate inserts.

Log: `ORG envelope exists`.

## Non-admin membership (invite flow)

When a user accepts an invite (not the org creator), Clerk fires `organizationMembership.created` with `data.role !== "admin"`. The handler returns `200 { skipped: true, reason: "non_admin_membership", role: "..." }` and does no work. This is correct — the invitee is a user under an existing org, not a new org to provision.

## Failure modes

### 401 invalid signature

Causes:
- Wrong `CLERK_WEBHOOK_SECRET` set in SST secrets vs the Clerk dashboard's signing secret.
- Clock skew > 5 min between Clerk and AWS (Svix's tolerance).
- Body mutation by a proxy / CDN before the Lambda receives it.

Recovery:
1. Compare `sst secret list --stage <stage>` against the value visible in the Clerk dashboard ("Reveal" button on the endpoint).
2. Check Lambda time vs UTC: `aws logs tail /aws/lambda/prontiq-<stage>-PqClerkWebhookFunction-<rand> --follow` and look at log timestamps.
3. Re-set the secret with `sst secret set` and redeploy if the value drifted.

### 5xx after Stripe customer creation (retryable_failure)

Logged as `ORG envelope provisioning retryable failure`. The Stripe customer was created (or reused via idempotency-key). The DDB write hit a transient error (throughput, throttling, network).

Svix retry schedule (default): 5s, 5min, 30min, 2h, 5h, 10h, 16h, 24h, 48h. The next retry should succeed.

If the alarm `PqClerkWebhookErrors` fires (>5 errors in 15min), check:
- DDB ProvisionedThroughputExceededException on `prontiq-keys` or `prontiq-audit` (tables are PAY_PER_REQUEST so this should be rare; if it happens, AWS hot-partition behaviour is the cause).
- Lambda IAM lapse — verify the deploy role's IAM policy hasn't drifted.

### 5xx fatal_failure with `reason: "user_has_no_primary_email"`

The org creator's Clerk user has no primary email at all (phone-first / OAuth-only signup, or operator deleted the email post-signup). The handler refuses to proceed because:
- Stripe `customers.create` requires `email` for receipts and dunning.
- The welcome email path can't run without a target.

Recovery: add a primary email to the user in the Clerk dashboard (Users → user detail → Email addresses → Add → set as primary), then "Resend" the failed message from the webhook endpoint detail.

### 5xx fatal_failure with `reason: "primary_email_unverified"`

The user has a primary email set, but it hasn't completed verification (`status: unverified | failed | expired | transferable | null`). The handler refuses to proceed because forwarding an unverified email to Stripe would create a customer record against a typoed or unconfirmed address, and SES would silently bounce.

**No fallback policy:** even if the user has another verified email, the handler does NOT fall back. The primary is the user's explicit identity choice, and falling back would make Stripe customer email unpredictable from the operator's view.

Recovery options (the `verificationStatus` from CloudWatch logs tells you which case applies):
- `unverified`: ask the user to complete email verification (Clerk usually sends a link automatically; user clicks to confirm)
- `failed` / `expired`: trigger a fresh verification from the Clerk dashboard or have the user request a new link
- `transferable`: the user is mid-signup; usually self-heals when they finish

After the primary is verified, click "Resend" on the failed message in the Clerk dashboard.

### 5xx fatal_failure (other)

Logged as `ORG envelope provisioning fatal failure` with classification `fatal`. Causes:
- Stripe `StripeInvalidRequestError` (e.g. malformed email — won't fix on retry).
- DDB `ValidationException` (item too large, bad shape — code bug).
- DDB `ResourceNotFoundException` (table missing — schema drift, IAM problem).

Svix still redelivers, but a real fatal will exhaust retries. Then:
1. Capture the failing message from the Clerk dashboard (the `svix-id`).
2. Check CloudWatch Logs for the corresponding `request_id`.
3. Fix the underlying issue (code, IAM, schema).
4. From the Clerk dashboard, click "Resend" on the failed message.

### Manual recovery — webhook never arrived

Rare case where Clerk's webhook delivery system loses the event entirely. The user signs in to `/account` and sees no envelope. The recovery endpoint `POST /v1/account/setup` (PR 3 of P1B.05) runs the same `provisionOrg` service, authenticated via Clerk JWT. Same code path; user-driven instead of webhook-driven.

## Replaying a delivery (Clerk dashboard)

1. Navigate to the Clerk dashboard → Webhooks → endpoint detail.
2. Find the message in "Message attempts" (filter by status `Failed`).
3. Click the message → "Resend" button.
4. Confirm in the new attempt's response that the handler returned 200.
5. Verify the envelope exists in DDB: `aws dynamodb get-item --table-name prontiq-<stage> --key '{"apiKeyHash":{"S":"ORG#<orgId>"}}'`.

## CloudWatch references

| Resource | Path |
|---|---|
| Handler logs | `/aws/lambda/prontiq-<stage>-PqClerkWebhookFunction-<rand>` |
| Error alarm | `PqClerkWebhookErrors` (region `ap-southeast-2`) |
| Alarm SNS topic | `PqIngestAlerts` (reused for control-plane alerting until P1F.02 lands) |

## Tear-down (only if the entire webhook surface is being replaced)

1. Disable the endpoint in the Clerk dashboard (do NOT delete — keeps the audit history of past deliveries).
2. Remove the `api.route("POST /webhooks/clerk", ...)` line + `clerkWebhookFn` declaration + alarm from `sst.config.ts`.
3. Deploy. SST will delete the Lambda, the route, and the alarm. The DDB tables and SNS topic remain (used by other consumers).
4. Optionally `sst secret remove ClerkWebhookSecret --stage <stage>` once you're sure no other code reads it.
