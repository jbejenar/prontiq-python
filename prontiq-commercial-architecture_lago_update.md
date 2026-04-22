# Prontiq Commercial Layer Architecture

> Absorbed into `ARCHITECTURE.MD` on 2026-04-22.
>
> This file is retained for git history only and is **not canonical**.
> Use `ARCHITECTURE.MD` as the source of truth for the target commercial
> architecture.
>
> Sample plan names, tiers, and prices below are historical planning examples
> only and may conflict with the current business direction.

## Governing Principle

Prontiq's commercial layer is deliberately built on Lago so that billing is not a category of work the founder does. Every downstream decision is optimised for one property: that the billing infrastructure runs without requiring founder attention. When choosing between options, prefer the option that removes billing from the founder's working set, even if it costs marginally more in dollars.

---

## System Boundaries

| System               | Owns                                                                                                       | Does NOT own                                                     |
| -------------------- | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| **Clerk**            | Human identity, session management, signup flow                                                            | API key auth, billing, plans                                     |
| **Lago**             | Plans, pricing, metering, invoicing, credit aggregation, wallets, coupons, Stripe orchestration, analytics | API key management, access control, real-time credit enforcement |
| **Prontiq Platform** | API key lifecycle, credit counter enforcement, event emission, dashboard proxy, customer mapping           | Plan definitions, invoice generation, payment collection         |
| **Stripe**           | Payment processing, card collection, disbursement                                                          | Metering, plan logic, customer identity                          |
| **DynamoDB**         | Customer mapping, API keys, credit counters                                                                | Billing truth (that's Lago)                                      |
| **SQS**              | Durable event buffer between platform and Lago                                                             | Nothing else                                                     |

---

## Identity and Auth Model

Two auth surfaces, two mechanisms, one customer ID. Identity is org-scoped via Clerk Organizations — a team shares a credit pool, API keys, and billing, not each individual user.

```
Browser (human)                    Machine (API call)
  │                                  │
  ▼                                  ▼
Clerk session token              API key (prn_live_xxx)
  │                                  │
  ▼                                  ▼
Next.js Route Handler verifies   API handler hashes key
  │                                  │
  ▼                                  ▼
DynamoDB: clerk_org_id           DynamoDB: sha256(key)
  → customerId                     → customerId
  │                                  │
  └──────────┬───────────────────────┘
             ▼
      Same customerId everywhere
```

Clerk proves who the human is and which org they belong to. API keys prove who the machine is. Both resolve to `customerId` (which maps 1:1 with a Clerk org). Everything downstream is keyed by `customerId` and does not care which door the request came through.

---

## Data Model (DynamoDB)

### customers table

```
pk:              clerk_org_id
customerId:      "cust_prn_4f9a..."    (Prontiq-generated UUID)
email:           "..."                  (org billing email)
lago_external_id: "cust_prn_4f9a..."   (same as customerId)
status:          "active" | "deleting"  (supports soft-delete during account removal)
created_at:      ...
```

Identity is org-scoped. A Clerk Organization maps 1:1 to a Prontiq customer, a Lago customer, and a Stripe customer. Individual users within the org share the same credit pool, API keys, and billing.

### api_keys table

```
pk:              sha256(api_key)
customerId:      "cust_prn_4f9a..."
key_id:          "prn_a3f9"            (short public identifier, shown in console, attached to events)
name:            "CI pipeline key"
created_at:      ...
revoked_at:      null | timestamp
deleted_at:      null | timestamp      (supports soft-delete during account removal)
```

The `key_id` is a non-secret short identifier generated at key creation time (e.g., last 8 chars of the key, or a separate short UUID). It is safe to display in the console ("Key ending in ...a3f9"), attach to usage events, and store in analytics tables. It is never the full key or the hash.

### api_key_usage table

```
pk:              customerId
sk:              key_id#period          (e.g., "prn_a3f9#2026-04")
credits_used:    847
calls:           { address_search: 340, ariscan_full: 12, address_autocomplete: 695 }
```

Per-key usage is a product concern, not a billing concern. This table is owned by the platform, not by Lago. It is incremented atomically on the hot path alongside the credit counter. Lago is not involved in per-key usage tracking.

The `sk` includes the period, so historical per-key usage is naturally partitioned by month. The console can query previous periods for per-key usage trends without any special logic.

### credit_counters table

```
pk:              customerId
credits_used:    1800                  (0 for PAYG — still tracked for billing)
credit_limit:    5000                  (null for PAYG)
plan_type:       "capped" | "payg"
period:          "2026-04"
status:          "active" | "deleting" (supports soft-delete during account removal)
```

`credits_remaining` is never stored — it is a calculated field: `credit_limit - credits_used`, computed by the dashboard when needed.

Plan examples:

```
Free:   { credit_limit: 100,   credits_used: 27,   plan_type: "capped", status: "active" }
Pro:    { credit_limit: 5000,  credits_used: 1800,  plan_type: "capped", status: "active" }
PAYG:   { credit_limit: null,  credits_used: 450,   plan_type: "payg",   status: "active" }
```

**Monitoring from day one:** set CloudWatch alarms on `credit_counters` table `ThrottledRequests > 0` and `SystemErrors > 0`. See "DynamoDB Hot Partition" in the Scaling and Robustness section.

---

## Lago Configuration

### Billable Metric

```
name:             Credit Usage
code:             credit_usage
aggregation_type: SUM
field_name:       credits
```

### Credit Weight Table (platform-side config)

```typescript
const CREDIT_COSTS: Record<string, number> = {
  address_autocomplete: 0.5,
  address_search: 1,
  ariscan_quick: 10,
  ariscan_full: 25,
};
```

### Plans (configured in Lago UI by PO)

**Free:**

```
code:        "free"
base_amount: A$0/month
charge:      credit_usage, graduated
  0–100 credits: A$0.00/credit
  (no overage tier — platform hard-caps)
```

**Pro:**

```
code:        "pro"
base_amount: A$49/month
charge:      credit_usage, graduated
  0–5000 credits:  A$0.00/credit (included)
  5001+ credits:   A$0.02/credit (overage)
```

**Pay As You Go:**

```
code:        "payg"
base_amount: A$0/month
charge:      credit_usage, standard
  A$0.02/credit (every credit billed)
```

---

## Lifecycle Events

### 1. User Signup

```
User completes Clerk signup → Clerk auto-creates a personal Organization
  │
  ▼
Clerk webhook: organization.created → apps/console/app/api/webhook/clerk/route.ts
  │
  ├── Generate customerId (UUID)
  ├── Write customers table: { clerk_org_id, customerId, email }
  ├── Create customer in Lago: POST /api/v1/customers
  │     { external_id: customerId, email }
  ├── Create Free subscription in Lago: POST /api/v1/subscriptions
  │     { external_customer_id: customerId, plan_code: "free" }
  └── Write credit_counters: { customerId, credit_limit: 100,
        credits_used: 0, plan_type: "capped", period: "2026-04" }
```

Result: user signs up, lands on console.prontiq.dev, already has 100 free credits. Zero friction.

### 2. Plan Upgrade / Downgrade

```
User clicks "Upgrade to Pro" on console.prontiq.dev (Clerk session)
  │
  ▼
Route Handler: apps/console/app/api/billing/subscribe/route.ts
  ├── Update subscription in Lago: PUT /api/v1/subscriptions/{id}
  │     { plan_code: "pro" }
  └── Lago fires webhook: subscription.updated
        │
        ▼
      Your webhook handler:
        └── Update credit_counters:
              { credit_limit: 5000, credits_used: 0, plan_type: "capped" }
```

### 3. API Key Creation

```
User clicks "Create API Key" on console.prontiq.dev (Clerk session)
  │
  ▼
Route Handler: apps/console/app/api/keys/route.ts
  ├── Verify Clerk session → clerk_org_id → customerId
  ├── Generate key: prn_live_xxxxx
  ├── Hash: sha256(key)
  ├── Write api_keys: { pk: hash, customerId, name, created_at }
  └── Return plaintext key (shown once, never stored)

Lago: not involved. Keys are platform's concern.
```

### 4. API Key Deletion

```
User clicks "Revoke Key" on console.prontiq.dev (Clerk session)
  │
  ▼
Route Handler: apps/console/app/api/keys/[keyId]/route.ts
  ├── Verify Clerk session → clerk_org_id → customerId
  ├── Verify key belongs to this customer
  └── Set revoked_at on api_keys row (or delete)

Lago: still not involved.
```

### 5. Billing Cycle Reset

```
Lago fires webhook: subscription.started (at cycle boundary)
  │
  ▼
Your webhook handler:
  └── Reset credit_counters: credits_used = 0
```

### 6. Account Deletion

```
User requests account deletion on console.prontiq.dev (Clerk session)
  │
  ▼
Route Handler: apps/console/app/api/account/delete/route.ts (in order):
  1. Cancel all subscriptions in Lago
       → Lago generates final invoice, handles proration
  2. Set customer row status = "deleting" in DynamoDB
  3. TransactWriteItems: soft-delete api_keys and credit_counters
       (set deleted_at timestamps, not hard deletes)
  4. On Lago webhook: subscription.terminated
       → Hard-delete api_keys, credit_counters, customer rows
  5. Optionally delete customer in Lago (or keep for audit/invoice history)
  6. Delete organization in Clerk (last — preserves identity until cleanup is complete)

  Recovery: daily sweep Lambda identifies customer rows stuck in
  status = "deleting" for >24 hours and retries or alerts.
```

---

## Hot Path (API Request Flow)

This is the performance-critical path. No external service except DynamoDB.

```
Incoming API request (e.g., POST /api/v1/address/search)
  │
  ▼
1. Hash API key → DynamoDB api_keys table → customerId + key_id  [~2ms]
   If not found, revoked, or deleted_at set → 401
  │
  ▼
2. Look up credit cost: CREDIT_COSTS["address_search"] = 1       [in-memory]
  │
  ▼
3. DynamoDB atomic increment on credit_counters:                  [~2ms]
     credits_used += 1
     ConditionExpression: credits_used + :cost <= credit_limit
                      AND status = "active"
   If condition fails (limit reached) → 402 { error: "credit_limit_reached" }
   If condition fails (status ≠ active) → 403 { error: "account_suspended" }
   If plan_type === "payg" → increment credits_used, skip the cap check,
                              but still check status = "active"
  │
  ▼
4. Execute the actual work (OpenSearch query, scan, etc.)         [variable]
  │
  ▼
5. Fire event to SQS (async, non-blocking):                       [~1ms]
     {
       transaction_id: uuid(),
       external_subscription_id: customerId,
       code: "credit_usage",
       properties: { api: "address_search", credits: 1, key_id: "prn_a3f9" }
     }
  │
  ▼
6. Return result to caller
```

**Total billing overhead on the hot path: ~4ms (two DynamoDB calls).** Lago is never on this path. SQS is fire-and-forget. Per-key usage analytics are written asynchronously by the SQS Lambda consumer (see Async Billing Path), not on the hot path. The user's response is not delayed by billing or analytics.

---

## Async Billing Path (SQS → Lago & Analytics)

```
SQS queue: prontiq-billing-events
  │
  ▼
Lambda consumer (triggered by SQS, batchSize: 10, maxBatchingWindow: 5s)
  Event source mapping: FunctionResponseTypes = ["ReportBatchItemFailures"]
  │
  ├── Parse batch of events
  │
  ├── 1. Analytics write (fail-open):
  │      Batch update DynamoDB api_key_usage for events in this batch
  │        (pk: customerId, sk: key_id#period)
  │        (increment credits_used and calls.{api} per event)
  │      If this write fails → log and continue. Do NOT fail the batch.
  │      Per-key analytics are non-critical; a missed write means the
  │      dashboard is slightly stale, not that billing is wrong.
  │
  ├── 2. Billing write (fail-closed):
  │      For each event in batch:
  │        ├── POST to Lago /api/v1/events
  │        ├── On 2xx → success, SQS auto-deletes this message
  │        ├── On 4xx → log error, add to batchItemFailures
  │        └── On 5xx / timeout → add to batchItemFailures
  │
  └── Return { batchItemFailures: [failed messageIds only] }

DLQ: prontiq-billing-events-dlq
  └── CloudWatch alarm on ApproximateNumberOfMessagesVisible > 0
        → alert: billing event didn't land
```

The analytics write (step 1) and the billing write (step 2) have different failure semantics. Analytics is fail-open: if DynamoDB rejects the batch update, the Lambda logs the error and proceeds to Lago. The per-key usage dashboard will be briefly stale but billing is unaffected. Billing is fail-closed: if Lago rejects an event, that specific message is returned to SQS for redelivery.

This design keeps per-key analytics completely off the hot path — the dashboard is eventually consistent by a few seconds (the SQS batching window) rather than real-time, which is imperceptible to users. The hot path stays at ~4ms with only two DynamoDB calls.

**Key disciplines:**

1. `transaction_id` is generated in the API handler (step 5 of the hot path), not in the Lambda consumer. If SQS redelivers, the same `transaction_id` ensures Lago deduplicates. This is the single most important detail for billing integrity.

2. `ReportBatchItemFailures` is a launch requirement, not a future optimisation. Without it, one failed event causes all 10 messages in the batch to be redelivered, generating unnecessary retries. See "SQS Batch Failure Handling" in the Scaling and Robustness section.

3. The `api_key_usage` DynamoDB write is **not deduplicated** and does not attempt idempotency. This is deliberate. SQS redeliveries are rare (only on Lago 5xx or Lambda crash), and if a batch of 10 events is redelivered, the dashboard double-counts exactly 10 requests. For a customer doing 50,000 requests/month, a dashboard showing 50,010 is imperceptible. Lago holds the exact, deduplicated billing truth via `transaction_id` — the analytics table is a product convenience, not a financial record. Attempting to deduplicate via a `StringSet` of transaction IDs would hit DynamoDB's 400KB item size limit within days for high-volume keys.

---

## Background Reconciliation

```
Every 5 minutes (EventBridge rule → Lambda):
  │
  For each active customer:
  ├── GET /api/v1/customers/{customerId}/current_usage from Lago
  │     → extract total credits consumed this period
  ├── GET subscription → plan → charge tiers from Lago
  │     → extract current credit_limit from the plan's included tier
  ├── Overwrite DynamoDB credit_counters:
  │     credits_used = lago_total_credits_used
  │     credit_limit = plan_included_credits (from charge tiers)
  └── Detect period rollover: if Lago's period differs from stored period,
        set credits_used = 0, update period
```

This single Lambda corrects three categories of drift in one pass:

1. **Counter drift** — credits_used realigned to Lago's aggregated truth
2. **Plan changes** — credit_limit updated if PO changed the plan's quota in Lago
3. **Cycle rollover** — credits_used reset if billing period has advanced

The local counter is the real-time enforcer; Lago is the accountant who checks the books.

### Known Trade-offs and Accepted Risks

**Plan-definition changes propagate within ~5 minutes, not instantly.** Lago does not fire webhooks when a plan's configuration changes (price, quota, charge tiers). Only customer-level events (subscription created/updated/terminated, invoice generated) trigger webhooks. Plan-wide changes are detected by the reconciliation Lambda on its next pass.

Implications:

- **PO raises credit quota:** customers are briefly under-served (old lower limit enforced for up to 5 minutes). Conservative drift — no revenue risk.
- **PO lowers credit quota:** customers may briefly exceed the new limit (old higher limit enforced for up to 5 minutes). Permissive drift — minor giveaway risk. At launch scale this is a handful of extra credits, not a material concern.
- **PO changes pricing:** no platform impact at all — pricing only affects invoice generation, which Lago handles at cycle end.

Mitigation if drift becomes a concern: reduce reconciliation interval from 5 minutes to 60 seconds. Lambda cost difference is negligible.

**New plans appear within cache TTL (~10 minutes).** The pricing page and upgrade UI read plans from Lago via a cached Next.js Route Handler (or ISR fetch). A new plan created by the PO appears to customers once the cache expires. Acceptable at launch — the PO can coordinate timing if a launch announcement matters.

**Deleted plans are an operational hazard.** Lago permits deletion of plans with no active subscriptions. A deleted plan disappears from the API and can break references. Mitigated by operational rule: plans are never deleted, only retired via config. See "PO Deletes a Plan" section.

### Scaling and Robustness Risks

These are known architectural constraints that are acceptable at launch but must be addressed as Prontiq grows. Each has a documented trigger and fix.

**1. O(N) Reconciliation Scaling Trap**

The reconciliation Lambda runs every 5 minutes and iterates through every active customer, calling Lago's `current_usage` endpoint per customer. At 100 customers this completes in seconds. At 5,000 customers it will hit Lago API rate limits or exceed Lambda's 15-minute timeout.

- **v1 posture:** acceptable. Prontiq will not have 5,000 customers at launch.
- **Trigger to fix:** reconciliation Lambda duration exceeding 60 seconds, or Lago returning 429s during reconciliation.
- **Fix options:**
  - Paginate and shard: split customers across multiple Lambda invocations (e.g., fan-out via SQS or Step Functions)
  - Shift to webhook-driven: use `subscription.started` webhooks for cycle resets and only reconcile counter drift on a slower cadence (hourly) for the corrections that webhooks don't cover
  - Lago batch API: if Lago introduces a bulk usage endpoint, switch to batch reads

**2. SQS Batch Failure Handling**

The Lambda consumer processes batches of 10 events from SQS. If one event triggers a 5xx from Lago and the Lambda throws, SQS redelivers all 10 messages. Lago deduplicates via `transaction_id` so no double-billing occurs, but this generates unnecessary retries and network overhead.

- **v1 posture:** configure `ReportBatchItemFailures` from day one. This is not a "fix later" item — it's a launch requirement.
- **Implementation:** the Lambda event source mapping must set `FunctionResponseTypes: ["ReportBatchItemFailures"]`. The handler catches per-event failures and returns only the failed message IDs:

```typescript
export async function handler(event: SQSEvent): Promise<SQSBatchResponse> {
  const failures: SQSBatchItemFailure[] = [];

  for (const record of event.Records) {
    try {
      const payload = JSON.parse(record.body);
      await postToLago(payload);
    } catch (err) {
      failures.push({ itemIdentifier: record.messageId });
    }
  }

  return { batchItemFailures: failures };
}
```

This ensures the 9 successful events are deleted from SQS and only the failed event is retried.

**3. DynamoDB Hot Partition on `credit_counters`**

The `credit_counters` partition key is `customerId`. A single enterprise customer pushing 1,000+ requests per second (plausible for high-volume address autocomplete) concentrates all atomic increment writes on a single DynamoDB partition. A single partition is capped at approximately 1,000 WCU/second.

The primary mitigation is already applied: per-key analytics writes (`api_key_usage`) were evicted from the hot path and moved to the async SQS Lambda consumer. This means the hot path only writes to `credit_counters` (one write per request), not to both `credit_counters` and `api_key_usage` (which would have doubled the write pressure). This buys significant runway before the hot partition becomes a real problem.

- **v1 posture:** acceptable. Single hot-path write per request, analytics offloaded to async. Prontiq's launch customers will not sustain 1,000 RPS per customer.
- **Trigger to fix:** DynamoDB `ThrottledRequests` metric spiking on the `credit_counters` table; customer-reported 500s during high-volume batch runs.
- **Fix options (Levers 2 and 3, apply only when triggered):**
  - In-memory buffer: accumulate credits in a request-local or Lambda-scoped counter and flush to DynamoDB in batches (e.g., every 10 requests or every 100ms). Trades exact real-time enforcement for throughput.
  - Write sharding: split the counter across N shards (`customerId#shard0`, `customerId#shard1`, ...) and sum on read. Standard DynamoDB pattern for hot keys.
  - Redis counter on the hot path: atomic increment in ElastiCache, periodic flush to DynamoDB for durability. Reintroduces an infrastructure dependency but solves the throughput ceiling entirely.
- **Monitoring from day one:** set a CloudWatch alarm on `credit_counters` table `ThrottledRequests > 0`.

**4. Account Deletion Sequence is Fragile**

The deletion flow deletes `api_keys`, `credit_counters`, the customer row, the Lago customer, and the Clerk user in sequence. If Lago fails mid-flow or the Route Handler times out, the system is left in a partially deleted state — a Lago customer with no DynamoDB mapping, or DynamoDB rows with no Lago customer.

- **v1 posture:** implement soft-deletes and transactional DynamoDB writes from day one.
- **Implementation:**
  1. Cancel subscriptions in Lago (generates final invoice)
  2. Set `status: "deleting"` on the customer row in DynamoDB (soft-delete flag)
  3. Use `TransactWriteItems` to atomically soft-delete `api_keys` and `credit_counters` rows (set `deleted_at` timestamps)
  4. On Lago `subscription.terminated` webhook confirmation, hard-delete the DynamoDB rows
  5. Delete the Clerk organization last
- **Recovery:** a background sweep (daily Lambda) identifies customer rows stuck in `status: "deleting"` for more than 24 hours and either retries or alerts for manual intervention.

**5. Free Tier Abuse via Signup Scripting**

Clerk auto-creates an org on signup, which auto-provisions a Free plan with 100 credits. With zero friction, a malicious actor can script signups and consume OpenSearch resources at 100 credits per disposable account.

- **v1 posture:** accept the risk with lightweight mitigations. Full prevention requires card-on-file for free tier, which kills conversion. The mitigations below reduce the blast radius without adding friction for legitimate users.
- **Mitigations (implement at launch):**
  - Rate-limit the Clerk webhook handler: if more than N orgs are created from the same IP within a window, delay provisioning and flag for review
  - Clerk's built-in bot protection: enable CAPTCHA on the signup form (Clerk supports this natively)
  - Monitor: alert on anomalous signup velocity (e.g., >50 orgs created per hour)
- **Mitigations (add when abuse is observed):**
  - Email verification before Free plan provisioning: org is created but subscription is not provisioned until the email is confirmed
  - Card-on-file for Free tier: handled via Lago + Stripe, with a $0 authorization. Eliminates scripted abuse entirely but adds friction. Deploy only if the problem materialises.
- **Trigger to escalate:** OpenSearch costs spiking without corresponding revenue growth; anomalous signup-to-churn patterns in Lago analytics.

**6. Webhook Ordering and Idempotency**

Lago guarantees at-least-once delivery but not in-order delivery. This creates a classic distributed systems edge case during rapid state transitions.

The scenario:

1. User upgrades to Pro at 11:59 PM on the last day of the billing cycle
2. Lago fires `subscription.updated` (limit → 5000, credits_used → 0)
3. Cycle rolls over at 12:00 AM. Lago fires `subscription.started` (credits_used → 0)
4. Due to network jitter, `subscription.started` arrives _before_ `subscription.updated`
5. Your webhook handler processes them in wrong order: limit gets set to 5000 correctly, but a delayed `subscription.started` arriving minutes later blindly resets `credits_used = 0`, wiping out any usage that occurred in the gap

The impact: a customer's credit counter could be temporarily incorrect — either showing usage that was already reset, or losing a few minutes of tracked usage. At worst this is a handful of credits during a 5-minute window at cycle boundary, visible as a brief dashboard inconsistency.

- **v1 posture:** do nothing to the code. The background reconciliation Lambda is already the authoritative state enforcer. If webhooks arrive out of order and clobber the counter, the next reconciliation pass (within 5 minutes) overwrites `credits_used` and `credit_limit` with Lago's truth. The system self-heals.
- **Accepted artifact:** temporary dashboard inconsistencies (under 5 minutes) during cycle rollovers or rapid plan changes are an accepted consequence of eventual consistency. Users will not notice a brief counter fluctuation at midnight.
- **Trigger to fix:** only if billing-grade precision is required at the counter level (e.g., regulatory or contractual obligation to show real-time-accurate usage). In that case, add a `last_webhook_timestamp` field to `credit_counters` and reject webhook writes that are older than the current timestamp. This converts the handler to a last-writer-wins-by-timestamp model. Not worth building for v1.

---

## Dashboard and Landing Data Flow

### Console (`apps/console` — `console.prontiq.dev`)

The console is the customer-facing dashboard. It is not an admin panel. There is no Prontiq-built admin UI for managing plans, pricing, invoices, or billing configuration — Lago's own UI is the admin interface, operated directly by the PO. The console only renders what Lago exposes via API.

The console is client-rendered below the Clerk auth boundary. TanStack Query hooks call Next.js Route Handlers, which proxy to Lago server-side. The Lago API key never leaves the server.

```
apps/console/
  app/
    api/
      billing/
        current-usage/route.ts    → proxies Lago GET /customers/{id}/current_usage
        history/route.ts          → proxies Lago GET /customers/{id}/past_usage
        invoices/route.ts         → proxies Lago GET /invoices?external_customer_id={id}
        plan/route.ts             → proxies Lago GET /subscriptions?external_customer_id={id}
        plans/route.ts            → proxies Lago GET /plans (cached 10min)
        subscribe/route.ts        → creates/updates Lago subscription
        key-usage/route.ts        → DynamoDB api_key_usage query (no Lago)
      webhook/
        lago/route.ts             → receives Lago webhooks
        clerk/route.ts            → receives Clerk webhooks
    (dashboard)/
      overview/page.tsx           → KPIs including credit usage (from current-usage route)
      usage/page.tsx              → account usage + per-key breakdown (two data sources)
      billing/page.tsx            → invoices, plan info, upgrade (from invoices + plan routes)
      keys/page.tsx               → API key management (DynamoDB only, no Lago)
      playground/page.tsx         → live API testing
      danger-zone/page.tsx        → account deletion
```

Data flow for the usage page (two sources, one page):

```
usage/page.tsx
  │
  ├── Account-level usage (TanStack Query)
  │     → GET /api/billing/current-usage
  │     → Route Handler → Lago current_usage API
  │     → Returns: total credits_used, credit_limit, breakdown by charge
  │     → Renders: credit gauge, account-level usage chart
  │
  └── Per-key usage (TanStack Query)
        → GET /api/billing/key-usage
        → Route Handler → DynamoDB api_key_usage (pk = customerId)
        → Returns: [{ key_id, key_name, credits_used, calls: { api: count } }]
        → Renders: per-key breakdown table with API-level detail
```

The two datasets match in aggregate (both are fed by the same hot-path increments) but are authoritative for different concerns: Lago owns the billing truth, DynamoDB owns the per-key breakdown.

Data flow for other dashboard pages:

```
Browser (TanStack Query in usage/page.tsx)
  │
  ▼
GET /api/billing/current-usage
  │
  ▼
Next.js Route Handler (server-side):
  ├── getAuth() → verify Clerk session → clerk_org_id
  ├── DynamoDB: clerk_org_id → customerId
  ├── Lago: GET /api/v1/customers/{customerId}/current_usage
  │     (using process.env.LAGO_API_KEY — never exposed to browser)
  ├── Shape response: { credits_used, credit_limit, breakdown_by_charge }
  └── Return to browser
```

### Landing (`apps/landing` — `prontiq.dev`)

The pricing page on `apps/landing` renders plan cards from Lago's plan data, replacing Stripe Pricing Tables (which are superseded per the Frontend Engineering Strategy).

```
apps/landing/
  app/
    pricing/page.tsx              → SSG or ISR
      → build-time or revalidation fetch:
          Lago GET /api/v1/plans (server-side, LAGO_API_KEY in env)
      → renders Prontiq-styled plan cards with:
          - plan name, base price, included credits, overage rate
          - extracted from Lago's charge tiers
      → "Get Started" CTA links to console.prontiq.dev/sign-up
      → "Upgrade" CTA links to console.prontiq.dev/billing
```

The landing site fetches plans at build time (or via ISR revalidation every 10 minutes). When the PO creates or modifies a plan in Lago, the pricing page updates on next revalidation. No deploy required.

### Pricing page data shaping

The route handler (or build-time fetch) transforms Lago's plan payload into a clean frontend contract:

```typescript
// lib/lago/plans.ts (shared utility)
export async function getDisplayPlans(): Promise<DisplayPlan[]> {
  const response = await fetch(`${LAGO_API_URL}/api/v1/plans`, {
    headers: { Authorization: `Bearer ${LAGO_API_KEY}` },
    next: { revalidate: 600 }, // ISR: 10 minutes
  });
  const { plans } = await response.json();

  return plans
    .filter((p) => ACTIVE_PLANS.includes(p.code))
    .map((p) => ({
      code: p.code,
      name: p.name,
      interval: p.interval,
      amount_cents: p.amount_cents,
      currency: p.amount_currency,
      trial_period_days: p.trial_period,
      included_credits: extractIncludedCredits(p.charges),
      overage_rate: extractOverageRate(p.charges),
    }));
}
```

This utility is importable from both `apps/landing` (build-time) and `apps/console` (route handler). The browser never sees Lago's raw payload — only the shaped `DisplayPlan` contract.

All calls are server-side. Clerk proves identity in the console. The route handler is the trust boundary. The browser never sees a Lago API key.

---

## Webhook Registrations

### Lago → `apps/console/app/api/webhook/lago/route.ts`

| Webhook                           | Handler action                                            |
| --------------------------------- | --------------------------------------------------------- |
| `subscription.started`            | Reset credit_counters.credits_used to 0                   |
| `subscription.updated`            | Update credit_limit (and reset credits_used on upgrade)   |
| `subscription.terminated`         | Clean up if account deletion in progress                  |
| `invoice.created`                 | Optional: notify user via dashboard                       |
| `invoice.payment_status_updated`  | Optional: handle payment failure (suspend access, notify) |
| `customer.payment_provider_error` | Optional: prompt user to update payment method            |

### Clerk → `apps/console/app/api/webhook/clerk/route.ts`

| Webhook                | Handler action                                               |
| ---------------------- | ------------------------------------------------------------ |
| `organization.created` | Create customer in DynamoDB + Lago, auto-provision Free plan |
| `organization.deleted` | Trigger account deletion flow                                |

---

## PO Operations — What Happens When Plans, Prices, or Quotas Change

The PO manages all commercial configuration in Lago's UI. No deploys, no PRs, no engineering involvement. This section documents the downstream effects of each type of change and what (if anything) your platform needs to do.

### PO Changes Pricing on an Existing Plan

Example: Pro plan overage rate changes from A$0.02/credit to A$0.03/credit.

```
PO edits the charge on the Pro plan in Lago UI
  │
  ▼
Effect: new pricing applies to future invoices only.
Lago does NOT retroactively re-price the current billing period.
In-progress usage continues aggregating; the new rate applies
at next invoice generation.

Platform impact: NONE.
  - credit_counters unchanged (pricing doesn't affect credit limits)
  - Hot path unchanged
  - Dashboard pricing page updates automatically (GET /api/v1/plans is cached,
    refreshes within 10min TTL)
  - No webhook fires for plan-level price changes
```

**Important:** if the PO wants the new price to apply immediately to in-progress subscriptions, they need to understand that Lago applies plan changes at next invoice. For mid-cycle repricing, the PO would need to create a new plan version and migrate subscribers — a deliberate action, not an accident.

### PO Changes the Credit Quota on a Plan

Example: Pro plan included credits increase from 5,000 to 7,500.

```
PO edits the graduated tiers on the Pro plan's credit_usage charge in Lago UI
  (first tier: 0–7500 at A$0.00 instead of 0–5000)
  │
  ▼
Effect in Lago: new tier applies to future invoices.
Current billing period invoices use the tier that was active when the period started.

Platform impact: credit_counters MUST be updated.
  │
  ▼
Two mechanisms catch this:

1. Background reconciliation (every 5 minutes):
   - Reads the customer's subscription → plan → charge tiers from Lago
   - Extracts the new included-credit ceiling (7,500)
   - Updates credit_counters.credit_limit = 7500
   - Recalculates credits_remaining = 7500 - lago_usage_this_period

2. Manual trigger (if immediate propagation needed):
   - PO notifies engineering: "I've changed Pro quota"
   - Engineer runs a one-off Lambda invocation to force reconciliation
   - Or: engineer updates credit_limit directly in DynamoDB for affected customers
```

**Design decision:** the reconciliation Lambda should always read the plan's included-credit tier from Lago rather than hardcoding it. This makes quota changes self-healing within 5 minutes without any code change or deploy.

The reconciliation Lambda extracts the credit limit from Lago like this:

```typescript
async function extractCreditLimit(subscriptionId: string): Promise<number | null> {
  const sub = await lago.subscriptions.get(subscriptionId);
  const plan = await lago.plans.get(sub.plan_code);

  const creditCharge = plan.charges.find((c) => c.billable_metric_code === "credit_usage");
  if (!creditCharge) return null;

  if (creditCharge.charge_model === "graduated") {
    // Find the last tier with per_unit_amount === "0" — that's the included quota
    const freeTiers = creditCharge.properties.graduated_ranges.filter(
      (t) => t.per_unit_amount === "0",
    );
    const lastFreeTier = freeTiers[freeTiers.length - 1];
    return lastFreeTier?.to_value ?? null; // null means unlimited free tier
  }

  if (creditCharge.charge_model === "standard" && sub.plan_code === "payg") {
    return null; // PAYG has no cap
  }

  return null;
}
```

This means the PO changes the number in Lago, and within 5 minutes every customer's credit counter reflects the new limit. No deploy. No config file edit. No engineering involvement.

### PO Creates a New Plan

Example: PO creates an "Enterprise" plan with 50,000 credits/month at A$299/month.

```
PO creates the plan in Lago UI:
  - name: Enterprise
  - code: enterprise
  - base_amount: A$299
  - charge on credit_usage: graduated, 0–50000 at A$0.00, 50001+ at A$0.015

Platform impact: NONE for plan creation.
  - GET /api/v1/plans returns the new plan automatically
  - Pricing page and upgrade UI render it within cache TTL (10min)
  - No code change needed — the dashboard renders whatever plans Lago returns

When a customer subscribes to it:
  - Normal upgrade flow applies (subscription.updated webhook)
  - credit_counters updated via webhook handler
  - Or reconciliation Lambda picks it up within 5 minutes
```

**Key principle:** your platform never hardcodes plan codes or plan properties. It reads them from Lago dynamically. A new plan is visible to customers the moment the PO saves it in Lago and the cache expires.

### PO Retires a Plan

Example: PO wants to discontinue the Free plan for new signups but keep existing Free users on it.

```
PO approach in Lago:
  - Does NOT delete the Free plan (existing subscriptions would break)
  - Instead: marks it as not available for new subscriptions
    (Lago doesn't have a native "hidden" flag, so the PO uses a naming
    convention like prefixing with "_retired_" or the platform filters
    by a known list of active plan codes)

Platform impact: MINOR.
  - The pricing page / plan selection UI needs to know which plans to show
  - Options:
    a. Platform maintains a small config: ACTIVE_PLANS = ["pro", "enterprise", "payg"]
       PO tells engineering to update when retiring a plan (one-line change, deploy)
    b. PO uses a naming convention (_retired_ prefix), platform filters on it
    c. Platform shows all plans from GET /api/v1/plans and the PO simply
       doesn't create plans they don't want shown (simplest, but less control)
```

**Recommendation:** option (a) for v1. A simple array of active plan codes in your platform config. The PO asks engineering to remove a plan code when retiring. One line, one deploy, once a year at most.

### PO Deletes a Plan

**Plans are never deleted from Lago.** This is an operational rule, not a technical limitation.

Lago will prevent deletion of plans with active subscriptions (returns an error). But if a plan has no active subscriptions, Lago allows deletion — and that's dangerous because:

1. The plan disappears from `GET /api/v1/plans`, breaking any cached references
2. Invoice history referencing the deleted plan may lose context
3. If the auto-provisioned Free plan is deleted, every new signup fails silently

```
Operational rule (documented in Lago runbook):
  - Plans are NEVER deleted from Lago
  - Retired plans are hidden via ACTIVE_PLANS config
  - Plan definitions are retained permanently for invoice history and audit
  - The PO is briefed on this rule during onboarding
  - If a plan must be removed from Lago (data cleanup, test plans),
    engineering does it after verifying zero references
```

### PO Changes Credit Weights (Per-API Credit Costs)

Example: address_search should cost 2 credits instead of 1.

```
This is the ONE commercial change that requires a platform deploy.

The CREDIT_COSTS table lives in your platform:
  address_search: 1 → 2

Engineer updates the config, deploys. Immediate effect on all future API calls.
Lago is not involved — it just sums whatever credits value arrives in events.

Platform impact: code change + deploy.
```

**Mitigation options to remove the deploy requirement (future, not v1):**

- Move CREDIT_COSTS to a DynamoDB config table, cached in-memory with 60s TTL. PO updates via a tiny admin endpoint. No deploy needed.
- Move CREDIT_COSTS to Lago as plan-level metadata (custom properties on charges). Reconciliation Lambda reads them. More complex, probably over-engineered.

**v1 recommendation:** keep it as a config object in code. It changes rarely (new API launches, not daily tweaks). A deploy for a credit weight change is acceptable. Revisit when the PO is making weight changes weekly.

### PO Creates or Modifies Coupons / Vouchers

```
PO creates a coupon in Lago UI:
  - code: LAUNCH20
  - type: percentage, 20% off
  - frequency: once (first invoice only)
  - expiration: 2026-12-31

Platform impact: NONE if using Lago's reusable coupons.
  - Users enter the code on your dashboard
  - Your handler calls Lago POST /api/v1/applied_coupons
  - Lago applies the discount at invoice time

If using the DynamoDB voucher-inventory pattern (single-use codes):
  - PO asks engineering to generate a batch of codes
  - Engineer runs a script that creates N DynamoDB rows + one Lago coupon definition
  - Or: build a small admin UI for the PO to generate codes (future)
```

### PO Adjusts Wallet / Prepaid Credit Grants

```
PO grants bonus credits to a customer in Lago UI:
  - POST /api/v1/wallets (or top-up an existing wallet)

Platform impact: DEPENDS on your model.
  - If using graduated pricing (included credits in plan): no wallet involved,
    no platform impact
  - If using Lago wallets for prepaid credit packs: the wallet balance is
    Lago's concern, but your credit_counters table doesn't know about wallets

  If you adopt wallets later, the reconciliation Lambda needs to account for
  wallet balance when computing credits_remaining. Document this as a follow-up.
```

### Summary: PO Change Impact Matrix

| PO Action                     | Lago UI                 | Platform Deploy        | DynamoDB Update                | Timing                |
| ----------------------------- | ----------------------- | ---------------------- | ------------------------------ | --------------------- |
| Change price per credit       | ✅ Edit charge          | None                   | None                           | Next invoice          |
| Change included credit quota  | ✅ Edit charge tiers    | None                   | Auto via reconciliation        | ~5 minutes            |
| Create new plan               | ✅ Create plan          | None                   | None                           | Cache expiry (~10min) |
| Retire a plan                 | ✅ Convention/rename    | One-line config change | None                           | On deploy             |
| Change credit weight per API  | N/A                     | Config change + deploy | None                           | On deploy             |
| Create coupon                 | ✅ Create coupon        | None                   | None (unless single-use codes) | Immediate             |
| Grant bonus credits (wallet)  | ✅ Create/top-up wallet | None                   | Follow-up if wallets adopted   | Immediate             |
| Change plan base price        | ✅ Edit plan            | None                   | None                           | Next invoice          |
| Add new API to credit weights | N/A                     | Config change + deploy | None                           | On deploy             |

**The governing rule:** if it's a billing/commercial concern, the PO does it in Lago. If it's a product/engineering concern (credit weights, active plan list), it requires a deploy. The boundary is clean and the exceptions are small.

---

## Lago Infrastructure (prontiq-lago repo)

Separate repo. Infra only. No business logic.

### Dev

- One EC2 `t4g.small` (or DO Droplet equivalent) in Sydney
- Docker Compose: Lago API + worker + front + Postgres + Redis + Clickhouse
- All state local, nightly EBS/volume snapshots
- Caddy for TLS

### Prod

- One EC2 `t4g.medium` (or DO Droplet equivalent) in Sydney
- Docker Compose: Lago API + worker + front + Redis + Clickhouse
- Managed Postgres (RDS or DO Managed PostgreSQL)
- S3 / DO Spaces for invoice PDFs
- ALB or DO LB for TLS termination
- Nightly backups, 7-day PITR on managed Postgres

### Lago Image Pinning

Image tags pinned explicitly. Never `latest`. Upgrades are deliberate: bump version in compose file, snapshot data volume, `docker compose pull && docker compose up -d`.

---

## Vouchers and Coupons

### Promo codes (percentage/fixed discounts)

Lago coupons. Platform owns code inventory (DynamoDB vouchers table), Lago owns discount application.

### Prepaid credit vouchers (gift cards)

Lago wallets. Platform issues codes, Lago manages balance ledger and drawdown.

### Redemption flow

```
User enters code on dashboard
  → Platform validates code in DynamoDB (exists, unredeemed, not expired)
  → Platform calls Lago: POST /api/v1/applied_coupons (or POST /api/v1/wallets)
  → Platform marks code as redeemed in DynamoDB
  → Lago applies discount or credit at next invoice
```

---

## What Lives Where — The Complete Map

| Concern                                            | Owner                                   | Why                                                               |
| -------------------------------------------------- | --------------------------------------- | ----------------------------------------------------------------- |
| "Who is this human?"                               | Clerk                                   | Identity provider                                                 |
| "Who is this machine?"                             | DynamoDB api_keys                       | Platform-owned, hot-path safe                                     |
| "Which key made this request?"                     | DynamoDB api_keys (key_id)              | Non-secret short identifier, attached to events and usage records |
| "What plan are they on?"                           | Lago                                    | Source of truth for plans                                         |
| "How many credits have they used?" (real-time)     | DynamoDB credit_counters (credits_used) | Hot-path enforcement, incremented atomically                      |
| "How many credits have they used?" (billing truth) | Lago (aggregated from events)           | Authoritative, reconciled every 5 minutes                         |
| "How many credits do they have left?"              | Calculated: credit_limit - credits_used | Never stored — derived at query time                              |
| "How many credits did each key use?"               | DynamoDB api_key_usage                  | Per-key breakdown, product concern, not billing                   |
| "Which APIs did each key call?"                    | DynamoDB api_key_usage (calls map)      | Per-key per-API breakdown for the console usage page              |
| "What's their credit limit?"                       | DynamoDB credit_counters (credit_limit) | Synced from Lago plan via reconciliation                          |
| "What does each API cost in credits?"              | Platform config (CREDIT_COSTS)          | Product decision, requires deploy to change                       |
| "What does each credit cost in dollars?"           | Lago plan charges                       | Commercial decision, PO manages in Lago UI                        |
| "Has this customer paid?"                          | Lago + Stripe                           | Payment orchestration                                             |
| "What are the available plans?"                    | Lago (GET /api/v1/plans)                | Single source, dashboard renders dynamically                      |
| "Show me my account usage history"                 | Lago (current_usage, past_usage)        | Billing-grade data                                                |
| "Show me my per-key usage"                         | DynamoDB api_key_usage                  | Product-grade data, queried by customerId                         |
| "Show me my invoices"                              | Lago (invoices API)                     | System of record                                                  |
| "Apply a voucher"                                  | Platform validates, Lago applies        | Split responsibility                                              |
| "PO changed a plan's pricing or quota"             | Lago (plan definition)                  | Propagates to platform via reconciliation (~5min)                 |
| "PO created a new plan"                            | Lago                                    | Propagates to pricing page via cache expiry (~10min)              |
| "PO retired a plan"                                | Platform ACTIVE_PLANS config            | Requires one-line deploy                                          |
| "Plans are deleted"                                | Never — operational rule                | Retired via config, never deleted from Lago                       |

---

## Cost Model

### Platform infrastructure (DynamoDB, SQS, Lambda)

- DynamoDB: ~A$3/month at launch scale (on-demand pricing, four small tables)
- SQS: ~A$0.60 per million messages
- Lambda (SQS consumer + reconciliation): ~A$2/month
- **Total platform billing overhead: ~A$5/month**

### Lago infrastructure (prontiq-lago repo)

- Dev environment: ~A$22–35/month
- Prod environment: ~A$65–80/month
- **Total Lago hosting: ~A$95–115/month**

### Combined commercial layer: ~A$100–120/month

---

## Reversibility Assessment

| Component             | Replacement cost | Classification                                              |
| --------------------- | ---------------- | ----------------------------------------------------------- |
| Caddy / reverse proxy | Hours            | Disposable — swap anytime                                   |
| SQS queue             | Hours            | Disposable — swap for any durable queue                     |
| DynamoDB tables       | Days             | Moderate — schema is simple, data is small                  |
| Clerk                 | Weeks            | Compounding — user sessions, OAuth, webhooks                |
| Lago                  | Weeks to months  | Compounding — plan definitions, invoice history, event data |
| Stripe                | Very difficult   | Compounding — payment methods, customer records, regulatory |

Spend agonising time on compounding decisions. Spend zero time on disposable ones.

---

## Frontend Alignment

This commercial architecture integrates with the Prontiq Frontend Engineering Strategy (v2.4, ratified 20 April 2026). Key alignment points:

| Frontend strategy decision                  | Commercial layer implication                                                                   |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Next.js 15 + React 19 across both apps      | Route Handlers in `apps/console` proxy Lago; build-time fetches in `apps/landing` render plans |
| Clerk Organizations as identity model       | `customerId` maps 1:1 to `clerk_org_id`; credit pools, keys, billing are org-scoped            |
| TanStack Query for data access              | Dashboard billing components use TanStack Query against `/api/billing/*` route handlers        |
| `@prontiq/sdk` from `sdks/typescript`       | SDK handles product API calls; billing route handlers are separate and don't use the SDK       |
| Stripe Pricing Tables superseded            | Plan cards on landing and console are Prontiq-rendered from Lago plan data                     |
| SSG + ISR for `apps/landing`                | Pricing page fetches plans from Lago at build time with ISR revalidation (10min)               |
| Client-rendered console below auth boundary | All Lago data fetched via Route Handlers, never direct browser-to-Lago                         |
| shadcn/ui components                        | Billing UI (usage charts, invoice tables, plan cards) built with shadcn primitives             |
| `packages/tokens` as design token source    | Plan cards, usage widgets, invoice displays use token-derived styles                           |

### Console pages that consume Lago data

| Console page                 | Route handler                                        | Data source                                            |
| ---------------------------- | ---------------------------------------------------- | ------------------------------------------------------ |
| `overview/page.tsx`          | `/api/billing/current-usage`                         | Lago `GET /customers/{id}/current_usage`               |
| `usage/page.tsx` (account)   | `/api/billing/current-usage`, `/api/billing/history` | Lago `GET /customers/{id}/current_usage`, `past_usage` |
| `usage/page.tsx` (per-key)   | `/api/billing/key-usage`                             | DynamoDB `api_key_usage` (no Lago)                     |
| `billing/page.tsx`           | `/api/billing/invoices`, `/api/billing/plan`         | Lago `GET /invoices`, `GET /subscriptions`             |
| `billing/page.tsx` (upgrade) | `/api/billing/subscribe`                             | Lago `POST /subscriptions`                             |
| `keys/page.tsx`              | Direct DynamoDB                                      | DynamoDB `api_keys` (no Lago)                          |

### Landing pages that consume Lago data

| Landing page       | Data source            | Lago endpoint |
| ------------------ | ---------------------- | ------------- |
| `pricing/page.tsx` | Build-time / ISR fetch | `GET /plans`  |

---

## Cross References

- Frontend Engineering Strategy: `docs/FRONTEND-ENGINEERING-STRATEGY.md` (v2.4)
- Architecture: `ARCHITECTURE.MD`
- Execution plan: `ROADMAP.md`
- Lago infrastructure: `prontiq-lago` repo
- SDK source: `sdks/typescript`
- Brand source: `packages/tokens/src/tokens.ts`
- Console prototype: `docs/prototypes/console-dashboard-v1.html`
