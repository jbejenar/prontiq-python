# Prontiq Platform Architecture

> A unified data API platform for Australian and global open data, commercialised with obsessive developer experience.

**Repo:** `prontiq-platform` (private)
**Public repos:** [`flat-white`](https://github.com/jbejenar/flat-white) (address pipeline), [`prontiq-ariscan`](https://github.com/jbejenar/prontiq-ariscan) (AI readiness scanner), `abn-extract` (future), `lei-extract` (future)
**Version:** 1.0
**Author:** Prontiq Engineering
**Last Updated:** April 2026

---

## 1. Vision

Every product on this platform follows one pattern:

```
Free open dataset → independent pipeline → S3 (NDJSON + manifest.json)
    → event-driven indexing → OpenSearch → commercial API
    → auth / billing / docs / SDKs
```

One Prontiq subscription. One API key. One SDK. One invoice. Per-product usage line items. The developer who came for address validation discovers ABN verification and LEI lookup. That's the lock-in. That's the moat.

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
│   Domain: flat-white  ·  Engine: OpenSearch 2.13                            │
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
│   Hono + @hono/zod-openapi on Lambda (ARM64, Node.js 20)  ·  SST v3 + Pulumi   │
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
│   ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────────┐     │
│   │  DynamoDB    │  │    Unkey     │  │          Stripe              │     │
│   │ Hot-path key │  │ Key issuance │  │  Metered per-product billing │     │
│   │ verification │  │ + scoping    │  │  One sub, usage line items   │     │
│   │ (+ DAX at    │  │ + mgmt UI   │  │  Embedded pricing table      │     │
│   │  scale)      │  │             │  │                              │     │
│   └──────────────┘  └──────────────┘  └──────────────────────────────┘     │
└──────────────────────────────┬──────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                    CUSTOMER-FACING SURFACES                                   │
│                                                                              │
│   ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐         │
│   │    Dashboard     │  │  Docs + Playground│  │      SDKs       │         │
│   │  Next.js + Clerk │  │    Mintlify      │  │    Speakeasy    │         │
│   │  + shadcn/ui     │  │  (from OpenAPI)  │  │  (from OpenAPI) │         │
│   │                  │  │                  │  │                  │         │
│   │ · API keys       │  │ · Per-product    │  │ · TypeScript    │         │
│   │ · Usage charts   │  │   sections       │  │ · Python        │         │
│   │ · Billing        │  │ · Interactive    │  │ · PHP           │         │
│   │ · Integrations   │  │   playground     │  │ · Go            │         │
│   │ · Team mgmt      │  │ · Code snippets  │  │ · Ruby          │         │
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
| **Infrastructure**        | SST v3 + Pulumi                              | —                                                         | —                       | Deploys API + dashboard from one repo. `sst dev` for live Lambda dev. No CloudFormation synth step.                                                                       |
| **API framework**         | Hono + `@hono/zod-openapi` on Lambda (ARM64) | —                                                         | —                       | Route groups per product, shared middleware, auto OpenAPI 3.1 spec from Zod route schemas. The spec is the atom from which docs and SDKs are derived.                     |
| **Search**                | OpenSearch managed                           | ~$35/mo (t3.small)                                        | ~$150/mo (2× t3.medium) | One cluster, index per product, alias-swap for zero-downtime updates.                                                                                                     |
| **Data pipelines**        | Independent per product                      | —                                                         | —                       | Each ships NDJSON + manifest.json to S3. Platform reacts.                                                                                                                 |
| **Ingestion**             | EventBridge → Step Functions                 | AWS free tier                                             | —                       | S3 manifest trigger → parallel bulk index → health check → alias swap.                                                                                                    |
| **Auth (portal)**         | Clerk                                        | **50,000 MAUs free**                                      | $20/mo (Pro)            | Sign-up, login, OAuth, orgs, teams. Pre-built Next.js components. Won't hit paid for years.                                                                               |
| **API key mgmt**          | Unkey                                        | **150,000 verifications/mo free**                         | $25/mo                  | Key issuance, per-product scoping, management UI. Not in the hot request path.                                                                                            |
| **Hot-path verification** | DynamoDB (+ DAX from Phase 3)                | AWS free tier                                             | —                       | Sub-ms key verification. Synced from Unkey via webhooks. No external dependency per request. Plain DynamoDB in Phase 1-2; DAX added when sub-ms latency matters at scale. |
| **Billing**               | Stripe (metered)                             | **Processing fees only**                                  | 2.9% + 30¢/txn          | One subscription, per-product usage line items. Embedded pricing table + customer portal. $0 until revenue.                                                               |
| **Docs**                  | Mintlify                                     | **Free Hobby plan** (1 editor, custom domain, playground) | ~$250-300/mo (Pro)      | Beautiful docs from OpenAPI spec. Free tier covers a solo founder. AI assistant and team collaboration only on paid.                                                      |
| **SDKs**                  | Speakeasy                                    | **1 SDK, up to 50 API methods, free forever**             | Contact for pricing     | Auto-generated typed SDKs. 50 methods covers entire address + ABN + LEI surface.                                                                                          |
| **Dashboard**             | Next.js + Clerk + shadcn/ui                  | Deployed to Lambda via SST ($0)                           | —                       | Your code. No vendor fee.                                                                                                                                                 |
| **CI/CD**                 | GitHub Actions + OIDC                        | Free tier                                                 | —                       | No stored AWS credentials. Short-lived STS tokens per run.                                                                                                                |
| **Monitoring**            | CloudWatch + X-Ray                           | Included with AWS                                         | —                       | Per-handler latency, error rates, usage dashboards.                                                                                                                       |

### 3.3 Monthly Cost Model

| Stage                     | OpenSearch                                 | Clerk                    | Unkey                                                  | Mintlify                 | Speakeasy | Stripe          | Total               |
| ------------------------- | ------------------------------------------ | ------------------------ | ------------------------------------------------------ | ------------------------ | --------- | --------------- | ------------------- |
| **Phase 1** (0-100 devs)  | $35                                        | $0                       | $0                                                     | $0                       | $0        | $0              | **~$35/mo**         |
| **Phase 2** (100-1K devs) | $150 (scale to 2-node — see trigger below) | $0                       | $0                                                     | $0                       | $0        | Processing fees | **~$170/mo + fees** |
| **Phase 3** (1K-10K devs) | $150                                       | $0                       | $0                                                     | $0                       | $0        | Processing fees | **~$170/mo + fees** |
| **Phase 4** (10K+ devs)   | $150+                                      | $0 (still under 50K MAU) | $0 (only key CRUD, not verification — well under 150K) | ~$250 (need team collab) | Contact   | Processing fees | **~$400/mo + fees** |

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
| OpenSearch domain    | `flat-white` — t3.small.search × 1, 20GB gp3, OpenSearch 2.13. Name is historical; OpenSearch doesn't support domain renaming. All products share this domain. |
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

Standard error codes: `INVALID_API_KEY`, `MISSING_API_KEY`, `RATE_LIMIT_EXCEEDED` (API Gateway throttle), `QUOTA_EXCEEDED` (monthly per-product limit), `PRODUCT_NOT_ALLOWED`, `INVALID_PARAMETERS`, `NOT_FOUND`, `INTERNAL_ERROR`.

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
│     e.g., "16 heath crescent hampton" → GAVIC420559144   │
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

On a t3.small.search with 20GB gp3:

| Product         | Est. Records | Est. Index Size | Notes                                                                |
| --------------- | ------------ | --------------- | -------------------------------------------------------------------- |
| Address (G-NAF) | 15M          | ~10 GB          | `search_as_you_type` + enrichment fields (verified Apr 2026)         |
| ABN             | 3M           | 1-2 GB          | Simpler schema, keyword-heavy                                        |
| LEI             | 1.5M         | 0.5-1 GB        | Small dataset                                                        |

**With retention (two versions of address + current ABN + LEI):** 12 + 12 + 2 + 1 = ~27GB. **Exceeds 20GB.**

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
  "_id": "GAVIC420559144",
  "addressLabelSearch": "16 HEATH CRESCENT HAMPTON EAST VIC 3188",
  "confidence": 2,
  "geocode": {
    "latitude": -37.93762284,
    "longitude": 145.02948591,
    "type": "FRONTAGE CENTRE SETBACK",
    "reliability": 2
  },
  "boundaries": {
    "lga": { "name": "Bayside" },
    "ward": { "name": "Ivison Ward" },
    "stateElectorate": { "name": "BRIGHTON" },
    "commonwealthElectorate": { "name": "GOLDSTEIN" },
    "meshBlock": { "code": "20051660000", "category": "Residential" },
    "sa2": { "name": "Hampton", "code": "208011172" },
    "sa3": { "name": "Bayside", "code": "20801" },
    "sa4": { "name": "Melbourne - Inner South", "code": "208" },
    "gccsa": { "name": "Greater Melbourne", "code": "2GMEL" }
  }
}
```

### 5.4 API Layer

**Framework:** Hono + `@hono/zod-openapi` on Lambda (ARM64, Node.js 20) deployed via SST v3.

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

Rate limiting operates at two levels:

1. **API Gateway throttling (per-route, all keys).** Configured via SST on the API Gateway stage. Protects the OpenSearch cluster from DDoS and runaway clients. Default: 100 req/s per route burst, 50 req/s sustained. No application code needed — API Gateway enforces this before the Lambda is invoked.

2. **Monthly quota enforcement (per-key, per-product, application-level).** The DynamoDB key record includes `monthlyQuotaPerProduct` and the current month's usage counter. Checked in the auth middleware alongside key verification — same DynamoDB read, no extra latency. When quota is exceeded, return `429 QUOTA_EXCEEDED` with `resets_at` in the response body.

Per-second rate limiting (token bucket) is deferred to Phase 2+. At Phase 1 volumes (< 100 devs), monthly quotas + API Gateway throttling provide sufficient protection. When per-key burst control is needed, add DynamoDB sliding window counters: key `{apiKey}#{product}#{minuteWindow}`, atomic `ADD` per request (~3ms). Accept approximate enforcement across concurrent Lambda instances.

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

