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

1. **SES sender posture healthy** for `prontiq.dev` in `ap-southeast-2`. The welcome email path now uses the shared suppression-aware SES helper and the stage-specific SES configuration set for this stack. Domain verification / DKIM / sandbox status should be managed via `docs/runbooks/ses-suppression.md`.
2. **SES recipients may still be skipped intentionally.** `emailSent: false` no longer means only "SES is not configured"; it can also mean the recipient is currently suppressed because of an SES bounce or complaint record. Provisioning durability is unaffected in all of those cases.
3. **GitHub Environment secrets set per environment** (Settings → Environments → `dev` / `prod` → Environment secrets) — ALL THREE are required by the webhook Lambda. CLERK_SECRET_KEY is no longer PR-3-only; the handler resolves the verified primary email via the Clerk Backend API.
   - `CLERK_WEBHOOK_SECRET` — Svix signing secret. Clerk dashboard → Webhooks → endpoint detail → Signing Secret. Format: `whsec_...`.
   - `CLERK_SECRET_KEY` — Clerk Backend API key. Clerk dashboard → API Keys → Backend (Secret Keys). Format: `sk_test_...` for dev, `sk_live_...` for prod.
   - `STRIPE_SECRET_KEY` — Stripe restricted key. Format: `sk_test_...` for dev, `sk_live_...` for prod.

   The values flow: GitHub Environment secret → workflow `env:` block → `process.env.X` at SST-config time → baked into the Lambda's environment variable. The handler reads `process.env.CLERK_WEBHOOK_SECRET` etc. at runtime.

   `sst.config.ts` enforces these at deploy time for the `dev` and `prod` stages:
   - **Trims** leading/trailing whitespace before validation so a copy-paste artefact like a trailing newline doesn't slip through (whitespace-only values fail the same as truly-unset).
   - **Fails fast** with a clear error pointing at the GitHub Environment if any required value is empty after trimming, rather than shipping a Lambda that returns 500 on every request.
   - **Encrypts at rest** in Pulumi state via `$util.secret()` — values are redacted from previews, diffs, and stack outputs. Lambda still receives them as standard env vars (KMS-encrypted at rest by AWS).

   Personal stages (e.g. `jbejenar`) skip the validation guard so `sst dev` works locally without all secrets configured.

   **Do NOT use `sst secret set`** for these — the codebase's convention is GitHub Environment vars/secrets exported via the deploy workflow. `sst.Secret` (SSM-backed) was tried in an earlier iteration of this PR and conflicted with the env-var pattern.
4. **Clerk dashboard configured**: `organizationMembership.created` event subscribed; signing secret matches the GitHub Environment value.
5. **Optional — `CLERK_ADMIN_ROLES` GitHub Environment variable** (NOT a secret): Defaults to `"org:admin,admin"`. Override only if your Clerk app uses custom organization roles for the creator. Comma-separated list, e.g. `owner,principal`. Same end-to-end configuration path as the secrets above (Settings → Environments → `dev` / `prod` → Variables).

   **Applies to BOTH Lambdas** — the webhook gates on the Svix-signed `data.role` field, and the account-setup endpoint's `clerkAdminOnly()` middleware gates on the JWT `org_role` claim. Both call the same `getAdminRoles()` helper from `@prontiq/control-plane`, which reads this env var. `sst.config.ts` wires the same value into both Lambdas via the shared `controlPlaneEnv()` helper, so a divergence between the two ingress paths is impossible by construction.

   To verify the deployed value reached BOTH Lambdas:

   ```bash
   for fn in PqClerkWebhook PqAccount; do
     echo "=== $fn ==="
     aws lambda get-function-configuration \
       --function-name $(aws lambda list-functions --region ap-southeast-2 \
         --query "Functions[?contains(FunctionName, \`prontiq-<stage>-${fn}\`)].FunctionName" \
         --output text) \
       --query 'Environment.Variables.CLERK_ADMIN_ROLES'
   done
   ```

   Both should print the same value (or both empty for the default).
