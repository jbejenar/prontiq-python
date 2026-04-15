# ADR-001: Remove Unkey, adopt DynamoDB-native API key management

## Status

Accepted

## Context

The v2.1 architecture used Unkey as a third-party key issuance and management layer, with DynamoDB as a hot-path verification cache kept in sync via webhooks. The full chain was:

```
Clerk user.created  →  Stripe customer  →  Unkey key  →  DynamoDB
                                            │
                                            └──webhooks──┐
                                                         ▼
                                    Unkey key.updated → DynamoDB sync

15-min reconciliation Lambda:
  Unkey API ←→ DynamoDB table  (fix missed webhooks)
```

Forces at play:

- **Reliability burden.** Every webhook hop is a failure point. Unkey → DynamoDB sync webhooks failing silently would mean a deleted key keeps working or a downgraded key keeps old limits. A 15-minute reconciliation Lambda was added as a safety net.
- **Cost trajectory.** Unkey free tier was 150K verifications/month — but verifications were always served from DynamoDB (Unkey was only involved in CRUD operations, well under the free tier). Beyond Phase 1, paid tier starts at $25/mo. Nothing was gained for the spend.
- **Vendor in a critical path.** Clerk webhook → Unkey API failure blocks user provisioning. Unkey outages block all new signups.
- **Complexity per developer.** Three systems to reason about (Clerk, Unkey, DynamoDB) for what is fundamentally "generate a random string, hash it, store it." Same pattern as GitHub, Stripe, AWS — none of which use a third-party for API key management.
- **~80 LOC of crypto + DynamoDB replaces the entire integration.** `crypto.randomBytes(24)` + `createHash('sha256')` + `DynamoDBClient.send(GetCommand)`. Covered by the standard library and AWS SDK.

## Decision

Remove Unkey entirely. API key management moves to custom code in `packages/shared/src/keys.ts` (~80 LOC) backed by DynamoDB:

- `generateKey()` returns `{ raw, hash, prefix }` where `raw = "pq_live_" + randomBytes(24).toString("hex")` and `hash = SHA-256(raw)`.
- `hashKey(raw)` → SHA-256 for verification.
- `prontiq-keys` table stores only the hash as primary key (never the raw key).
- `prontiq-audit` table captures every lifecycle event (CREATE/ROTATE/REVOKE/UPGRADE/DOWNGRADE).
- Rotation writes a `REDIRECT` record to `prontiq-usage` so in-flight requests against the old key still succeed briefly and orphaned usage is attributable to the new key.

See ARCHITECTURE.MD §5.5 for the full schema and §7 for the verification middleware chain.

## Consequences

**Positive:**

- One fewer vendor. No Unkey account, API key, webhook endpoint, or billing line item.
- No webhook sync hop → one class of failure mode (stale DynamoDB after missed webhook) disappears.
- No reconciliation Lambda → one scheduled job disappears.
- $25/mo saved at scale, $0 today.
- Hot-path verification reduces to a single DynamoDB `GetItem` by hash — no network call to Unkey, no cache-staleness question.
- Simpler threat model: raw key never leaves the user → no "stolen from Unkey" attack vector.

**Negative:**

- Loss of Unkey's management UI (last-used timestamps, per-key dashboards, rate-limit rules). Rebuilt as DynamoDB-backed queries behind `/v1/account/keys` and rendered in the `/account` page (P1B / P1C).
- Writing our own key code means owning the crypto correctness: prefix format, random source, hash algorithm, collision probability, REDIRECT record semantics. The code is small but load-bearing. Covered by P1B.12 integration tests.
- Migration from the live `ApiKeyTable` (raw-key PK, nested usage map) to `prontiq-keys` + `prontiq-usage` (hash-based PK, per-month scope items) is a data migration, tracked by ROADMAP P1B.04b.

**Neutral:**

- Clerk is retained for human identity (sign-in, orgs, sessions). Only machine identity (API keys) moved. The two systems remain decoupled.

## Alternatives Considered

- **Continue Unkey with better reconciliation.** Shorter reconciliation interval or event replay. Rejected: doesn't remove the sync-hop failure mode, doesn't remove the vendor, and adds ops complexity.
- **Clerk machine identity (M2M tokens).** Clerk offers machine-to-machine tokens. Rejected at this time: the feature is newer and less battle-tested than API-key patterns from GitHub/Stripe; would couple all provisioning to a single vendor.
- **AWS Cognito user pools for machine identity.** Rejected: overkill and wrong shape — Cognito is designed for human auth flows, not long-lived API keys.
- **Third-party gateway with built-in key management (e.g., Kong, Tyk).** Rejected: much larger footprint than the problem requires, and forces a specific deployment topology.

---

_Date: 2026-04-15_
_Decision makers: Prontiq Engineering_