Two systems, complementary roles:

**Clerk** (human identity) — sign-up, login, OAuth (Google, GitHub), organisations, team management. The dashboard authenticates through Clerk. Webhook on `user.created` triggers the provisioning chain.

**Unkey** (machine identity) — API key issuance, per-key metadata (tier, product scopes, rate limits), management UI. Keys created via Unkey's API when a user signs up or upgrades.

**DynamoDB** (hot-path verification) — on every API request, the key is validated against a local DynamoDB table. Synced from Unkey via webhooks. No external dependency per request. DAX (DynamoDB Accelerator) is layered in at Phase 3+ when sub-millisecond latency becomes critical at scale.

**Key format:** `pq_live_xxxxxxxxxxxxxxxxxxxxxxxx` (production), `pq_test_xxxxxxxxxxxxxxxxxxxxxxxx` (sandbox).

**Key metadata (DynamoDB record):**

```json
{
  "apiKey": "pq_live_abc123...",
  "ownerEmail": "dev@startup.com",
  "orgId": "org_clerk_xyz",
  "tier": "growth",
  "products": ["address", "abn"],
  "monthlyQuotaPerProduct": 50000,
  "usage": {
    "address": { "2026-04": 47200 },
    "abn": { "2026-04": 82800 }
  },
  "active": true,
  "lastSyncedFromUnkey": "2026-04-09T12:00:00Z"
}
```

