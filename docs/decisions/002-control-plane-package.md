# ADR-002: Add `@prontiq/control-plane` package and recover prior provisioning design

## Status

Accepted

## Context

P1B.05 (Clerk webhook handler) needs an `provisionOrg(orgId, ownerEmail, …)` service that:

- Reads ORG envelope idempotency
- Creates a Stripe customer with deterministic `Idempotency-Key`
- Atomically writes ORG envelope + audit row via `TransactWriteItems`
- Re-reads the envelope after partial failures to distinguish "concurrent provisioner won" from "real fatal failure"
- Sends a best-effort welcome email via SES

P1B.07 separately needs a reusable `writeAudit()` helper that:

- Generates a monotonic sort key (`{iso8601}#{ulid}`)
- Sets a 365-day TTL
- Conditionally writes (`attribute_not_exists`) so retries don't double-count

Both services need the AWS SDK DynamoDB clients (`@aws-sdk/client-dynamodb` + `@aws-sdk/lib-dynamodb`) and `stripe`. Two callers consume the provisioning service: the Clerk webhook handler (Lambda inside `@prontiq/webhooks`) and the user-driven `POST /v1/account/setup` endpoint (Lambda inside `@prontiq/api`, via P1B.05 PR 3).

Forces:

- **`@prontiq/shared` is dep-light by design.** It is consumed by every other workspace package and ships into hot-path Lambdas. Adding the AWS SDK and Stripe to it would expand the bundle of every consumer, including the address-API Lambda that has no business knowing about Stripe.
- **`api → webhooks` is an awkward dependency direction.** Webhooks is a Lambda package, not a library. Making `@prontiq/api` import a subpath from `@prontiq/webhooks` couples a customer-facing surface to a webhook-handler implementation detail.
- **Prior design intent already existed.** A previous (uncommitted) session had built a near-complete provisioning service in `packages/control-plane/dist/`. The compiled output (290 LOC) implemented every DoD branch correctly, including the `isCompleteOrgEnvelope` partial-write guard and the post-failure re-read inside the retry loop. Throwing that away to rewrite from scratch would risk regressing on edge cases the original author had already solved.

## Decision

Create a dedicated `@prontiq/control-plane` workspace package as the home for provisioning + audit logic. Recover the prior design from the uncommitted `dist/` into typed `src/` rather than rewriting from scratch. Three hardenings during recovery:

