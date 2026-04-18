# Prontiq Platform Architecture

> A unified data API platform for Australian and global open data, commercialised with obsessive developer experience.

**Repo:** `prontiq-platform` (private)
**Public repos:** [`flat-white`](https://github.com/jbejenar/flat-white) (address pipeline), [`prontiq-ariscan`](https://github.com/jbejenar/prontiq-ariscan) (AI readiness scanner), `abn-extract` (future), `lei-extract` (future)
**Version:** 2.2
**Author:** Prontiq Engineering
**Last Updated:** April 2026

> **v2.2 (2026-04-15):** Unkey removed — API keys are DynamoDB-native (SHA-256 hash, ~80 LOC). Added §5.10 Brand, §7 Auth & Endpoint Reference, §8 Security, §9 Error Taxonomy, §10 Monitoring, §11 Retention, §12 Edge Cases. Replaced §14 Phasing with security deliverables. Schema migration tracked in ROADMAP P1B.04b.

---

## 1. Vision

Every product on this platform follows one pattern:

```
Free open dataset → independent pipeline → S3 (NDJSON + manifest.json)
    → event-driven indexing → OpenSearch → commercial API
    → auth / billing / docs / SDKs
```

One Prontiq subscription. One API key. One SDK. One invoice. Family-level credit lines that stay simple for customers even when endpoint costs differ internally. The developer who came for address validation discovers ABN verification and LEI lookup. That's the lock-in. That's the moat.

Nobody else bundles Australian address validation with ABN verification with LEI lookup under one subscription with typed SDKs and a free tier. The data is free. The compute is cheap. The moat is the platform that makes consuming it trivially easy, beautifully documented, and cheaper than the incumbents.

---

## 2. Product Roadmap

### Tier 1 — Build first, prints money

| Product                        | Data Source       | Licence   | Update Cadence | Market Gap                                                                              | Status                        |
| ------------------------------ | ----------------- | --------- | -------------- | --------------------------------------------------------------------------------------- | ----------------------------- |
| **Address validation** (G-NAF) | data.gov.au       | CC BY 4.0 | Quarterly      | Incumbents (Loqate, Aust Post) are expensive, clunky, and lack enrichment               | Pipeline built (`flat-white`) |
| **ABN/ASIC verification**      | ABR bulk extract  | Open      | Daily          | Zero free developer-friendly API. CreditorWatch charges $3-5/lookup. Regulatory demand. | Next                          |
| **GLEIF/LEI lookup**           | GLEIF Golden Copy | Open      | Daily          | International play. Banks, cross-border payments, compliance teams need LEI resolution. | After ABN                     |

### Tier 2 — Strong revenue, longer sales cycle

| Product                         | Data Source          | Licence | Update Cadence | Market Gap                                                                                                                                                          |
| ------------------------------- | -------------------- | ------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **CVE/NVD vulnerability intel** | NVD JSON feeds       | Open    | Continuous     | Free-tier alternative to Snyk ($20-100K/yr). Integrates with [`ariscan`](https://github.com/jbejenar/prontiq-ariscan) — Prontiq's open-source AI readiness scanner. |
| **Patent/trademark search**     | IP Australia + USPTO | Open    | Periodic       | $500-2K per search via commercial providers. OpenSearch fuzzy matching is proven.                                                                                   |

### Tier 3 — Viable, more crowded

| Product                        | Data Source            | Notes                                                                |
| ------------------------------ | ---------------------- | -------------------------------------------------------------------- |
| **Property zoning & planning** | State planning portals | Wedge: API for PropTech devs, not competing with CoreLogic end-users |
| **SEC EDGAR financials**       | SEC                    | Later addition once platform pattern proven                          |

---

## 3. Platform Stack

### 3.1 Stack Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           OPEN DATA SOURCES                                  │
│   G-NAF (quarterly)  ·  ABR (daily)  ·  GLEIF (daily)  ·  NVD  ·  IP Aus  │
└──────────────────────────────┬──────────────────────────────────────────────┘
                               │  Each pipeline ships NDJSON to data/, manifest to manifests/
                               ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         S3 BUCKET                                            │
│   flat-white-address-493712557159-ap-southeast-2-an                         │
│                                                                              │
│   data/                              manifests/                              │
│   ├── address/2026-02/*.ndjson       ├── address-2026-02.json  ← TRIGGER   │
│   ├── abn/2026-04-09/*.ndjson        ├── abn-2026-04-09.json               │
│   ├── lei/2026-04-09/*.ndjson        └── lei-2026-04-09.json               │
│   └── ...                                                                    │
└──────────────────────────────┬──────────────────────────────────────────────┘
                               │  Any .json landing in manifests/ triggers EventBridge
                               ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                    EVENT-DRIVEN INGESTION                                     │
│                                                                              │
│   EventBridge ──▶ Step Functions                                             │
│   ┌──────────────────────────────────────────────────────┐                  │
│   │ 1. Read manifest, validate schema, verify checksums  │                  │
│   │ 2. Create versioned index, apply mappings            │                  │
│   │ 3. Parallel Map: each NDJSON file → Lambda bulk POST │                  │
│   │ 4. Enable refresh, force merge                       │                  │
│   │ 5. Health check (doc count, sample queries, latency) │                  │
│   │ 6. Atomic alias swap (zero downtime)                 │                  │
│   │ 7. Wait 1 hour, delete old index                     │                  │
│   └──────────────────────────────────────────────────────┘                  │
└──────────────────────────────┬──────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                      OPENSEARCH CLUSTER                                      │
│   Domain: flat-white  ·  Engine: OpenSearch 2.19                            │
│   Dev: t3.small.search × 1  ·  Prod: t3.medium.search × 2                 │
│                                                                              │
│   Indices:                        Aliases:                                   │
│   ├── address-2026-02        →    addresses                                  │
│   ├── abn-2026-04-09         →    abn-entities                              │
│   ├── lei-2026-04-09         →    lei-entities                              │
│   ├── cve-2026-04-09         →    cve-vulnerabilities                       │
│   └── patents-2026-04        →    au-patents                                │
└──────────────────────────────┬──────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         API LAYER                                            │
│   Hono + @hono/zod-openapi on Lambda (ARM64, Node.js 20)  ·  SST v4 + Pulumi   │
│   Auto-generates OpenAPI 3.1 spec from Zod route schemas                        │
│                                                                              │
│   /v1/address/*    /v1/abn/*    /v1/lei/*    /v1/cve/*    /v1/patents/*     │
│                                                                              │
│   Shared middleware:                                                         │
│   CORS → Key extraction → DynamoDB verify → Tier check → Rate limit          │
│   → Route handler → Async usage increment → Response                        │
└──────────────────────────────┬──────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                      COMMERCIAL LAYER                                        │
│                                                                              │
│   ┌──────────────────────────────┐  ┌──────────────────────────────┐       │
│   │   DynamoDB (API keys)        │  │          Stripe              │       │
│   │   SHA-256 hash verification  │  │  Metered per-product billing │       │
│   │   Hot-path gen + verify      │  │  One sub, credit-based lines │       │
│   │   (~80 LOC, no vendor)       │  │  Embedded pricing table      │       │
│   └──────────────────────────────┘  └──────────────────────────────┘       │
└──────────────────────────────┬──────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                    CUSTOMER-FACING SURFACES                                   │
│                                                                              │
│   ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐         │
│   │  /account page   │  │  Docs + Playground│  │      SDKs       │         │
│   │  Next.js + Clerk │  │    Mintlify      │  │    Speakeasy    │         │
│   │  <UserProfile /> │  │  (from OpenAPI)  │  │  (from OpenAPI) │         │
│   │                  │  │                  │  │                  │         │
│   │ · Profile        │  │ · Per-product    │  │ · TypeScript    │         │
│   │ · Security       │  │   sections       │  │ · Python        │         │
│   │ · Usage          │  │ · Interactive    │  │ · PHP           │         │
│   │ · Billing        │  │   playground     │  │ · Go            │         │
│   │ · API Key        │  │ · Code snippets  │  │ · Ruby          │         │
│   └──────────────────┘  └──────────────────┘  └──────────────────┘         │
└──────────────────────────────┬──────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                        DISTRIBUTION                                          │
│                                                                              │
│   Shopify plugin  ·  WooCommerce plugin  ·  <prontiq-address> web component │
│   ariscan integration (CVE → security pillar, APIs → design pillar)         │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 3.2 Stack Decision Table

| Layer                     | Tool                                         | Free Tier                                                 | First Paid Tier         | Why This One                                                                                                                                                              |
| ------------------------- | -------------------------------------------- | --------------------------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Infrastructure**        | SST v4 + Pulumi                              | —                                                         | —                       | Deploys API + dashboard from one repo. `sst dev` for live Lambda dev. No CloudFormation synth step.                                                                       |
| **API framework**         | Hono + `@hono/zod-openapi` on Lambda (ARM64) | —                                                         | —                       | Route groups per product, shared middleware, auto OpenAPI 3.1 spec from Zod route schemas. The spec is the atom from which docs and SDKs are derived.                     |
| **Search**                | OpenSearch managed                           | ~$35/mo (t3.small)                                        | ~$150/mo (2× t3.medium) | One cluster, index per product, alias-swap for zero-downtime updates.                                                                                                     |
| **Data pipelines**        | Independent per product                      | —                                                         | —                       | Each ships NDJSON + manifest.json to S3. Platform reacts.                                                                                                                 |
| **Ingestion**             | EventBridge → Step Functions                 | AWS free tier                                             | —                       | S3 manifest trigger → parallel bulk index → health check → alias swap.                                                                                                    |
| **Auth (portal)**         | Clerk                                        | **50,000 MAUs free**                                      | $20/mo (Pro)            | Sign-up, login, OAuth, orgs, teams. Pre-built Next.js components. Won't hit paid for years.                                                                               |
| **API keys**              | DynamoDB (+ DAX from Phase 3)                | AWS free tier                                             | —                       | DynamoDB-native: generate, SHA-256 hash, verify. Raw key never stored. ~80 LOC (see §7). No vendor in the hot path. DAX when sub-ms matters at scale.                     |
| **Billing**               | Stripe (metered)                             | **Processing fees only**                                  | 2.9% + 30¢/txn          | One subscription, family-level credit line items. Embedded pricing table + customer portal. $0 until revenue.                                                             |
| **Docs**                  | Mintlify                                     | **Free Hobby plan** (1 editor, custom domain, playground) | ~$250-300/mo (Pro)      | Beautiful docs from OpenAPI spec. Free tier covers a solo founder. AI assistant and team collaboration only on paid.                                                      |
| **SDKs**                  | Speakeasy                                    | **1 SDK, up to 50 API methods, free forever**             | Contact for pricing     | Auto-generated typed SDKs. 50 methods covers entire address + ABN + LEI surface.                                                                                          |
| **Account page**          | Next.js (`/account`) + Clerk `<UserProfile />` | Deployed to Lambda via SST ($0)                           | —                       | No custom dashboard. Clerk's profile UI with custom tabs (Usage, Billing, API Keys) wired to DynamoDB-backed `/v1/account/*` endpoints. See §5.9.                          |
| **CI/CD**                 | GitHub Actions + OIDC                        | Free tier                                                 | —                       | No stored AWS credentials. Short-lived STS tokens per run.                                                                                                                |
| **Monitoring**            | CloudWatch + X-Ray                           | Included with AWS                                         | —                       | Per-handler latency, error rates, usage dashboards.                                                                                                                       |

### 3.3 Monthly Cost Model

| Stage                     | OpenSearch                                 | Clerk                    | Mintlify                 | Speakeasy | Stripe          | SES           | Total               |
| ------------------------- | ------------------------------------------ | ------------------------ | ------------------------ | --------- | --------------- | ------------- | ------------------- |
| **Phase 1** (0-100 devs)  | $35                                        | $0                       | $0                       | $0        | $0              | <$1/mo        | **~$35/mo**         |
| **Phase 2** (100-1K devs) | $150 (scale to 2-node — see trigger below) | $0                       | $0                       | $0        | Processing fees | <$1/mo        | **~$170/mo + fees** |
| **Phase 3** (1K-10K devs) | $150                                       | $0                       | $0                       | $0        | Processing fees | ~$5/mo        | **~$170/mo + fees** |
| **Phase 4** (10K+ devs)   | $150+                                      | $0 (still under 50K MAU) | ~$250 (need team collab) | Contact   | Processing fees | ~$20-50/mo    | **~$420/mo + fees** |

You reach $420/month only when you have 10,000+ developers generating significant revenue. Until then: **$35/month** (Phase 1), scaling to **$170/month** when the HA trigger fires.

> **OpenSearch HA scaling trigger:** Scale from t3.small × 1 (no replicas) to t3.medium × 2 (1 replica) when ANY of these conditions is met: (1) 10 paying customers, (2) $500 MRR, (3) second product (ABN) goes live. Phase 1 on a single node is acceptable pre-revenue — a few hours of downtime during an AZ outage or maintenance window is tolerable. Once there are paying customers relying on SLA-adjacent uptime, single-node is not. The scaling trigger is a business decision, not a technical one — define it now, execute it at the threshold. Note: OpenSearch managed service has mandatory maintenance windows even on multi-node clusters; schedule them for low-traffic hours (e.g., Sunday 03:00 AEST).

---

## 4. Existing AWS Resources

| Resource             | Value                                                                                                                                                          |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Account              | `493712557159`                                                                                                                                                 |
| Region               | `ap-southeast-2` (Sydney)                                                                                                                                      |
| S3 bucket            | `flat-white-address-493712557159-ap-southeast-2-an` (all products, all phases)                                                                                 |
| IAM role (pipelines) | `arn:aws:iam::493712557159:role/flat-white-role`                                                                                                               |
| IAM role (platform)  | `prontiq-platform-deploy-role` (to be created — needs CF, Lambda, APIGW, DynamoDB, IAM, CW, OpenSearch)                                                        |
| IAM policy           | `arn:aws:iam::493712557159:policy/flat-white-s3-access`                                                                                                        |
| OpenSearch domain    | `flat-white` — t3.small.search × 1, 50GB gp3, OpenSearch 2.19. Name is historical; OpenSearch doesn't support domain renaming. All products share this domain. |
| GitHub OIDC          | Provider configured for `token.actions.githubusercontent.com`                                                                                                  |
| Encryption           | HTTPS enforced, encryption at rest disabled (open data)                                                                                                        |

---

## 5. Deep Dives

### 5.1 Data Pipelines

Each data source has its own independent pipeline in its own repo. The platform doesn't care who built the pipeline or where it runs. It cares that the output conforms to the manifest contract. This contract is the most important interface in the architecture — every pipeline built for the next five years will speak it.

#### 5.1.1 S3 Bucket Strategy

**One bucket. Two top-level directories. Data and signal are separated.**

The existing bucket `flat-white-address-493712557159-ap-southeast-2-an` is used for all products, all phases. The name has "address" in it — that's historical. It doesn't matter.

```
flat-white-address-493712557159-ap-southeast-2-an/
│
├── data/                                           ← ALL product data lives here
│   │                                                  Pipelines write here throughout their run
│   │
│   ├── address/
│   │   ├── 2026-02/
│   │   │   ├── mappings.json                       ← index mappings for THIS version
│   │   │   ├── vic.ndjson
│   │   │   ├── nsw.ndjson
│   │   │   ├── qld.ndjson
│   │   │   ├── sa.ndjson
│   │   │   ├── wa.ndjson
│   │   │   ├── tas.ndjson
│   │   │   ├── nt.ndjson
│   │   │   └── act.ndjson
│   │   └── 2026-05/
│   │       ├── mappings.json                       ← may be identical, but versioned
│   │       └── ...                                 ← next quarterly release
│   │
│   ├── abn/
│   │   ├── 2026-04-09/
│   │   │   ├── mappings.json
│   │   │   ├── entities-001.ndjson
│   │   │   └── entities-002.ndjson
│   │   └── 2026-04-10/
│   │       ├── mappings.json
│   │       └── ...                                 ← daily update
│   │
│   ├── lei/
│   │   └── 2026-04-09/
│   │       ├── mappings.json
│   │       └── golden-copy.ndjson
│   │
│   └── cve/
│       └── 2026-04-09/
│           ├── mappings.json
│           └── nvd-cves.ndjson
│
└── manifests/                                      ← CENTRAL TRIGGER DIRECTORY
    │                                                  EventBridge watches ONLY this prefix
    │                                                  Any .json landing here fires the Step Function
    │
    ├── address-2026-02.json                        ← triggers address ingestion
    ├── abn-2026-04-09.json                         ← triggers ABN ingestion
    ├── abn-2026-04-10.json
    └── lei-2026-04-09.json
```

**Why two directories, not one:**

The previous design had `manifest.json` living inside each version directory alongside the NDJSON files. That means EventBridge needs a wildcard rule matching `*/manifest.json` across the entire bucket — which could accidentally trigger on any file named `manifest.json` in any nested path (documentation, backup, mistake). Worse, it tangles the data and the signal in the same directory tree.

The central `manifests/` directory solves this:

- **One EventBridge rule:** `prefix: manifests/`, `suffix: .json`. Unambiguous. Nothing else in the bucket can accidentally trigger ingestion.
- **Clear separation of concerns:** `data/` is the staging area — pipelines write here over minutes or hours, uploading NDJSON files in whatever order they want. `manifests/` is the trigger — a single small JSON file lands once, at the end, after all data is uploaded and verified.
- **Flat and auditable:** `ls manifests/` shows you every ingestion that's ever been triggered. Each file is timestamped by S3. It's a natural audit trail.
- **Idempotent retries:** overwriting a manifest (same filename) triggers EventBridge again. The Step Function checks if the index already exists and skips. Safe.

**Pipeline workflow (every pipeline follows this sequence):**

```
1. Upload NDJSON files to data/{product}/{version}/
   (order doesn't matter, can be parallel)
   IMPORTANT: Upload with ChecksumAlgorithm: SHA256 so S3 stores
   the checksum natively. The platform verifies via HEAD metadata —
   zero data transfer, zero re-streaming.

2. Upload mappings.json to data/{product}/{version}/mappings.json
   (copy forward from previous version if schema unchanged)

3. Verify all files present in S3
   (HEAD each key, confirm Content-Length and ChecksumSHA256)

4. Build manifest JSON
   (product, version, file list with S3-verified checksums, totals)

5. Upload manifest to manifests/{product}-{version}.json
   ← THIS IS THE TRIGGER
   ← This is the LAST thing the pipeline does
   ← Everything before this is invisible to the platform
```

**Manifest filename convention:** `{product}-{version}.json`. The filename is for human readability and debugging. The manifest content is authoritative — the Step Function reads the JSON, not the filename. But the naming convention makes `aws s3 ls s3://bucket/manifests/` instantly readable:

```
2026-04-09 14:30:00   address-2026-02.json
2026-04-09 18:15:00   abn-2026-04-09.json
2026-04-10 06:00:00   abn-2026-04-10.json
2026-04-10 06:05:00   lei-2026-04-09.json
```

**Key design decisions:**

- **`mappings.json` lives at `data/{product}/{version}/mappings.json` — per-version, not shared.** Most version bumps reuse the same mappings (copy forward). But when a schema change does happen, the old version's mappings are preserved alongside its data. This means any version can be re-ingested at any time — rollback, debugging, disaster recovery — without risk of mappings drift. The manifest references this path explicitly via `index.mappings_key`.
- **Version directories use the format the upstream data uses.** G-NAF: `2026-02` (year-month). ABR: `2026-04-09` (year-month-day). GLEIF likewise. The platform treats version as an opaque string.
- **No run IDs in any path.** Retries overwrite. The manifest is authoritative.
- **S3 lifecycle rules:** `data/` versions older than 90 days → Glacier or delete. `manifests/` files are tiny (< 1KB) — keep indefinitely as audit trail, or lifecycle to Glacier after 1 year.

**IAM policy per pipeline (example for flat-white):**

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:GetObject"],
      "Resource": [
        "arn:aws:s3:::flat-white-address-493712557159-ap-southeast-2-an/data/address/*",
        "arn:aws:s3:::flat-white-address-493712557159-ap-southeast-2-an/manifests/address-*"
      ]
    },
    {
      "Effect": "Allow",
      "Action": "s3:ListBucket",
      "Resource": "arn:aws:s3:::flat-white-address-493712557159-ap-southeast-2-an",
      "Condition": {
        "StringLike": { "s3:prefix": ["data/address/*", "manifests/address-*"] }
      }
    }
  ]
}
```

Each pipeline can write data (NDJSON + per-version `mappings.json`) to its own `data/{product}/` prefix and manifests matching `manifests/{product}-*`. No pipeline can write to another product's data or trigger another product's ingestion. The ABN pipeline gets the same structure scoped to `data/abn/*` and `manifests/abn-*`.

**EventBridge rule (one rule, all products):**

```json
{
  "source": ["aws.s3"],
  "detail-type": ["Object Created"],
  "detail": {
    "bucket": { "name": ["flat-white-address-493712557159-ap-southeast-2-an"] },
    "object": { "key": [{ "prefix": "manifests/" }, { "suffix": ".json" }] }
  }
}
```

That's it. Any `.json` file landing in `manifests/` triggers the Step Function. The Step Function reads the file, validates it, and proceeds. One rule. All products. Forever.

#### 5.1.2 Manifest Contract

The manifest is the platform's API boundary. Every field has been considered for what could go wrong if it's missing, wrong, or misused. The platform supports two manifest versions via a discriminated union on `manifest_version`.

**v1 manifest** (original — all files are ingest sources):

```json
{
  "manifest_version": 1,
  "product": "address",
  "version": "2026-02",
  "created_at": "2026-04-09T14:30:00Z",
  "pipeline": { "repo": "jbejenar/flat-white", "commit": "a1b2c3d4e5f6", "run_id": "12345678" },
  "source": { "name": "G-NAF", "release": "February 2026", "url": "https://data.gov.au/dataset/geocoded-national-address-file-g-naf" },
  "files": [
    { "key": "data/address/2026-02/all.ndjson.gz", "records": 15823417, "bytes": 1702942457, "sha256": "d7a8fbb307d7809469ca9abcb0082e4f..." }
  ],
  "total_records": 15823417,
  "index": {
    "mappings_key": "data/address/2026-02/mappings.json",
    "settings": { "number_of_shards": 1, "number_of_replicas": 0 }
  }
}
```

**v2 manifest** (current — separates inventory from ingest sources):

```json
{
  "manifest_version": 2,
  "product": "address",
  "version": "2026-02-7",
  "created_at": "2026-04-11T10:00:00Z",
  "pipeline": { "repo": "jbejenar/flat-white", "commit": "abc123def456", "run_id": "99999999" },
  "source": { "name": "G-NAF", "release": "February 2026", "url": "https://data.gov.au/dataset/geocoded-national-address-file-g-naf" },
  "files": [
    { "key": "data/address/2026-02-7/nsw.ndjson.gz", "records": 3000000, "bytes": 500000000, "sha256": "..." },
    { "key": "data/address/2026-02-7/vic.ndjson.gz", "records": 2500000, "bytes": 400000000, "sha256": "..." },
    { "key": "data/address/2026-02-7/all.ndjson.gz", "records": 15015573, "bytes": 1702942457, "sha256": "..." }
  ],
  "total_records": 15015573,
  "index": {
    "mappings_key": "data/address/2026-02-7/mappings.json",
    "settings": { "number_of_shards": 1, "number_of_replicas": 0 },
    "source_keys": ["data/address/2026-02-7/all.ndjson.gz"]
  }
}
```

**Key v1/v2 differences:**

| Concern | v1 | v2 |
|---------|----|----|
| `files[]` | Ingest sources only | Full data-file inventory (state files + consolidated files) |
| `index.source_keys` | Not present | Array of S3 keys to ingest (subset of `files[]`) |
| `total_records` | Sum of all `files[].records` | Sum of `source_keys` files' records only |
| Ingestion source | All files in `files[]` | Only files referenced by `source_keys` |

The platform verifies ALL `files[]` entries (HEAD for size + checksum) regardless of version. Only `source_keys` files are ingested into OpenSearch. For v1, all files are treated as ingest sources (backward compatible).

**Field-by-field rationale:**

| Field                | Type       | Why It Exists                                                                                                                                                                                                                                                                                                                                      | What Happens If It's Wrong                                                                                  |
| -------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `manifest_version`   | `integer`  | Forward compatibility. If the contract changes, the Step Function can handle v1 and v2 manifests differently.                                                                                                                                                                                                                                      | Step Function rejects unknown versions with an explicit error.                                              |
| `product`            | `string`   | The platform's product registry key. Derives the index name pattern (`{product}-{version}`) and the alias name.                                                                                                                                                                                                                                    | Step Function validates against a known product registry (DynamoDB or hardcoded). Unknown product → reject. |
| `version`            | `string`   | Opaque version identifier. Combined with `product` to form the index name.                                                                                                                                                                                                                                                                         | Duplicate version → Step Function detects existing index, skips or overwrites based on config.              |
| `created_at`         | `ISO 8601` | Audit trail. Also used to reject stale manifests — Step Function can refuse to ingest a manifest older than the current live version.                                                                                                                                                                                                              | Missing → warning, not fatal. Wrong → stale detection may misfire.                                          |
| `pipeline.repo`      | `string`   | Traceability. Every dataset can be traced back to a specific repo, commit, and CI run.                                                                                                                                                                                                                                                             | Missing → acceptable (manual uploads), but logged as a warning.                                             |
| `pipeline.commit`    | `string`   | Pinpoints the exact code that produced this data. Essential for debugging bad data.                                                                                                                                                                                                                                                                | Same as above.                                                                                              |
| `pipeline.run_id`    | `string`   | Links to the GitHub Actions run for full logs.                                                                                                                                                                                                                                                                                                     | Same as above.                                                                                              |
| `source.name`        | `string`   | Human-readable upstream data source name. Documentation, not machine-consumed.                                                                                                                                                                                                                                                                     | Missing → acceptable.                                                                                       |
| `source.release`     | `string`   | Upstream release identifier. For G-NAF this is "February 2026". For ABR it might be "2026-04-09".                                                                                                                                                                                                                                                  | Missing → acceptable.                                                                                       |
| `source.url`         | `string`   | Link to the upstream data source. Provenance documentation.                                                                                                                                                                                                                                                                                        | Missing → acceptable.                                                                                       |
| `files[].key`        | `string`   | S3 key relative to the bucket root. The Step Function resolves against the same bucket the manifest was uploaded to. NOT a full `s3://` URI — keeps the manifest portable across environments.                                                                                                                                                     | Step Function verifies each key exists in S3 before proceeding. Missing file → abort.                       |
| `files[].records`    | `integer`  | Expected record count in this file. v1: summed across all files must equal `total_records`. v2: summed across `source_keys` files must equal `total_records`.                                                                                                                                                                                      | Mismatch → health check fails → alias swap blocked.                                                         |
| `files[].bytes`      | `integer`  | Expected file size. Step Function verifies against S3 `ContentLength` before ingestion. Catches truncated uploads.                                                                                                                                                                                                                                 | Mismatch → abort before wasting time on bulk indexing.                                                      |
| `files[].sha256`     | `string`   | Content integrity. Stored as lowercase hex SHA-256. Platform compares against S3 native `ChecksumSHA256` metadata after normalizing encodings (manifest hex vs S3 base64). Zero data transfer verification.                                                                                                                                        | Mismatch → abort with explicit error identifying the corrupted file.                                        |
| `total_records`      | `integer`  | v1: sum of all `files[].records`. v2: sum of `source_keys` files' records. Health check queries OpenSearch `_count` after ingestion and compares.                                                                                                                                                                                                  | Mismatch → health check fails → alias swap blocked → old index stays live → alert fires.                    |
| `index.mappings_key` | `string`   | S3 key for the OpenSearch index mappings file. Per-version so that any version can be re-ingested with its original schema — essential for rollback and disaster recovery.                                                                                                                                                                         | Step Function reads this file and applies it when creating the versioned index. Missing → abort.            |
| `index.settings`     | `object`   | Per-product index settings (shards, replicas). Phase 1: 1 shard, 0 replicas on single-node t3.small. Product ingestion policy can override.                                                                                                                                                                                                       | Missing → Step Function applies sensible defaults (1 shard, 0 replicas).                                    |
| `index.source_keys`  | `string[]` | **v2 only.** Array of S3 keys from `files[]` that should be ingested into OpenSearch. Separates the full data-file inventory from the ingest targets. Must be non-empty; every entry must exist in `files[].key`.                                                                                                                                  | Missing in v2 → schema validation fails. Key not in files[] → abort.                                        |

**What the pipeline does NOT specify:**

| Concern              | Who Owns It                                       | Why                                                                                                                                                           |
| -------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Index name**       | Platform derives it as `{product}-{version}`      | Prevents naming collisions and ensures consistency.                                                                                                           |
| **Alias name**       | Platform derives it from a product registry       | A bug in any pipeline cannot corrupt the alias mapping. The platform maintains a product→alias lookup (e.g. `address` → `addresses`, `abn` → `abn-entities`). |
| **Refresh interval** | Platform always sets `-1` during bulk, `1s` after | Ingestion optimisation is the platform's concern, not the pipeline's.                                                                                         |
| **Force merge**      | Platform always runs post-ingestion               | Same — read optimisation is standardised.                                                                                                                     |

**Product registry** (maintained by the platform, not by pipelines):

```json
{
  "address": {
    "alias": "addresses",
    "description": "G-NAF Australian address validation",
    "retention_hours": 168,
    "cache_ttl_seconds": 3600,
    "update_cadence": "quarterly"
  },
  "abn": {
    "alias": "abn-entities",
    "description": "ABR business entity verification",
    "retention_hours": 48,
    "cache_ttl_seconds": 900,
    "update_cadence": "daily"
  },
  "lei": {
    "alias": "lei-entities",
    "description": "GLEIF Legal Entity Identifier lookup",
    "retention_hours": 48,
    "cache_ttl_seconds": 900,
    "update_cadence": "daily"
  },
  "cve": {
    "alias": "cve-vulnerabilities",
    "description": "NVD vulnerability intelligence",
    "retention_hours": 24,
    "cache_ttl_seconds": 300,
    "update_cadence": "continuous"
  },
  "patents": {
    "alias": "au-patents",
    "description": "IP Australia patent and trademark search",
    "retention_hours": 168,
    "cache_ttl_seconds": 3600,
    "update_cadence": "periodic"
  }
}
```

This registry lives in the platform repo (DynamoDB table or SST config). Adding a new product means adding one entry here and building a pipeline that outputs the manifest contract. The ingestion infrastructure handles everything else. The `retention_hours` and `cache_ttl_seconds` fields drive the index lifecycle (section 5.2.4) and API Gateway caching (section 5.4) respectively.

#### 5.1.3 Manifest Validation (Step Function, Step 1)

Before any indexing begins, the Step Function validates the manifest rigorously:

```
1. Parse manifest JSON — reject if malformed
2. Check manifest_version — reject if unknown
3. Validate product against registry — reject if unknown
4. Verify all files exist in S3:
   a. HEAD each files[].key — reject if any missing
   b. Compare Content-Length to files[].bytes — reject if mismatch
   c. Compare S3 ChecksumSHA256 (from HEAD response) to files[].sha256 — reject if mismatch
      (Pipelines MUST upload with ChecksumAlgorithm: SHA256 so S3 stores the checksum natively.
       Verification is a metadata check — zero data transfer, zero compute.)
5. Verify sum of files[].records equals total_records — reject if mismatch
6. Read index.mappings_key from S3 — reject if missing or invalid JSON
7. Sample content validation:
   a. Read the first 500 records from each NDJSON file
   b. Parse each line as JSON — reject if malformed
   c. Validate field presence and types against the mappings schema
      (e.g., `addressLabelSearch` is string, `confidence` is integer, `geocode.latitude` is number)
   d. Reject if >1% of sampled records fail validation
   This catches pipeline bugs that produce structurally valid NDJSON with wrong field types —
   which would otherwise pass all checks, get indexed (OpenSearch silently coerces), and serve garbage.
8. Check if index {product}-{version} already exists:
   a. If yes and force=false → skip (idempotent, already ingested)
   b. If yes and force=true → delete existing index, proceed
9. All checks pass → proceed to index creation
```

If any check fails, the Step Function aborts with a descriptive error, sends an SNS alert, and the current live alias stays untouched. No partial state. No half-indexed data.

**Concurrency control:** If two manifests for the same product land simultaneously (retry + new version), two Step Functions would race on the alias swap. Concurrency is controlled at the Step Functions level — see section 5.2.3 for the deduplication approach (no DynamoDB locks needed).

**The `force` parameter:** Step 7b references `force=true` to overwrite an existing index. This is NOT a manifest field — it's a Step Function execution input parameter, set manually when re-ingesting a version (e.g., `aws stepfunctions start-execution --input '{"force": true}'`). Default is `false` (skip if index exists, ensuring idempotency).

**Rollback:** If the new version passes the health check but contains bad data (correct count, incorrect content), the old index remains in the cluster for the product's configured retention period (section 5.2.4 — 7 days for address, 48 hours for ABN/LEI). Rollback is a single `_aliases` API call to swap back — instant, < 30 seconds including cache flush. After the retention window expires, rollback requires re-running the pipeline with the previous version's manifest. The old NDJSON files and per-version mappings remain in S3 (90-day lifecycle) so re-ingestion is always possible with the correct schema.

#### 5.1.4 Error Response Format

All API endpoints return errors in a consistent JSON shape. This format is defined in the Zod schemas so Speakeasy generates proper error types in every SDK.

```json
{
  "error": {
    "code": "QUOTA_EXCEEDED",
    "message": "Monthly quota exceeded for product 'address'",
    "status": 429,
    "request_id": "req_a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "details": {
      "product": "address",
      "used": 50000,
      "limit": 50000,
      "resets_at": "2026-05-01T00:00:00Z"
    }
  }
}
```

The `request_id` is generated per request (`crypto.randomUUID()` with `req_` prefix) and included in every response — success and error. The same ID is logged in CloudWatch structured logs, enabling direct trace from customer report to log entry.

Complete error code table is in §9 Error Taxonomy. The four hot-path codes in live code today are `MISSING_API_KEY`, `INVALID_API_KEY`, `PRODUCT_NOT_ALLOWED`, `QUOTA_EXCEEDED`.

#### 5.1.5 API Versioning

The API is versioned via URL path prefix (`/v1/`). Breaking changes ship as `/v2/` routes alongside `/v1/`. Both versions run simultaneously in the same Hono app — separate route groups, shared middleware. Deprecation: `/v1/` routes return a `Sunset` header 90 days before removal. Non-breaking additions (new fields in response, new optional query parameters) ship within `/v1/` without a version bump.

Every pipeline speaks this contract. `flat-white` produces it. The future ABN pipeline produces it. GLEIF produces it. The platform handles everything downstream.

### 5.2 Event-Driven Ingestion & Zero-Downtime Index Lifecycle

> **Note:** This describes the Phase 2+ target architecture. Phase 1 uses a simpler GitHub Actions cron job that runs the same steps sequentially. Step Functions is introduced in Phase 2 when multiple products with different cadences justify the orchestration.

The core principle: **the application always queries an alias, never a versioned index name.** New data is indexed into a fresh versioned index, validated in isolation, then swapped in atomically. The old index stays around as a rollback target. This works independently per product — address can be updating while ABN is stable.

#### 5.2.1 Blue-Green Index Deployment

```
S3 manifest lands in manifests/
        │
        ▼
┌─────────────────────┐
│  EventBridge rule    │  prefix: manifests/, suffix: .json
└────────┬────────────┘
         │
         ▼
┌─────────────────────┐
│  Step Function       │  Concurrency: 1 per product (see 5.2.3)
│  starts execution    │
└────────┬────────────┘
         │
         ▼
┌─────────────────────┐
│  1. Validate         │  Full manifest validation (section 5.1.3)
│  manifest            │  Including S3 checksums + NDJSON sampling
└────────┬────────────┘
         │
         ▼
┌─────────────────────┐
│  2. Create NEW       │  PUT /{product}-{version}
│  versioned index     │  Apply mappings from data/{product}/{version}/mappings.json
│                      │  Settings: refresh_interval: -1, number_of_replicas: 0
│  (blue-green: old    │  The OLD index (e.g., address-2026-02) stays live on the alias
│   index stays live)  │  serving all traffic. The new index is invisible to the API.
└────────┬────────────┘
         │
         ▼
┌─────────────────────┐
│  3. Parallel Map     │──── vic.ndjson → Lambda (stream S3 → _bulk POST to NEW index)
│  over NDJSON files   │──── nsw.ndjson → Lambda
│                      │──── qld.ndjson → Lambda
│  (10GB mem, 15min)   │──── ... (all files in parallel)
│                      │
│  Traffic continues   │  The API is still serving from the OLD index via the alias.
│  hitting OLD index   │  Users experience zero downtime and zero degradation.
└────────┬────────────┘
         │
         ▼
┌─────────────────────┐
│  4. Finalize new     │  PUT /{product}-{version}/_settings
│  index               │    { refresh_interval: "1s" }
│                      │  POST /{product}-{version}/_forcemerge
│                      │    ?max_num_segments=5    (not 1 — see note below)
└────────┬────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────┐
│  5. Pre-swap validation (against the NEW index directly) │
│                                                          │
│  a. Doc count:  GET /{product}-{version}/_count          │
│     Must match manifest.total_records ±0.1%              │
│                                                          │
│  b. Sample queries: run 5-10 known-good queries against  │
│     the NEW index directly (not via alias)               │
│     Verify expected results appear in top-N              │
│     e.g., "9 endeavour court coffin bay" → GASA_422206807│
│                                                          │
│  c. Latency: p95 of sample queries < 100ms              │
│                                                          │
│  d. Schema spot-check: GET a random doc from new index,  │
│     verify all expected top-level fields exist           │
│                                                          │
│  ALL checks must pass. This is the gate.                 │
└────────┬────────────────────────────────────────────────┘
         │
    pass │              │ fail
         ▼              ▼
┌──────────────┐  ┌───────────────────────────────────────┐
│ 6. Atomic    │  │ Alert (SNS) + mark execution failed   │
│ alias swap   │  │ Keep old index live on alias           │
│              │  │ DELETE the failed new index (cleanup)  │
│ (see 5.2.2) │  │ Log: which check failed + details      │
└────┬─────────┘  └───────────────────────────────────────┘
     │
     ▼
┌──────────────────────┐
│ 7. Invalidate API    │  Flush API Gateway cache for this product's routes.
│ Gateway cache        │  Ensures clients see new data immediately.
└────────┬─────────────┘
         │
         ▼
┌──────────────────────┐
│ 8. Retain old index  │  Do NOT delete immediately.
│ (rollback window)    │  Retention period is per-product (see 5.2.4).
│                      │  A scheduled Lambda checks and deletes expired indices.
└──────────────────────┘
```

The parallel map is the performance trick. G-NAF with 8 state files → 8 Lambdas running simultaneously → ingestion drops from 40 minutes to 5-10 minutes.

> **Force merge note:** `max_num_segments=5`, not 1. Merging to 1 segment on a single t3.small node is CPU-intensive, blocks searches during the merge, and can take minutes for 15M docs. 5 segments gives most of the read-performance benefit without the operational risk. On a 2+ node prod cluster, merge to 1 if desired.

#### 5.2.2 Atomic Alias Swap

The swap is a single OpenSearch `_aliases` API call that atomically removes the old index and adds the new:

```json
POST /_aliases
{
  "actions": [
    { "remove": { "index": "address-2026-02", "alias": "addresses" } },
    { "add":    { "index": "address-2026-05", "alias": "addresses" } }
  ]
}
```

This is atomic — both actions execute in a single cluster state update. There is no moment where the alias points to zero indices or two indices. Zero downtime. The application always queries `addresses`, never `address-2026-05`.

**What happens to in-flight requests during the swap:**

- Requests that started before the swap continue to execute against the old index (OpenSearch resolves the alias at query parse time, and the query holds a search context on the resolved index).
- Requests arriving after the swap hit the new index.
- No requests fail. No requests see partial data. No requests see a mix.

**Multi-product independence:** Each product has its own alias. Swapping address data does not affect the `abn-entities` alias. Products update on completely independent schedules — address quarterly, ABN daily, LEI daily — and never interfere with each other.

#### 5.2.3 Concurrency Control

If two manifests for the same product land simultaneously (retry + new version), two Step Functions would race on the alias swap.

**Solution: Step Functions execution deduplication, not DynamoDB locks.**

The Step Function is configured with a name derived from the product: `ingest-{product}`. Before starting work, the first task calls `ListExecutions` filtered to `RUNNING` status for this state machine. If another execution is already running for the same product, the new execution waits with exponential backoff (check every 30s, up to 10 minutes). If the wait exceeds 10 minutes, abort and alert.

This eliminates the need for a DynamoDB lock, TTL tuning, and the associated failure modes (lock held by crashed execution, TTL too short for long ingestion, TTL too long after crash).

**Cross-product concurrency is unrestricted.** Address and ABN can ingest simultaneously — they write to different indices and swap different aliases.

#### 5.2.4 Index Retention & Rollback

After a successful alias swap, the old index is NOT deleted immediately. It remains in the cluster as a rollback target.

**Retention periods (configured per product in the product registry):**

| Product | Update Cadence | Retention | Why                                                                           |
| ------- | -------------- | --------- | ----------------------------------------------------------------------------- |
| Address | Quarterly      | 7 days    | Re-running the pipeline takes hours. Keep the old index for a week.           |
| ABN     | Daily          | 48 hours  | Yesterday's data is always available. Day-before-yesterday is the safety net. |
| LEI     | Daily          | 48 hours  | Same as ABN.                                                                  |
| CVE     | Continuous     | 24 hours  | Fast-moving data, short rollback window is acceptable.                        |
| Patents | Periodic       | 7 days    | Same rationale as address.                                                    |

**Automated cleanup:** A scheduled Lambda runs every 6 hours. For each product, it lists all indices matching `{product}-*`, identifies which one the alias currently points to, and deletes any index older than the product's retention period. Indices are never deleted if they're the only index for that product (safety net).

**Manual rollback procedure:**

If bad data is discovered after the swap but within the retention window:

```bash
# 1. Check what indices exist
GET /_cat/indices/address-*?v

# 2. Swap the alias back to the old index (atomic, instant)
POST /_aliases
{
  "actions": [
    { "remove": { "index": "address-2026-05", "alias": "addresses" } },
    { "add":    { "index": "address-2026-02", "alias": "addresses" } }
  ]
}

# 3. Invalidate API Gateway cache
aws apigateway flush-stage-cache --rest-api-id XXX --stage-name prod

# 4. Investigate and fix the pipeline, then re-ingest
```

Time to rollback: **< 30 seconds** (one API call + cache flush). No pipeline re-run needed.

**If the retention window has expired** (old index deleted): re-run the pipeline with the previous version's manifest. The NDJSON files remain in S3 (90-day lifecycle) so re-ingestion is always possible. The per-version `mappings.json` ensures the re-ingested data uses the correct schema.

#### 5.2.5 OpenSearch Snapshots & Backups

OpenSearch managed service provides automated daily snapshots (retained for 14 days, free, enabled by default). These are the last line of defense.

**When to use snapshots vs. alias rollback:**

| Scenario                      | Use Alias Rollback                        | Use Snapshot Restore        |
| ----------------------------- | ----------------------------------------- | --------------------------- |
| Bad data from a pipeline run  | ✅ Instant, swap alias back               | ❌ Overkill                 |
| Accidental index deletion     | ❌ Index is gone                          | ✅ Restore from snapshot    |
| OpenSearch cluster corruption | ❌ Can't swap aliases on a broken cluster | ✅ Restore entire cluster   |
| Mappings migration gone wrong | ✅ If old index still exists              | ✅ If old index was deleted |

**Manual snapshot before risky operations:**

Before any manual OpenSearch operation (mappings migration, cluster upgrade, settings change), take a manual snapshot:

```
PUT /_snapshot/cs-automated/{product}-pre-migration-{date}
{
  "indices": "address-*,abn-*,lei-*",
  "include_global_state": false
}
```

**Snapshot monitoring:** The same scheduled Lambda that handles index cleanup also verifies that the latest automated snapshot completed successfully. Alert via SNS if the most recent snapshot is older than 48 hours.

#### 5.2.6 Storage Capacity Planning

On a t3.small.search with 50GB gp3:

| Product         | Est. Records | Est. Index Size | Notes                                                                |
| --------------- | ------------ | --------------- | -------------------------------------------------------------------- |
| Address (G-NAF) | 15M          | ~10 GB          | `search_as_you_type` + enrichment fields (verified Apr 2026)         |
| ABN             | 3M           | 1-2 GB          | Simpler schema, keyword-heavy                                        |
| LEI             | 1.5M         | 0.5-1 GB        | Small dataset                                                        |

**With retention (two versions of address + current ABN + LEI):** 12 + 12 + 2 + 1 = ~27GB. Comfortably within 50GB.

**Action items:**

- After first address ingestion, check `GET /_cat/indices?v` for actual index size
- If address index > 10GB: increase gp3 to 50GB ($2.50/mo more) BEFORE adding ABN
- Monitor with CloudWatch `FreeStorageSpace` alarm: alert at 80% utilization
- Phase 2 (2-node cluster): each node gets its own storage, doubling capacity

### 5.3 OpenSearch Index Design

**Address index mappings** (confirmed against `flat-white` NDJSON schema):

```json
{
  "settings": {
    "number_of_shards": 3,
    "number_of_replicas": 0,
    "refresh_interval": "-1",
    "index.codec": "best_compression"
  },
  "mappings": {
    "properties": {
      "addressLabelSearch": { "type": "search_as_you_type" },
      "addressLabel": { "type": "keyword" },
      "localityName": { "type": "keyword" },
      "state": { "type": "keyword" },
      "postcode": { "type": "keyword" },
      "streetName": { "type": "keyword" },
      "streetType": { "type": "keyword" },
      "numberFirst": { "type": "keyword" },
      "confidence": { "type": "byte" },
      "location": { "type": "geo_point" },
      "geocode": {
        "properties": {
          "latitude": { "type": "float" },
          "longitude": { "type": "float" },
          "type": { "type": "keyword" },
          "reliability": { "type": "byte" }
        }
      },
      "boundaries": {
        "properties": {
          "lga": { "properties": { "name": { "type": "keyword" }, "code": { "type": "keyword" } } },
          "ward": { "properties": { "name": { "type": "keyword" } } },
          "stateElectorate": { "properties": { "name": { "type": "keyword" } } },
          "commonwealthElectorate": { "properties": { "name": { "type": "keyword" } } },
          "meshBlock": {
            "properties": { "code": { "type": "keyword" }, "category": { "type": "keyword" } }
          },
          "sa1": { "type": "keyword" },
          "sa2": { "properties": { "name": { "type": "keyword" }, "code": { "type": "keyword" } } },
          "sa3": { "properties": { "name": { "type": "keyword" }, "code": { "type": "keyword" } } },
          "sa4": { "properties": { "name": { "type": "keyword" }, "code": { "type": "keyword" } } },
          "gccsa": {
            "properties": { "name": { "type": "keyword" }, "code": { "type": "keyword" } }
          }
        }
      }
    }
  }
}
```

> **Important:** The `geocode` field in `flat-white` data is an object with `latitude`, `longitude`, `type`, and `reliability`. OpenSearch `geo_point` requires `{ "lat": ..., "lon": ... }` and rejects extra sub-fields. The mapping therefore keeps `geocode` as an object type (preserving all sub-fields) and adds a separate `location` field of type `geo_point`. The `flat-white` pipeline must add `"location": { "lat": geocode.latitude, "lon": geocode.longitude }` to each document during the NDJSON transform. Reverse geocoding queries and geo_distance sorts use `location`; geocode metadata (`type`, `reliability`) remains on `geocode`.

> **Shard count:** 3 shards is for production (2+ node cluster). For Phase 1 dev (single t3.small.search node), use 1 shard — all 3 primaries on one node gives no distribution benefit and wastes resources. Override via the manifest's `index.settings.number_of_shards`. When the HA scaling trigger fires (section 3.3) and you move to 2 nodes, switch to 3 shards + 1 replica for distribution and redundancy.

**Validated data shape** (cross-referenced against public sources — LGA, electorates, wards, ABS geography all confirmed):

```json
{
  "_id": "GASA_422206807",
  "addressLabelSearch": "9 ENDEAVOUR COURT COFFIN BAY SA 5607",
  "confidence": 1,
  "geocode": {
    "latitude": -34.61887626,
    "longitude": 135.46174196,
    "type": "PROPERTY CENTROID",
    "reliability": 2
  },
  "boundaries": {
    "lga": { "name": "Lower Eyre Council" },
    "ward": null,
    "stateElectorate": { "name": "FLINDERS" },
    "commonwealthElectorate": { "name": "GREY" },
    "meshBlock": { "code": "40066660000", "category": "Residential" },
    "sa2": { "name": "Eyre Peninsula", "code": "406011130" },
    "sa3": { "name": "Eyre Peninsula and South West", "code": "40601" },
    "sa4": { "name": "South Australia - Outback", "code": "406" },
    "gccsa": { "name": "Rest of SA", "code": "4RSAU" }
  }
}
```

### 5.4 API Layer

**Framework:** Hono + `@hono/zod-openapi` on Lambda (ARM64, Node.js 20) deployed via SST v4.

**Why Hono specifically:** the `@hono/zod-openapi` package auto-generates an OpenAPI 3.1 spec from Zod route schemas. That spec is consumed by Mintlify (docs) and Speakeasy (SDKs). Without it, you maintain the spec manually — and it drifts. Hono itself is chosen for its lightweight middleware composition and route grouping, which maps cleanly to a multi-product API.

**Route structure:**

```
/v1/health                    GET   Public       No auth — for load balancers, uptime monitors
/v1/status                    GET   Authed       Returns product availability, key info, quota remaining

/v1/address/autocomplete      GET   Free tier    Sub-50ms target (warm), cached via API Gateway
/v1/address/validate          GET   Free tier    Full G-NAF validation
/v1/address/enrich            GET   Starter+     Boundaries, electorates, hazard zones
/v1/address/reverse           GET   Free tier    Coordinates → address
/v1/address/lookup/postcode   GET   Free tier    Postcode → localities
/v1/address/lookup/suburb     GET   Free tier    Suburb → postcodes, bounds

/v1/abn/verify                GET   Free tier    ABN status, GST, entity details
/v1/abn/search                GET   Free tier    Business name search
/v1/abn/directors             GET   Starter+     ACN director lookup

/v1/lei/lookup                GET   Free tier    LEI → entity details
/v1/lei/search                GET   Free tier    Entity name → LEI resolution

/v1/cve/lookup                GET   Free tier    CVE ID → vulnerability details
/v1/cve/search                GET   Free tier    Product/version → matching CVEs

/v1/patents/search            GET   Free tier    Fuzzy patent/trademark search
/v1/patents/lookup            GET   Free tier    Application number → details
```

> **Latency targets:** "Sub-50ms" is for warm Lambda invocations. Cold starts add 200-500ms to P99. Phase 1 accepts this. Phase 2+ options: provisioned concurrency ($) for high-traffic routes like autocomplete, or accept that P99 includes cold starts and document accordingly. The sub-50ms target applies to P50/P95, not P99.

**Response caching:**

Address data changes quarterly. ABN/LEI data changes daily. Most queries against the same data produce identical results for hours or days.

API Gateway caching sits in front of the Lambda — cache hits never invoke the function. Cache key = full query string (already normalized by API Gateway). TTL per product:

| Product | Cache TTL  | Invalidation                         |
| ------- | ---------- | ------------------------------------ |
| Address | 1 hour     | Invalidate on alias swap (quarterly) |
| ABN     | 15 minutes | Invalidate on alias swap (daily)     |
| LEI     | 15 minutes | Invalidate on alias swap (daily)     |
| CVE     | 5 minutes  | Near-realtime data                   |

API Gateway cache: 0.5GB at $0.02/hr ≈ $15/month. Reduces OpenSearch load by 70-80% for popular queries. Worth it even in Phase 1. Invalidation is triggered by the ingestion Step Function after a successful alias swap.

**Shared middleware stack:**

```
Request
  │
  ▼ Request ID generation (crypto.randomUUID() → X-Request-Id header, included in all responses)
  ▼ CORS
  ▼ API key extraction (X-Api-Key header)
  ▼ DynamoDB key verification (sub-ms local — no external vendor in hot path; DAX added Phase 3+)
  ▼ Tier enforcement (which products this key can access)
  ▼ Quota check (monthly per-product counter from key record — reject if exceeded)
  ▼ Route handler (product-specific business logic → OpenSearch)
  ▼ Usage increment (awaited DynamoDB atomic counter — ~3ms, see below)
  │
  ▼ Response (includes X-Request-Id, X-RateLimit-Remaining, X-RateLimit-Reset headers)
```

**Rate limiting strategy:**

Rate limiting operates at three levels:

1. **API Gateway throttling (per-IP / per-route, all keys).** SST configures per-route throttles. Protects OpenSearch from DDoS and runaway clients. Default: 100 req/s burst, 50 req/s sustained. Enforced before the Lambda is invoked.

2. **Burst rate limiting (per-key, per-second, application-level).** In-memory token bucket per `apiKeyHash` in Hono middleware. Prevents a single key from overwhelming OpenSearch in one second. See §5.4.1 below.

3. **Monthly quota enforcement (per-key, per-product family, application-level).** The DynamoDB key record includes `quotaPerProduct`; usage counts live in the `prontiq-usage` table (per-month row per product family). Checked in the auth middleware. Each request is rated into credits via `BILLING_ENDPOINTS` before the family row is atomically incremented. Free tier → hard `429 QUOTA_EXCEEDED`. Paid tier → request proceeds with `X-RateLimit-Over: true` header; Stripe bills overage at month end.

#### 5.4.1 Burst Rate Limiting

Monthly quotas prevent exceeding the plan over 30 days. Burst rate limiting prevents overwhelming OpenSearch in one second. Two layers, different mechanisms.

| Layer | What It Prevents | Mechanism | Where |
|---|---|---|---|
| Monthly quota | Exceeding 50K req/month | DynamoDB atomic counter | Hono middleware |
| Burst rate limit | Exceeding 100 req/sec | In-memory token bucket per apiKeyHash | Hono middleware |

The token bucket lives in a module-scoped `Map` inside the Lambda. Each key gets a bucket with capacity = `rateLimit` (from key metadata). On each request, consume one token. If empty, return 429 `RATE_LIMITED` with `Retry-After` header. Tokens refill at the configured rate.

**Why in-memory, not DynamoDB:** per-second rate limiting requires microsecond-level decisions. DynamoDB round-trips (2-5ms) are too slow.

**Lambda scaling caveat:** with N concurrent instances, the effective burst limit is N × `rateLimit`. At low concurrency (1-3 for Phase 1), per-instance limits are close to the true limit. At high concurrency, fall back to API Gateway's built-in throttling (per-IP, global). A real per-key global limiter (Redis / ElastiCache / API Gateway usage plans) is post-Phase-1 work — see §12 Edge Cases.

#### 5.4.2 Rate Limit Response Headers

Every response includes:

```
X-RateLimit-Limit: 50000
X-RateLimit-Remaining: 2800
X-RateLimit-Reset: 2026-05-01T00:00:00Z
X-RateLimit-Product: address
X-RateLimit-Warning: approaching-limit    (at 80%+)
X-RateLimit-Over: true                    (paid tier, past quota, billing as overage)
X-Payment-Overdue: true                   (subscription past_due — grace period active; see §5.6.3)
```

**Usage tracking:**

Usage increment is an awaited `UpdateItem` with `ADD` on the DynamoDB key record's monthly counter. This is ~3ms (within the 50ms budget) and provides at-most-once semantics — if the DynamoDB write fails, the usage is undercounted (acceptable) rather than the request failing. The response is already sent before the usage write completes via `ctx.executionCtx.waitUntil()` in the Hono handler, making it non-blocking from the client's perspective while still being durable.

**Request ID:**

Every response (success and error) includes `X-Request-Id: req_xxxxxxxx`. The same ID is logged in CloudWatch structured logs. When a customer reports "my request failed," the request ID traces directly to the CloudWatch log entry with full context (key, product, query, latency, error).

**OpenSearch connection management:**

The `@opensearch-project/opensearch` client is instantiated outside the Lambda handler (module scope) so it persists across warm invocations. Configure `maxSockets: 10` and HTTP keep-alive to reuse connections. On a t3.small (~128 max connections), this prevents connection exhaustion under concurrent Lambda load.

**WAF / DDoS protection:**

AWS WAF is attached to the API Gateway stage. Phase 1 rules:

- Rate-based rule: 1000 requests per 5 minutes per IP (blocks automated abuse)
- Geographic restriction: none (international products like LEI)
- SQL injection / XSS managed rules: enabled (free with AWS managed rule groups)

Cost: ~$5/month for WAF + $0.60 per million requests inspected. Cheap insurance against a single bad actor taking down the OpenSearch cluster.

### 5.5 Authentication & API Key Management

API keys are generated, hashed, verified, and stored entirely in DynamoDB. No vendor. ~80 lines of code (crypto + DynamoDB client). Clerk handles human identity (dashboard login, OAuth, orgs, teams) — it never sees the API keys.

> **Migration callout:** Live today is a single table `ApiKeyTable` with PK = raw API key string and a nested `usage: {product: {month: count}}` map. The schema below is the **target state** after P1B.04b (data migration ticket). Full code path (hashed lookups, separate usage table, seed-key rotation) is tracked in P1B.02 / P1B.04 / P1B.04b. Until then, the live code at `packages/api/src/middleware/auth.ts` and `packages/api/src/middleware/usage.ts` implements the legacy shape.

#### 5.5.1 DynamoDB Schema

Four tables plus one registry item. All on-demand (pay-per-request). The first two serve the hot path. The third is append-only audit. The fourth handles SES bounce suppression.

| Table | Purpose |
|---|---|
| `prontiq-keys` | API key metadata + billing registry + org-envelope record + Stripe webhook completion markers |
| `prontiq-usage` | Usage counters + email flags + billing push state + REDIRECT records |
| `prontiq-audit` | Append-only lifecycle audit log |
| `prontiq-ses-suppressions` | Email bounce/complaint suppression |

**Design principles:** hot-path isolation (keys + usage separated), append-only logging (audit), TTL-driven cleanup, hash-only key storage.

##### Table: `prontiq-keys`

Stores API key metadata. Raw key never stored — only SHA-256 hash.

```
PK:   apiKeyHash           string    SHA-256 of the raw key

      keyPrefix            string    First 12 chars (masked display: "pq_live_a3f8••••")
      ownerEmail           string    Primary contact email
      orgId                string    Clerk organisation ID
      tier                 string    "free" | "starter" | "growth" | "enterprise"
      products             list      Enabled products: ["address", "abn", "lei"]
      quotaPerProduct      number    Monthly credit limit per product family
      rateLimit            number    Requests per second (burst limit, used by §5.4.1)
      active               boolean   false = revoked, all requests rejected
      paymentOverdue       boolean   Set true by past_due webhook; cleared on recovery / downgrade / deletion
      stripeCustomerId     string    "cus_abc123"
      stripeSubscriptionId string    "sub_xyz789" (set on upgrade, cleared on downgrade)
      subscriptionItems    map       Snapshot of Stripe subscription item IDs by product
                                     from the last successful webhook reconciliation.
                                     Useful for support/debugging; meter-based billing
                                     no longer depends on these IDs directly.
      createdAt            string    ISO 8601
      lastUsedAt           string    ISO 8601

GSI:  orgId-index          PK: orgId  (list all keys in an org)
```

> **Why keep `subscriptionItems`?** It gives support and future tooling a direct snapshot of the Stripe subscription composition the webhook last observed. The billing cron (§5.6.2) now uses Stripe meters rather than `subscriptionItems.createUsageRecord()`, so this field is no longer the primary billing linkage.

##### Table: `prontiq-usage`

Per-key, per-product monthly counters. Atomic increment on every request.

```
PK:   apiKeyHash           string    Same hash as prontiq-keys
SK:   scope                string    "{product}#{yearMonth}" e.g. "address#2026-04"

      requestCount         number    Atomically incremented credit total (legacy field name retained)
      warningEmailSent     boolean   True once the 80% threshold email sent (atomic conditional)
      limitEmailSent       boolean   True once the 100% threshold email sent (atomic conditional)
      lastPushedCumulativeCount  number  Cumulative count last pushed to Stripe for this scope.
                                          **Only meaningful on the CURRENT hash in a rotation chain.**
                                          On rotated-out hashes (those reachable via REDIRECT records),
                                          this field is dead state and is ignored by the cron. The
                                          rename from `lastPushedCount` makes this invariant explicit.
      pendingMeterEventIdentifier   string  Deterministic Stripe meter-event identifier reserved
                                            on the CURRENT hash before calling Stripe. Cleared
                                            after the DDB watermark finalize succeeds.
      pendingMeterTargetCumulativeCount number  The target cumulative count paired with
                                                `pendingMeterEventIdentifier`. Lets retries
                                                re-send the exact same Stripe meter event if the
                                                API call succeeded but the DDB finalize write failed.
      closed               boolean   True once month-close Lambda finalised this scope
      ttl                  number    Unix timestamp — auto-expire after 90 days
```

##### Table: `prontiq-audit`

Append-only log of all key lifecycle events. Never on the hot path.

```
PK:   orgId                string    Organisation that owns the key
SK:   timestamp#eventId    string    ISO 8601 + ULID for sort order

      action               string    "CREATE" | "ROTATE" | "REVOKE" | "UPGRADE" | "DOWNGRADE"
      apiKeyHash           string    Hash of the affected key
      actorId              string    Clerk user ID who triggered the action
      metadata             map       Action-specific context (old/new tier, IP, user agent)
      ttl                  number    Auto-expire after 365 days
```

##### Table: `prontiq-ses-suppressions`

Email addresses that have bounced or complained. Checked before every SES send.

```
PK:   email                string    The suppressed email address

      reason               string    "hard_bounce" | "soft_bounce" | "complaint"
      bounceCount          number    Soft bounce suppresses after 3
      ttl                  number    90 days for bounces, no TTL for complaints (permanent)
```

##### Billing Registry Items (stored in `prontiq-keys`)

Two reserved items index billable keys for the hourly Stripe cron.

```
PK:   apiKeyHash           "REGISTRY#active-keys"    (reserved, not a real key hash)

      activeHashes         string set                  All BILLABLE apiKeyHash values

PK:   apiKeyHash           "REGISTRY#retired-billing-keys"   (reserved, not a real key hash)

      activeHashes         string set                  Formerly billable apiKeyHash values
                                                     still waiting for their final
                                                     current/previous-month Stripe
                                                     meter delta to be flushed
```

`REGISTRY#active-keys` contains currently billable paid-tier keys. `REGISTRY#retired-billing-keys`
contains hashes that were downgraded/cancelled out of paid billing and still have outstanding
or pending meter deltas that must be flushed before billing discovery can stop. A hash may
temporarily exist in **both** registries: live entitlement processing resumes immediately via
the active registry, while the retired registry keeps historical current/previous-month billing
discovery alive until the chain-aware drain check says the hash is fully settled. Free keys are
active in `prontiq-keys` but absent from both registries once drained.

| Event | Registry Action |
|---|---|
| **UPGRADE** (free → paid) | ADD hash to `REGISTRY#active-keys`; if the hash is still present in `REGISTRY#retired-billing-keys`, leave it there until the hourly cron confirms historical billable scopes are fully drained |
| **DOWNGRADE** (paid → paid, e.g. Growth → Starter) | Keep in registry (still billable) — only the `tier` / `quotaPerProduct` / `subscriptionItems` change |
| **DOWNGRADE to free** / **CANCEL** (`customer.subscription.deleted`) | DELETE hash from `REGISTRY#active-keys`, ADD hash to `REGISTRY#retired-billing-keys` until the hourly cron drains any remaining current/previous-month billable deltas, then DELETE from retired registry |
| **ROTATE** (if billable) | DELETE old hash + ADD new hash |
| **REVOKE** (if billable) | DELETE hash |

> **Sharding ceiling:** DynamoDB item-size limit is 400 KiB (409,600 bytes). A 64-char SHA-256 hex hash is ~64 bytes plus string-set overhead. Theoretical maximum is ~6,400 hashes; practical ceiling is ~6,000 billable keys per registry item once attribute-name overhead and set metadata are accounted for. At that scale, shard both `REGISTRY#active-keys#{0..N}` and `REGISTRY#retired-billing-keys#{0..N}` keyed by the first N bits of the hash (trigger: Phase 5).

##### Stripe Webhook Completion Marker (stored in `prontiq-keys`)

Replay-safe dedupe/claim record for Stripe webhook processing. The handler
claims the record as `processing` before side effects, finishes replay-safe
state writes, then finalizes the same record as `completed`.

```
PK:   apiKeyHash           "WEBHOOK#stripe#{eventId}"   (reserved — not a real key hash)

      claimedAt            string                       ISO 8601 — current worker lease timestamp
      status               "processing" | "completed"  Event claim state
      eventType            string                       Stripe event type
      webhookOrgId         string | null                Org ID resolved from customer metadata
      completedAt          string?                      ISO 8601 — when replay-safe state convergence finished
      ttl                  number                       Unix timestamp — 7 days
```

##### Provisioning Lock Item (stored in `prontiq-keys`)

Records that an org has been provisioned (Stripe customer created, org envelope written). The Clerk webhook (§5.7.1) writes this to mark the org as ready for the user to sign in and create their first key.

```
PK:   apiKeyHash           "ORG#{orgId}"             (reserved — not a real key hash)

      stripeCustomerId     string                    "cus_..." created by webhook with
                                                     Idempotency-Key: "clerk-provision-{orgId}"
      ownerEmail           string                    From Clerk user.created event
      tier                 string                    "free" until first upgrade webhook
      products             list                      Current enabled API products for the org.
                                                     Starts as ["address"] on free and is updated
                                                     dynamically from Stripe metadata so a later
                                                     first-key flow does not infer products from
                                                     tier alone.
      hasFirstKey          boolean                   false until the user creates their first key
                                                     via /v1/account/keys/create. Used by the account
                                                     page to show "Create your first key" CTA vs
                                                     the keys-list view.
      completedAt          string                    ISO 8601 — when the org-envelope TransactWrite
                                                     committed. Permanent (no TTL).
```

> **Why an "org envelope" instead of a provisioning lock that holds a key hash?** The raw API key cannot be safely minted in a webhook — there's no in-flight HTTP response to the user, and DDB stores only the hash. The Clerk webhook provisions everything *except* the key. The user's first sign-in to `/account` calls `/v1/account/keys/create`, which mints the key and returns the raw value in the HTTP response (shown once). See §5.7.1 + §10 Developer Journey.

Stripe customer creation upstream of the TransactWriteItems uses `Idempotency-Key: clerk-provision-{orgId}` so webhook retries return the same `cus_...` without duplicates. See §5.7.1 for the full flow and §12.2 for failure modes.

##### REDIRECT Record (stored in `prontiq-usage`)

Written during key rotation. **Auth grace and billing attribution are deliberately split** so a leaked-then-rotated key cannot remain valid for months:

```
PK:   apiKeyHash           oldHash                   SHA-256 of the rotated-out key
SK:   scope                "REDIRECT"

      newHash              string                    SHA-256 of the replacement key
      authValidUntil       number                    Unix seconds — 5 minutes after rotation.
                                                     After this, auth middleware rejects 401 on
                                                     the old key. Drains in-flight requests only.
      ttl                  number                    Unix seconds — 90 days. Used by billing cron
                                                     to attribute any late/orphaned usage events
                                                     on oldHash → newHash. Independent of auth.
      revokedByRotateAt    string                    ISO 8601 timestamp of the rotation event
                                                     (audit trail, no functional behaviour).

GSI:  newHash-redirect-index
      PK: newHash          (sparse — only REDIRECT items populate it)
      Projection: KEYS_ONLY (just oldHash + newHash)

      The billing cron uses this GSI to ask "which old hashes redirect
      to this currently-billable hash?" without scanning prontiq-usage.
      The GSI is sparse because newHash is only set on REDIRECT items
      — counter items (SK = "{product}#{yearMonth}") have no newHash
      attribute, so DDB excludes them from the index. Storage cost is
      proportional to active rotation backlog (typically << 100 items).
```

**Auth middleware** (§5.5.3 step 2): on `prontiq-keys` GetItem miss, look up `{PK: hashedIncomingKey, SK: "REDIRECT"}`. If `authValidUntil > now` → re-resolve via `newHash` and proceed (one retry, no loop). If `authValidUntil <= now` → 401 `INVALID_API_KEY` regardless of `ttl`.

**Billing cron** (§5.6.2 step 2c): independent of `authValidUntil`. Iterates REDIRECT records keyed by `oldHash`, accumulates orphaned usage on that scope, attributes to `newHash`'s billing line. Continues until `ttl` expires.

**REVOKE behaviour (no explicit REDIRECT update required):** when a key is revoked, the REVOKE handler sets `active: false` on the live `prontiq-keys` row. If a REDIRECT record exists pointing TO the revoked hash (`oldHash → newHash` where `newHash` is now revoked), the auth middleware naturally rejects: it re-resolves through the REDIRECT, GetItems the `newHash` record, and the `active` check in §5.5.3 step 3 fails → 401. Saves a GSI lookup at REVOKE time. See §12.3 for the rotation flow.

> **Why 5 minutes?** Long enough to drain genuinely in-flight requests (Lambda 15-min max + DDB eventual-consistency window). Short enough that a leaked + rotated key has a tightly bounded exposure window. Tunable via `REDIRECT_AUTH_GRACE_SECONDS` env var if dev-mode needs longer.

#### 5.5.2 Key Operations

Five operations. Every mutation writes to `prontiq-audit`.

| Operation | Implementation | Trigger |
|---|---|---|
| **CREATE** | Generate `pq_live_` + `randomBytes(24).toString('hex')`. SHA-256 hash. `PutItem` to `prontiq-keys`. Write CREATE to audit. Return raw key once. Registry is updated on upgrade, not creation — free-tier keys aren't billable. | Clerk `user.created` webhook, or "Create Key" in account page |
| **VERIFY** | Hash incoming `X-Api-Key`. `GetItem` from `prontiq-keys` by hash. Check `active`, `tier`, `products`, REDIRECT fallback. | Every API request (hot path) |
| **ROTATE** | Generate new key. `TransactWrite`: delete old hash + put new hash atomically. Swap hash in billing registry (if billable). Write REDIRECT record. Write ROTATE to audit. Return new raw key once. | "Rotate" button in account page |
| **REVOKE** | `TransactWriteItems`: (a) `UpdateItem` `prontiq-keys/{hash}` set `active: false`; (b) `UpdateItem` `REGISTRY#active-keys` DELETE hash if billable; (c) Write REVOKE to `prontiq-audit`. **Note:** if this key was the target of a prior rotation, the REDIRECT record for the rotated-out hash naturally stops working — the auth middleware re-resolves through the REDIRECT, then GetItems the newHash record, then fails the `active` check (§5.5.3 step 3). No explicit REDIRECT cleanup needed. | "Revoke" button in account page |
| **LIST** | `Query` GSI `orgId-index`. Return metadata with masked `keyPrefix`. Never return raw key or hash. | Account page API Key tab |

**Key limits per tier:** Free 2, Starter 5, Growth 20, Enterprise unlimited. Enforced on CREATE via GSI count query before PutItem. See §9 error taxonomy for `KEY_LIMIT_EXCEEDED`.

**Key generation reference:**

```typescript
import { randomBytes, createHash } from 'crypto';

const PREFIX = 'pq_live_';

export function generateKey() {
  const raw = PREFIX + randomBytes(24).toString('hex');
  const hash = createHash('sha256').update(raw).digest('hex');
  return { raw, hash, prefix: raw.slice(0, 12) };
}

export function hashKey(raw: string) {
  return createHash('sha256').update(raw).digest('hex');
}
```

**Security:** raw key transmitted once on creation, once on rotation, never stored. DynamoDB holds only the SHA-256 hash. Same pattern as GitHub, Stripe, AWS.

#### 5.5.3 Hot-Path Flow

Quota is enforced by a **single conditional `UpdateItem`** that increments the counter only when the request is allowed. This collapses the historical "read → check → write" race window into one atomic DDB call. Free-tier hard limits become actually hard.

```
Request arrives with X-Api-Key header
│
│  1. HASH        SHA-256 the raw key                                   ~0.01ms
│  2. READ        DynamoDB GetItem → prontiq-keys (metadata, tier,      ~2-5ms
│                 quotaPerProduct, products, paymentOverdue, rateLimit)
│                 (on miss: check REDIRECT fallback per §12.3 — if the
│                  redirect's authValidUntil has expired → 401, else
│                  re-resolve via newHash and retry once)
│  3. CHECK       active? product? burst (§5.4.1)? paymentOverdue?      ~0ms
│                 (Quota is checked atomically in step 4 — not here.)
│  4. INCREMENT   DynamoDB UpdateItem → prontiq-usage                   ~3-5ms
│                   ADD requestCount :one
│                   ConditionExpression:
│                     attribute_not_exists(requestCount)
│                       OR requestCount < :quota
│                       OR :tierAllowsOverage
│                 If ConditionalCheckFailed AND tier='free':
│                   → 429 QUOTA_EXCEEDED (response body has resets_at)
│                 If success on paid tier with newCount > quota:
│                   → set X-RateLimit-Over: true header
│                 Returned attributes: new requestCount,
│                   warningEmailSent, limitEmailSent (for step 7)
│  5. EXECUTE     OpenSearch query (or circuit breaker → 503, §12.4)    ~10-30ms
│  6. RESPOND     JSON + rate limit headers (Remaining = quota - count) ← DONE
│
│  7. EMAIL       Threshold check (atomic conditional UpdateItem on     ~0-2ms
│                 prontiq-usage to set warningEmailSent / limitEmailSent
│                 — exactly-once email per scope per cycle).
│                 SES send via waitUntil — best-effort, not awaited.
│  8. LOG         CloudWatch EMF (structured stdout, zero network)      ~0ms
```

> **Why synchronous increment?** The previous design (read count → serve → async write) created a race window: two concurrent free-tier requests near `quotaPerProduct` could both observe the same count, both pass the check, both serve, and only count once because the writes raced. A leaked free-tier key could fan out to hundreds of in-flight requests and ride the boundary indefinitely. The atomic conditional `UpdateItem` closes this window — DDB executes the condition + increment as one operation. Cost: +3–5ms in the critical path. Acceptable given the 50ms total budget.

> **Why two `tierAllowsOverage` codepaths in one expression?** The condition uses an OR: "no item yet" OR "under quota" OR "tier permits overage." Free tier passes only the first two; paid tiers pass the third unconditionally and we detect overage from `newCount > quota` post-update.

**Total client-perceived latency:** ~16-40ms (steps 1-6).

**Cold start:** ~130ms. Provisioned concurrency not required at Phase 1 volumes.

**Optimisation ladder:**

| Phase | Strategy | Trigger |
|---|---|---|
| 1 | Absorb 2-5ms DynamoDB reads | Initial launch |
| 2 | Lambda in-memory cache (60s TTL, module-scoped `Map`) | > 100K req/month |
| 3 | DynamoDB DAX (~$30/month) | > 5M req/month |

> **Vendor migration note (Clerk):** Clerk's 50K MAU free tier is generous today, but vendor pricing changes. The Clerk integration is isolated to the `/account` Next.js app (`@clerk/nextjs` components + webhook handler). If Clerk becomes untenable, migration to `next-auth` or `lucia` is feasible — the API key system is completely independent of Clerk.

### 5.6 Billing

Stripe metered billing. One subscription per organisation. Family-level credit line items. Payment failure has a 14-day grace period.

#### 5.6.1 Plan Definitions

**Stripe is the source of truth for commercial configuration.** The recurring Stripe Price declares the Prontiq tier via metadata, and metered Stripe Products declare enabled Prontiq products via metadata. The public commercial unit is now **credits**, not raw requests. `packages/shared/src/constants.ts` holds the runtime guardrails for each tier plus the endpoint-weight table used to explain how credits are consumed.

`packages/shared/src/constants.ts`:

```typescript
export const PLANS = {
  free: {
    includedCreditsPerMonth: 10_000,
    quotaPerProduct: 10_000,
    rateLimit: 10,                      // req/sec
    products: ['address'],
    maxKeys: 2,
    overagePerThousandCredits: null,    // hard 429, no overage
  },
  starter: {
    includedCreditsPerMonth: 10_000,
    quotaPerProduct: 10_000,
    rateLimit: 50,
    products: ['address', 'abn', 'lei', 'cve', 'patents'],
    maxKeys: 5,
    overagePerThousandCredits: 1_50,
  },
  growth: {
    includedCreditsPerMonth: 50_000,
    quotaPerProduct: 50_000,
    rateLimit: 100,
    products: ['address', 'abn', 'lei', 'cve', 'patents'],
    maxKeys: 20,
    overagePerThousandCredits: 1_00,
  },
  enterprise: {
    includedCreditsPerMonth: null,
    quotaPerProduct: null,
    rateLimit: null,
    products: ['address', 'abn', 'lei', 'cve', 'patents'],
    maxKeys: Infinity,
    overagePerThousandCredits: null,
  },
} as const;

export const BILLING_ENDPOINTS = {
  "address.autocomplete": { product: "address", creditCost: 1 },
  "address.validate": { product: "address", creditCost: 1 },
  "address.lookup_postcode": { product: "address", creditCost: 1 },
  "address.lookup_suburb": { product: "address", creditCost: 1 },
  "address.reverse": { product: "address", creditCost: 2 },
  "address.enrich": { product: "address", creditCost: 3 },
} as const;
```

**Pricing table (customer-facing):**

| Tier | Base Price | Included Credits | Overage (per 1K credits) | Products | Rate Limit | Max Keys |
|---|---|---|---|---|---|---|
| **Free** | $0 | 10,000/month | — (hard 429) | Address only | 10 req/sec | 2 |
| **Starter** | $29/month | 10,000/month | $1.50 | All | 50 req/sec | 5 |
| **Growth** | $99/month | 50,000/month | $1.00 | All + SLA | 100 req/sec | 20 |
| **Enterprise** | Custom | Custom | Custom | All + dedicated support | Custom | Unlimited |

**Credits menu example (customer-facing):**

| Endpoint | Credits |
|---|---|
| Address Autocomplete | 1 |
| Address Validate | 1 |
| Address Postcode Lookup | 1 |
| Address Suburb Lookup | 1 |
| Address Reverse | 2 |
| Address Enrich | 3 |

Customers see these as the published credit costs for the API menu. The shipped auth middleware applies these weights inline and stores the resulting family-level credit totals in DynamoDB; the billing cron then forwards those accumulated credits to the family-level Stripe meter.

**Fail-closed rule:** a product must not be enabled commercially until it has explicit endpoint credit weights in `BILLING_ENDPOINTS`. If Stripe enables a product with no corresponding billing weights yet, the auth middleware returns `500 INTERNAL_ERROR` for that product rather than silently billing it at a guessed rate.

The same fail-closed rule applies to Stripe metering: the billing cron derives each product family's Stripe meter event name from the shared billing definitions rather than synthesizing it independently. A product with no declared meter mapping is not billable.

**Example invoice (Growth plan, heavy Address usage):**

```
Prontiq Growth Plan                         $99.00
├── Address API — 47,200 / 50,000 credits   included
├── ABN Verification — 82,800 / 50,000 credits  $32.80 (32,800 overage credits × $1.00/1K)
├── LEI Lookup — 3,400 / 50,000 credits     included
└── CVE Search — 0 / 50,000 credits         included
                                            ------
Total                                       $131.80
```

**Stripe structure:**

```
Stripe Dashboard:

  Plan Products (recurring base fee):
    ├── Prontiq Starter Plan  → recurring Price: $29/month
    └── Prontiq Growth Plan   → recurring Price: $99/month

  API Products (family-level meters billed in credits):
    ├── Prontiq Address API   → metered Price against Address credits
    ├── Prontiq ABN API       → metered Price against ABN credits
    ├── Prontiq LEI API       → metered Price against LEI credits
    └── ... (one per API product)

  Pricing Table (embedded in account page Billing tab via <stripe-pricing-table>)
    - Paid plans only (Starter / Growth)
    - Free is rendered by Prontiq, not created as a Stripe subscription product

  Subscription (one per org): one plan item + one metered item per enabled product.
```

**Overage calculation:** the billing cron (§5.6.2) ultimately pushes **credits**, not raw request counts, to Stripe hourly via family-level Stripe meters. The auth middleware already applies the published endpoint credit weights and accumulates the resulting family total (for example all Address endpoints -> Address credits) in DynamoDB. Changing commercial pricing or endpoint credit weights is a product/catalog decision, not a Stripe catalog rewrite.

**Subscription lifecycle:**

| Event | What Happens |
|---|---|
| **Developer signs up** | No Stripe subscription. Free tier is app-managed in DynamoDB. Key works immediately. |
| **Developer clicks "Upgrade to Growth"** | Stripe Checkout creates a Subscription with recurring plan item + metered product items. `checkout.session.completed` webhook → update DynamoDB (§5.7). |
| **Developer changes plan (Starter → Growth or same-tier product mix)** | Stripe handles proration. `customer.subscription.updated` webhook reconciles the full billing snapshot in DynamoDB. |
| **Developer adds payment method** | Stripe customer portal. No webhook needed. |
| **Developer views invoices** | Stripe customer portal link in the Billing tab. |
| **Developer cancels** | `cancel_at_period_end: true`. Access continues until period end. `customer.subscription.deleted` fires at period end → downgrade to free. |
| **Card declines on renewal** | Grace period (§5.6.3). Service continues ~14 days. |

**Customer portal:** linked from the Billing tab. Manages payment methods, plan changes, invoice history, cancellation. Themed with Prontiq branding (§5.10). Configured in Stripe Dashboard → Settings → Customer Portal. The Billing tab can show a Prontiq-rendered Free card alongside the embedded Stripe pricing table for paid upgrades.

**How the plan connects to the middleware:** the upgrade webhook (§5.7) reads `PLANS[tier]` from `constants.ts` and writes `quotaPerProduct`, `rateLimit`, `products`, `maxKeys` to all org keys in `prontiq-keys`. The middleware still enforces family-level entitlement and quota state from DynamoDB on every request, and now applies endpoint credit weights inline before incrementing the family usage row. Plan changes take effect on the next request after the webhook processes.

#### 5.6.2 Hourly Billing Cron

Scheduled Lambda (EventBridge cron, hourly). Targeted reads, not a table scan. **Push state is single-rooted**: only the current hash in a rotation chain holds `lastPushedCumulativeCount`. Old hashes' counters are read for usage attribution only — their `lastPushedCumulativeCount` is dead state and ignored. **Replay safety is explicit on the current-hash usage row**: before calling Stripe, the cron reserves `pendingMeterEventIdentifier` + `pendingMeterTargetCumulativeCount`; after Stripe accepts the event, the cron finalizes by advancing `lastPushedCumulativeCount` and clearing the pending marker.

**Authoritative billing model:** customer-facing billing is in credits. The cron's job is:

1. gather the current family-level credit totals from DynamoDB
2. compare them with the last successfully pushed cumulative counts
3. compute the resulting family-level credit delta
4. emit that credit delta into Stripe

**Implementation note (current state):** the shipped implementation keeps one `{product}#{yearMonth}` row per family and stores consumed credits in that row's `requestCount` field. The legacy field name remains for schema compatibility; semantically it is now "credits used this month for the product family."

```
Every hour:
  1. Read `REGISTRY#active-keys` and `REGISTRY#retired-billing-keys`
     from prontiq-keys.
     `active` = currently billable hashes.
     `retired` = hashes recently downgraded/cancelled out of paid billing
     but still waiting for their final current/previous-month credit delta
     to be pushed.
     `active=false` still blocks request authentication (§5.5.3), but it
     does NOT block retired-billing finalisation here as long as the hash
     still has Stripe customer linkage and outstanding billable history.

  2. For each apiKeyHash (= "current hash") in the union of active + retired:
     a. BatchGetItem prontiq-keys for stripeCustomerId + enabled products

     b. **Discover full attribution chain via recursive GSI traversal**
        (see §5.5.1 REDIRECT schema's newHash-redirect-index):
          chain = [currentHash]
          frontier = [currentHash]
          while frontier non-empty AND chain.length < MAX_CHAIN_DEPTH (=10):
            results = Query newHash-redirect-index for each hash in frontier
            newOldHashes = results' oldHash values, deduplicated, not in chain
            chain.push(...newOldHashes)
            frontier = newOldHashes
          (Single rotation: chain = [C, B] (1 GSI query).
           Two rotations: chain = [C, B, A] (2 queries).
           TTL on REDIRECT records (90d) bounds chain depth in practice.)

     c. Query prontiq-usage for every hash in the redirect chain.
        Candidate billing families are the union of:
          - the current entitlement set on the active key, and
          - any current/previous-month usage scopes in the chain that still
            have credits, a pushed watermark, or a pending meter marker.
        This is what keeps the final delta billable after same-tier product
        removals or downgrades: removing a family from `key.products` does
        not immediately hide its outstanding current-month or previous-month
        usage from the hourly sweep.

     d. For each API family:
          sumCredits = sum(usage[hash][product#month].requestCount
                           for hash in chain)
          currentLastPushed = usage[currentHash][familyMeter#month]
                                .lastPushedCumulativeCount
                                ?? 0
          delta = sumCredits - currentLastPushed
        **Note:** sumLastPushedCumulativeCount is NOT computed across the
        chain. Only the CURRENT hash's pushed count is the gate. This is
        what prevents the rotation double-counting bug — old hashes'
        already-pushed counters are not re-credited because they're not
        in the gate.

     e. Skip product if delta <= 0
        (delta < 0 should not happen with this model; if observed, log
         WARN with chain dump and skip — likely indicates a manual DDB
         edit. Negative-delta alarm fires after 3 consecutive
         occurrences.)

     f. Reserve the replay-safe pending push on the CURRENT hash row:
          SET pendingMeterEventIdentifier = "meter-{currentHash}-{scope}-{sumCredits}",
              pendingMeterTargetCumulativeCount = sumCredits
        (Conditional on the current row having no conflicting pending
         push and the observed `lastPushedCumulativeCount` still matching
         what this cron run read.)

     g. stripe.billing.meterEvents.create(
          {
            event_name: "prontiq_{product}_requests",
            identifier: pendingMeterEventIdentifier,
            payload: {
              stripe_customer_id: stripeCustomerId,
              request_count: delta
            }
          }
        )
        (The payload value is now "credits used since the last successful
         sync" for that API family. Stripe meters aggregate credits over
         the billing period. The deterministic identifier is reused on
         retry if Stripe accepted the event but the DDB finalize step failed.)

     h. Finalize the CURRENT hash's prontiq-usage row only:
          SET lastPushedCumulativeCount = pendingMeterTargetCumulativeCount
          REMOVE pendingMeterEventIdentifier, pendingMeterTargetCumulativeCount
        (Conditional on the same pending identifier/target still being
         present so a stale worker cannot overwrite newer state.)

  3. Retirement eligibility is checked against both the current month
     and the previous month on every run, even outside the early-UTC
     previous-month processing window. This is stricter than the hourly
     processing set on purpose: a retired hash must remain discoverable
     until both months are fully drained or explicitly closed by
     month-close.

  4. If a retired hash has no outstanding/pending current-month or
     previous-month billable scopes after that full retirement check,
     remove it from `REGISTRY#retired-billing-keys`.

  5. Stripe aggregates meter events per metered Price and invoices at month end.
```

**Worked example — rotation correctness** (this is the test case that pinned the previous design's bug):

| Time | Event | A.req / A.pushed | B.req / B.pushed | C.req / C.pushed | Stripe meter |
|---|---|---|---|---|---|
| T0 | A used 100, prior cron pushed | 100 / 100 | — | — | 100 |
| T1 | rotate A→B; new B row | 100 / 100 (frozen) | 0 / 0 | — | 100 |
| T2 | 50 reqs against B | 100 / 100 | 50 / 0 | — | 100 |
| T3 | cron: chain=[B,A], sum=150, currentLastPushed=B.pushed=0, delta=150, push set:150 | 100 / 100 | 50 / 150 | — | **150** ✓ |
| T4 | 25 more reqs against B | 100 / 100 | 75 / 150 | — | 150 |
| T5 | cron: sum=175, currentLastPushed=150, delta=25, push set:175 | 100 / 100 | 75 / 175 | — | **175** ✓ |
| T6 | rotate B→C; new C row | 100 / 100 | 75 / 175 (frozen) | 0 / 0 | 175 |
| T7 | 10 reqs against C | 100 / 100 | 75 / 175 | 10 / 0 | 175 |
| T8 | cron: chain=[C,B,A] via 2 GSI hops, sum=185, currentLastPushed=C.pushed=0, delta=185, push set:185 | 100 / 100 | 75 / 175 | 10 / 185 | **185** ✓ |

The previous design at T5 would have computed `sumLastPushed = 150 + 100 = 250 → delta = -75 ❌`. The new model only consults the current hash's pushed count, sidestepping the double-counting entirely.

**Why query the GSI recursively:** a key can be rotated multiple times. Each rotation creates a REDIRECT(prevHash → newHash). The cron must reach all hashes in the lineage, not just the immediate predecessor. `MAX_CHAIN_DEPTH=10` is a safety bound; in practice REDIRECT records expire after 90 days so chains rarely exceed depth 2-3.

**Why query the GSI at all:** without it, the cron would have to scan `prontiq-usage` looking for `SK="REDIRECT"` records (doesn't scale) or maintain a per-org rotation history (more state, more bugs). The sparse GSI on `newHash` gives exactly the access pattern needed.

**Why delta meter events instead of `action: "set"` usage records:** Stripe meters aggregate event values over the billing period; they do not replace the prior total. The cron therefore computes the delta from `lastPushedCumulativeCount`, but it still keeps replay safety by reserving a deterministic pending event identifier on the current-hash row before it calls Stripe.

**Month-boundary handling:** for the first 6 hours of each month, the cron processes both current-month and previous-month scopes. Because scope discovery is usage-driven rather than entitlement-only, a family removed at the month boundary still gets its final previous-month delta pushed before month-close. A dedicated **month-close Lambda** (P1B.11) will run at 00:30 UTC on day 1: final sweep on previous-month scope, sets `closed: true`. Once closed, the hourly cron skips that scope permanently.

**Idempotency / failure model:** the pending marker is the guardrail. If Stripe accepts the event and the DDB finalize write fails, the next cron run reuses the same `pendingMeterEventIdentifier` + `pendingMeterTargetCumulativeCount`, re-sends the exact same meter event (Stripe dedupes on identifier), and then finalizes the watermark. CloudWatch alarm `PqBillingCronErrors` pages on failed runs; month-close remains a separate hardening step.

**Cost at scale:**

| Volume | DynamoDB | CloudWatch EMF | Cron Lambda | Total |
|---|---|---|---|---|
| 100K req/mo | ~$0.15 | ~$0.50 | ~$0.00 | **~$0.65** |
| 1M req/mo | ~$1.50 | ~$5.00 | ~$0.00 | **~$6.50** |
| 10M req/mo | ~$15.00 | ~$50.00 | ~$0.10 | **~$65** |

#### 5.6.3 Payment Failure & Grace Period

When a paid developer's card fails on renewal, their production app must not break immediately.

| Stripe Event | What Happens | Timing |
|---|---|---|
| `invoice.payment_failed` | Log only. Stripe retries via Smart Retries. | Day 0-7 |
| `customer.subscription.updated` with `status: 'past_due'` | All retries exhausted. Email developer: "Your payment failed. Update your card at [billing link]." Clarify that the overall Stripe retry/cancellation policy gives ~14 days from first failure, and that entering `past_due` means ~7 days remain before cancellation. Set `paymentOverdue: true` on all org keys. Middleware adds `X-Payment-Overdue: true` to responses. Account page shows a banner. | Day ~7 |
| `customer.subscription.deleted` (at end of grace) | Downgrade all org keys to free. Clear `paymentOverdue`, `stripeSubscriptionId`, `subscriptionItems`. Remove from registry. | Day ~14 |

**Total grace: ~14 days from first failure.** `customer.subscription.updated` handles both directions: `past_due` sets the flag and sends the email; `active` (after successful retry) clears the flag.

> **Implementer note — Stripe configuration required.** `customer.subscription.deleted` does NOT fire 7 days after `past_due` by default. The 14-day total requires:
> 1. **Stripe Dashboard → Settings → Billing → Subscriptions and emails → Smart Retries:** configure retry schedule so all retry attempts complete within 7 days of first failure.
> 2. **Subscription setting:** cancel subscription when all retries exhausted (Stripe Dashboard → Settings → Billing → Subscription cancellation policy).
> Without both, `past_due` persists indefinitely or retry cadence differs. Pick a retry schedule, document it, and test with a failing test card before going live.

### 5.7 Webhook Chain

Two Lambda handlers, five event types. All verify signatures. All write to the audit table. The provisioning handler is **idempotent by completion-marker semantics, not by attempt-marker** — see §5.7.1.

**orgId resolution in Stripe handlers:** Stripe webhook events carry a `customer` field as a string ID (e.g., `"cus_abc123"`), not an expanded customer object. The provisioning flow stores `orgId` in the Stripe customer's `metadata` at creation time. Every Stripe webhook handler retrieves the full customer to read it:

```typescript
const customerId = event.data.object.customer;                 // "cus_abc123"
const customer = await stripe.customers.retrieve(customerId);  // full object
const orgId = customer.metadata.orgId;                         // "org_clerk_xyz"
```

One extra Stripe API call per webhook invocation. Webhooks fire rarely (signup, upgrade, downgrade, payment failure — never the hot path), so the latency is irrelevant. Optimisation using `client_reference_id` on Checkout is deferred.

#### 5.7.1 Clerk: `user.created`

**Critical invariant (post-review):** the **raw API key is never minted in a webhook**. A webhook response goes to Clerk, not to the user's browser, so any raw key generated server-side has no in-flight HTTP response to ride back on. Combined with hash-only storage, an SES failure would leave the org provisioned with a key whose raw value is unrecoverable. Instead, the webhook provisions the **org envelope** (Stripe customer + provisioning marker), and the **first API key is minted by an authenticated `/v1/account/keys/create` call** where the raw value is returned in the HTTP response and shown to the user once.

```
1. Verify Svix signature                                          (invalid → 400)

2. GetItem ORG#{orgId}
   ├─ Found  → return 200 (already provisioned; idempotent no-op)
   └─ Missing → continue to step 3

3. Create Stripe customer with Idempotency-Key: "clerk-provision-{orgId}"
   metadata: { orgId, source: "clerk-webhook" }
   → returns stripeCustomerId. Stripe's idempotency layer guarantees
     repeated calls with the same key return the same customer
     (24-hour window — well beyond any retry burst).

4. TransactWriteItems (DDB):
   a. ConditionalPut prontiq-keys/ORG#{orgId} where attribute_not_exists(apiKeyHash)
      Item: { stripeCustomerId, ownerEmail, tier="free",
              products=["address"], completedAt, hasFirstKey: false }
      // ORG#{orgId} is the org-envelope record. No raw API key
      // material lives here — only Stripe linkage and provisioning state.
   b. ConditionalPut prontiq-audit/{orgId}/{timestamp#eventId}
      where attribute_not_exists(orgId) AND attribute_not_exists(SK)
      Item: { action="ORG_PROVISIONED", actorId="clerk-webhook",
              metadata={ source: "user.created", stripeCustomerId },
              ttl }

   On TransactionCanceled (concurrent provisioning):
     Re-read ORG#{orgId} → return 200. The competing call already won.

5. Send welcome email via SES — best-effort. Subject: "Welcome to Prontiq."
   Body: "Your account is ready. Sign in at https://prontiq.dev/account
   to create your first API key." Includes docs link.
   A failed email does NOT block sign-in. The user can sign in and the
   /account page detects "no key yet" and shows the "Create your first
   API key" CTA. SES failures are recoverable by the user without
   operator intervention.

6. Return 200
```

**First-key creation** (separate, user-driven, after sign-in):

The `/v1/account/keys/create` endpoint (P1C.03):

```
1. Authenticate via Clerk JWT → orgId, ownerEmail, actorId
2. Check ORG#{orgId} exists (else: 404 ORG_NOT_PROVISIONED — typically
   means user signed in faster than webhook landed; retry after a
   second)
3. Count existing org keys via GSI → enforce PLANS[tier].maxKeys
   (else: 403 KEY_LIMIT_EXCEEDED)
4. Generate API key via generateKey() (P1B.02)
5. TransactWriteItems:
   a. ConditionalPut prontiq-keys/{apiKeyHash} (full v2.2 shape)
   b. UpdateItem prontiq-keys/ORG#{orgId} SET hasFirstKey = true
      (idempotent — first call sets, subsequent calls re-set true)
   c. PutItem prontiq-audit (action="CREATE", actorId=user)
6. Return 201 with body { keyId: prefix, raw: rawKey, createdAt }
   The raw key is shown ONCE in the response. Account page renders
   "Copy this key — it will not be shown again."
```

**Why this works:**

- The webhook provisions only what the user can't see anyway (Stripe customer ID, org envelope). No secret material is generated server-side without a user-visible HTTP response.
- The first-key flow is just a normal `/v1/account/keys/create` call — no special "first-time" code path. Treats "first key" as the same operation as "Nth key".
- SES failure is no longer load-bearing. The user can sign in regardless and create their key from the UI.
- Stripe customer creation remains idempotent in the webhook so retries are safe.
- ORG#{orgId} item replaces the previous PROVISION#{orgId}: no more `provisionedKeyHash` field (no key exists yet), just `stripeCustomerId` + a cached entitlement snapshot (`tier`, `products`) + `hasFirstKey`.

**Manual recovery path** (the rare case where the Clerk webhook never fires at all): the `/account` page detects no `ORG#{orgId}` record and shows a "Set up your account" CTA. Clicking it calls `POST /v1/account/setup` (Clerk-authenticated) which runs steps 2–5 above against the user's session-derived `orgId`. Same code path as the webhook, just triggered by the user instead of Clerk. The user then creates their first key normally via `/v1/account/keys/create`.

#### 5.7.2 Stripe: `checkout.session.completed` (initial upgrade from free)

```
1. Verify stripe-signature                                       (invalid → 400 INVALID_SIGNATURE)

2. Retrieve Stripe customer → read metadata.orgId

3. **Two-step Stripe read for the subscription items map** (Checkout
   Session events do NOT include the per-product subscription-item IDs
   inline — only the subscription ID):

   a. Read `event.data.object.subscription` → subscriptionId.
   b. `stripe.subscriptions.retrieve(subscriptionId, { expand: ['items.data.price', 'items.data.price.product'] })`
      → returns Subscription with `items.data[]` populated, each entry
      having `id` (the `si_...` we need) and `price.product`
      (the expanded Stripe Product object we inspect for metadata).
   c. Build subscriptionItems map:
        for each item in subscription.items.data:
          if item.price.metadata.prontiqTier exists OR
             item.price.product.metadata.prontiqTier exists:
            // recurring plan price; tier source of truth
            continue
          product = item.price.product.metadata.prontiqProduct
            // e.g., "address"
          subscriptionItems[product] = item.id  // "si_..."
   d. Determine tier from the recurring plan Price metadata:
        tier = recurringItem.price.metadata.prontiqTier
            || recurringItem.price.product.metadata.prontiqTier
      **Validate** that the tier is one of the known Prontiq tiers and
      that at least one metered product is enabled. If metadata is
      missing/invalid → return 500 with a CloudWatch ERROR log. Stripe
      will retry the webhook; on persistent failure, alert via SNS so an
      operator can fix the misconfigured subscription before billing breaks.

4. Query prontiq-keys by orgId (GSI) → ALL keys for this org

5. Determine tier from the recurring Price or Product `metadata.prontiqTier`.

6. TransactWriteItems (DDB): for each org key,
   - UpdateItem prontiq-keys/{apiKeyHash}: set tier, products,
     quotaPerProduct, rateLimit, stripeSubscriptionId, subscriptionItems
   - Update REGISTRY#active-keys: ADD apiKeyHash to activeHashes
   (One transaction can touch up to 100 items; for orgs with > ~30 keys,
    chunk into multiple transactions.)

7. Reset warningEmailSent + limitEmailSent on all prontiq-usage items
   for the current scope **only when the usage row already exists**
   (no sparse-row backfill just to clear flags; existing counters only).

8. Write UPGRADE to prontiq-audit (one entry per orgId+timestamp).

9. Finalize the claimed webhook marker in prontiq-keys:
     PK = WEBHOOK#stripe#{eventId}
     status = completed
   Duplicate delivery returns 200 only once the marker is completed;
   a fresh duplicate that sees `status=processing` returns 500 so
   Stripe retries after the active worker finishes.

10. Return 200.
```

> **Why validate before persisting?** A misconfigured Stripe subscription (for example a recurring plan Price/Product missing `metadata.prontiqTier`, or a metered Product missing `metadata.prontiqProduct`) would let the billing cron or entitlement state drift silently from what the customer bought. Validating + failing the webhook surfaces the misconfiguration immediately. Stripe will retry, and on persistent failure the operator gets paged — far better than silent under-billing.

#### 5.7.3 Stripe: `customer.subscription.updated` (billing-state reconcile / past_due / recovered)

```
1. Verify stripe-signature
2. Retrieve Stripe customer → read metadata.orgId
3. If the Stripe subscription snapshot differs from DynamoDB (tier, products, subscriptionItems, or derived limits):
   a. Determine new tier from recurring Price/Product `metadata.prontiqTier`
   b. Query prontiq-keys by orgId → ALL keys
   c. Update each key: tier, products, quotaPerProduct, rateLimit, subscriptionItems
   d. Registry: UPGRADE → ADD hash(es); DOWNGRADE → keep in registry (still paid, limits adjusted)
   e. Reset warningEmailSent + limitEmailSent on usage items
   f. Write UPGRADE or DOWNGRADE to prontiq-audit
4. If status === 'past_due':
   a. Query prontiq-keys by orgId → ALL keys
   b. Set paymentOverdue: true on each key
   c. Send payment failure email via SES (best-effort; suppression-aware)
5. If status === 'active' AND any org key has paymentOverdue:
   a. Query prontiq-keys by orgId → ALL keys
   b. Clear paymentOverdue on each
   c. No email in P1B.06
6. Return 200
```

> Both initial upgrade (§5.7.2) and subsequent subscription changes converge on the same DynamoDB update logic. `subscription.updated` is not tier-only: it reconciles any Stripe-side drift in `products`, `subscriptionItems`, or derived limits even when the tier string does not change. The same event type also handles payment-status transitions (`active ↔ past_due`) — one event type, two state transitions.

#### 5.7.4 Stripe: `customer.subscription.deleted` (cancel / end of grace)

```
1. Verify stripe-signature
2. Retrieve Stripe customer → read metadata.orgId
3. Query prontiq-keys by orgId → ALL keys
4. Update each key: tier → "free", products → free list, quotaPerProduct → 10000
5. Clear stripeSubscriptionId, subscriptionItems, paymentOverdue on each key
6. DELETE each apiKeyHash from `REGISTRY#active-keys`
7. ADD each apiKeyHash to `REGISTRY#retired-billing-keys`
   (keeps the hash discoverable for the hourly billing cron until the
    final current/previous-month meter deltas are flushed)
8. Write DOWNGRADE to prontiq-audit
9. Return 200
```

Stripe is configured with `cancel_at_period_end: true` on user-initiated cancellation. The webhook fires at period end, not at cancellation time.

#### 5.7.5 Stripe: `invoice.payment_failed`

```
1. Verify stripe-signature
2. Log event for debugging
3. Return 200 (no action — Stripe retries via Smart Retries)
```

#### 5.7.6 Shopify: `app.installed` (Phase 4)

```
1. Verify Shopify HMAC signature
2. Generate store-scoped API key (pq_live_ + 48 hex)
3. PutItem to prontiq-keys with metadata: { shopifyStoreId, scope: "shopify" }
4. Configure checkout extension with the key
5. Write CREATE to prontiq-audit
6. Return 200
```

### 5.8 Developer Journey

```
1. DISCOVERY
   Developer lands on prontiq.dev/address
   Hero: live autocomplete demo — types address, sees enriched results
   Below: pricing table, one-line SDK install, "Get Started Free"

2. SIGN UP
   Clicks "Get Started Free" → Clerk modal (Google/GitHub OAuth or email)
   10 seconds. They land on /account.

3. ACCOUNT PAGE — first visit
   Org auto-provisioned (Clerk webhook → Stripe customer → ORG#{orgId}).
   No API key exists yet. Sees: "Welcome to Prontiq. Create your first
   API key to get started." CTA button.

4. CREATE FIRST KEY (one click)
   Click "Create your first API key" → POST /v1/account/keys/create
   → response shows the raw key ONCE in a copy-to-clipboard modal:
     "Copy this key — it will not be shown again. Lost keys can be
      rotated from the API Keys tab."
   Closing the modal records the key in /account's masked-prefix list.

5. FIRST CALL
   Curl command + SDK snippet on /account are pre-filled with the
   key from step 4 (still in browser memory until refresh).
   → prontiq.address.autocomplete({ q: "9 endeavour cou" })
   Fully typed. Works immediately.

6. USAGE
   Usage ticks up in real-time on /account (pulled from prontiq-usage).
   DynamoDB middleware enforces quota (monthly, atomic) + burst
   (per-second) per product. At 80% of quota: upgrade nudge on /account
   + SES threshold email.

7. UPGRADE
   Clicks "Upgrade" → Stripe embedded pricing table
   Picks Starter or Growth → card details in Stripe's hosted form
   Stripe webhook updates DynamoDB tier/quota; next request reflects new limits

8. SHOPIFY (optional)
   Clicks "Integrations" → Shopify card → OAuth install flow
   Store-scoped key provisioned automatically (via the same
   /v1/account/keys/create path with `scope: "shopify"` metadata)
   Checkout extension installed — address autocomplete live

9. TEAM (optional)
   Adds colleague via Clerk org management
   Colleague gets own login, shared API keys and usage data
```

> **Why first key is user-driven, not webhook-emailed.** Hash-only storage means we can't email a key we minted server-side and then lost — the raw value cannot be reconstructed from the hash. Generating in the user-visible HTTP response solves this without any escrow / one-time-reveal complexity. Welcome email becomes a navigational nudge ("sign in to create your key") rather than a secret delivery channel that breaks if SES is down.

### 5.9 Dashboard & Account Security

No custom dashboard application. One Next.js page at `prontiq.dev/account` using Clerk's `<UserProfile />` with custom tabs. Every tab is DynamoDB-backed or Stripe-hosted — no third-party management UI.

> Forward contract: no `/v1/account/*` routes exist in live code yet. Implementation tracked under P1B and P1C tickets.

#### 5.9.1 Account Page Structure

```
┌───────────────────────────────────────────────────┐
│  Prontiq                                 [Sign out] │
│                                                     │
│  [Profile] [Security] [Usage] [Billing] [API Key]  │
│  ─────────────────────────────────────────────────  │
│                                                     │
│  April 2026                                         │
│                                                     │
│  Address API    ██████████████░░░  47,200 / 50,000  │
│  ABN Verify     ████░░░░░░░░░░░░   8,300 / 50,000  │
│  LEI Lookup     █░░░░░░░░░░░░░░░   1,200 / 50,000  │
│                                                     │
│  Plan: Growth ($99/mo)  ·  Resets May 1             │
│  [View daily breakdown ▼]                           │
└───────────────────────────────────────────────────┘
```

| Tab | Data Source | Components |
|---|---|---|
| **Profile** | Clerk managed | Name, email, avatar, connected accounts |
| **Security** | Clerk + custom (§5.9.2) | Password, 2FA, active sessions, login history |
| **Usage** | `GET /v1/account/usage` → DynamoDB | Progress bars, 30-day chart, quota warnings |
| **Billing** | Stripe embedded pricing table + customer portal | Plan management, invoices, payment methods |
| **API Key** | `GET /v1/account/keys` → DynamoDB GSI | Masked key display, Create/Rotate/Revoke, audit log |

#### 5.9.2 Account Security

##### Authentication & Session Management

Sessions are HttpOnly, Secure, SameSite=Lax cookies. 7-day sliding window. 30-minute idle timeout on the account page. Users can view and revoke individual sessions.

##### Sensitive Action Re-authentication

| Action | Re-auth Required? | Method |
|---|---|---|
| View usage / billing | No | — |
| Create API key | No | Key limits enforced |
| Rotate API key | **Yes** | Clerk step-up (password or 2FA) |
| Revoke API key | **Yes** | Clerk step-up |
| Change billing plan | **Yes** | Stripe Checkout (card re-entry) |
| Delete organisation | **Yes** | Clerk step-up + typed confirmation |
| Invite team member | No | Can be revoked by admin |

##### CSRF Protection

SameSite=Lax cookies. All state-mutating requests require Clerk session token in `Authorization` header. CORS restricts `/v1/account/*` to `https://prontiq.dev`. API Gateway rejects requests without valid Origin/Referer.

##### Account Endpoint Rate Limits

| Endpoint Group | Limit | Window | Scope |
|---|---|---|---|
| `POST /v1/account/keys/*` | 5 req | 1 minute | Per org |
| `POST /v1/account/keys/rotate` | 3 req | 1 minute | Per org |
| `POST /v1/account/keys/revoke` | 3 req | 1 minute | Per org |
| `GET /v1/account/usage` | 30 req | 1 minute | Per user |
| `GET /v1/account/keys` | 30 req | 1 minute | Per user |

##### Audit Trail Visibility

The API Key tab displays recent key lifecycle events from `prontiq-audit` — who, when, from which IP. Developers can answer "who rotated my production key?" without a support ticket.

##### Multi-org Isolation & Role-Based Access

Clerk supports multiple orgs per user. The account page respects the currently selected org via `<OrganizationSwitcher>`. Keys, usage, billing, and audit are all scoped to `orgId` derived from the Clerk session — never from URL or request body.

Only users with the Clerk role `admin` can create, rotate, or revoke keys. The `member` role can view usage and keys (masked) but cannot mutate them.

### 5.10 Brand

All design tokens defined in `packages/shared/src/brand.ts`. One file, all surfaces.

```typescript
export const brand = {
  name: 'Prontiq',
  colors: {
    primary: '#0F172A',      // near-black, terminal aesthetic
    accent: '#3B82F6',       // blue, links and focus rings
    surface: '#FFFFFF',
    muted: '#64748B',
    success: '#10B981',
    danger: '#EF4444',
  },
  font: {
    sans: 'Inter, system-ui, sans-serif',
    mono: 'JetBrains Mono, monospace',
  },
  radius: '8px',
  logo: { light: '/logo-light.svg', dark: '/logo-dark.svg' },
};
```

| Surface | How It's Themed | Sync |
|---|---|---|
| **Landing page** (Next.js) | Tailwind `theme.extend` consuming `brand.ts` | Build-time import |
| **Clerk** (sign-in, profile) | `<ClerkProvider appearance>` — `colorPrimary`, `fontFamily`, `borderRadius` | Runtime import |
| **Mintlify** (docs) | `mint.json` — `colors.primary`, `logo`, `font` | CI script reads `brand.ts` → writes `mint.json` |
| **Stripe** (billing portal) | Dashboard → Branding — logo, icon, accent | Manual one-time setup |
| **SES emails** | HTML template — same logo, colours, font | Build-time token injection |

> **TODO — reconcile with `docs/BRAND.md`.** The existing BRAND.md specifies `DM Sans` / `Instrument Serif` / `IoskeleyMono` with `#06080d` / `#22d3ee`. v2.2 canonicalizes `Inter` / `JetBrains Mono` with `#0F172A` / `#3B82F6`. These disagree. Reconciliation is a separate ticket; `brand.ts` does not exist in the repo yet.

### 5.11 Docs & SDKs

**Mintlify** (free Hobby tier) — docs site with per-product sections, generated from the OpenAPI spec that Hono auto-produces. Interactive playground. Git-based: docs live in the repo, deploy on push.

```
docs.prontiq.dev/
├── Getting Started
│   ├── Quick Start
│   ├── Authentication
│   └── Rate Limits & Quotas
├── Address API
│   ├── Autocomplete · Validate · Enrich · Reverse · Lookup
├── ABN Verification
│   ├── Verify · Search · Directors
├── LEI Lookup
│   ├── Lookup · Search
├── SDKs
│   ├── TypeScript · Python · PHP · Go
├── Integrations
│   ├── Shopify · WooCommerce · Web Component
└── API Reference (auto-generated from OpenAPI)
```

**Speakeasy** (free tier: 1 SDK, 50 methods) — auto-generates typed SDKs from the OpenAPI spec. Published to npm, PyPI, Packagist via GitHub Action on spec change.

**SDK usage:**

```typescript
import { Prontiq } from "@prontiq/sdk";

const prontiq = new Prontiq({ apiKey: "pq_live_..." });

// Address autocomplete
const { suggestions } = await prontiq.address.autocomplete({ q: "9 endeavour cou" });

// ABN verification
const { entity } = await prontiq.abn.verify({ abn: "51824753556" });

// LEI lookup
const { entity } = await prontiq.lei.lookup({ lei: "549300MLUDYVRQOOXS22" });
```

### 5.12 Distribution

**Shopify Checkout UI Extension** — address autocomplete at checkout. OAuth install from dashboard provisions a store-scoped API key automatically. For B2B stores: bundles address validation with ABN verification.

**WooCommerce plugin** — checkout field hooks. Settings page for API key. WordPress Plugin Directory.

**`<prontiq-address>` web component** — embeddable autocomplete widget. Works in any frontend framework. Hero demo on the landing page and docs site.

```html
<script src="https://cdn.prontiq.dev/address-widget.js"></script>
<prontiq-address api-key="pq_live_..." on-select="handleAddress"></prontiq-address>
```

**[`ariscan`](https://github.com/jbejenar/prontiq-ariscan) integration** — Prontiq's open-source CLI that scores codebases for AI agent readiness using an 8-pillar rubric grounded in 80+ research papers. The CVE/NVD API feeds directly into `ariscan`'s security pillar scoring, and the address/ABN APIs serve as reference implementations for the API design pillar. Developers using `ariscan` discover the data APIs. Developers using the data APIs discover `ariscan`. Cross-pollination between the open-source tool and the commercial platform.

---

## 6. Monorepo Structure

Live layout. The account Next.js app (`/account` page) and `brand.ts` in `shared/` are planned additions in P1B/P1C and are marked below.

```
prontiq-platform/
├── sst.config.ts                       # SST v4 + Pulumi — deploys everything
├── packages/
│   ├── api/                            # Hono on Lambda — TWO entry points: index.ts ($default
│   │   │                               #   address-API hot path) and account-handler.ts
│   │   │                               #   (PqAccount Lambda for /v1/account/*; bundle isolation)
│   │   ├── src/
│   │   │   ├── routes/                 # /v1/{product}/*
│   │   │   │   ├── address.ts
│   │   │   │   ├── account.ts          # POST /setup — Clerk-JWT recovery (P1B.05 PR 3/3, live)
│   │   │   │   ├── abn.ts              # (Phase 2)
│   │   │   │   ├── lei.ts              # (Phase 3)
│   │   │   │   ├── cve.ts              # (Phase 5)
│   │   │   │   └── patents.ts          # (Phase 5)
│   │   │   ├── middleware/
│   │   │   │   ├── auth.ts             # SHA-256 key verification (post-P1B.04b migration)
│   │   │   │   ├── clerk-jwt.ts        # Clerk session-token verification for /v1/account/* (P1B.05 PR 3)
│   │   │   │   ├── rate-limit.ts       # Token bucket (P1B.09)
│   │   │   │   └── usage.ts            # Atomic counter increment on prontiq-usage
│   │   │   ├── search/
│   │   │   │   ├── client.ts           # OpenSearch SigV4 client
│   │   │   │   ├── queries.ts          # Query builders per product
│   │   │   │   └── relevance.ts
│   │   │   ├── index.ts                # $default Lambda — address-API hot path; do NOT
│   │   │   │                           #   import @prontiq/control-plane or @clerk/backend here
│   │   │   └── account-handler.ts      # PqAccount Lambda — /v1/account/* with clerk-jwt mounted
│   │   └── package.json
│   ├── shared/                         # Shared types, constants, utilities
│   │   ├── src/
│   │   │   ├── types.ts                # Product registry, manifest schema, error types, ApiKeyRecord
│   │   │   ├── constants.ts            # Product→alias mapping, ERROR_CODES, PLANS (P1B.03)
│   │   │   ├── validation.ts           # Zod schemas (shared between API and ingestion)
│   │   │   ├── keys.ts                 # generateKey, hashKey (P1B.02)
│   │   │   └── brand.ts                # (Planned — §5.10; reconcile with docs/BRAND.md)
│   │   └── package.json
│   ├── docs/                           # Mintlify config + MDX content + openapi.json
│   │   ├── mint.json
│   │   └── guides/
│   ├── ingestion/                      # Step Functions + Lambda handlers
│   │   ├── src/
│   │   │   ├── read-manifest.ts
│   │   │   ├── create-index.ts
│   │   │   ├── bulk-ingest.ts          # 10GB mem, 15min timeout
│   │   │   ├── health-check.ts
│   │   │   ├── alias-swap.ts
│   │   │   └── cleanup.ts
│   │   └── package.json
│   ├── control-plane/                  # @prontiq/control-plane — provisionOrg service + audit + clerk helpers
│   │   ├── src/
│   │   │   ├── provisioning.ts         # createProvisioningService() — Stripe customer create + TransactWriteItems envelope+audit + best-effort SES welcome email; exception-free public surface (read-result discriminated union); strong reads on every envelope check
│   │   │   ├── audit.ts                # buildAuditTransactItem (atomic grouping) + writeAudit (standalone) + monotonic ULID + idempotent on eventId
│   │   │   ├── clerk.ts                # resolvePrimaryEmail (verified-primary-email invariant — shared by webhook + /v1/account/setup)
│   │   │   └── index.ts
│   │   └── package.json                # Consumed by webhooks AND api
│   ├── webhooks/                       # Lambdas: clerk.ts (live) + stripe.ts (P1B.06 stub)
│   │   ├── src/
│   │   │   ├── clerk.ts                # organizationMembership.created (admin role) → resolvePrimaryEmail (from @prontiq/control-plane) → provisionOrg
│   │   │   ├── stripe.ts               # 4 events (§5.7) — stub; P1B.06
│   │   │   └── index.ts                # Router
│   │   └── package.json
│   └── plugins/                        # Phase 4 distribution
│       ├── shopify/                    # Checkout UI Extension
│       ├── woocommerce/                # WP plugin
│       └── web-component/              # <prontiq-address> widget
│
│   # Planned (P1C):
│   # └── web/                          # Next.js — landing page + /account page (Clerk UserProfile + custom tabs)
│
├── scripts/                            # sync-brand-to-mintlify.ts, seed-test-data.ts, purge-org.ts, ts-package-build.mjs
├── docs/                               # ARCHITECTURE.MD, ROADMAP.md, decisions/, operations/, runbooks/
├── .github/
│   └── workflows/                      # ci.yml, deploy-prod.yml, generate-sdks.yml
├── package.json                        # Workspace root
├── turbo.json                          # Turborepo config
└── tsconfig.json
```

Seven packages today (`api`, `control-plane`, `docs`, `ingestion`, `plugins`, `shared`, `webhooks`). The eighth (`web`) is added in P1C when the `/account` page ships. No dashboard application — the account page is a thin Clerk-wrapped Next.js view over DynamoDB-backed and Stripe-hosted components. `control-plane` was added in P1B.05 PR 1/3 to keep `provisionOrg` callable from both `webhooks` (server-to-server) and `api` (user-driven recovery via `/v1/account/setup`, P1B.05 PR 3/3) without an awkward `api → webhooks` dep direction.

---

## 7. Auth & Endpoint Reference

### 7.1 Three Auth Paths

| Endpoint Group | Auth Mechanism | Token | Identity |
|---|---|---|---|
| `/v1/{product}/*` | API key | `X-Api-Key` header | The key (maps to org via DynamoDB) |
| `/v1/account/*` | Clerk JWT | `Authorization: Bearer` header | Clerk user + active org |
| `/webhooks/*` | Signature verification | `svix-signature` / `stripe-signature` | The sending service |

Zero overlap. Each endpoint group has exactly one way in.

### 7.2 Middleware Chains

**`apiKeyAuth` (product endpoints):**

This is a summary. **§5.5.3 is the authoritative hot-path flow** — quota is enforced by a single conditional `UpdateItem` on `prontiq-usage` that increments only when allowed. There is no separate "read usage → check quota → write usage" path; that pattern (the v2.1 design) had a race window that let concurrent free-tier requests bypass the limit.

```
1. Extract X-Api-Key header                    (missing → 401 MISSING_API_KEY)
2. SHA-256 hash → GetItem prontiq-keys         (not found → check REDIRECT
                                                 with authValidUntil grace
                                                 per §5.5.1 → 401 if expired
                                                 or fallback misses)
3. Check active, product, paymentOverdue,
   burst (token bucket §5.4.1)                 (any fail → 401 / 403 / 429)
4. **Atomic INCREMENT on prontiq-usage**       (per §5.5.3 step 4)
   ConditionExpression:
     attribute_not_exists(requestCount)
       OR requestCount < :quota
       OR :tierAllowsOverage = :true
   ConditionalCheckFailed AND tier='free' → 429 QUOTA_EXCEEDED
   newCount > quota AND tier paid → set X-RateLimit-Over: true header
5. Route handler → OpenSearch → 200 + rate limit headers
   (Remaining = quota - newCount from step 4's ReturnValues=UPDATED_NEW)
```

**Quota enforcement contract:** the conditional `UpdateItem` in step 4 is the **only** authoritative quota gate. Any read of `prontiq-usage` in middleware is for display headers (e.g., a `X-RateLimit-Remaining` hint pulled from prefetched data) and **must not** be used to allow or deny a request. The v2.1 read-then-check pattern is removed.

> **Why §7.2 used to repeat the quota check.** Earlier drafts showed a "step 5: check quota" step that read `prontiq-usage` separately. That described the v2.1 design which had a race window — concurrent free-tier requests at the boundary could all observe the same remaining count and proceed. Resolved in v2.2 by collapsing check + increment into the single conditional `UpdateItem`. See §5.5.3 for the full latency budget and rationale.

> Live code emits `PRODUCT_NOT_ALLOWED` (see `packages/shared/src/constants.ts:77`). v2.2 originally specified `PRODUCT_NOT_ENABLED`; ARCHITECTURE.MD canonicalizes the live string. Rename to `PRODUCT_NOT_ENABLED` is a v2.3 consideration with SDK-regen impact.

**`clerkAuth` (account endpoints):**

```
1. Extract Authorization: Bearer <jwt>         (missing → 401 UNAUTHORIZED)
2. Verify JWT against Clerk JWKS (cached)      (invalid/expired → 401 UNAUTHORIZED)
3. Extract orgId from claims                   (missing → 403 ORG_REQUIRED)
4. Check Clerk role for mutations              (member on mutate → 403)
5. Attach orgId to request context
6. Route handler → DynamoDB scoped to orgId
```

**Webhook handlers:**

```
1. Read raw request body (Stripe signature covers raw bytes)
2. Verify signature (Svix or Stripe)           (invalid → 400 INVALID_SIGNATURE)
3. Parse verified event
4. Dispatch by event.type
```

### 7.3 Complete Endpoint Reference

Endpoint URLs reflect live prod (query-param form). Path-param migration is a v2.3 consideration.

#### Address API

| Method | Endpoint | Auth Header | Token Format | Min Tier | On Missing/Invalid |
|---|---|---|---|---|---|
| GET | `/v1/address/autocomplete?q=&state=&limit=` | `X-Api-Key` | `pq_live_` + 48 hex chars | Free | 401 `MISSING_API_KEY` / 401 `INVALID_API_KEY` |
| GET | `/v1/address/validate?q=` | `X-Api-Key` | `pq_live_` + 48 hex chars | Free | 401 / 401 |
| GET | `/v1/address/enrich?id=` | `X-Api-Key` | `pq_live_` + 48 hex chars | Starter | 401 / 401 / 403 `PRODUCT_NOT_ALLOWED` |
| GET | `/v1/address/reverse?lat=&lon=&radius=&limit=` | `X-Api-Key` | `pq_live_` + 48 hex chars | Free | 401 / 401 |
| GET | `/v1/address/lookup/postcode?postcode=&limit=` | `X-Api-Key` | `pq_live_` + 48 hex chars | Free | 401 / 401 |
| GET | `/v1/address/lookup/suburb?suburb=&state=&limit=` | `X-Api-Key` | `pq_live_` + 48 hex chars | Free | 401 / 401 |

#### ABN API *(Phase 2)*

| Method | Endpoint | Auth Header | Token Format | Min Tier | On Missing/Invalid |
|---|---|---|---|---|---|
| GET | `/v1/abn/verify?abn=` | `X-Api-Key` | `pq_live_` + 48 hex chars | Free | 401 / 401 |
| GET | `/v1/abn/search?name=&state=` | `X-Api-Key` | `pq_live_` + 48 hex chars | Free | 401 / 401 |
| GET | `/v1/abn/directors?acn=` | `X-Api-Key` | `pq_live_` + 48 hex chars | Starter | 401 / 401 / 403 |

#### LEI API *(Phase 3)*

| Method | Endpoint | Auth Header | Token Format | Min Tier | On Missing/Invalid |
|---|---|---|---|---|---|
| GET | `/v1/lei/lookup?lei=` | `X-Api-Key` | `pq_live_` + 48 hex chars | Free | 401 / 401 |
| GET | `/v1/lei/search?name=&country=` | `X-Api-Key` | `pq_live_` + 48 hex chars | Free | 401 / 401 |

#### CVE API *(Phase 5)*

| Method | Endpoint | Auth Header | Token Format | Min Tier | On Missing/Invalid |
|---|---|---|---|---|---|
| GET | `/v1/cve/lookup?cve=` | `X-Api-Key` | `pq_live_` + 48 hex chars | Free | 401 / 401 |
| GET | `/v1/cve/search?product=&version=` | `X-Api-Key` | `pq_live_` + 48 hex chars | Free | 401 / 401 |

#### Patents API *(Phase 5)*

| Method | Endpoint | Auth Header | Token Format | Min Tier | On Missing/Invalid |
|---|---|---|---|---|---|
| GET | `/v1/patents/search?q=&class=` | `X-Api-Key` | `pq_live_` + 48 hex chars | Free | 401 / 401 |
| GET | `/v1/patents/lookup?application=` | `X-Api-Key` | `pq_live_` + 48 hex chars | Free | 401 / 401 |

#### Account Endpoints *(Phase 1C — not yet live)*

| Method | Endpoint | Auth Header | Token Format | Org Required | On Missing/Invalid |
|---|---|---|---|---|---|
| POST | `/v1/account/setup` | `Authorization` | `Bearer <clerk_jwt>` | Yes | Manual recovery if webhook missed (§5.7.1, §12.2). Idempotent — returns 200 if `ORG#{orgId}` already exists. 404 `ORG_NOT_PROVISIONED` is the trigger condition. |
| GET | `/v1/account/usage?period=` | `Authorization` | `Bearer <clerk_jwt>` | Yes | 401 `UNAUTHORIZED` / 403 `ORG_REQUIRED` |
| GET | `/v1/account/keys` | `Authorization` | `Bearer <clerk_jwt>` | Yes | 401 / 403. Returns `[]` if `hasFirstKey: false` on org envelope. |
| POST | `/v1/account/keys/create` | `Authorization` | `Bearer <clerk_jwt>` | Yes (admin) | 401 / 403 / 404 `ORG_NOT_PROVISIONED` (call `/setup` first). **Returns raw key once in response body** (only place in the system where a raw key crosses the network outbound). |
| POST | `/v1/account/keys/rotate` | `Authorization` | `Bearer <clerk_jwt>` | Yes (admin + step-up) | 401 / 403. Returns the new raw key once in response body. Writes REDIRECT record per §5.5.1 / §12.3. |
| POST | `/v1/account/keys/revoke` | `Authorization` | `Bearer <clerk_jwt>` | Yes (admin + step-up) | 401 / 403 |

#### Webhook Endpoints

| Method | Endpoint | Auth Headers | Verification | On Invalid |
|---|---|---|---|---|
| POST | `/webhooks/clerk` | `svix-id`, `svix-timestamp`, `svix-signature` | HMAC against Clerk webhook secret | 400 `INVALID_SIGNATURE` |
| POST | `/webhooks/stripe` | `stripe-signature` | `stripe.webhooks.constructEvent()` | 400 `INVALID_SIGNATURE` |

**Handled Stripe events:** `checkout.session.completed` (initial upgrade), `customer.subscription.updated` (plan changes + past_due + recovery — §5.6.3), `customer.subscription.deleted` (cancel / downgrade), `invoice.payment_failed` (log only).

### 7.4 Response Headers

**Product requests (success):**

```
HTTP/1.1 200 OK
Content-Type: application/json
X-Request-Id: req_a1b2c3d4
X-RateLimit-Limit: 50000
X-RateLimit-Remaining: 47199
X-RateLimit-Reset: 2026-05-01T00:00:00Z
X-RateLimit-Product: address
Access-Control-Allow-Origin: *
```

**Account requests:**

```
HTTP/1.1 200 OK
Content-Type: application/json
Access-Control-Allow-Origin: https://prontiq.dev
Access-Control-Allow-Credentials: true
Cache-Control: private, no-cache
```

### 7.5 Success Response Shapes

Speakeasy generates SDK types from these shapes. Every success response includes `"product"` at top level.

**Autocomplete** (`GET /v1/address/autocomplete`):

```json
{
  "product": "address",
  "query": "9 endeavour cou",
  "count": 5,
  "results": [
    {
      "id": "GASA_422206807",
      "address": "9 ENDEAVOUR COURT COFFIN BAY SA 5607",
      "components": {
        "number": "9",
        "street": "ENDEAVOUR",
        "street_type": "COURT",
        "locality": "COFFIN BAY",
        "state": "SA",
        "postcode": "5607"
      },
      "location": { "lat": -34.61887626, "lon": 135.46174196 },
      "confidence": 1,
      "score": 0.97
    }
  ]
}
```

**Validate** (`GET /v1/address/validate`):

```json
{
  "product": "address",
  "valid": true,
  "match_score": 0.97,
  "input": "9 endeavour court coffin bay",
  "canonical": {
    "id": "GASA_422206807",
    "address": "9 ENDEAVOUR COURT COFFIN BAY SA 5607",
    "components": { "...": "..." },
    "location": { "lat": -34.61887626, "lon": 135.46174196 }
  }
}
```

> **Note on `confidence` vs `match_score`:** autocomplete returns `confidence` (integer 1-3, G-NAF geocode confidence) and `score` (float 0-1, OpenSearch relevance). Validate returns `match_score` (float 0-1, input-to-canonical match). Different fields, different names — prevents SDK type collisions.

**Enrich** (`GET /v1/address/enrich`):

```json
{
  "product": "address",
  "id": "GASA_422206807",
  "address": "9 ENDEAVOUR COURT COFFIN BAY SA 5607",
  "location": { "lat": -34.61887626, "lon": 135.46174196 },
  "boundaries": {
    "lga": { "name": "Lower Eyre Council", "code": "lgaGyBYDi99uya6" },
    "ward": null,
    "stateElectorate": { "name": "FLINDERS" },
    "commonwealthElectorate": { "name": "GREY" },
    "meshBlock": { "code": "40066660000", "category": "Residential" },
    "sa1": "40601113001",
    "sa2": { "name": "Eyre Peninsula", "code": "406011130" },
    "sa3": { "name": "Eyre Peninsula and South West", "code": "40601" },
    "sa4": { "name": "South Australia - Outback", "code": "406" },
    "gccsa": { "name": "Rest of SA", "code": "4RSAU" }
  }
}
```

Diff these shapes against `packages/docs/openapi.json` before any doc update — the live OpenAPI spec is the source of truth for SDK codegen.

---

## 8. Security

### 8.1 Security Layers

| Layer | Controls |
|---|---|
| **Edge** (API Gateway) | WAF rules, IP throttle 100/s, TLS termination, geographic blocking (optional) |
| **Application** (Hono) | Clerk JWT verify, API key hash+verify, CORS enforcement, burst rate limiting, input validation (Zod), circuit breaker, audit logging |
| **Data** (DynamoDB) | Encryption at rest (AES-256), hash-only key storage, TTL auto-expire |
| **Webhook** | Svix/Stripe signature verify, idempotency locks, 400 on invalid |
| **Email** (SES) | DKIM + SPF + DMARC, suppression list, bounce/complaint handler |

### 8.2 Threat Model

| Threat | Layer | Control |
|---|---|---|
| Stolen API key | Application | Rotation, hash-only storage, revocation |
| Brute-force key guessing | Edge + Application | IP throttle + 192-bit keyspace |
| DDoS on API | Edge | API Gateway throttle, WAF, per-IP limits |
| Session hijack | Application | HttpOnly/Secure/SameSite cookies |
| CSRF on account actions | Application | SameSite=Lax + Auth header + CORS restrict |
| Spoofed webhooks | Webhook | Signature verification |
| Duplicate webhook processing | Webhook | Idempotency: ORG#{orgId} for Clerk; per-event-id dedupe for Stripe |
| SES reputation damage | Email | Suppression list, bounce handler |
| Billing fraud (upgrade cycling) | Application | No counter reset on upgrade |
| Unauthorised key mutation | Application | Clerk role enforcement + re-auth step-up |
| Org ID manipulation | Application | orgId from Clerk session, never URL |

### 8.3 Input Validation

All inputs validated with Zod schemas in `packages/shared/src/validation.ts`. Invalid → 400 `VALIDATION_ERROR`. Zod schemas are shared between API (server) and Speakeasy SDK (client types).

### 8.4 Encryption

- DynamoDB: AES-256 at rest (AWS-managed, free)
- In transit: TLS 1.2+ at API Gateway
- API keys: SHA-256 hash only stored (never raw)
- Stripe: PCI DSS Level 1. No card data touches Prontiq infrastructure.

---

## 9. Error Taxonomy & Response Format

All errors follow a consistent JSON structure:

```json
{
  "error": {
    "code": "MACHINE_READABLE_CODE",
    "message": "Human-readable explanation with context",
    "status": 429,
    "request_id": "req_a1b2c3d4",
    "details": { "...": "..." }
  }
}
```

| Code | HTTP | When |
|---|---|---|
| `MISSING_API_KEY` | 401 | No `X-Api-Key` header |
| `INVALID_API_KEY` | 401 | Key not found, hash mismatch, or `active=false` |
| `PRODUCT_NOT_ALLOWED` | 403 | Tier doesn't include this product |
| `QUOTA_EXCEEDED` | 429 | Free tier: `requestCount >= quotaPerProduct` (paid tiers allow overage, never 429) |
| `RATE_LIMITED` | 429 | Burst rate exceeded (token bucket, §5.4.1) |
| `KEY_LIMIT_EXCEEDED` | 403 | Org at max keys for tier |
| `UNAUTHORIZED` | 401 | Missing or invalid Clerk JWT |
| `ORG_REQUIRED` | 403 | No org selected in Clerk session |
| `INVALID_SIGNATURE` | 400 | Webhook signature verification failed |
| `VALIDATION_ERROR` | 400 | Zod schema validation failed |
| `SERVICE_UNAVAILABLE` | 503 | OpenSearch down (circuit open) |
| `INTERNAL_ERROR` | 500 | Unhandled exception |

**Live today** (`packages/shared/src/constants.ts:73-77` + `packages/shared/src/types.ts` `ErrorCode` union): `MISSING_API_KEY`, `INVALID_API_KEY`, `PRODUCT_NOT_ALLOWED`, `QUOTA_EXCEEDED`. The other 8 codes are forward contracts introduced with their features:

- `RATE_LIMITED` ships with P1B.09 (burst limiter middleware).
- `KEY_LIMIT_EXCEEDED` ships with P1C.03 (`/v1/account/keys/create` with per-tier cap).
- `UNAUTHORIZED`, `ORG_REQUIRED` ship with P1C account endpoints (Clerk JWT + org resolution).
- `INVALID_SIGNATURE` ships with P1B.05 / P1B.06 (Svix / Stripe webhook verification).
- `VALIDATION_ERROR` ships when Zod middleware returns structured errors (already used in Zod openapi responses, may need a dedicated code in middleware).
- `SERVICE_UNAVAILABLE` ships with a future circuit breaker on OpenSearch.
- `INTERNAL_ERROR` is the default 500 — may already exist as a fallback in Hono error handler.

When adding any of the above codes to `packages/shared/src/constants.ts`, ensure this table stays in sync — it is the SDK consumer contract.

---

## 10. Monitoring & Alerting

All metrics via CloudWatch. EMF for custom metrics — structured stdout, zero network calls.

### 10.1 Key Metrics

| Metric | Source | Alarm Threshold |
|---|---|---|
| API latency (p50, p95, p99) | CloudWatch EMF | p99 > 50ms for 5 min |
| Error rate (4xx, 5xx) | API Gateway + EMF | 5xx > 1% for 5 min |
| DynamoDB read/write latency | CloudWatch built-in | p99 > 20ms for 10 min |
| DynamoDB throttled requests | CloudWatch built-in | > 0 for 1 min |
| OpenSearch cluster health | CloudWatch built-in | RED for 1 min |
| Circuit breaker state changes | CloudWatch EMF | Any state change |
| Lambda cold start rate | CloudWatch Insights | > 10% for 15 min |
| SES bounce rate | SES/CloudWatch | > 3% for 1 hour |
| SES complaint rate | SES/CloudWatch | > 0.05% for 1 hour |
| Billing cron success/failure | CloudWatch EMF | Any failure |

### 10.2 Alerting Tiers

| Tier | Channel | Response Time | Examples |
|---|---|---|---|
| **P1 — Critical** | PagerDuty (phone) | < 15 min | 5xx > 5%, circuit OPEN, DynamoDB throttled |
| **P2 — Warning** | Slack #prontiq-alerts | < 1 hour | p99 > 50ms, SES bounce > 3%, cold start > 10% |
| **P3 — Info** | Slack #prontiq-metrics | Next business day | DAX trigger approaching, usage nearing limits |

### 10.3 Dashboard

CloudWatch dashboard "prontiq-production": API Health (latency + error rate), DynamoDB (capacity, throttles), OpenSearch (cluster status), Billing (cron success, Stripe push count), Email (deliveries, bounces, complaints).

---

## 11. Data Retention Policy

DynamoDB TTL handles automatic expiration. No manual cleanup.

| Data | Table | Retention | Rationale |
|---|---|---|---|
| Active key metadata | `prontiq-keys` | Indefinite | Must persist while active |
| Revoked key metadata | `prontiq-keys` | Indefinite (`active=false`) | Prevents hash reuse |
| Billing registry | `prontiq-keys` | Indefinite | Updated on lifecycle events |
| Provisioning locks | `prontiq-keys` | Indefinite | Permanent idempotency |
| Usage counters | `prontiq-usage` | 90 days (TTL) | Billing needs current + previous month |
| Email flags + push state | `prontiq-usage` | 90 days (same item) | Expire with usage item |
| REDIRECT records | `prontiq-usage` | 90 days (TTL) | Match usage lifetime |
| Audit events | `prontiq-audit` | 365 days (TTL) | Incident investigation |
| Bounce suppressions | `prontiq-ses-suppressions` | 90 days (TTL) | Re-check after 90 days |
| Complaint suppressions | `prontiq-ses-suppressions` | Permanent (no TTL) | Never re-send |
| CloudWatch metrics | CloudWatch | 15 months | AWS default |
| CloudWatch logs | CloudWatch Logs | 30 days | Cost control |

### 11.1 GDPR / Privacy

On account deletion, purge: `prontiq-keys` (all org keys + `ORG#{orgId}` envelope + remove from billing registry), `prontiq-usage` (all scopes including REDIRECT records), `prontiq-audit` (all org events), `prontiq-ses-suppressions` (owner email). Stripe customer deletion via Stripe API. Clerk deletion via Clerk. Orchestrated by `scripts/purge-org.ts`.

---

## 12. Edge Cases & Failure Modes

### 12.1 Billing Boundaries

**Mid-month upgrade.** Counter not reset. Developer gets `newQuota - currentCount` remaining. Prevents upgrade/downgrade/re-upgrade gaming.

**Mid-month downgrade.** `cancel_at_period_end: true`. Access continues through paid period. Never cut off a paying customer early.

**Month-boundary clock skew.** Usage scope computed at request time (step 2, §5.5.3), passed to async write. Never recomputed. A request at 23:59:59 on April 30 always counts as April.

**First month generosity.** Signup April 15 → 10,000 credits for the remaining 15 days. Deliberate. Counter resets May 1 regardless.

### 12.2 Webhook Reliability

**Signature verification.** Clerk: Svix headers. Stripe: `stripe.webhooks.constructEvent()`. Invalid → 400 `INVALID_SIGNATURE`.

**Idempotency.**
- **Clerk provisioning** (`user.created`): writes the `ORG#{orgId}` envelope record after creating the Stripe customer (§5.7.1). A retry that hits an existing `ORG#{orgId}` returns 200 immediately. Stripe customer creation uses `Idempotency-Key: clerk-provision-{orgId}` so retries reuse the same `cus_...`. **The webhook does NOT mint API keys** — those are user-driven via `/v1/account/keys/create` after sign-in, which puts the raw key in a user-visible HTTP response (the only safe place for hash-only-stored secrets).
- **Stripe webhooks**: dedupe on `event.id` via a claim/finalize reserved item in `prontiq-keys` (`WEBHOOK#stripe#{eventId}`). The handler claims the item as `processing`, applies replay-safe target-state writes, then finalizes it as `completed`. Stripe duplicates that arrive while a fresh `processing` claim exists return 500 so Stripe retries later; completed markers return 200 no-op.

**Clerk webhook failure → manual recovery.** Two independent failure cases, both fully recoverable from the user side:

1. **Webhook never created the org envelope** (e.g., Svix delivery failure during a Lambda outage). The `/account` page detects "no `ORG#{orgId}` record" and shows a "Set up your account" CTA. Clicking it calls `POST /v1/account/setup` (Clerk-authenticated), which runs the same Stripe-customer-create + ORG-envelope-PutItem flow as the webhook (same `Idempotency-Key`, same atomic write). Same code, two triggers.
2. **Org envelope exists but the user has no keys** (e.g., SES failed so no welcome email arrived, but webhook succeeded). The standard `/v1/account/keys/create` flow handles this — there's nothing special about a "first" key. The `hasFirstKey` flag flips on the first successful create.

In both cases, the user owns recovery. No operator paging required for SES outages or single-shot webhook misses.

**Stripe webhook failure.** Stripe redelivers failed webhooks for 3 days. If processing fails persistently, the event lands in DLQ and pages oncall. Common cause: `subscriptionItems` validation failure (§5.7.2) — usually a Stripe Dashboard misconfiguration where a Prontiq product is missing its metered Price.

### 12.3 Key Rotation Safety

During rotation, `TransactWriteItems` atomically deletes the old `prontiq-keys` item, puts the new one, swaps the registry hash (if billable), writes the audit ROTATE entry, and writes a REDIRECT record to `prontiq-usage`. In-flight requests against the old key may race the swap; the REDIRECT record gives them a graceful drain.

**Two-clock model — auth grace and billing attribution are independent:**

| Clock | Field | Default | What it controls |
|---|---|---|---|
| Auth grace | `authValidUntil` | now + 5 min | How long the auth middleware will accept the old raw key (re-resolves to newHash). After expiry → 401. |
| Billing attribution | `ttl` | now + 90 days | How long the billing cron attributes orphaned usage on `oldHash` to `newHash`. After expiry → DDB removes the record. |

**Why decoupled?** A user who rotates because of a leak gets immediate effective protection — the leaked key's exposure window is bounded to 5 minutes regardless of in-flight Lambda invocations. The 90-day billing window only matters for the cron, which runs server-side and never authenticates a request.

**REVOKE-after-ROTATE:** the redirect back-door closes automatically. The REVOKE on `newHash` flips `active: false` on the live `prontiq-keys` record. The next request with the (rotated-out) old raw key follows the REDIRECT, lands on `newHash`, and fails the `active` check in §5.5.3 step 3 → 401. No explicit REDIRECT mutation needed at REVOKE time.

See §5.5.1 for the full REDIRECT schema, §5.5.3 for the auth middleware behaviour on lookup miss, and §5.6.2 for billing cron handling.

### 12.4 OpenSearch Failure Handling

Circuit breaker: CLOSED (normal) → OPEN (> 50% failures in 60s → return 503 `SERVICE_UNAVAILABLE` immediately) → HALF-OPEN (after 30s, allow one probe request).

### 12.5 SES Bounce & Complaint Handling

AWS suspends SES at > 5% bounce rate or > 0.1% complaint rate. A Lambda subscriber maintains `prontiq-ses-suppressions`. Before every SES send, check the suppression list. Hard bounces suppress immediately. Soft bounces after 3 within 30 days. Complaints permanent.

Prerequisite: SES production-access exit from the AWS sandbox (verified sending domain, DKIM+SPF+DMARC, production-access request approved by AWS — typically 24-48h review).

### 12.6 Registry Sharding

`REGISTRY#active-keys` has a practical ceiling of ~6,000 billable keys per item (400 KiB / ~64 bytes per hash + set overhead). Beyond that, shard into `REGISTRY#active-keys#{0..N}` keyed by the first N bits of the hash. See §5.5.1 for the detailed math. Trigger: Phase 5.

### 12.7 Burst Limiter Concurrency

In-memory token bucket (§5.4.1) is per-Lambda-instance. With N concurrent instances, the effective burst is N × `rateLimit`. API Gateway's per-IP throttle is the global fallback. A real per-key global limiter (Redis / ElastiCache / API Gateway usage plans) is post-Phase-1.

### 12.8 Security Threats

**Invalid key DDoS.** API Gateway IP-level throttling (100 req/s per IP) before Lambda fires.

**Key in email.** Industry standard. Mitigation: immediate rotation via account page.

---

## 13. CI/CD

**GitHub Actions + OIDC federation.** No stored AWS credentials.

> **Note:** The existing `flat-white-role` has S3-only permissions. Platform deployment (`sst deploy`) requires a separate `prontiq-platform-deploy-role`. SST v4 uses **Pulumi** (not CloudFormation) — the deploy role needs:
>
> - **Pulumi state backend:** S3 (`PutObject`, `GetObject`, `DeleteObject` on the SST-managed state bucket) + DynamoDB (`PutItem`, `GetItem`, `DeleteItem` on the SST-managed lock table). SST v4 bootstraps these automatically on first `sst deploy` — the role needs `s3:CreateBucket` and `dynamodb:CreateTable` for the initial bootstrap, or pre-create them.
> - **Resource permissions:** Lambda, API Gateway V2, DynamoDB, IAM (passrole for Lambda execution roles), CloudWatch (logs + alarms), OpenSearch, S3 (for data bucket access), WAF, EventBridge, Step Functions, SNS, SQS.
> - **NOT needed:** CloudFormation permissions (SST v2/CDK used CF; SST v4 uses Pulumi, not CF).
>
> Create this role with the same OIDC trust policy scoped to `repo:jbejenar/prontiq-platform:*`.

```yaml
permissions:
  id-token: write
  contents: read

steps:
  - uses: aws-actions/configure-aws-credentials@v4
    with:
      role-to-assume: arn:aws:iam::493712557159:role/prontiq-platform-deploy-role
      aws-region: ap-southeast-2
```

| Trigger             | Action                                            |
| ------------------- | ------------------------------------------------- |
| Push to `main`      | Lint, typecheck, build, `sst deploy --stage dev`  |
| Manual dispatch     | `sst deploy --stage prod`                         |
| OpenAPI spec change | Speakeasy regenerates SDKs, publishes to npm/PyPI |
| Docs change         | Mintlify rebuilds docs site                       |
| S3 manifest lands   | EventBridge → Step Functions → index + swap       |

---

## 14. Phasing

Phases are defined by product scope. Security deliverables are first-class, shipped alongside product work — not bolted on later.

| Phase | Timeline | Scope | Product Deliverables | Security Deliverables |
|---|---|---|---|---|
| **1** | 4-6 weeks | Address API | Hono routes, DynamoDB-native key verify + usage counters, rate-limit headers, burst rate limiting, Clerk auth, Stripe metered billing, Mintlify docs, Speakeasy TypeScript SDK, landing page, `/account` page, welcome email via SES | Idempotent webhooks, flag-based threshold emails, `prontiq-audit` table, circuit breaker, SES bounce handling, CORS per-endpoint, input validation (Zod), re-auth step-up on sensitive actions, WAF rules, CloudWatch dashboard, payment grace period (14d) |
| **2** | 4 weeks | ABN/ASIC | New pipeline, new Hono route group, new OpenSearch index. SDK adds `prontiq.abn`. Stripe adds ABN line item. | Extend error taxonomy; ABN-specific Zod schemas |
| **3** | 3 weeks | GLEIF/LEI | First international product. Evaluate team-management needs. | Evaluate geographic access restrictions |
| **4** | 4 weeks | Shopify + WooCommerce | Scale OpenSearch to 2-node HA. Lambda in-memory cache. | Plugin-specific API key scoping (read-only keys) |
| **5** | TBD | CVE/NVD + Patents | DAX when trigger criteria met. Full dashboard if > 500 developers. | `REGISTRY#active-keys` sharding. Full security audit. Penetration testing. |

---

## 15. Competitive Position at Phase 3

Three products. One platform. One API key. One SDK. One invoice.

| Capability                    | Prontiq | CreditorWatch | Loqate | Google Places | Aust Post |
| ----------------------------- | ------- | ------------- | ------ | ------------- | --------- |
| Address validation (G-NAF)    | ✅      | ❌            | ✅     | ❌            | ✅        |
| ABS statistical enrichment    | ✅      | ❌            | ❌     | ❌            | ❌        |
| Electorate + hazard zones     | ✅      | ❌            | ❌     | ❌            | ❌        |
| ABN/ASIC verification         | ✅      | ✅            | ❌     | ❌            | ❌        |
| LEI lookup                    | ✅      | ❌            | ❌     | ❌            | ❌        |
| Typed SDKs (5 languages)      | ✅      | ❌            | ❌     | ✅            | ❌        |
| Interactive docs + playground | ✅      | ❌            | ❌     | ✅            | ❌        |
| Free tier (5K req/month)      | ✅      | ❌            | ❌     | ❌            | ❌        |
| Shopify + WooCommerce plugins | ✅      | ❌            | ✅     | ❌            | ❌        |
| Single API key for everything | ✅      | ❌            | ❌     | ❌            | ❌        |
| Open-source data pipeline     | ✅      | ❌            | ❌     | ❌            | ❌        |
| Price per 1K at scale         | $1.00   | ~$3-5         | ~$3-5  | ~$2-5         | Opaque    |

---

## 16. Design Principles

1. **The manifest is the platform's API boundary.** Any pipeline, anywhere, drops NDJSON + manifest.json into S3. The platform handles everything downstream. Adding a new data product is a pipeline, a route group, and a docs section. Infrastructure doesn't change.

2. **No vendor in the hot path.** Clerk manages identity. Stripe manages billing. API key verification is a single DynamoDB read against a hash — no third party touches the sub-50ms autocomplete call. No vendor latency, no vendor outage.

3. **The OpenAPI spec is the single atom.** `@hono/zod-openapi` generates it from route schemas. Mintlify consumes it for docs. Speakeasy consumes it for SDKs. One source of truth, three outputs. Change a route, everything updates.

4. **Free tiers are marketing spend, not lost revenue.** Clerk (50K MAUs), Mintlify (Hobby plan), Speakeasy (50 methods), Stripe (processing only), SES (62K/month Lambda-emitted). The platform costs $35/month to run until you have thousands of paying developers.

5. **Ship what validates, build what earns.** Phase 1 is the API, docs, and an SDK. The dashboard, plugins, and additional products follow demand, not assumptions.

---

## 17. Licence

Proprietary — Prontiq Pty Ltd. All rights reserved.