**Unkey → DynamoDB consistency:**

Webhooks are the primary sync mechanism, but webhooks can fail (Lambda down, delivery failure, network timeout). A stale DynamoDB record means a deleted key keeps working or a downgraded key keeps old limits.

**Reconciliation:** A scheduled Lambda runs every 15 minutes:

1. Lists all active keys from Unkey API
2. Scans the DynamoDB table
3. For keys in DynamoDB but not in Unkey: mark `active: false` (deactivated or deleted upstream)
4. For keys in Unkey but not in DynamoDB: create the record (webhook was missed)
5. For keys in both: compare `tier`, `products`, `monthlyQuotaPerProduct` — update DynamoDB if stale
6. Log all discrepancies as warnings to CloudWatch

Cost: one Unkey API call + one DynamoDB scan every 15 minutes. Negligible. This is the safety net that makes webhook-based sync reliable.

The `lastSyncedFromUnkey` field tracks when the record was last verified against Unkey. If a key hasn't been reconciled in > 1 hour (reconciliation Lambda was down), the auth middleware logs a warning but continues serving — DynamoDB is the source of truth for the hot path; Unkey is the source of truth for key management.

> **Vendor migration note (Clerk):** Clerk's 50K MAU free tier is generous today, but vendor pricing changes. The auth integration is isolated to the dashboard package (`@clerk/nextjs` components + webhook handler). If Clerk's pricing becomes untenable, migration to `next-auth` or `lucia` is feasible — the API key system (Unkey + DynamoDB) is completely independent of Clerk. Clerk manages human identity (dashboard login); Unkey manages machine identity (API keys). Replacing one doesn't affect the other.