1. Replace `randomUUID()` audit eventId with `monotonicFactory()` from `ulid` so same-millisecond writes preserve time-ordered sort keys.
2. Construct the Stripe client with `new Stripe(key, { maxNetworkRetries: 3 })` — the SDK retries network blips in seconds rather than letting them bounce to Svix redelivery (hours).
3. Distinguish `StripeInvalidRequestError` / `StripeCardError` (4xx → fatal, retry won't help) from `StripeAPIError` / `StripeConnectionError` (5xx/network → retryable). The prior dist treated all Stripe exceptions as retryable.

Audit API is dual:

- `buildAuditTransactItem(input)` returns a `TransactWriteItem` shape — used by callers (P1B.05 provisioning, future rotation/revoke flows) that need the audit row in the SAME transaction as a state mutation. Atomicity guarantee.
- `writeAudit(input)` wraps the same item in a standalone `PutCommand` — used by callers (P1B.10 billing cron) that don't need transactional grouping with another write.

`OrgEnvelopeRecord` + `AuditRecord` types live in `@prontiq/shared` (no SDK deps required for the type definitions themselves).

## Consequences

**Positive:**

- `@prontiq/shared` stays dep-light; address-API Lambda doesn't pay the AWS SDK + Stripe bundle cost.
- Both Clerk webhook (P1B.05 PR 2) and `/v1/account/setup` (P1B.05 PR 3) consume the same provisioning code path — easier to audit "is this fix applied to both flows?".
- Recovered design preserves the partial-write guard (`isCompleteOrgEnvelope`) and the post-failure re-read pattern. P1B.05's "never return 200 unless ORG envelope confirmed present" invariant is enforced by construction.
- Future control-plane work (P1B.10 billing cron, P1C.03 key rotation) has a natural home and can reuse the audit helpers.

**Negative:**

- One more workspace package to maintain. Mitigated by the fact that the package is small and tightly scoped (provisioning + audit only).
- The prior `dist/` artefacts on disk briefly conflict with the new `src/` build output. Resolved by normal `pnpm build` overwriting `dist/` and `dist/` being gitignored.

## Hardening contracts (added during PR #94 review)

The first review pass surfaced two correctness contracts the recovered design did not enforce. Both are now codified in the package's public API and protected by explicit regression tests.

### 1. `provisionOrg` is exception-free at the public surface

The state machine has three ORG-envelope reads (preflight, post-commit confirmation, reconciliation). Each can fail transiently (throttling, network blip) or fatally (table missing, IAM lapse). Letting raw SDK exceptions escape would turn recoverable provisioning outcomes into uncaught 500s — and worse, after a Stripe customer was already created, the caller would lose the `stripeCustomerId` context needed for safe redelivery.

`readOrgEnvelope` returns a discriminated union the compiler forces every call site to exhaust:

```ts
type EnvelopeReadResult =
  | { kind: "found"; record: OrgEnvelopeRecord }
  | { kind: "missing" }
  | { kind: "transient_failure"; error: Error }
  | { kind: "fatal_failure"; error: Error };
```

All three call sites in `provisionOrg` `switch` on `kind`, preserve `stripeCustomerId` through any post-Stripe failure path, and return a typed `ProvisioningResult` rather than throw. The `Bug 4: provisionOrg never throws` regression test exercises every failure mode and asserts the contract.

### 2. `writeAudit` is idempotent when the caller supplies a deterministic `eventId` + `now`

The original audit row used `SK = {iso_now}#{ulid()}`. Both components were generated per call, so a retried `writeAudit` always inserted a duplicate row — the conditional write trivially succeeded against a fresh primary key. Standalone callers (P1B.10 billing cron, P1C.03 rotation flows) would inflate audit history on any retry-after-timeout.

`BuildAuditInput` now accepts an optional `eventId` paired with the existing optional `now`. When the caller supplies the upstream event's identifier (Svix `svix-id` for Clerk, Stripe `evt_...` for Stripe, deterministic key for cron) and the upstream event's timestamp, retries hit the same primary key and the conditional write rejects the duplicate. `writeAudit` returns `WriteAuditResult { written: boolean }` so the caller can distinguish a fresh write from a successful idempotent retry — `ConditionalCheckFailedException` is caught and translated, never re-thrown, while genuine SDK errors still escape.

The provisioning path is unaffected: its audit row is bundled into the same `TransactWriteItems` as the ORG envelope, and the envelope's `attribute_not_exists(apiKeyHash)` is the actual idempotency gate. The dual API (`buildAuditTransactItem` for atomic grouping, `writeAudit` for standalone) makes this explicit at the call site.

### 3. Welcome email is best-effort *at the boundary*, not just inside the default sender

The `EmailSender` interface (`(input: EmailInput) => Promise<boolean>`) is public, and injected implementations (custom SES adapter, third-party provider, in-process queue) are not contractually required to be exception-free. The default `getDefaultEmailSender` already wraps SigV4 in try/catch and returns `false` on error — but that's a property of one implementation, not the interface.

`provisionOrg` invokes the email sender only after the ORG envelope is durably committed and strongly confirmed. At that point the org *is* provisioned, full stop. A throw from the email path here would turn a durable success into an uncaught 500, the caller would observe failure for a successful provisioning, and only the next Svix retry's preflight read would self-recover via the `already_exists` path — but the initial response would still be wrong.

The `sendWelcomeEmailSafely` boundary helper guards every call to `dependencies.sendWelcomeEmail`: any throw (asynchronous rejection or synchronous error) is logged with org context and translated to `emailSent: false`. The strengthened invariant: **`provisionOrg` cannot throw after a successful `TransactWriteItems` commit, no matter what an injected dependency does.**

Two regression tests pin this contract: a rejecting `Promise<boolean>` sender and a synchronously-throwing sender. Both verify `provisionOrg` returns `{ status: "created", emailSent: false }` with the envelope and `stripeCustomerId` intact.

### 4. Unified DynamoDB error classifier with safe-default for ambiguous post-Stripe writes

The original code had two separate transient-error classifiers — one for reads (recognised `TimeoutError`) and one for writes (didn't). That asymmetry meant a `TransactWriteItems` timeout after Stripe customer creation was silently classified as `fatal_failure`, even though a timeout is the canonical *ambiguous* outcome (the write may have committed; the response was lost) and a retry is provably safe via the deterministic Stripe idempotency-key + the envelope's `attribute_not_exists`.

Replaced with a single `classifyDdbError(error): "transient" | "fatal" | "ambiguous"` returning a discriminated outcome. Three signals feed it, in order:

1. **Provably-fatal name allowlist** (`ValidationException`, `ResourceNotFoundException`, `AccessDeniedException`, `UnrecognizedClientException`, `InvalidSignatureException`, `MissingAuthenticationTokenException`) → fatal.
2. **Transient name allowlist** covering throttling (`ProvisionedThroughputExceededException`, `ThrottlingException`, `RequestLimitExceeded`, `RequestThrottledException`), service availability (`InternalServerError`, `InternalFailure`, `ServiceUnavailable`), AND **transport-layer** signals (`TimeoutError`, `AbortError`, `NetworkingError`) → transient.
3. **Smithy `$retryable` trait** (set by AWS SDK v3 on errors the SDK considered retryable) → transient.

For `TransactionCanceledException`, the classifier walks `CancellationReasons[]` first: any provably-fatal reason wins; otherwise transient reasons → transient; otherwise (all `ConditionalCheckFailed` / `None`) → ambiguous (the post-failure reconciliation read decides).

`provisionOrg` adopts a **safe-default-on-ambiguity** policy specifically for post-Stripe write failures. The asymmetric cost analysis:

| Misclassification | Cost |
|---|---|
| transient → fatal | Operator alarm fires + user-visible failure for an org that *was* successfully provisioned. User signs up again, gets `already_exists` on retry preflight, but the initial UX says "your signup failed" — the worst surface for first-impression. |
| fatal → transient | Svix retries for ~5 days then DLQ alarm fires. Same operator visibility, just delayed. User experience is unaffected (Svix retry happens server-side). |

The first cost is much worse, so post-Stripe ambiguous errors retry rather than fail. The reads share the same classifier (read failures default to transient too — no side-effect has occurred yet, retry is unconditionally safe).

### 5. Webhook secrets flow through GitHub Environment, NOT `sst.Secret()` (with `$util.secret()` for Pulumi state encryption)

PR #95 (the first version of the Clerk webhook handler) introduced `sst.Secret("ClerkWebhookSecret")` and friends for the three required secret values. That conflicted with the codebase's existing convention: secrets / config flow GitHub Environment secret/var → workflow `env:` block → `process.env.X` at SST-config evaluation time → baked into the Lambda env. Same pattern as the pre-existing `WELCOME_EMAIL_FROM` / `STRIPE_SECRET_KEY` / `PRONTIQ_ACCOUNT_URL` config that was already wired through the deploy workflows.

The two patterns can't coexist for one value: GitHub Environment lands in `process.env`, but `sst.Secret` expects SSM. Result: `SecretMissingError` despite the operator having set `CLERK_WEBHOOK_SECRET` and `STRIPE_SECRET_KEY` in the GitHub Environment. PR #97 ripped out the `sst.Secret` declarations, switched to `process.env.X` reads matching the existing convention, and added two further hardenings surfaced during PR #97's review:

1. **`$util.secret()` (Pulumi `secret()`) wrapping** for the values when passed to the Function `environment` block. Without this wrapper, plain string inputs to Pulumi `environment` get serialised as plaintext in deployment state, previews, diffs, and any stack outputs that reference them — visible to anyone with read access to the SST/Pulumi state backend (private S3 bucket, IAM-restricted to the deploy role + account root). The original `sst.Secret` had this property because it produced `Output<string>` with the secret-typed marker; switching to plain `process.env` would have dropped it without the wrapper. With `$util.secret()`: encrypted in state, redacted from previews/diffs, and secret-typed end-to-end. Lambda still receives them as standard env vars (KMS-encrypted at rest by AWS), so handler code is unchanged.

2. **Whitespace-trim before validation AND wiring** via a `readGithubSecret(name)` helper in `sst.config.ts`. GitHub Actions resolves an unset `${{ secrets.X }}` to `""`, which is rejected by the validation guard. But a copy-paste artefact like a trailing newline (`"sk_test_abc\n"`) or a whitespace-only paste (`"   "`) would otherwise pass a `length === 0` check and ship an invalid secret to the Lambda — recreating the silent-deploy-broken-runtime failure mode. The helper trims once at the boundary; both the validation guard and the env-block use it, so normalisation is consistent across the two paths.

A `REQUIRED_WEBHOOK_SECRETS` fail-fast guard at the top of `sst.config.ts` enforces that all three (`CLERK_WEBHOOK_SECRET`, `CLERK_SECRET_KEY`, `STRIPE_SECRET_KEY`) are non-empty after trimming for `dev` / `prod` stages — `sst deploy` fails with a clear error pointing at the GitHub Environment instead of shipping a Lambda that returns 500 on every request. Personal stages (`jbejenar` etc.) skip the guard so `sst dev` works locally without all secrets configured.

Operator-facing rule (also in `docs/runbooks/clerk-webhook.md` § preconditions and `AGENTS.md` § Do NOT): **never use `sst secret set` for these values**. The single source of truth is the GitHub Environment.

## Alternatives Considered

1. **Put `provisionOrg` and `writeAudit` in `@prontiq/shared`.** Rejected: pollutes the dep-light shared package with the AWS SDK + Stripe.
2. **Put both in `@prontiq/webhooks`; have `@prontiq/api` import subpaths.** Rejected: creates an awkward `api → webhooks` dep direction. Webhooks is a Lambda package, not a library.
3. **Inline the provisioning logic in `packages/webhooks/src/clerk.ts` and again in `packages/api/src/routes/account.ts`.** Rejected: violates the P1B.05 DoD assertion that "both the webhook handler AND `/setup` endpoint import from the same shared service" (`grep -rn "provisionOrg" packages/` should show exactly one implementation).
4. **Rewrite the provisioning service from scratch instead of recovering the dist.** Rejected: the prior author already solved the partial-write race and the post-failure re-read; rewriting risks regressing on those subtle invariants.

---

_Date: 2026-04-17_
_Decision makers: @jbejenar (engineering)_