6. **User email requirement**: This handler requires the org creator's Clerk user to have a verified primary email address. Phone-only / OAuth-only users without a primary email return 500 `fatal_failure` with `reason: "user_has_no_primary_email"`. Operator fix is to add a primary email in the Clerk dashboard, then "Resend" the failed message.

## Healthy delivery (golden path)

1. Clerk fires `organizationMembership.created` with `data.role === "admin"` (org creator).
2. Handler verifies Svix signature, extracts `orgId / userId / ownerEmail`, calls `provisionOrg`.
3. Service creates a Stripe customer (idempotency-keyed `clerk-provision-{orgId}`) and TransactWriteItems the ORG envelope + audit row.
4. Strong-read confirmation, optional best-effort suppression-aware SES welcome email, response: `200 { ok: true, status: "created", emailSent: true|false }`.
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
- Wrong `CLERK_WEBHOOK_SECRET` in the GitHub Environment vs the Clerk dashboard's signing secret.
- Clock skew > 5 min between Clerk and AWS (Svix's tolerance).
- Body mutation by a proxy / CDN before the Lambda receives it.

Recovery:
1. **Verify the deployed Lambda's env value matches Clerk:**
   ```sh
   # Show the value baked into the deployed Lambda (not the GitHub Environment secret directly — GitHub doesn't expose secret values back):
   FUNC=$(aws lambda list-functions --region ap-southeast-2 \
     --query 'Functions[?contains(FunctionName, `prontiq-<stage>-PqClerkWebhook`)].FunctionName' \
     --output text)
   aws lambda get-function-configuration --function-name "$FUNC" \
     --query 'Environment.Variables.CLERK_WEBHOOK_SECRET' --output text
   ```
   Compare against the Clerk dashboard → Webhooks → endpoint detail → Signing Secret (click "Reveal").
2. **If values differ**: update the GitHub Environment secret (Settings → Environments → `<stage>` → Environment secrets → `CLERK_WEBHOOK_SECRET` → "Update secret"), then redeploy:
   - For `dev`: push any commit to `main`, OR re-run the most recent CI workflow's `deploy-dev` job (`gh run rerun <run-id> --failed`)
   - For `prod`: trigger the "Deploy to Production" workflow (`gh workflow run deploy-prod.yml`)
3. **Check Lambda time vs UTC** if values match: `aws logs tail "/aws/lambda/$FUNC" --follow --region ap-southeast-2` and look at log timestamps for clock-skew evidence.

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

Rare case where Clerk's webhook delivery system loses the event entirely. The user signs in to `/account` and sees no envelope. **Recovery: `POST /v1/account/setup`** — Clerk-JWT-authenticated, runs the same `createProvisioningService().provisionOrg(...)` code path as this webhook. Same idempotency invariant: a delayed webhook + a recovery call collapse to one envelope, one Stripe customer, one audit row.

**Operator preconditions** (BOTH dev and prod tenants — these are not caught by the `REQUIRED_WEBHOOK_SECRETS` deploy guard because they're Clerk-dashboard config, not env vars):

1. **Clerk session token JWT template must include BOTH `org_id` AND `org_role`.** Clerk Dashboard → Sessions → Customize session token → add `{ "org_id": "{{org.id}}", "org_role": "{{org.role}}" }` to the template. Missing `org_id` → `400 NO_ACTIVE_ORG`. Missing `org_role` → `400 NO_ROLE_CLAIM`.
2. **Frontend must call `setActive({ organization })`** before invoking `/v1/account/setup`. Even with the JWT template above, `org_id` and `org_role` are only populated when the session has an active organization.

**Authorization mirrors the webhook's role gate.** The endpoint is admin-only. `org_role` must be in `getAdminRoles()` (defaults to `org:admin` + `admin`; operator-overridable via the `CLERK_ADMIN_ROLES` env var on the `PqAccount` Lambda — same env var the webhook uses). Non-admin callers receive `403 INSUFFICIENT_ROLE` with the role surfaced in `details.role`. This prevents an invited org member from racing a delayed webhook and becoming the recorded `ownerEmail` / Stripe customer for the org.

**Failure modes mirror this webhook's** (`primary_email_unverified`, `user_has_no_primary_email`, `clerk_api_lookup_failed`) — same operator-facing fixes apply (verify primary email in Clerk, add a primary email, retry). Distinct from the webhook: a transient Clerk Backend API failure surfaces as `503 RETRYABLE_FAILURE` (sync HTTP) rather than 500 (which would trigger Svix redelivery in the webhook flow).

**JWT-verifier-side failure modes** (introduced after PR #101 review #3 — Bug 4):

- **`401 INVALID_TOKEN`** — caller fault. Token expired, tampered, signature mismatch, or otherwise bad. Surfaced with `details.reason` carrying the Clerk `TokenVerificationErrorReason` (e.g., `token-expired`, `token-invalid-signature`). User-facing fix: sign in again.
- **`503 VERIFIER_UNAVAILABLE`** — upstream / network outage. Clerk's JWKS endpoint or Backend API was unreachable, returned 5xx, or rate-limited us. Surfaced with `details.reason` (e.g., `remote-jwk-failed-to-load`, `clerk_api_503`, `clerk_api_429`, `network_error`) and an optional `details.retryAfter` (seconds). The token may be perfectly valid — the dashboard should retry the same request rather than prompt re-auth. **Triggers `PqAccountErrors`** so sustained Clerk outages alarm operators.
- **`500 INTERNAL_ERROR`** — operator config bug or unknown error. Includes missing `CLERK_SECRET_KEY` env, malformed secret key (Clerk rejects with `invalid-secret-key`), or unrecognised exception class. Triggers `PqAccountErrors`.

The classifier lives in `packages/api/src/middleware/clerk-jwt.ts` (`classifyVerifierError`); the unit-test matrix pins each branch.

**CloudWatch logs**: `/aws/lambda/prontiq-<stage>-PqAccountFunction-<rand>` — search by `request_id` (returned in the `X-Request-Id` response header and the error envelope's `request_id` field).

**CloudWatch alarm**: `PqAccountErrors` — fires on > 5 ApiGateway 5xx responses / 15min on the `ANY /v1/account/{proxy+}` route. **Catches both** unhandled Lambda exceptions (which propagate to API Gateway as 5xx) AND handler-returned 500/503 envelopes (`RETRYABLE_FAILURE`, `FATAL_FAILURE`). Wired to the same `PqIngestAlerts` SNS topic as `PqClerkWebhookErrors`.

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
| Error alarm | `PqClerkWebhookErrors` (region `ap-southeast-2`). Tracks `AWS/ApiGateway 5xx` on the `POST /webhooks/clerk` route (covers both unhandled Lambda exceptions AND handler-returned 500s). |
| Alarm SNS topic | `PqIngestAlerts` (reused for control-plane alerting until P1F.02 lands) |

## Tear-down (only if the entire webhook surface is being replaced)

1. Disable the endpoint in the Clerk dashboard (do NOT delete — keeps the audit history of past deliveries).
2. Remove the `api.route("POST /webhooks/clerk", ...)` line + `clerkWebhookFn` declaration + alarm from `sst.config.ts`.
3. Deploy. SST will delete the Lambda, the route, and the alarm. The DDB tables and SNS topic remain (used by other consumers).
4. Optionally remove the GitHub Environment secrets (`CLERK_WEBHOOK_SECRET`, `CLERK_SECRET_KEY`, `STRIPE_SECRET_KEY`, and `vars.CLERK_ADMIN_ROLES`) for the corresponding environment once you're sure no other code reads them: Settings → Environments → `<stage>` → Environment secrets / Variables → "Remove secret".