### 5.6 Billing

**Stripe metered billing.** One subscription per organisation. Per-product usage line items.

**Pricing:**

Usage is metered per product. Each product has its own included allocation within the plan. Overage is charged per product beyond its allocation — the Twilio model.

| Tier       | Base Price | Included per Product     | Overage (per 1K) | Access                  |
| ---------- | ---------- | ------------------------ | ---------------- | ----------------------- |
| Free       | $0         | 5,000/month per product  | —                | Address, ABN            |
| Starter    | $29/month  | 10,000/month per product | $1.50            | All products            |
| Growth     | $99/month  | 50,000/month per product | $1.00            | All products + SLA      |
| Enterprise | Custom     | Custom                   | Custom           | All + dedicated support |

**Example invoice (Growth plan, heavy ABN usage):**

```
Prontiq Growth Plan                         $99.00
├── Address API — 47,200 / 50,000           included
├── ABN Verification — 82,800 / 50,000      $32.80 (32,800 overage × $1.00/1K)
├── LEI Lookup — 3,400 / 50,000             included
└── CVE Search — 0 / 50,000                 included
                                            ------
Total                                       $131.80
```

**Usage → Stripe pipeline (durability guarantee):**

Usage counters live in DynamoDB (atomic `ADD` per request, per-key, per-product, per-month). These are the source of truth for billing. The pipeline to Stripe:

1. **Hourly batch Lambda:** Scans DynamoDB for all keys with usage > 0 for the current billing period. For each key, reports the delta (current count minus last-reported count) to Stripe as a usage record via `stripe.subscriptionItems.createUsageRecord()`. Stores `lastReportedCount` in DynamoDB after successful Stripe write.

2. **Idempotency:** If the Lambda fails mid-batch, the next run picks up where it left off — `lastReportedCount` only updates after a successful Stripe write. No double-counting.

3. **Retry:** The Lambda is configured with an SQS dead-letter queue. If it fails 3 consecutive times, the DLQ receives the event and triggers an SNS alert. Usage data is never lost — it accumulates in DynamoDB until successfully reported.

4. **End-of-month sweep:** A final batch runs at 23:55 UTC on the last day of the month to ensure all usage is reported before Stripe finalizes the invoice.

5. **Audit trail:** Every Stripe usage record write is logged with the key, product, delta, and timestamp. DynamoDB usage counters are retained for 90 days after the billing period ends.

### 5.7 Webhook Chain

```
┌─────────────────────────────────────────────────────────┐
│                    PROVISIONING                          │
│                                                          │
│  Clerk: user.created                                     │
│    → Create Stripe customer (free tier)                  │
│    → Create Unkey key (free tier limits)                 │
│    → Sync key metadata to DynamoDB                       │
│    → Email: welcome + API key + docs link                │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│                    UPGRADE                                │
│                                                          │
│  Stripe: subscription.created / subscription.updated     │
│    → Update Unkey key (new tier limits, product scopes)  │
│    → Sync updated metadata to DynamoDB                   │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│                    KEY SYNC                               │
│                                                          │
│  Unkey: key.updated / key.created / key.deleted          │
│    → Write/update/delete in DynamoDB (hot-path cache)    │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│                    USAGE → BILLING                        │
│                                                          │
│  DynamoDB usage counters (per-key, per-product, per-mo)  │
│    → Hourly batch Lambda → Stripe usage records          │
│    → Idempotent: tracks lastReportedCount per key        │
│    → DLQ + SNS alert on 3 consecutive failures           │
│    → End-of-month sweep at 23:55 UTC                     │
│    → Stripe invoices at month end                        │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│                    RECONCILIATION (scheduled)             │
│                                                          │
│  Every 15 minutes:                                       │
│    → List all Unkey keys, diff against DynamoDB          │
│    → Deactivate orphaned keys, create missing records    │
│    → Update stale tier/quota metadata                    │
│    → Log discrepancies as CloudWatch warnings            │
│                                                          │
│  Every 6 hours:                                          │
│    → Scan OpenSearch indices, delete expired per          │
│      product retention policy (section 5.2.4)            │
│    → Verify latest automated snapshot is < 48 hours old  │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│                    SHOPIFY INTEGRATION                    │
│                                                          │
│  Shopify: app.installed                                  │
│    → Create store-scoped Unkey key                       │
│    → Sync to DynamoDB                                    │
│    → Configure checkout extension with key               │
└─────────────────────────────────────────────────────────┘
```

### 5.8 Developer Journey

```
1. DISCOVERY
   Developer lands on prontiq.dev/address
   Hero: live autocomplete demo — types address, sees enriched results
   Below: pricing table, one-line SDK install, "Get Started Free"

2. SIGN UP
   Clicks "Get Started Free" → Clerk modal (Google/GitHub OAuth or email)
   10 seconds. They're in the dashboard.

3. DASHBOARD
   API key auto-provisioned (Clerk webhook → Unkey → DynamoDB)
   Sees: key, live playground, empty usage chart, quick-start snippets

4. FIRST CALL
   Copies curl command with their key pre-filled
   Or: npm install @prontiq/sdk
   → prontiq.address.autocomplete({ q: "16 heath cres" })
   Fully typed. Works immediately.

5. USAGE
   Usage ticks up in real-time on dashboard
   DynamoDB middleware enforces rate limit and quota per product
   At 80% of quota: upgrade nudge in dashboard

6. UPGRADE
   Clicks "Upgrade" → Stripe embedded pricing table
   Picks Starter or Growth → card details in Stripe's hosted form
   Unkey rate limits update automatically via webhook

7. SHOPIFY (optional)
   Clicks "Integrations" → Shopify card → OAuth install flow
   Store-scoped key provisioned automatically
   Checkout extension installed — address autocomplete live

8. TEAM (optional)
   Adds colleague via Clerk org management
   Colleague gets own login, shared API keys and usage data
```

### 5.9 Developer Dashboard Pages

| Page             | What It Shows                                                                      | Stack                           |
| ---------------- | ---------------------------------------------------------------------------------- | ------------------------------- |
| **Overview**     | Usage chart (all products), current plan, quick-start snippets with key pre-filled | Recharts, Clerk `<UserButton>`  |
| **API Keys**     | List, create, rotate, delete. Per-key product scopes. Sandbox vs live toggle.      | Unkey management API            |
| **Usage**        | Per-product usage charts. Daily/weekly/monthly. Export CSV.                        | DynamoDB → Recharts             |
| **Billing**      | Plan management, payment method, invoices, receipts                                | Stripe embedded customer portal |
| **Integrations** | Shopify OAuth install. WooCommerce setup wizard. Web component embed code.         | Custom pages                    |
| **Team**         | Invite members, assign roles, remove                                               | Clerk `<OrganizationProfile>`   |
| **Playground**   | Select endpoint, enter params, see live response JSON                              | Custom, hits live API           |
| **Settings**     | Webhook URLs, notification preferences, account deletion                           | Custom                          |

### 5.10 Docs & SDKs

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
const { suggestions } = await prontiq.address.autocomplete({ q: "16 heath cres" });

// ABN verification
const { entity } = await prontiq.abn.verify({ abn: "51824753556" });

// LEI lookup
const { entity } = await prontiq.lei.lookup({ lei: "549300MLUDYVRQOOXS22" });
```

### 5.11 Distribution

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

```
prontiq-platform/
├── sst.config.ts                       # SST v3 + Pulumi — deploys everything
├── packages/
│   ├── api/                            # Hono on Lambda
│   │   ├── src/
│   │   │   ├── routes/
│   │   │   │   ├── address.ts          # /v1/address/* route group
│   │   │   │   ├── abn.ts             # /v1/abn/*
│   │   │   │   ├── lei.ts             # /v1/lei/*
│   │   │   │   ├── cve.ts             # /v1/cve/*
│   │   │   │   └── patents.ts         # /v1/patents/*
│   │   │   ├── middleware/
│   │   │   │   ├── auth.ts            # DynamoDB key verification
│   │   │   │   ├── rate-limit.ts      # Token bucket
│   │   │   │   └── usage.ts           # Async counter increment
│   │   │   ├── search/
│   │   │   │   ├── client.ts          # OpenSearch SigV4 client
│   │   │   │   ├── queries.ts         # Query builders per product
│   │   │   │   └── relevance.ts       # Scoring and ranking
│   │   │   └── index.ts              # Hono app entry point
│   │   └── package.json
│   ├── shared/                         # Shared types, constants, utilities
│   │   ├── src/
│   │   │   ├── types.ts              # Product registry, manifest schema, error types
│   │   │   ├── constants.ts          # Product→alias mapping, tier limits
│   │   │   └── validation.ts         # Zod schemas (shared between API and ingestion)
│   │   └── package.json
│   ├── dashboard/                      # Next.js developer portal
│   │   ├── app/
│   │   │   ├── (auth)/               # Clerk auth pages
│   │   │   ├── dashboard/
│   │   │   │   ├── page.tsx          # Overview
│   │   │   │   ├── keys/            # API key management
│   │   │   │   ├── usage/           # Usage charts
│   │   │   │   ├── billing/         # Stripe embedded portal
│   │   │   │   ├── integrations/    # Shopify, WooCommerce
│   │   │   │   ├── team/            # Clerk org management
│   │   │   │   ├── playground/      # Interactive API explorer
│   │   │   │   └── settings/
│   │   │   └── page.tsx             # Landing page (unauthenticated)
│   │   ├── components/               # shadcn/ui
│   │   └── package.json
│   ├── docs/                           # Mintlify config + content
│   │   ├── mint.json
│   │   └── pages/
│   ├── ingestion/                      # Step Functions + Lambda handlers
│   │   ├── src/
│   │   │   ├── read-manifest.ts
│   │   │   ├── create-index.ts
│   │   │   ├── bulk-ingest.ts       # 10GB mem, 15min timeout
│   │   │   ├── health-check.ts
│   │   │   ├── alias-swap.ts
│   │   │   └── cleanup.ts
│   │   └── package.json
│   ├── webhooks/                       # Clerk, Stripe, Unkey handlers
│   │   ├── src/
│   │   │   ├── clerk.ts              # user.created → provision key
│   │   │   ├── stripe.ts            # subscription.updated → update limits
│   │   │   └── unkey.ts             # key.updated → sync DynamoDB
│   │   └── package.json
│   └── plugins/
│       ├── shopify/                   # Checkout UI Extension
│       ├── woocommerce/              # WP plugin
│       └── web-component/            # <prontiq-address> widget
├── scripts/
│   ├── generate-api-key.ts
│   ├── benchmark.ts
│   └── seed-test-data.ts
├── .github/
│   └── workflows/
│       ├── ci.yml
│       ├── deploy-prod.yml
│       └── generate-sdks.yml        # Speakeasy on spec change
├── package.json                       # Workspace root
├── turbo.json                         # Turborepo config
└── tsconfig.json
```

---

## 7. CI/CD

**GitHub Actions + OIDC federation.** No stored AWS credentials.

> **Note:** The existing `flat-white-role` has S3-only permissions. Platform deployment (`sst deploy`) requires a separate `prontiq-platform-deploy-role`. SST v3 uses **Pulumi** (not CloudFormation) — the deploy role needs:
>
> - **Pulumi state backend:** S3 (`PutObject`, `GetObject`, `DeleteObject` on the SST-managed state bucket) + DynamoDB (`PutItem`, `GetItem`, `DeleteItem` on the SST-managed lock table). SST v3 bootstraps these automatically on first `sst deploy` — the role needs `s3:CreateBucket` and `dynamodb:CreateTable` for the initial bootstrap, or pre-create them.
> - **Resource permissions:** Lambda, API Gateway V2, DynamoDB, IAM (passrole for Lambda execution roles), CloudWatch (logs + alarms), OpenSearch, S3 (for data bucket access), WAF, EventBridge, Step Functions, SNS, SQS.
> - **NOT needed:** CloudFormation permissions (SST v2/CDK used CF; SST v3/Pulumi does not).
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

## 8. Phasing

### Phase 1 — Address API + minimal platform (6 weeks)

Build:

- Hono API with address routes (autocomplete, validate, enrich, reverse, lookup)
- SST v3 deployment (Lambda + API Gateway V2 + DynamoDB)
- DynamoDB key verification middleware
- Clerk auth (hosted pages initially, embedded components later)
- Stripe payment links (free + paid tiers)
- Mintlify docs (free Hobby tier) from OpenAPI spec
- Speakeasy SDK (TypeScript, free tier)
- Dashboard skeleton: login, key display, usage chart, billing link, playground
- Landing page with live autocomplete demo (`<prontiq-address>` web component)
- `flat-white` updated to write manifest.json
- GitHub Actions cron for ingestion (simpler than Step Functions for one product)

Cost: ~$35/month (OpenSearch)

### Phase 2 — ABN/ASIC verification (4 weeks)

Build:

- ABN data pipeline (ABR bulk extract → NDJSON → S3 → manifest)
- Hono route group for /v1/abn/\*
- OpenSearch index + mappings for ABN entities
- EventBridge + Step Functions ingestion (now worth it with two products, different cadences)
- Dashboard: add ABN usage line
- Docs: add ABN section
- SDK: Speakeasy regenerates with `prontiq.abn` namespace
- Stripe: add ABN usage meter

Cost: still ~$35/month

### Phase 3 — GLEIF/LEI + full dashboard (3 weeks)

Build:

- LEI pipeline (Golden Copy → NDJSON → S3 → manifest)
- Hono route group for /v1/lei/\*
- Full dashboard build-out (usage charts, team management, Stripe embedded portal)
- Unkey integration for key management UI in dashboard
- First international product

Cost: still ~$35/month

### Phase 4 — Shopify + WooCommerce plugins (4 weeks)

Build:

- Shopify Checkout UI Extension (address autocomplete + ABN for B2B)
- Shopify OAuth install flow in dashboard
- WooCommerce checkout plugin
- Store-scoped API key provisioning
- Scale OpenSearch to 2-node HA if traffic warrants

Cost: ~$150/month (if scaled)

### Phase 5 — CVE/NVD + Patents (2-4 weeks each)

- Same pattern. Pipeline + route group + index + docs section + SDK namespace.
- CVE integrates with `ariscan`'s security pillar.
- Patent search leverages OpenSearch fuzzy matching (proven with address).

---

## 9. Competitive Position at Phase 3

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

## 10. Design Principles

1. **The manifest is the platform's API boundary.** Any pipeline, anywhere, drops NDJSON + manifest.json into S3. The platform handles everything downstream. Adding a new data product is a pipeline, a route group, and a docs section. Infrastructure doesn't change.

2. **No vendor in the hot path.** Unkey manages keys. Clerk manages identity. Stripe manages billing. But the actual API request — the sub-50ms autocomplete call — touches only your Lambda and your DynamoDB cache. No third-party latency, no third-party outage.

3. **The OpenAPI spec is the single atom.** `@hono/zod-openapi` generates it from route schemas. Mintlify consumes it for docs. Speakeasy consumes it for SDKs. One source of truth, three outputs. Change a route, everything updates.

4. **Free tiers are marketing spend, not lost revenue.** Clerk (50K MAUs), Unkey (150K verifications), Mintlify (Hobby plan), Speakeasy (50 methods), Stripe (processing only). The platform costs $35/month to run until you have thousands of paying developers.

5. **Ship what validates, build what earns.** Phase 1 is the API, docs, and an SDK. The dashboard, plugins, and additional products follow demand, not assumptions.

---

## Licence

Proprietary — Prontiq Pty Ltd. All rights reserved.
