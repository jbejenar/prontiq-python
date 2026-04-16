# Prontiq Platform — Roadmap

> A unified data API platform for Australian and global open data.
> Last updated: 2026-04-14 · v1.2
>
> **Reference:** `ARCHITECTURE.MD` is the authoritative design doc. This roadmap is the execution plan.

---

## Overview

**Pattern:** Free open dataset → independent pipeline → S3 (NDJSON + manifest.json) → event-driven indexing → OpenSearch → commercial API → auth / billing / docs / SDKs.

**Stack:** SST v4 + Pulumi · Hono + @hono/zod-openapi · OpenSearch 2.19 · DynamoDB (DDB-native keys, hash-based) · Clerk · Stripe · Next.js 15 · Mintlify · Speakeasy

**Repo:** pnpm monorepo with Turborepo. 10 workspace packages. TypeScript strict. ESM only.

---

## Summary

| Phase     | Epic                       | Tickets | Done       | Target      |
| --------- | -------------------------- | ------- | ---------- | ----------- |
| **P0**    | Infrastructure Foundation  | 6       | 6/6 ✅     | Week 1      |
| **P1A**   | API Core (Address)         | 13      | 9/13       | Weeks 2-3   |
| **P1B**   | Auth & Billing             | 13      | 1/13       | Weeks 3-4   |
| **P1C**   | Dashboard                  | 7       | 0/7        | Weeks 4-5   |
| **P1D**   | Docs & SDK                 | 5       | 2/5        | Week 5      |
| **P1E**   | Ingestion (Phase 1)        | 6       | 4/6        | Week 6      |
| **P1F**   | Distribution               | 2       | 1/2        | Week 6      |
| **P2**    | ABN/ASIC Verification      | 8       | 0/8        | Weeks 7-10  |
| **P3**    | GLEIF/LEI + Full Dashboard | 7       | 0/7        | Weeks 11-13 |
| **P4**    | Shopify + WooCommerce      | 5       | 0/5        | Weeks 14-17 |
| **P5**    | CVE/NVD + Patents          | 4       | 0/4        | Weeks 18-21 |
| **Total** |                            | **76**  | **23/76**  |             |

---

## Phase 0 — Infrastructure Foundation

> **Goal:** Everything needed before the first line of product code runs in AWS.

---

### Ticket P0.01 — IAM Deploy Role for SST v3

```yaml
id: P0.01
title: IAM Deploy Role for SST v3
status: done
priority: p0-critical
epic: P0
persona: [builder]
depends_on: []
completed: 2026-04-09
tech_stack:
  iac: SST v3 + Pulumi
  auth: GitHub OIDC
  account: "493712557159"
  region: ap-southeast-2
```

#### User Story

As a builder, I need an IAM role that GitHub Actions and local `sst dev` can assume via OIDC so that deployments never require stored AWS credentials.

#### Problem Statement

SST v3 uses Pulumi under the hood (not CloudFormation). The deploy role needs S3 + DynamoDB permissions for Pulumi state management, plus all resource-level permissions (Lambda, APIGW, DynamoDB, etc.). The existing `flat-white-role` only has S3 data access — it cannot deploy infrastructure. Without this role, no CI/CD and no `sst dev`.

#### Definition of Done

##### Functional

- [x] IAM role `prontiq-platform-deploy-role` created in account `493712557159`
  - `Verify:` `aws iam get-role --role-name prontiq-platform-deploy-role`
  - `Evidence:` Created 2026-04-09. ARN: `arn:aws:iam::493712557159:role/prontiq-platform-deploy-role`
- [x] OIDC trust policy scoped to `repo:jbejenar/prontiq-platform:*`
  - `Verify:` `aws iam get-role --role-name prontiq-platform-deploy-role --query 'Role.AssumeRolePolicyDocument'`
  - `Evidence:` Trust policy includes `StringLike` condition on `token.actions.githubusercontent.com:sub`
- [x] Pulumi state backend permissions: S3 CreateBucket/Put/Get/Delete, DynamoDB CreateTable/Put/Get/Delete
  - `Verify:` `aws iam get-role-policy --role-name prontiq-platform-deploy-role --policy-name prontiq-platform-deploy-policy`
  - `Evidence:` `SSTBootstrapAndPulumiState` statement with full S3 + DynamoDB permissions
- [x] Resource permissions: Lambda, APIGW, DynamoDB, IAM passrole, CW, OpenSearch, S3, WAF, EventBridge, Step Functions, SNS, SQS, CloudFront, ECR, SSM
  - `Verify:` Policy document contains all required service statements
  - `Evidence:` 13 SID statements covering all services
- [x] NOT CloudFormation (SST v3 uses Pulumi)
  - `Verify:` `aws iam get-role-policy` does not contain `cloudformation:*`
  - `Evidence:` No CloudFormation statement in policy
- [ ] Verified: `aws sts assume-role-with-web-identity` works from GitHub Actions
  - `Verify:` Push to main, CI deploy step succeeds
  - `Evidence:` Pending P0.03

#### Scope

**In:** IAM role, trust policy, inline permissions policy

**Out — Do Not Implement:**

- CI/CD workflow testing → P0.03
- SST resource definitions → P0.02
- OpenSearch domain access verification → P0.06

---

### Ticket P0.02 — SST Bootstrap + First Deploy

```yaml
id: P0.02
title: SST Bootstrap + First Deploy
status: done
priority: p0-critical
epic: P0
persona: [builder]
depends_on: [P0.01]
completed: 2026-04-09
tech_stack:
  iac: SST v3 + Pulumi
  runtime: Node.js 20
  arch: ARM64
  api: Hono on Lambda via API Gateway V2
  db: DynamoDB
  dashboard: Next.js 15 via OpenNext
```

#### User Story

As a builder, I need `sst deploy --stage dev` to provision the API Gateway, Lambda, DynamoDB table, and Next.js dashboard so that all downstream development has live infrastructure to develop against.

#### Problem Statement

Without a running deployment, all API development is blind — no Lambda execution context, no DynamoDB table, no API Gateway URL. SST v3's `sst dev` provides live Lambda dev (code changes take effect in seconds), but it requires a successful initial bootstrap to generate `.sst/` type definitions and provision base resources.

#### Definition of Done

##### Functional

- [x] `sst deploy --stage dev` completes successfully
  - `Verify:` Command exits 0, outputs resource URLs
  - `Evidence:` API: `https://59jym47ia1.execute-api.ap-southeast-2.amazonaws.com`, Dashboard: `https://d2ttwndpb06ei3.cloudfront.net`
- [x] API Gateway V2 endpoint is reachable and returns health check JSON
  - `Verify:` `curl https://59jym47ia1.execute-api.ap-southeast-2.amazonaws.com/v1/health`
  - `Evidence:` Returns `{"status":"ok","timestamp":"2026-04-09T12:36:36.126Z"}`
- [x] Auth middleware works — unauthenticated requests return 401 with request_id
  - `Verify:` `curl .../v1/address/autocomplete?q=test`
  - `Evidence:` Returns `{"error":{"status":401,"message":"Missing X-Api-Key header","code":"MISSING_API_KEY","request_id":"req_3a022461-..."}}`
- [x] DynamoDB ApiKeyTable created
  - `Verify:` `aws dynamodb describe-table --table-name prontiq-platform-dev-ApiKeyTableTable-*`
  - `Evidence:` Table exists with `apiKey` hash key
- [x] Lambda function deployed (ARM64, Node.js 20, 512MB, 30s timeout)
  - `Verify:` Lambda configuration in AWS console
  - `Evidence:` ARM64 architecture, nodejs20.x runtime
- [x] Dashboard (Next.js) deployed via CloudFront
  - `Verify:` `curl https://d2ttwndpb06ei3.cloudfront.net`
  - `Evidence:` Returns rendered HTML with "Prontiq" heading
- [x] CloudWatch logs visible for Lambda invocations
  - `Verify:` `aws logs describe-log-groups --log-group-name-prefix /aws/lambda/prontiq-platform-dev`
  - `Evidence:` Log groups exist for API route handlers
- [x] OpenSearch client lazy-initialized (doesn't crash Lambda init when endpoint unset)
  - `Verify:` Health check returns 200 even without OPENSEARCH_ENDPOINT
  - `Evidence:` Fixed during deploy — client moved to lazy init pattern in `search/client.ts`
- [ ] `sst remove --stage dev` cleans up all resources
  - `Verify:` Command exits 0, resources deleted
  - `Evidence:` Pending (keeping dev stage active)

##### Issues Found & Fixed During Deploy

- Clerk `<ClerkProvider>` crashes Next.js build without `publishableKey` → made conditional on env var
- Clerk `<UserButton>` crashes prerender → removed from initial scaffold
- OpenSearch client crashes Lambda init with empty endpoint → lazy initialization
- Duplicate `deploy:staging` script in package.json → removed duplicate
- Separate health route Lambda had different env vars → consolidated to single `$default` route

#### Scope

**In:** SST bootstrap, API Gateway V2, Lambda (single $default handler), DynamoDB table, Next.js dashboard via CloudFront, initial deploy verification

**Out — Do Not Implement:**

- OpenSearch connectivity → P0.06
- CI/CD deploy from GitHub Actions → P0.03
- WAF / throttling → P1A.10
- API Gateway caching → P1A.09
- Custom domains → P1F.01

---

### Ticket P0.03 — CI/CD Pipeline End-to-End

```yaml
id: P0.03
title: CI/CD Pipeline End-to-End
status: complete
priority: p0-critical
epic: P0
persona: [builder]
depends_on: [P0.01, P0.02]
completed: 2026-04-13
tech_stack:
  ci: GitHub Actions
  auth: OIDC federation
  iac: SST v3
```

#### User Story

As a builder, pushing to `main` automatically runs lint/typecheck/build and deploys to dev, while production remains a manual dispatch.

#### Problem Statement

The CI workflow file (`.github/workflows/ci.yml`) exists but has never been tested against the actual GitHub repository. OIDC credential exchange, pnpm caching, and `sst deploy --stage dev` need end-to-end verification. Production remains manual so releases stay deliberate.

#### Current Evidence

CI pipeline fully operational. `check` job runs lint → typecheck → build → test on PRs. `deploy-dev` runs SST deploy + Docker build/push on merge to main. All blockers resolved (workspace packages, IAM permissions, SST deploy).

#### Definition of Done

##### Functional

- [x] Push to `main` triggers the `check` job
- [x] `pnpm install --frozen-lockfile` succeeds in CI
- [x] `pnpm typecheck` passes all packages in CI
- [x] `pnpm build` passes all packages in CI
- [x] `pnpm lint` passes in CI
- [x] OIDC credential exchange works in `deploy-dev` job
- [x] `sst deploy --stage dev` succeeds from CI
- [x] Manual dispatch workflow for `sst deploy --stage prod` exists (deploy-prod.yml with workflow_dispatch)

#### Scope

**In:** CI workflow validation, OIDC exchange, dev deploy, manual prod trigger

**Out — Do Not Implement:**

- Test execution (no tests yet) → P1B.12
- Preview deployments per PR → future
- SDK generation workflow → P1D.04

---

### Ticket P0.04 — ESLint + Prettier Configuration

```yaml
id: P0.04
title: ESLint + Prettier Configuration
status: done
priority: p1-high
epic: P0
persona: [builder, contributor]
depends_on: []
completed: 2026-04-09
tech_stack:
  linter: ESLint 9 (flat config)
  formatter: Prettier 3.8
  hooks: Husky + lint-staged
```

#### User Story

As a builder/contributor, I need code style enforced automatically on commit and in CI so that the codebase stays consistent as it grows.

#### Problem Statement

Without a linter and formatter, AI agents and human contributors produce inconsistent code — different quote styles, trailing commas, unused imports. lint-staged ensures only changed files are checked on commit (fast), while CI runs the full lint as a gate.

#### Definition of Done

##### Functional

- [x] ESLint 9 flat config at root (`eslint.config.js`)
  - `Verify:` `npx eslint --print-config packages/api/src/index.ts | head -5`
  - `Evidence:` Config includes typescript-eslint rules, prettier compat, consistent-type-imports
- [x] Prettier config at root (`.prettierrc`)
  - `Verify:` `npx prettier --check "packages/*/src/**/*.ts"`
  - `Evidence:` All files pass (formatted during setup)
- [x] `pnpm lint` runs across all packages via Turborepo
  - `Verify:` `npx turbo lint` — 4 packages lint successfully
  - `Evidence:` "Tasks: 4 successful, 4 total" — zero errors
- [x] `.husky/pre-commit` runs lint-staged on changed files
  - `Verify:` `cat .husky/pre-commit` shows `pnpm lint-staged`
  - `Evidence:` lint-staged config in package.json: `*.{ts,tsx}` → eslint --fix + prettier
- [x] No lint errors in existing codebase
  - `Verify:` `npx turbo lint` exits 0
  - `Evidence:` Zero warnings, zero errors across all packages

#### Scope

**In:** ESLint flat config, Prettier, lint-staged, husky pre-commit hook

**Out — Do Not Implement:**

- Next.js ESLint plugin (dashboard handles separately) → P1C.07
- Test-specific lint rules → P1B.12
- Commit message linting (conventional commits) → future

---

### Ticket P0.05 — Dependabot Configuration

```yaml
id: P0.05
title: Dependabot Configuration
status: done
priority: p2-value
epic: P0
persona: [builder]
depends_on: []
completed: 2026-04-09
```

#### User Story

As a builder, I need dependency updates proposed automatically as PRs so that security vulnerabilities are patched promptly without manual tracking.

#### Problem Statement

npm ecosystem moves fast. Outdated dependencies accumulate security vulnerabilities (OWASP A06). Dependabot automates the chore of checking for updates and creates PRs with changelogs. Grouped updates (AWS SDK, dev deps) prevent PR spam.

#### Definition of Done

##### Functional

- [x] `.github/dependabot.yml` configured for npm ecosystem
  - `Verify:` File exists with valid YAML
  - `Evidence:` `.github/dependabot.yml` — npm, weekly, 10 PR limit, grouped AWS SDK + dev deps
- [x] Weekly schedule, max 10 open PRs
  - `Verify:` `schedule.interval: weekly`, `open-pull-requests-limit: 10`
  - `Evidence:` Config verified
- [x] AWS SDK dependencies grouped to prevent PR spam
  - `Verify:` `groups.aws-sdk.patterns: ["@aws-sdk/*"]`
  - `Evidence:` Config verified

#### Scope

**In:** Dependabot config file

**Out — Do Not Implement:**

- Renovate (alternative tool) — Dependabot is simpler for this stage
- Auto-merge rules → future

---

### Ticket P0.06 — OpenSearch Connectivity Verification

```yaml
id: P0.06
title: OpenSearch Connectivity Verification
status: complete
priority: p0-critical
epic: P0
persona: [builder]
depends_on: [P0.02]
external_dependency: "flat-white pipeline must have published G-NAF data + created addresses index"
completed: 2026-04-13
tech_stack:
  search: OpenSearch 2.13
  domain: flat-white
  client: "@opensearch-project/opensearch"
  auth: AWS SigV4
```

#### User Story

As a builder, I need the API Lambda to connect to the existing `flat-white` OpenSearch domain and successfully query the `addresses` alias so that address endpoints can return real data.

#### Problem Statement

The OpenSearch domain `flat-white` already exists with ~15M G-NAF addresses indexed under the `addresses` alias (created by the flat-white pipeline — external to this repo). The API Lambda needs SigV4-signed HTTP access to this domain. The deploy role (P0.01) includes `es:ESHttp*` permissions scoped to the domain, but connectivity hasn't been verified end-to-end: Lambda → VPC/public endpoint → SigV4 signing → OpenSearch query → response.

> **Pre-requisite (external):** The flat-white pipeline must have already run at least once, publishing G-NAF NDJSON to S3 and creating the `addresses` alias in OpenSearch. If the alias doesn't exist, this ticket cannot complete its final DoD item. Verify with: `curl -s $OPENSEARCH_ENDPOINT/_alias/addresses | python3 -m json.tool`

#### Current Evidence

Fully verified. `addresses` alias → `address-2026-02-7` with 15,015,573 docs. All 6 API endpoints return real G-NAF data. SigV4 auth, IAM permissions, connection pooling all working.

#### Definition of Done

##### Functional

- [x] `OPENSEARCH_ENDPOINT` environment variable set to the `flat-white` domain endpoint
- [x] Lambda can reach OpenSearch domain via SigV4
- [x] IAM execution role has `es:ESHttp*` on the domain
- [x] Query against `addresses` alias returns results
- [x] Connection pooling configured (keepAlive, maxSockets)

#### Scope

**In:** OpenSearch endpoint configuration, SigV4 connectivity, IAM permissions verification, live query test

**Out — Do Not Implement:**

- Index creation or data ingestion → P1E
- Search query tuning → P1A.02-07
- Connection pooling optimization → future (current config is sufficient for Phase 1)

---

## Phase 1A — API Core (Address)

> **Goal:** All 6 address endpoints live, validated, returning real data from OpenSearch. OpenAPI spec auto-generated.
>
> **Dependency:** P1A.01 can proceed after platform OpenSearch connectivity is verified. P1A.02–P1A.07 require the external `addresses` alias/data from P0.06, then are independent of each other and can be worked in parallel.

---

### Ticket P1A.01 — Migrate Routes to @hono/zod-openapi

```yaml
id: P1A.01
title: Migrate Routes to @hono/zod-openapi
status: done
priority: p0-critical
epic: P1A
persona: [builder]
depends_on: [P0.02]
completed: 2026-04-10
tech_stack:
  api: Hono + @hono/zod-openapi
  spec: OpenAPI 3.1
  validation: Zod
```

#### User Story

As a builder, I need routes defined with `createRoute()` so that the OpenAPI 3.1 spec is auto-generated from code — the single atom that drives docs and SDKs.

#### Problem Statement

The current routes use `addressRoutes.get()` (standard Hono) with manual `safeParse()` validation. This works but doesn't generate an OpenAPI spec. `@hono/zod-openapi` is already installed but not used. Migrating to `createRoute()` adds ~10 lines per route but produces a machine-readable spec that Mintlify (docs) and Speakeasy (SDKs) consume directly. Without the spec, docs and SDKs must be written by hand — and they drift.

#### Definition of Done

##### Functional

- [x] All 6 address routes migrated to `createRoute()` with Zod request/response schemas
  - `Verify:` `packages/api/src/routes/address.ts` uses `createRoute()` for each endpoint
  - `Evidence:` File diff shows `createRoute()` pattern with `request.query`, `responses.200`, `responses.400`, `responses.401`
- [x] `GET /openapi.json` returns valid OpenAPI 3.1 spec
  - `Verify:` `node --input-type=module -e "import app from './packages/api/dist/index.js'; const res=await app.request('/openapi.json'); ..."`
  - `Evidence:` Local built app returns status 200, `openapi: "3.1.0"`, and all 6 `/v1/address/*` paths. Live deploy verification remains gated by P0.03.
- [x] Spec includes all query parameters with types, constraints, and descriptions
  - `Verify:` `jq '.paths["/v1/address/autocomplete"].get.parameters' openapi.json`
  - `Evidence:` Parameters include `q` (required, string, min 1, max 200), `state` (optional, 2 chars), `limit` (optional, int, 1-20, default 5), and reverse `lat`/`lon` as required numbers
- [x] Spec includes response schemas for success and all error codes
  - `Verify:` `jq '.paths["/v1/address/autocomplete"].get.responses' openapi.json`
  - `Evidence:` 200, 400, 401, 403, 429, 500 response schemas defined; authenticated address operations include `ApiKeyAuth`
- [x] Spec accessible without authentication (no X-Api-Key required)
  - `Verify:` `curl .../openapi.json` without API key returns 200
  - `Evidence:` OpenAPI route defined before auth middleware in `index.ts`
- [x] Existing Zod schemas in `@prontiq/shared` reused (not duplicated)
  - `Verify:` `grep -r "autocompleteQuerySchema" packages/api/src/`
  - `Evidence:` Imported from `@prontiq/shared`, used in `createRoute()` definition

#### Scope

**In:** Route migration to `createRoute()`, OpenAPI spec endpoint, request/response schema wiring

**Out — Do Not Implement:**

- OpenSearch query changes (queries stay the same) → P1A.02-07
- SDK generation (needs the spec first) → P1D.04
- Docs generation (needs the spec first) → P1D.01

---

### Ticket P1A.02 — Address Autocomplete Endpoint

```yaml
id: P1A.02
title: Address Autocomplete Endpoint
status: complete
priority: p0-critical
epic: P1A
persona: [api-consumer]
depends_on: [P0.06, P1A.01]
completed: 2026-04-13
tech_stack:
  search: OpenSearch search_as_you_type
  target_latency: "150-250ms warm without caching; <50ms with API Gateway caching (P1A.09)"
```

#### User Story

As an API consumer, `GET /v1/address/autocomplete?q=9+endeavour+cou` returns matching addresses in < 50ms (warm) so that I can build real-time typeahead UIs.

#### Problem Statement

Address autocomplete is the flagship endpoint — the first thing developers try, the hero demo on the landing page, the reason they sign up. It must be fast (< 50ms warm), accurate (top result matches user intent), and rich enough to populate a form. The `search_as_you_type` field in OpenSearch handles prefix matching across n-grams, but the query needs tuning against real G-NAF data to ensure quality.

#### Definition of Done

##### Functional

- [x] Returns top-N suggestions with `id`, `addressLabel`, `localityName`, `state`, `postcode`, `confidence`
- [x] `search_as_you_type` multi_match query works against `addressLabelSearch` field
- [x] Optional `state` filter works (validated against Australian state enum)
- [x] Optional `limit` parameter (default 5, max 20)
- [x] Response includes total count for pagination context

##### Performance

- [x] Response time 150-250ms warm (OpenSearch query ~40-100ms + Lambda/network overhead). Sub-50ms achievable with API Gateway caching (P1A.09).

#### Scope

**In:** Autocomplete query against real data, state filter, limit, response format

**Out — Do Not Implement:**

- Proximity biasing (lat/lon boost) → future enhancement
- Fuzzy matching for typos → P1A.11 (shipped after launch)
- Address component parsing → P1A.03 (validate handles this)

---

### Ticket P1A.03 — Address Validate Endpoint

```yaml
id: P1A.03
title: Address Validate Endpoint
status: complete
priority: p0-critical
epic: P1A
persona: [api-consumer]
depends_on: [P0.06, P1A.01]
completed: 2026-04-13
tech_stack:
  search: OpenSearch best_fields
```

#### User Story

As an API consumer, `GET /v1/address/validate?q=9 endeavour court coffin bay sa 5607` returns the best matching address with a confidence level so that I can verify user-entered addresses against the G-NAF database.

#### Problem Statement

Address validation is the core business use case. Users paste a full address string and need to know: (1) does this address exist in G-NAF? (2) how confident is the match? (3) what's the canonical form? The validate endpoint uses `best_fields` matching (not prefix-based like autocomplete) and returns a single best match with a confidence classification based on the relevance score.

#### Definition of Done

##### Functional

- [ ] Returns best match with `id`, full address fields, and confidence (`high`/`medium`/`low`)
  - `Verify:` Query with known address returns `confidence: "high"`
  - `Evidence:` "9 endeavour court coffin bay sa 5607" → match with high confidence
- [ ] Returns `null` match and `confidence: "none"` when no confident result found
  - `Verify:` Query with garbage string "zzz123 nonexistent" returns null match
  - `Evidence:` `{ "match": null, "confidence": "none" }`
- [ ] Confidence thresholds tuned against known-good test queries
  - `Verify:` Test suite with 20+ known addresses and expected confidence levels
  - `Evidence:` Threshold values documented in code comments

#### Scope

**In:** Full-string address matching, confidence scoring, single-best-match response

**Out — Do Not Implement:**

- Bulk validation (array of addresses) → future
- Address correction/suggestion ("did you mean?") → future

---

### Ticket P1A.04 — Address Enrich Endpoint

```yaml
id: P1A.04
title: Address Enrich Endpoint
status: complete
priority: p1-high
epic: P1A
persona: [api-consumer]
depends_on: [P0.06, P1A.01]
completed: 2026-04-13
```

#### User Story

As an API consumer, `GET /v1/address/enrich?id=GASA_422206807` returns the full enriched address record including boundaries, electorates, and statistical geography so that I can enrich my data with government boundaries.

#### Problem Statement

Enrichment is the premium feature — boundaries (LGA, electorates, mesh blocks, SA2-SA4, GCCSA) are what no competitor offers at this price point. The enrich endpoint is a simple `GET` by document ID, returning all fields. It's gated to Starter+ tier because it's the upsell driver: free-tier autocomplete gets developers in, boundary enrichment converts them to paid.

#### Definition of Done

##### Functional

- [ ] Returns all fields: address, geocode, boundaries (LGA, ward, electorate, meshblock, SA2-SA4, GCCSA)
  - `Verify:` `curl .../v1/address/enrich?id=GASA_422206807`
  - `Evidence:` Response includes `boundaries.lga.name: "Lower Eyre Council"`, `boundaries.stateElectorate.name: "FLINDERS"`, `boundaries.commonwealthElectorate.name: "GREY"`, `boundaries.gccsa.code: "4RSAU"`, etc.
- [ ] Returns 404 for unknown ID with proper error format
  - `Verify:` `curl .../v1/address/enrich?id=NONEXISTENT`
  - `Evidence:` `{"error":{"code":"NOT_FOUND","status":404,...}}`
- [ ] Tier enforcement: Starter+ only (free tier gets 403)
  - `Verify:` Request with free-tier key returns 403 `PRODUCT_NOT_ALLOWED`
  - `Evidence:` Enrich route checks tier in auth middleware; free tier doesn't include "address-enrich" scope

#### Scope

**In:** Document retrieval by ID, full field return, tier gating

**Out — Do Not Implement:**

- Batch enrichment (array of IDs) → future
- Selective field return (field filtering) → future

---

### Ticket P1A.05 — Address Reverse Endpoint

```yaml
id: P1A.05
title: Address Reverse Endpoint
status: complete
priority: p1-high
epic: P1A
persona: [api-consumer]
depends_on: [P0.06, P1A.01]
completed: 2026-04-13
```

#### User Story

As an API consumer, `GET /v1/address/reverse?lat=-37.93&lon=145.02` returns nearby addresses sorted by distance so that I can convert coordinates to addresses.

#### Definition of Done

##### Functional

- [ ] Returns addresses within `radius` meters (default 100, max 50000)
  - `Verify:` Query with known coordinates returns nearby addresses
  - `Evidence:` Results include addresses within specified radius
- [ ] Each result includes `distance_m` (distance from query point)
  - `Verify:` Response objects contain `distance_m` field
  - `Evidence:` Values are numeric, sorted ascending
- [ ] Sorted by distance ascending
  - `Verify:` First result is closest to query coordinates
  - `Evidence:` `distance_m` values increase through the array
- [ ] `geo_distance` query works against `location` geo_point field
  - `Verify:` Query returns results from the `addresses` alias
  - `Evidence:` OpenSearch `geo_distance` sort applied correctly

#### Scope

**In:** Reverse geocoding, distance sort, radius filter

**Out — Do Not Implement:**

- Nearest-neighbor with ML ranking → future
- Interpolated street addresses (address between two G-NAF points) → not possible with G-NAF data

---

### Ticket P1A.06 — Address Lookup/Postcode Endpoint

```yaml
id: P1A.06
title: Address Lookup/Postcode Endpoint
status: complete
priority: p2-value
epic: P1A
persona: [api-consumer]
depends_on: [P0.06, P1A.01]
completed: 2026-04-13
```

#### User Story

As an API consumer, `GET /v1/address/lookup/postcode?postcode=5607` returns all localities in that postcode so that I can populate location dropdowns.

#### Definition of Done

##### Functional

- [ ] Returns list of localities with name, state, address count
  - `Verify:` `curl .../v1/address/lookup/postcode?postcode=5607`
  - `Evidence:` Response includes `{"postcode":"5607","localities":[{"name":"COFFIN BAY","state":"SA","address_count":...}]}`
- [ ] Uses `terms` aggregation on `localityName` field
  - `Verify:` OpenSearch query uses aggregation, not document scan
  - `Evidence:` `size: 0` in query body (aggregation only)
- [ ] Validates 4-digit Australian postcode format
  - `Verify:` `?postcode=999` returns 400; `?postcode=5607` returns 200
  - `Evidence:` Zod schema `z.string().regex(/^\d{4}$/)`

#### Scope

**In:** Postcode-to-locality aggregation, format validation

**Out — Do Not Implement:**

- Postcode boundary geometry (GeoJSON polygon) → future
- Postcode distance/route calculation → future

---

### Ticket P1A.07 — Address Lookup/Suburb Endpoint

```yaml
id: P1A.07
title: Address Lookup/Suburb Endpoint
status: complete
priority: p2-value
epic: P1A
persona: [api-consumer]
depends_on: [P0.06, P1A.01]
completed: 2026-04-13
```

#### User Story

As an API consumer, `GET /v1/address/lookup/suburb?suburb=coffin+bay` returns postcodes, geographic bounds, and address count for a suburb.

#### Definition of Done

##### Functional

- [ ] Returns postcodes, geographic bounds (bounding box), address count
  - `Verify:` `curl .../v1/address/lookup/suburb?suburb=coffin+bay`
  - `Evidence:` Response includes postcodes array, bounds object, address_count
- [ ] Optional `state` filter narrows results
  - `Verify:` `?suburb=richmond&state=VIC` vs `?suburb=richmond` (no state)
  - `Evidence:` With state: only VIC Richmond; without: all states with a Richmond
- [ ] Uses `terms` + `geo_bounds` aggregations
  - `Verify:` Query body uses aggregations, `size: 0`
  - `Evidence:` OpenSearch query in `queries.ts`

#### Scope

**In:** Suburb lookup with postcode aggregation and geographic bounds

**Out — Do Not Implement:**

- Suburb boundary polygon (GeoJSON) → future
- Population/demographics data → requires ABS integration

---

### Ticket P1A.08 — Error Response Consistency

```yaml
id: P1A.08
title: Error Response Consistency
status: pending
priority: p1-high
epic: P1A
persona: [api-consumer]
depends_on: [P1A.01]
completed: null
```

#### User Story

As an API consumer, every error response has the same shape with a `request_id` for debugging so that my error handling code is consistent across all endpoints.

#### Problem Statement

Consistent error responses are the difference between a developer-friendly API and a frustrating one. Every error — 400, 401, 403, 404, 429, 500 — must return the same JSON shape. The `request_id` enables support: "my request failed" → "what was the request ID?" → trace to CloudWatch in seconds. Rate limit headers tell the developer how much quota remains without them having to guess.

#### Definition of Done

##### Functional

- [ ] All error responses match `{ error: { code, message, status, request_id, details? } }`
  - `Verify:` Test each error code: 400, 401, 403, 404, 429, 500
  - `Evidence:` All match the schema; `request_id` present on every response
- [ ] `X-Request-Id` header present on ALL responses (success and error)
  - `Verify:` `curl -v .../v1/health` shows `X-Request-Id` in response headers
  - `Evidence:` Header present with `req_` prefix + UUID
- [ ] `X-RateLimit-Remaining` and `X-RateLimit-Reset` headers on authenticated responses
  - `Verify:` `curl -v .../v1/address/autocomplete?q=test` with API key
  - `Evidence:` Headers show remaining quota and reset timestamp
- [ ] Global error handler catches unhandled exceptions — returns `INTERNAL_ERROR`, no stack trace
  - `Verify:` Trigger an internal error (e.g., malformed OpenSearch response); verify no stack trace in response
  - `Evidence:` Response is `{"error":{"code":"INTERNAL_ERROR",...}}`, stack trace only in CloudWatch

#### Scope

**In:** Error envelope format, request ID, rate limit headers, global error handler

**Out — Do Not Implement:**

- Error analytics/dashboarding → P1F.02
- Error retry guidance in docs → P1D.02

---

### Ticket P1A.09 — API Gateway Caching

```yaml
id: P1A.09
title: API Gateway Caching
status: pending
priority: p1-high
epic: P1A
persona: [builder, ops]
depends_on: [P1A.02]
completed: null
tech_stack:
  cache: API Gateway cache (0.5GB)
  cost: ~$15/month
```

#### User Story

As a platform operator, repeated queries are served from API Gateway cache so that OpenSearch load is reduced by 70-80% and most queries return in < 5ms.

#### Problem Statement

Address data changes quarterly. The same "9 endeavour cou" query from 1000 different users hits OpenSearch 1000 times with identical results. API Gateway caching sits in front of the Lambda — cache hits never invoke the function. At $0.02/hr for 0.5GB (~$15/month), this is the cheapest performance optimization possible. Cache invalidation is triggered by the ingestion Step Function after alias swap.

#### Definition of Done

##### Functional

- [ ] API Gateway cache enabled (0.5GB) via SST configuration
  - `Verify:` `sst.config.ts` includes cache configuration on the API Gateway stage
  - `Evidence:` SST deploy creates cache; visible in AWS console
- [ ] Cache key = full query string (API Gateway default)
  - `Verify:` Two identical requests — second returns from cache
  - `Evidence:` Second request returns in < 5ms (vs ~30ms uncached)
- [ ] TTL = 1 hour for address routes (per product registry `cache_ttl_seconds`)
  - `Verify:` Cache expires after 1 hour
  - `Evidence:` Configuration in SST or API Gateway stage settings
- [ ] Cache invalidation callable from ingestion Step Function
  - `Verify:` API call to flush cache stage exists
  - `Evidence:` `aws apigateway flush-stage-cache` works
- [ ] Verified: second identical request returns in < 5ms
  - `Verify:` `time curl` first request (cold), then `time curl` same request (cached)
  - `Evidence:` First: ~30ms, Second: < 5ms

#### Scope

**In:** API Gateway cache setup, TTL configuration, invalidation endpoint

**Out — Do Not Implement:**

- CloudFront CDN caching → future (API Gateway cache is sufficient for Phase 1)
- Per-product TTL configuration in SST → future (single TTL for now)

---

### Ticket P1A.10 — WAF + API Gateway Throttling

```yaml
id: P1A.10
title: WAF + API Gateway Throttling
status: pending
priority: p1-high
epic: P1A
persona: [ops]
depends_on: [P0.02]
completed: null
tech_stack:
  waf: AWS WAF v2
  cost: ~$5/month + $0.60/M requests
```

#### User Story

As a platform operator, the API is protected from DDoS and abuse so that a single bad actor cannot take down the OpenSearch cluster and affect all customers.

#### Problem Statement

A t3.small OpenSearch node with ~128 max connections can be overwhelmed by a single script hammering autocomplete in a loop. API Gateway's built-in throttling limits burst/sustained request rates per route. AWS WAF adds IP-based rate limiting and managed rule groups for SQL injection/XSS. Combined cost: ~$5/month — cheap insurance.

#### Definition of Done

##### Functional

- [ ] AWS WAF attached to API Gateway stage via SST
  - `Verify:` `sst.config.ts` includes WAF web ACL
  - `Evidence:` WAF visible in AWS console, associated with API Gateway
- [ ] Rate-based rule: 1000 requests per 5 minutes per IP
  - `Verify:` Script sending 1001 requests from same IP; 1001st returns 429
  - `Evidence:` WAF rule triggers, returns 429 Forbidden
- [ ] SQL injection / XSS managed rules enabled
  - `Verify:` `?q=<script>alert(1)</script>` returns 403 (WAF block)
  - `Evidence:` WAF managed rule group blocks injection attempts
- [ ] API Gateway default throttling configured (reasonable burst/sustained limits)
  - `Verify:` API Gateway stage settings in AWS console
  - `Evidence:` Default throttle applied (exact values tuned based on OpenSearch capacity)

#### Scope

**In:** WAF web ACL, rate-based rule, managed rule groups, API Gateway default throttling

**Out — Do Not Implement:**

- Per-key per-second rate limiting (token bucket) is brought into P1 as **P1B.09** per ARCHITECTURE.MD §5.4.1 / architecture v2.2 §4.3
- Geographic restrictions → not needed (LEI is international)
- Custom WAF rules per customer → future
- Bot detection → future

---

### Ticket P1A.11 — Search Relevance + Fuzzy Matching

```yaml
id: P1A.11
title: Search Relevance + Fuzzy Matching
status: in-progress
priority: p1-high
epic: P1A
persona: [api-consumer]
depends_on: [P1A.02, P1A.03, P1A.06, P1A.07]
completed: null
tech_stack:
  search: OpenSearch bool_prefix + best_fields + fuzzy
```

#### User Story

As a developer, autocomplete and validate should rank the address I'm typing accurately and tolerate small typos so that my users get the right result with the first call.

#### Problem Statement

`multi_match` with `bool_prefix` defaulted to OR operator, so `9 endeavour cuo` returned `ENDEAVOUR STREET`/`ENDEAVOUR CLOSE` ranked equally with `ENDEAVOUR COURT` (all scored ~26 — the prefix `cuo` was unused). Validate had no typo tolerance — `9 endevour court` would mismatch. Suburb lookup required exact spelling. Postcode/suburb lookups had no `limit` param.

#### Definition of Done

##### Functional

- [x] Autocomplete: `operator: "and"` so all tokens must match (last as prefix)
  - `Verify:` `q=9+endeavour+cuo` returns COURT first
- [x] Autocomplete: `fuzziness: "AUTO"` for typos in completed words
  - `Verify:` `q=9+endevour+court` finds 9 ENDEAVOUR COURT
  - `Note:` Per ES semantics, fuzziness doesn't apply to the prefix (last) token
- [x] Validate: `fuzziness: "AUTO"` so typo'd full addresses still validate
  - `Verify:` Validate still matches with appropriate confidence on typos
- [x] Suburb lookup: fuzzy match with `prefix_length: 1` (first char must match)
  - `Verify:` `?suburb=bondi+beech` returns matched as BONDI BEACH
- [x] Suburb lookup: response `suburb` field returns matched name (not input echo)
- [x] Postcode lookup: new `limit` param (default 10, max 50)
- [x] Suburb lookup: new `limit` param (default 10, max 20)
- [x] Docs and OpenAPI spec regenerated and committed

#### Scope

**In:** Query-side relevance + fuzziness, limit params on lookups

**Out — Do Not Implement:**

- Mapping changes (no reindex required) → only if query-side proves insufficient
- Last-token fuzzy on autocomplete → not supported by ES bool_prefix; would need custom workaround
- Synonyms / phonetic matching → future
- Popularity / frequency boosting → future
- Per-product search tuning beyond address → handled per-product when needed

#### Tradeoffs

- Default `limit` for both lookups changed from 50/20 → 10. Callers can opt back in via explicit `limit`.
- Suburb fuzzy may match other suburbs within 2 edits of the input (rare in practice — keyword fuzzy is bounded by full-string edit distance, not tokenized).
- Latency impact untested (expected sub-30ms increase).

---

### Ticket P1A.12 — API Test Suite

```yaml
id: P1A.12
title: API Test Suite
status: complete
priority: p1-high
epic: P1A
persona: [builder]
depends_on: [P1A.02, P1A.03, P1A.06, P1A.07]
completed: 2026-04-14
completed: null
tech_stack:
  test_runner: node:test (built-in)
  mocking: __setClientForTesting injection point
  future: fixture OpenSearch index for end-to-end integration tests
```

#### User Story

As a builder, search behavior changes (relevance, fuzziness, ranking, defaults) should fail CI when a refactor breaks them — not be discovered after deploy.

#### Problem Statement

The API package had zero automated tests. Search semantics across `autocomplete`, `validate`, `lookupPostcode`, and `lookupSuburb` are tuned via OpenSearch DSL — a single typo in `operator`, `fuzziness`, or `prefix_length` silently changes ranking. P1A.11 originally shipped with manual verification only; the bug-4 regression (state collapsing in `lookupSuburb` two-phase fix) demonstrated why DSL tests are needed.

#### Definition of Done

##### Functional

- [x] node:test set up for `@prontiq/api` package (matches ingestion package pattern)
- [x] DSL assertion tests verify generated OpenSearch query shape for each endpoint
  - `Verify:` `pnpm --filter @prontiq/api test` runs in CI via Turbo
  - `Evidence:` `packages/api/src/search/queries.test.ts` (10 tests covering autocomplete phase-1/phase-2 fallback + fuzziness, validate fuzziness+none confidence, lookupPostcode limit, lookupSuburb two-phase + state behavior + Bug 4 regression)
- [x] Integration tests against a real OpenSearch instance seeded with fixture data
  - `Verify:` `pnpm --filter @prontiq/api test:integration` against local Docker or CI service container
  - `Evidence:` `packages/api/src/search/queries.integration.test.ts` (13 tests including typo'd-prefix phase-2 fallback, typo'd-word fuzzy, multi-state RICHMOND aggregation) + fixture dataset in `__fixtures__/addresses.ts`
- [x] Integration tests run in CI before merge
  - `Verify:` `.github/workflows/ci.yml` includes `integration-test` job with OpenSearch 2.19 service container, gating `deploy-dev`
  - `Evidence:` CI job spins up OpenSearch, waits for health, runs test suite
  - `Verify:` `q=9+endeavour+cuo` ranks COURT first
  - `Verify:` `q=9+endevour+court` (typo) finds ENDEAVOUR COURT via fuzzy
  - `Verify:` `?suburb=bondi+beech` returns matched as BONDI BEACH with consistent postcodes
  - `Verify:` `?postcode=2000&limit=3` returns exactly 3 localities
- [ ] Tests run in CI (GitHub Actions)

#### Scope

**In:** API search behavior — query construction, ranking, fuzzy, defaults, response shape

**Out — Do Not Implement:**

- Load testing → separate (P1F.02 monitoring)
- E2E browser testing → not applicable
- Coverage gate → opinionated; maintainers may add later

---

### Ticket P1A.13 — Tighten Validate Confidence Thresholds

```yaml
id: P1A.13
title: Tighten Validate Confidence Thresholds
status: complete
priority: p2-value
epic: P1A
persona: [api-consumer]
depends_on: [P1A.03, P1A.11]
completed: 2026-04-14
```

#### User Story

As an API consumer, I rely on validate's confidence to gate my form-submission flow. Nonsense input should return `none` or `low`, not `medium`.

#### Problem Statement

Discovered via post-deploy smoke test: `?q=zzz1234+nonexistent+nowhere` returns `confidence: "medium"`. This happens because fuzzy matching produces a moderate BM25 score against any partial token match (e.g. a single matching character class). Current thresholds:

- `> 20` → high
- `10-20` → medium
- `< 10` → low
- (only no-hits) → none

With `fuzziness: AUTO`, almost any input scores ≥ 10 against the 15M-doc index. Need to tighten or add a minimum-meaningful-match threshold.

#### Definition of Done

- [x] `?q=zzz1234+nonexistent+nowhere` returns `confidence: "none"` (verified by integration test against fixture index)
- [x] `?q=9+endeavour+court+coffin+bay+sa+5607` still returns a valid match (confidence threshold calibrated for 15M-doc prod; fixture index uses different score range)
- [x] Smoke test assertion tightened back to `expect none/low`
- [x] Implementation: `scoreToConfidence(score, query, matchedLabel)` combines BM25 with token-coverage gate (require ≥40% exact token overlap before any non-"none" confidence)

#### Approach

Options:
- Raise medium threshold (e.g. score > 15)
- Add minimum match-token-coverage requirement (e.g. ≥ 50% of input tokens must match exactly)
- Combine both

#### Scope

**In:** Tuning `validate()` confidence thresholds in `queries.ts`

**Out — Do Not Implement:**

- Confidence on autocomplete (different semantic — autocomplete is suggestion, not validation)
- Configurable thresholds via API param → over-engineering

---

## Phase 1B — Auth & Billing

> **Goal:** Sign-up → DDB-native API key → hash-verified requests → rate-limited with burst limiter → usage tracked per-month → billed hourly via Stripe, with 14-day payment grace period.
>
> **Scope boundary.** The hot-path middleware rewrite (hash-based lookup, REDIRECT fallback, new usage-table writes) ships in **P1B.04b** (cutover), NOT in P1B.02. P1B.02 is pure crypto primitives only — no DDB dependency — which is why it remains parallel-safe. P1B.04b flips schema + code atomically once P1B.02 and P1B.04 are both done.
>
> **Dependency graph:** P1B.01/.02/.03/.04 can run in parallel. P1B.04b depends on .02 + .04 (needs the crypto module + the tables to write the code cutover). P1B.05 depends on .01/.02/.03/.04. P1B.06 depends on .03/.04. P1B.07/.08 depend on .04. **P1B.09 depends on .02 + .04b** (the burst limiter middleware reads `record.rateLimit` from context — that context is established by the post-cutover auth middleware in .04b, not by the pure crypto module). P1B.10 depends on .03/.04/.06. P1B.11 depends on .10. P1B.12 depends on .05/.09/.04b (tests the cutover end-to-end).
>
> **Repo-wide Unkey removal** completed in PR #68 (`chore(webhooks): remove Unkey code`) — `packages/webhooks/src/unkey.ts`, `unkeyWebhook` export, `lastSyncedFromUnkey` field, and `UNKEY_*` env vars all gone from main. **No P1B ticket owns this cleanup.** Going forward, P1B tickets only need to guarantee no NEW Unkey references are introduced.
>
> **Architecture reference:** ARCHITECTURE.MD §5.5 (schema), §5.6 (billing), §5.7 (webhooks), §7 (endpoints), §9 (error taxonomy). Decision rationale: ADR-001.

---

### Ticket P1B.01 — Clerk Application Setup

```yaml
id: P1B.01
title: Clerk Application Setup
status: pending
priority: p0-critical
epic: P1B
persona: [builder]
depends_on: [P0.02]
completed: null
tech_stack:
  auth: Clerk
  framework: Next.js 15
```

#### User Story

As a builder, I need a Clerk application configured with OAuth providers and a webhook so that users can sign up and the provisioning chain (Clerk → Stripe → DynamoDB) is triggered automatically.

#### Problem Statement

Clerk handles human identity: sign-up, login, OAuth (Google/GitHub), organisations, team management. The `/account` page authenticates through Clerk. A webhook on `user.created` triggers the provisioning chain (Stripe customer → DynamoDB key record). Without Clerk, there's no sign-up flow and no user identity for the dashboard.

#### Definition of Done

##### Functional

- [ ] Clerk application created (dev + prod instances)
  - `Verify:` Clerk dashboard shows application with two instances
  - `Evidence:` Application ID and instance URLs
- [ ] Google and GitHub OAuth configured
  - `Verify:` Sign-up page shows Google + GitHub buttons
  - `Evidence:` Clerk dashboard OAuth providers list
- [ ] Webhook URL configured for `user.created` event
  - `Verify:` Clerk dashboard webhooks section shows endpoint URL
  - `Evidence:` URL points to `{api-url}/webhooks/clerk`
- [ ] `CLERK_SECRET_KEY` and `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` in SST secrets/env
  - `Verify:` `sst deploy` passes keys to `/account` and webhook Lambda
  - `Evidence:` Lambda env vars include Clerk keys
- [ ] Clerk webhook secret stored and used for signature verification
  - `Verify:` `CLERK_WEBHOOK_SECRET` available in webhook handler env
  - `Evidence:` SST config passes it through

#### Scope

**In:** Clerk app creation, OAuth config, webhook config, secret management

**Out — Do Not Implement:**

- Webhook handler implementation → P1B.05
- `/account` Clerk components → P1C.02
- Team/org management → P3.03

---

### Ticket P1B.02 — Key Module (crypto primitives)

```yaml
id: P1B.02
title: Key Module (crypto primitives)
status: done
priority: p0-critical
epic: P1B
persona: [builder]
depends_on: []
completed: 2026-04-16
tech_stack:
  keys: custom (node:crypto only — no DDB dependency)
```

#### User Story

As a builder, I need pure crypto primitives in `packages/shared/src/keys.ts` (`generateKey`, `hashKey`) so that every downstream ticket (Clerk webhook provisioning P1B.05, burst limiter P1B.09, migration/middleware cutover P1B.04b) has a consistent way to mint and hash `pq_live_` keys.

#### Problem Statement

v2.2 removes Unkey (ADR-001). Key generation and hashing are the foundational primitives — they need no DynamoDB access, no table schema, no auth middleware context. Keeping this ticket pure (no infra dependency) lets it run in parallel with P1B.01/.03/.04 and keeps the crypto contract isolated from the schema-migration work (where middleware changes actually land — see P1B.04b).

**Boundary:** this ticket ships the module only. Wiring it into `middleware/auth.ts` to do hash-based lookup + REDIRECT fallback against `prontiq-keys` / `prontiq-usage` happens in **P1B.04b** (the cutover ticket) because it requires the tables from P1B.04 and the migration script to flip both schema and code atomically.

#### Definition of Done

##### Functional

- [x] `packages/shared/src/keys.ts` exports `generateKey()` and `hashKey(raw: string)`
  - `Verify:` Module loads via `import { generateKey, hashKey } from "@prontiq/shared/keys"` (or equivalent export path in `index.ts`)
  - `Evidence:` File created with both exports; re-exported from `packages/shared/src/index.ts`; `pnpm typecheck` passes
- [x] `generateKey()` returns `{ raw: string; hash: string; prefix: string }`
  - `Verify:` Unit test asserts shape
  - `Evidence:` `raw = "pq_live_" + randomBytes(24).toString("hex")` (56 chars total); `hash = SHA-256(raw)` lowercase hex (64 chars); `prefix = raw.slice(0, 12)` — all asserted in `keys.test.ts`
- [x] `hashKey(raw)` returns the same SHA-256 hex for the same input
  - `Verify:` Unit test: `hashKey(key.raw) === key.hash` for any `key = generateKey()`
  - `Evidence:` `pnpm --filter @prontiq/shared test` (10/10 pass, includes determinism + known SHA-256 vector check)
- [x] Module has **zero imports** from `@aws-sdk/*`, `@prontiq/api`, or Unkey SDKs — only `node:crypto`
  - `Verify:` `grep -E "^import" packages/shared/src/keys.ts` shows only `node:crypto`
  - `Evidence:` Confirmed — single import `{ createHash, randomBytes } from "node:crypto"`

##### Testing

- [x] Unit tests cover: prefix is `pq_live_`, length is 56, hex suffix has 48 chars `[a-f0-9]{48}`, 1000 successive `generateKey()` calls produce no duplicates, `hashKey` is deterministic + matches `generateKey().hash`
  - `Verify:` `pnpm --filter @prontiq/shared test`
  - `Evidence:` 10 tests pass via `node --test` (repo convention; `node:test` in lieu of Vitest — matches `packages/ingestion/src/lib.test.ts`)

#### Scope

**In:** `packages/shared/src/keys.ts` with `generateKey` + `hashKey`; unit tests; export from shared package index.

**Out — Do Not Implement:**

- Auth middleware refactor (hash-based lookup, REDIRECT fallback) → **P1B.04b** (cutover)
- DynamoDB reads/writes → P1B.05 (Clerk webhook) for CREATE, P1B.04b for VERIFY path rewrite
- Repo-wide Unkey code/env removal → already completed in PR #68 (merged)
- Rotation / revoke / list endpoints → P1C.03 (`/v1/account/keys/*`)
- Table creation → P1B.04
- Data migration from legacy `ApiKeyTable` → P1B.04b

---

### Ticket P1B.03 — Stripe Setup (Products + PLANS + Pricing Table)

```yaml
id: P1B.03
title: Stripe Setup (Products + PLANS + Pricing Table)
status: pending
priority: p0-critical
epic: P1B
persona: [builder]
depends_on: []
completed: null
tech_stack:
  billing: Stripe (metered, tiered Prices)
```

#### User Story

As a builder, I need Stripe configured with subscription plans, per-product metered Prices with tiered allocations, an embedded Pricing Table, and matching `PLANS` constants so that the platform can bill developers with zero cron-side pricing logic.

#### Problem Statement

Stripe metered billing needs one subscription per organisation with per-product usage line items. Each metered Price is configured with `tiers` — first N thousand requests at $0, the rest at the overage rate (ARCHITECTURE.MD §5.6.1, "Stripe-side" option). The `PLANS` constants in `packages/shared/src/constants.ts` mirror this for the middleware — same quotas, same product scopes, same rate limits. The embedded `<stripe-pricing-table>` is configured in the Stripe Dashboard and referenced by ID in the Billing tab.

#### Definition of Done

##### Functional

- [ ] Stripe products created: Starter ($29/mo recurring), Growth ($99/mo recurring)
  - `Verify:` Stripe dashboard Products section
  - `Evidence:` Product IDs and Price IDs documented
- [ ] Per-product metered Prices created with tiers (address, abn, lei, cve, patents) — first N thousand at $0, overage at $1.50 (Starter) / $1.00 (Growth) per 1K
  - `Verify:` Stripe Billing → Prices section, inspect tiers on each
  - `Evidence:` Price IDs and tier config per product
- [ ] `<stripe-pricing-table>` created in Dashboard showing Free / Starter / Growth
  - `Verify:` Stripe dashboard → Pricing tables shows the table
  - `Evidence:` Pricing table ID captured for P1C.05 embed
- [ ] `PLANS` constants block added to `packages/shared/src/constants.ts` per ARCHITECTURE.MD §5.6.1 (free/starter/growth/enterprise shapes with `stripePriceId`, `quotaPerProduct`, `rateLimit`, `products`, `maxKeys`, `overagePerThousand`)
  - `Verify:` `pnpm typecheck` passes; PLANS[tier].stripePriceId matches Stripe Dashboard Price IDs
  - `Evidence:` `packages/shared/src/constants.ts` diff
- [ ] Webhook URL configured for `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed`
  - `Verify:` Stripe dashboard Webhooks section
  - `Evidence:` URL points to `{api-url}/webhooks/stripe`
- [ ] Smart Retries configured so all retry attempts complete within 7 days of first failure, AND subscription cancel policy set to "Cancel subscription when all retries exhausted" (required for 14-day grace per §5.6.3)
  - `Verify:` Stripe dashboard → Settings → Billing → Subscriptions and emails
  - `Evidence:` Retry schedule screenshot + cancel policy setting
- [ ] `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` in SST secrets
  - `Verify:` Webhook handler Lambda has access
  - `Evidence:` SST config passes them through

#### Scope

**In:** Stripe products, tiered metered Prices, Pricing Table, Smart Retries + cancel policy, webhook endpoints, PLANS constants, secrets

**Out — Do Not Implement:**

- Webhook handler → P1B.06
- Billing cron → P1B.10
- `/account` Billing tab → P1C.05
- Enterprise custom pricing → future

---

### Ticket P1B.04 — DynamoDB Tables (4 tables + schema)

```yaml
id: P1B.04
title: DynamoDB Tables (4 tables + schema)
status: in-progress
priority: p0-critical
epic: P1B
persona: [builder]
depends_on: [P0.02]
completed: null
tech_stack:
  infra: SST v4 + Pulumi
  data: DynamoDB
```

#### User Story

As a builder, I need four DynamoDB tables (`prontiq-keys`, `prontiq-usage`, `prontiq-audit`, `prontiq-ses-suppressions`) with the exact schema defined in ARCHITECTURE.MD §5.5.1 so that subsequent tickets (webhook handlers, cron, middleware) have the infra to write to.

#### Problem Statement

v2.2 splits the single legacy `ApiKeyTable` into four purpose-specific tables: hot-path isolation (keys + usage separated), append-only logging (audit), TTL-driven cleanup, hash-only storage. Registry and provisioning-lock are sentinel items in `prontiq-keys` with reserved PKs.

#### Definition of Done

##### Functional

- [x] `prontiq-keys` table with PK `apiKeyHash` (string), GSI `orgId-index` on `orgId` (sparse — sentinel rows like `ORG#{orgId}` and `REGISTRY#active-keys` deliberately do NOT set an `orgId` attribute, so they are excluded from the index per ARCHITECTURE.MD §5.5.1 "Sentinel record discriminator")
  - `Verify:` `aws dynamodb describe-table --table-name prontiq-keys` shows `orgId-index` GSI
  - `Evidence:` `sst.config.ts` `PqAuthKeys` component declares PK `apiKeyHash` + `orgId-index` GSI with default ALL projection; physical AWS name `prontiq-keys` (prod) / `prontiq-keys-{stage}` (non-prod). `describe-table` verification runs against dev after CI deploy post-merge.
- [x] `prontiq-usage` table with PK `apiKeyHash` (string) + SK `scope` (string); TTL enabled on `ttl` attribute; **GSI `newHash-redirect-index`** on `newHash` (sparse — only REDIRECT items have a `newHash` attribute) with `KEYS_ONLY` projection. Required by P1B.10 billing cron for rotation-chain attribution per ARCHITECTURE.MD §5.5.1 REDIRECT schema + §5.6.2 cron flow.
  - `Verify:` `aws dynamodb describe-table --table-name prontiq-usage` shows both TTL on `ttl` AND `newHash-redirect-index` GSI with `KEYS_ONLY` projection
  - `Evidence:` `sst.config.ts` `PqAuthUsage` component declares PK `apiKeyHash` + SK `scope`, `ttl: "ttl"`, `newHash-redirect-index` GSI with `projection: "keys-only"` (SST maps to `KEYS_ONLY`).
- [x] **REDIRECT GSI smoke test** — seed a REDIRECT item `{apiKeyHash: oldHash, scope: "REDIRECT", newHash: newHash, authValidUntil, ttl}`; query `newHash-redirect-index` where `newHash = newHash`; assert exactly 1 result (the seeded oldHash). Required because P1B.10 will fail without this index.
  - `Verify:` Integration test against DynamoDB Local
  - `Evidence:` `packages/api/src/middleware/redirect-gsi.integration.test.ts` (2 tests: indexed-match + sparse-miss) passes against DDB Local 2.5.2. CI runs it in the `integration-test` job alongside OpenSearch.
- [x] `prontiq-audit` table with PK `orgId` + SK `timestamp#eventId`; TTL enabled on `ttl` (365 days)
  - `Verify:` `aws dynamodb describe-table --table-name prontiq-audit`
  - `Evidence:` `sst.config.ts` `PqAuthAudit` component declares PK `orgId` + SK `timestamp#eventId`, `ttl: "ttl"`. The 365-day retention is enforced by writer helper (P1B.07) setting the `ttl` attribute value — DDB TTL is attribute-driven, not schema-driven.
- [x] `prontiq-ses-suppressions` table with PK `email`; TTL enabled on `ttl` (90 days for bounces)
  - `Verify:` `aws dynamodb describe-table --table-name prontiq-ses-suppressions`
  - `Evidence:` `sst.config.ts` `PqSesSuppressions` component declares PK `email`, `ttl: "ttl"`. The 90-day retention for bounces / null TTL for complaints is enforced by the bounce handler (P1B.08) setting the `ttl` attribute value.
- [x] All tables on-demand (PAY_PER_REQUEST) billing
  - `Verify:` describe-table shows `BillingModeSummary: PAY_PER_REQUEST`
  - `Evidence:` `sst.aws.Dynamo` defaults to `billingMode: "PAY_PER_REQUEST"` (confirmed at `.sst/platform/src/components/aws/dynamo.ts:522`). No explicit override needed.
- [ ] `sst diff --stage prod` reviewed before prod deploy (per CLAUDE.md infra rules) [DEFERRED: requires AWS prod credentials — user runs before merge per CLAUDE.md "Run `pnpm exec sst diff --stage prod` before merging any prod-affecting PR"]
  - `Verify:` Captured in PR description
  - `Evidence:` Diff output

#### Scope

**In:** 4 tables via SST, TTL config, GSI on keys table

**Out — Do Not Implement:**

- Data migration from legacy table → P1B.04b
- Any writes to these tables → later tickets
- Registry sharding (only needed post-6,250 billable keys, Phase 5)

---

### Ticket P1B.04b — Data Migration + Middleware Cutover (Legacy Schema → v2.2)

```yaml
id: P1B.04b
title: Data Migration + Middleware Cutover (Legacy Schema → v2.2)
status: pending
priority: p0-critical
epic: P1B
persona: [ops]
depends_on: [P1B.02, P1B.04]
completed: null
tech_stack:
  scripts: tsx, @aws-sdk/lib-dynamodb
  code: packages/api/src/middleware, packages/shared/src/types.ts
```

#### User Story

As a platform operator, I need a coordinated cutover that flips both the schema (legacy `ApiKeyTable` → `prontiq-keys` + `prontiq-usage`) and the code (auth + usage middleware rewritten for hash-based lookup with REDIRECT fallback) atomically, so that there is no window where the middleware is reading a shape the table no longer provides (or vice versa).

#### Problem Statement

Live today is a single `ApiKeyTable` with raw-key PK and nested `usage: {product: {month: count}}` on each record. The middleware (`packages/api/src/middleware/auth.ts`, `packages/api/src/middleware/usage.ts`) reads/writes that shape directly. v2.2 splits the table into `prontiq-keys` (hash PK) + `prontiq-usage` (composite PK `apiKeyHash` + SK `{product}#{yearMonth}`), and introduces REDIRECT records for rotation safety.

**Schema migration and middleware refactor are inseparable**: you can't flip one without the other. This ticket owns both. P1B.02 provides the crypto primitives (`generateKey` / `hashKey`); P1B.04 creates the target tables; this ticket does the hot-path rewrite + data copy + cutover. The legacy seed key `pq_live_prod_000000000000000000000000` doesn't match the `pq_live_` + 48 hex format and is rotated as part of the cutover.

#### Definition of Done

##### Functional — Middleware Refactor (matches ARCHITECTURE.MD §5.5.3 hot-path flow)

- [ ] `packages/api/src/middleware/auth.ts` rewritten: hash incoming `X-Api-Key` via `hashKey` (from P1B.02), `GetItem` from `prontiq-keys` by hash
  - `Verify:` Unit + integration test — valid key returns 200; invalid returns 401 `INVALID_API_KEY`
  - `Evidence:` `grep -n "GetCommand" packages/api/src/middleware/auth.ts` shows `Key: { apiKeyHash }` (not `apiKey`)
- [ ] REDIRECT fallback with `authValidUntil` grace check (per ARCHITECTURE.MD §5.5.1 + §12.3): on `prontiq-keys` miss, `GetItem` from `prontiq-usage` with `{apiKeyHash: oldHash, scope: "REDIRECT"}`; if present AND `authValidUntil > now()` → re-resolve via `record.newHash` and GetItem the new key (one retry, no loop). If `authValidUntil <= now()` → 401 `INVALID_API_KEY` regardless of `ttl`. The redirected-to record is then subject to the standard `active` check (so REVOKE-after-ROTATE naturally rejects).
  - `Verify:` Three integration tests — (a) seed REDIRECT with `authValidUntil` in future + valid newHash → 200; (b) same but with `authValidUntil` in past → 401; (c) seed REDIRECT pointing at a revoked (`active: false`) newHash → 401 via active check
  - `Evidence:` All three pass in P1B.12
- [ ] **Atomic quota enforcement** (per ARCHITECTURE.MD §5.5.3 step 4): replace the read-then-async-write pattern in `usage.ts` with a single conditional `UpdateItem` on `prontiq-usage`:
  ```
  UpdateExpression: "SET lastUsedAt = :now ADD requestCount :one"
  ConditionExpression: "attribute_not_exists(requestCount)
                        OR requestCount < :quota
                        OR :tierAllowsOverage = :true"
  ExpressionAttributeValues: {
    ":now":               { S: <ISO timestamp> },
    ":one":               { N: "1" },
    ":quota":             { N: <PLANS[tier].quotaPerProduct> },
    ":tierAllowsOverage": { BOOL: <tier !== "free"> },
    ":true":              { BOOL: true }
  }
  ReturnValues: "UPDATED_NEW"
  ```
  Note `SET` and `ADD` must be **separate clauses** in DynamoDB UpdateExpression — assignment is not allowed inside an `ADD` clause. Free-tier breach → `ConditionalCheckFailedException` → middleware returns 429 `QUOTA_EXCEEDED` with `resets_at`. Paid-tier overage → success with `X-RateLimit-Over: true` header set when `newRequestCount > quotaPerProduct`. Eliminates the race window where two concurrent requests both pass the quota check before either writes.
  - `Verify:` Race test — fire 100 concurrent requests at a free-tier key with quota=50; exactly 50 return 200, exactly 50 return 429
  - `Evidence:` Integration test result + DDB count = 50 (not 100)
- [ ] **Expression syntax test** (catches the SET/ADD mistake before deploy):
  - `Verify:` Unit test invokes the auth middleware against DynamoDB Local with a seeded `prontiq-keys` row and an absent `prontiq-usage` row. First request creates the usage item with `requestCount=1` and `lastUsedAt` set. Second request increments. Test deliberately constructs the UpdateExpression as a string and fails-fast if any `ADD ... = ...` substring is present anywhere in the codebase (regex: `ADD\s+\w+\s+\S+\s*,\s*\w+\s*=`).
  - `Evidence:` Vitest run + grep guard
- [ ] `packages/api/src/middleware/usage.ts` deleted or reduced to a thin wrapper — the atomic UpdateItem now lives inside `auth.ts` (combined check + increment) since they share the DDB call
  - `Verify:` `grep -n "UpdateCommand" packages/api/src/middleware/auth.ts` shows the conditional update
  - `Evidence:` Single hot-path DDB write per request (vs current two: read + async write)
- [ ] `ApiKeyRecord` type in `packages/shared/src/types.ts` updated to v2.2 shape: `apiKeyHash`, `keyPrefix`, `ownerEmail`, `orgId`, `tier`, `products`, `quotaPerProduct`, `rateLimit`, `active`, `paymentOverdue`, `stripeCustomerId`, `stripeSubscriptionId`, `subscriptionItems`, `createdAt`, `lastUsedAt` — **no `usage` nested map**, **no `monthlyQuotaPerProduct`**
  - `Verify:` `pnpm typecheck` passes
  - `Evidence:` Type diff shows removed legacy fields
- [ ] `TABLE_NAME` env var updated from `ApiKeyTable` to `KEYS_TABLE_NAME=prontiq-keys` + new `USAGE_TABLE_NAME=prontiq-usage` (wired via SST)
  - `Verify:` Lambda env vars inspected via `aws lambda get-function-configuration`
  - `Evidence:` SST config diff

##### Functional — Data Migration

- [ ] `scripts/migrate-api-keys.ts` reads every item in legacy `ApiKeyTable`
  - `Verify:` Scan count logged
  - `Evidence:` Script log
- [ ] For each legacy item: compute `hashKey(rawKey)`, `PutItem` to `prontiq-keys` with v2.2 shape (`subscriptionItems` may be empty until P1B.06 populates them on next Stripe event)
  - `Verify:` `aws dynamodb get-item` on new table returns expected record
  - `Evidence:` Sample record diff
- [ ] For each `usage.{product}.{month}` entry, `PutItem` to `prontiq-usage` with PK=apiKeyHash, SK=`{product}#{month}`, `requestCount`, `lastPushedCumulativeCount: requestCount` (set to the live count so the next cron sees a delta of 0 — legacy usage was never pushed via this cron, but the rename happens in v2.2 and we're not retroactively pushing existing usage), `ttl` 90 days out
  - `Verify:` Row count in `prontiq-usage` matches sum of nested entries
  - `Evidence:` Migration report
- [ ] Legacy seed key `pq_live_prod_000...` rotated: new key in new format issued to the owner (manual step — document who owns the seed and notify before running)
  - `Verify:` Old seed returns 401 after cutover; new key works
  - `Evidence:` Rotation plan captured in PR description
- [ ] Migration script is idempotent: re-running on an already-migrated table is a no-op
  - `Verify:` Run twice on dev; second run reports zero writes
  - `Evidence:` Script uses conditional `PutItem` or reads before write

##### Functional — Cutover & Rollback

- [ ] Dev cutover rehearsed before prod: migration + middleware deploy run successfully in `--stage dev`, integration tests pass against migrated data
  - `Verify:` CI run log
  - `Evidence:` Green CI
- [ ] Rollback plan documented: keep legacy `ApiKeyTable` intact (do not delete) for at least 14 days post-cutover; revert plan ships the previous `auth.ts`/`usage.ts` + re-point SST env to `ApiKeyTable`
  - `Verify:` SST config does not delete `ApiKeyTable`; rollback instructions in PR description
  - `Evidence:` PR description rollback section
- [ ] `sst diff --stage prod` reviewed before prod deploy (per CLAUDE.md)
  - `Verify:` Captured in PR description
  - `Evidence:` Diff output

#### Scope

**In:** Middleware rewrite (auth + usage), `ApiKeyRecord` type update, migration script, seed-key rotation plan, dev rehearsal, rollback strategy, SST env var changes.

**Out — Do Not Implement:**

- Deleting legacy `ApiKeyTable` → separate follow-up after 14-day soak
- Auto-creating subscription items for legacy upgraded keys → P1B.06 webhook handles this on next Stripe event
- Repo-wide Unkey code removal → already completed in PR #68 (merged)

---

### Ticket P1B.05 — Clerk Webhook Handler (Provisioning)

```yaml
id: P1B.05
title: Clerk Webhook Handler (Provisioning)
status: pending
priority: p0-critical
epic: P1B
persona: [api-consumer]
depends_on: [P1B.01, P1B.02, P1B.03, P1B.04]
completed: null
```

#### User Story

As a new user signing up, my org is auto-provisioned (Stripe customer + DynamoDB org envelope) within seconds. I sign in to `/account` and create my first API key from there — the raw key is shown to me once in the response.

#### Problem Statement

Per ARCHITECTURE.MD §5.7.1 (rewritten in PR #57 review #3 to address Bug 5), **the webhook does NOT mint API keys**. Hash-only storage means a key generated server-side without an in-flight HTTP response to the user is unrecoverable — an SES failure would leave the org with a `prontiq-keys` row whose raw value can never be revealed.

Instead, the webhook provisions the **org envelope** (`ORG#{orgId}` record + Stripe customer). The first API key is minted by the user-driven `POST /v1/account/keys/create` (P1C.03) where the raw value is returned in the HTTP response and shown once.

This ticket covers only the webhook side. P1C.03 covers the user-driven key creation.

#### Definition of Done

##### Functional

- [ ] Webhook signature verified via Svix
  - `Verify:` Unsigned request → 401; signed request → 200
  - `Evidence:` `svix.webhooks.verify()` in handler
- [ ] **Read-first idempotency check** — `GetItem ORG#{orgId}`. If found → return 200 (no side effects).
  - `Verify:` Webhook payload sent twice; second returns 200; second invocation makes ZERO Stripe API calls and ZERO DDB writes
  - `Evidence:` CloudWatch log "ORG envelope exists for orgId={…}, returning 200"; Stripe API call count = 1 (from first invocation only)
- [ ] **Stripe customer create with idempotency key** — `Idempotency-Key: clerk-provision-{orgId}`. Repeated calls return the same `cus_...`.
  - `Verify:` Force a step-4 transaction failure; retry the webhook; `customers.list({email: …})` shows exactly one customer
  - `Evidence:` Stripe Dashboard customer list + idempotency log line
- [ ] **No raw API key generated in this handler.** `grep -n "generateKey\|hashKey" packages/webhooks/src/clerk.ts` returns zero. The handler creates only the Stripe customer + ORG envelope + audit entry.
  - `Verify:` Code review
  - `Evidence:` grep result
- [ ] **Atomic commit via `TransactWriteItems`** — single transaction writes:
  1. `prontiq-keys/ORG#{orgId}` with `{stripeCustomerId, ownerEmail, tier="free", hasFirstKey: false, completedAt}` and `attribute_not_exists(apiKeyHash)`
  2. `prontiq-audit/{orgId}/{ts#ulid}` with `action="ORG_PROVISIONED"` and `attribute_not_exists(orgId) AND attribute_not_exists(SK)`
  Either both commit or neither does.
  - `Verify:` Happy path: send webhook → verify both items exist
  - `Evidence:` Integration test
- [ ] **TransactionCanceledException handling per ARCHITECTURE.MD §5.7.1** — distinguish cancellation reasons before deciding the response code. The handler MUST inspect `error.CancellationReasons[]` (AWS SDK populates this) and:
  - For each reason, branch on `Code`:
    - `ConditionalCheckFailed` on item (a) ORG envelope: GetItem `ORG#{orgId}` to confirm. **Only return 200 if the envelope is present and complete.** If absent/partial → fall through to the retry path.
    - `ConditionalCheckFailed` on item (b) audit row: extreme race (same ulid). GetItem ORG → confirm presence → return 200 if complete.
    - `TransactionConflict` / `ProvisionedThroughputExceeded` / `ThrottlingException`: throughput pressure. Retry the entire `TransactWriteItems` with exponential backoff (max 3 attempts; total ~1s).
    - Any other reason (`ValidationError`, `ResourceNotFound`, etc.): treat as fatal, return 5xx so Clerk redelivers (3-day window).
  - **Invariant: never return 200 unless ORG envelope is confirmed present.** Returning 200 prevents Clerk from retrying. A silent failure here would leave the user without an org.
  - `Verify:` Three integration tests:
    - (a) Replay duplicate webhook → ConditionalCheckFailed on ORG → GetItem confirms presence → 200
    - (b) Force a transient ThrottlingException (e.g., stub the DDB client to throw on first call) → handler retries → second attempt succeeds → 200
    - (c) Force a ValidationError (e.g., malformed item) → handler returns 5xx → Clerk redelivery scheduled
  - `Evidence:` All three pass; CloudWatch log differentiates "duplicate replay" vs "transient retry" vs "fatal"
- [ ] **No partial state possible** — kill the Lambda after Stripe customer creation but before TransactWrite; retry the webhook; verify the same Stripe customer is reused (Idempotency-Key) and exactly one ORG envelope row results
  - `Verify:` Manual chaos test in dev
  - `Evidence:` Test log + Stripe Dashboard customer count
- [ ] Welcome email sent via SES (subject "Welcome to Prontiq.", body includes a sign-in link to `/account` + docs link). **Does NOT contain an API key** — the user creates one from `/account` after sign-in. SES failure does not block provisioning durability.
  - `Verify:` SES send confirmation; email body contains "Sign in to create your first API key" and links to `https://prontiq.dev/account`
  - `Evidence:` SES sendRaw response + email screenshot

##### Recovery Endpoint

- [ ] Implement `POST /v1/account/setup` (Clerk-authenticated). Idempotent. If `ORG#{orgId}` exists → 200 (no side effects). If missing → run the same Stripe-customer-create + ORG-envelope-PutItem flow as the webhook handler (factored into a shared service).
  - `Verify:` **Route-level integration tests** (no UI dependency — UI is owned by P1C.03):
    - (a) Call `POST /v1/account/setup` with a Clerk-authenticated test principal whose ORG envelope does not exist → 201 + envelope created + audit row
    - (b) Call same endpoint twice in a row → second returns 200 with no DDB writes (idempotent)
    - (c) Inject Stripe-create success then DDB failure on first attempt → retry succeeds; verify exactly 1 Stripe customer (Idempotency-Key reuse) and 1 ORG envelope
    - (d) Verify both the webhook handler AND `/setup` endpoint import from the same shared service
  - `Evidence:` All four assertions pass; `grep -rn "provisionOrg\|provisionEnvelope" packages/` shows webhook + setup route + nothing else
  - `Note:` UI-level verification (the `/account` page detecting missing envelope and rendering the "Set up your account" CTA that calls this endpoint) lives in **P1C.03 DoD** — not here, because P1B.05 ships before any UI work and shouldn't depend on dashboard rendering.

#### Scope

**In:** Svix verification, ORG envelope creation, Stripe customer create with idempotency, audit entry, welcome email (no key in body), `/v1/account/setup` recovery endpoint, shared `provisioning.ts` service.

**Out — Do Not Implement:**

- Key minting → P1C.03 (`/v1/account/keys/create`)
- Org / team provisioning → P3.03
- Sandbox (`pq_test_`) keys → future

---

### Ticket P1B.06 — Stripe Webhook Handler (4 events + grace)

```yaml
id: P1B.06
title: Stripe Webhook Handler (4 events + grace)
status: pending
priority: p0-critical
epic: P1B
persona: [api-consumer]
depends_on: [P1B.03, P1B.04]
completed: null
```

#### User Story

As a developer changing plans, my API keys reflect the new tier/quota on the next request. As a developer whose card fails, I get a 14-day grace period before losing service. As a platform operator, Stripe subscription state drives DynamoDB state deterministically.

#### Problem Statement

Four event types: `checkout.session.completed` (initial upgrade), `customer.subscription.updated` (plan change + past_due + recovered), `customer.subscription.deleted` (cancel / end of grace), `invoice.payment_failed` (log only). All require signature verification, `stripe.customers.retrieve(customerId)` to read `metadata.orgId`, and batched updates across all keys for the org. See ARCHITECTURE.MD §5.7.2–§5.7.5.

#### Definition of Done

##### Functional

- [ ] Signature verified via `stripe.webhooks.constructEvent()` — unsigned → 400
  - `Verify:` Unsigned POST returns 400
  - `Evidence:` Handler log
- [ ] `checkout.session.completed` (per ARCHITECTURE.MD §5.7.2 — two-step Stripe read required):
  1. Retrieve customer → read orgId from metadata
  2. Get `subscription` ID from event → `stripe.subscriptions.retrieve(subId, {expand: ['items.data.price']})` to get the per-product subscription items (Checkout Session events do NOT include `items` inline)
  3. Build subscriptionItems map: for each item.data, map `item.price.product` (Stripe product) → Prontiq product slug (via `STRIPE_PRODUCT_TO_PRONTIQ` constant); skip the recurring plan price; record `item.id` (the `si_...`) per Prontiq product
  4. **Validate**: every `PLANS[tier].products` entry must have a subscription item. Missing → return 500 with SNS alert (Stripe will retry; persistent failure pages oncall — better than silent under-billing)
  5. Query `prontiq-keys` by orgId via GSI `orgId-index` with **`FilterExpression: "attribute_exists(keyPrefix) AND attribute_exists(active)"`** (sentinel guard per ARCHITECTURE.MD §5.5.1 — excludes ORG envelope and any future singleton rows). Returns ALL real API-key items for this org.
  6. TransactWriteItems: update each key (tier/products/quota/rateLimit/stripeSubscriptionId/subscriptionItems) + ADD each hash to REGISTRY#active-keys
  7. Reset warning/limit email flags on usage items; audit UPGRADE
  - `Verify:` Test card upgrade Free→Growth; (a) `subscriptionItems` map populated for every Growth product (`address`, `abn`, `lei`, `cve`, `patents`); (b) deliberately delete the ABN metered Price in Stripe Dashboard before the test → webhook returns 500, SNS alert fires; (c) `/v1/address/enrich` works (Starter-only product) on next request
  - `Evidence:` Integration test covering happy path + missing-product validation failure
- [ ] `customer.subscription.updated` (plan change, paid→paid): update each key (tier, products, quota, rateLimit, subscriptionItems), reset email flags; **keep hash in REGISTRY#active-keys** (still billable — §5.5.1 event table); audit UPGRADE or DOWNGRADE per tier delta
  - `Verify:` Starter→Growth via Stripe customer portal; keys reflect change; `aws dynamodb get-item --table prontiq-keys --key '{"apiKeyHash":{"S":"REGISTRY#active-keys"}}'` shows hash still in activeHashes set
  - `Evidence:` Integration test covering both Starter→Growth and Growth→Starter
- [ ] `customer.subscription.updated` (past_due): set `paymentOverdue: true` on all org keys + send SES payment failure email
  - `Verify:` Simulate past_due via Stripe CLI; X-Payment-Overdue: true header appears on next request; email sent (check SES logs)
  - `Evidence:` Integration test + CloudWatch log
- [ ] `customer.subscription.updated` (active after past_due): clear `paymentOverdue: false` on all org keys
  - `Verify:` Resolve past_due with new card; subsequent requests no longer have X-Payment-Overdue header
  - `Evidence:` Integration test
- [ ] `customer.subscription.deleted`: downgrade all keys to free (tier="free", products=["address"], quotaPerProduct=5000, rateLimit=10), clear stripeSubscriptionId/subscriptionItems/paymentOverdue, DELETE each hash from REGISTRY#active-keys, audit DOWNGRADE
  - `Verify:` Cancel subscription; at period end all org keys return to free tier limits
  - `Evidence:` Integration test
- [ ] `invoice.payment_failed`: log event, no DDB writes
  - `Verify:` Simulate payment failure; log entry present; no DDB change
  - `Evidence:` CloudWatch log
- [ ] Idempotent across events: replaying the same event ID is a no-op

#### Scope

**In:** 4 Stripe event handlers, orgId resolution, batched org-key updates, registry mutations, email on past_due, audit writes

**Out — Do Not Implement:**

- Prorated billing → Stripe handles automatically
- Initial subscription creation from scratch without checkout → not supported; user must go through Checkout

---

### Ticket P1B.07 — `prontiq-audit` Writer Helper

```yaml
id: P1B.07
title: prontiq-audit Writer Helper
status: pending
priority: p1-high
epic: P1B
persona: [builder]
depends_on: [P1B.04]
completed: null
```

#### User Story

As a builder of lifecycle-event code (webhook handlers, rotation, revoke), I need a single `writeAudit()` helper in `packages/shared/src/audit.ts` so that every lifecycle event writes a consistent shape to `prontiq-audit` without copy-pasted boilerplate.

#### Problem Statement

CREATE/ROTATE/REVOKE/UPGRADE/DOWNGRADE events need identical row shapes for later query ("who rotated the key?"). Centralise so every caller passes `{orgId, action, apiKeyHash, actorId, metadata}` and the helper handles ULID generation, ISO timestamp, TTL math.

#### Definition of Done

##### Functional

- [ ] `writeAudit({orgId, action, apiKeyHash, actorId, metadata})` in `packages/shared/src/audit.ts`
  - `Verify:` Called from P1B.05 (CREATE), P1B.06 (UPGRADE / DOWNGRADE), P1C.03 (ROTATE / REVOKE)
  - `Evidence:` Import in each caller
- [ ] ULID generated per call; timestamp is ISO 8601; SK = `{timestamp}#{ulid}`
  - `Verify:` Query audit table; rows sort chronologically
  - `Evidence:` Sample rows
- [ ] TTL set to `now + 365 days` (unix seconds)
  - `Verify:` Sample item's `ttl` matches expected value
  - `Evidence:` `describe` output
- [ ] Unit test covers all 5 action values

#### Scope

**In:** `audit.ts` helper, unit tests

**Out — Do Not Implement:**

- Reading / querying audit (that's `/v1/account/keys` → P1C.03)
- Audit UI → P1C.03

---

### Ticket P1B.08 — `prontiq-ses-suppressions` + Bounce Handler

```yaml
id: P1B.08
title: prontiq-ses-suppressions + Bounce Handler
status: pending
priority: p1-high
epic: P1B
persona: [ops]
depends_on: [P1B.04]
completed: null
```

#### User Story

As a platform operator, I need SES bounce and complaint events to populate `prontiq-ses-suppressions` so that repeated sends to bad addresses don't wreck our SES reputation.

#### Problem Statement

AWS suspends SES accounts at >5% bounce rate or >0.1% complaint rate. We need a feedback loop: SES publishes bounce/complaint events to SNS → Lambda subscriber writes to `prontiq-ses-suppressions` → every SES send checks the suppression list first. See ARCHITECTURE.MD §12.5.

#### Definition of Done

##### Pre-requisite

- [ ] SES production-access request submitted and approved (typically 24-48h AWS review)
  - `Verify:` AWS SES console shows account out of sandbox
  - `Evidence:` AWS approval email
- [ ] Sending domain verified with DKIM + SPF + DMARC configured
  - `Verify:` SES domain identity shows all three green
  - `Evidence:` DNS records + SES status

##### Functional

- [ ] SES configured to publish bounces and complaints to SNS topic
  - `Verify:` SNS topic receives test-bounce message
  - `Evidence:` SST config + SES configuration set
- [ ] Lambda subscriber writes to `prontiq-ses-suppressions`
  - `Verify:` Trigger bounce with simulator address; row appears in DDB within 30s
  - `Evidence:` DDB scan
- [ ] Hard bounce: `reason="hard_bounce"`, no TTL variance (90d default)
- [ ] Soft bounce: increment `bounceCount`; suppress only after 3 within 30 days
  - `Verify:` Simulate 3 soft bounces; 3rd creates suppression entry
  - `Evidence:` DDB scan showing `bounceCount: 3`
- [ ] Complaint: `reason="complaint"`, `ttl` unset (permanent)
- [ ] All SES send paths (welcome email, threshold email, payment-failure email) check `prontiq-ses-suppressions` before sending
  - `Verify:` Suppressed address does NOT receive send; log shows "suppressed, skipping"
  - `Evidence:` Integration test

#### Scope

**In:** SES prod-access exit, SNS topic, subscriber Lambda, suppression-check middleware

**Out — Do Not Implement:**

- Un-suppression UI → manual DDB edit for now
- Email template system → per-call HTML string for Phase 1

---

### Ticket P1B.09 — Burst Rate Limiter Middleware

```yaml
id: P1B.09
title: Burst Rate Limiter Middleware
status: pending
priority: p1-high
epic: P1B
persona: [builder]
depends_on: [P1B.02, P1B.04b]
completed: null
```

#### User Story

As a platform operator, a single abusive key cannot overwhelm OpenSearch in one second — each key has a per-Lambda-instance token bucket sized from `record.rateLimit` on the loaded `prontiq-keys` record.

#### Problem Statement

Monthly quotas (§5.4 middleware) prevent 30-day overruns but not one-second floods. In-memory token bucket per `apiKeyHash` prevents the latter. See ARCHITECTURE.MD §5.4.1.

**Why this depends on P1B.04b** (not just P1B.02): the burst limiter needs both `apiKeyHash` (the bucket key) AND `record.rateLimit` (the bucket capacity), which are both produced by the post-cutover auth middleware that loads the v2.2 `ApiKeyRecord` shape. Wiring the limiter against the legacy `ApiKeyTable` shape (`record.apiKey` raw + nested usage map) would require a temporary translation layer that gets thrown away at cutover. Cleaner to wait for P1B.04b.

Known caveat: per-Lambda-instance, not global — documented and accepted for Phase 1.

#### Definition of Done

##### Functional

- [ ] Middleware `packages/api/src/middleware/rate-limit.ts` instantiates a module-scoped `Map<apiKeyHash, TokenBucket>`
  - `Verify:` Code review
  - `Evidence:` File exists with implementation
- [ ] Reads `apiKeyHash` and `record.rateLimit` from request context (set by the post-P1B.04b auth middleware)
  - `Verify:` Unit test wires a fake context with `c.set("apiKey", { rateLimit: 100, apiKeyHash: "abc..." })` and confirms the limiter reads both
  - `Evidence:` Test passes
- [ ] On each request: consume 1 token from the bucket for this key (create bucket with capacity = `record.rateLimit` on first encounter)
  - `Verify:` Unit test
  - `Evidence:` Vitest output
- [ ] Empty bucket → return 429 with `code: "RATE_LIMITED"` body and `Retry-After` header
  - `Verify:` Integration test: 200 requests at rate > limit; receive 429 with Retry-After
  - `Evidence:` Response
- [ ] Buckets refill at `rateLimit` tokens/second (continuous refill, floor at capacity)
  - `Verify:` Sleep `1/rateLimit` after burst; next request succeeds
  - `Evidence:` Integration test
- [ ] Notes section in ticket + README call out the per-instance caveat — global burst control is deferred (Redis / API Gateway usage plans, post-Phase-1)

##### Testing

- [ ] Integration test covers burst + refill + multiple keys isolated

#### Scope

**In:** Middleware, unit + integration tests, documented Lambda-concurrency caveat

**Out — Do Not Implement:**

- Global (cross-Lambda) rate limiter → post-Phase-1
- Per-product burst — single bucket per key today

---

### Ticket P1B.10 — Billing Cron (hourly → Stripe)

```yaml
id: P1B.10
title: Billing Cron (hourly → Stripe)
status: pending
priority: p0-critical
epic: P1B
persona: [ops]
depends_on: [P1B.03, P1B.04, P1B.06]
completed: null
```

#### User Story

As a platform operator, usage data flows from `prontiq-usage` to Stripe every hour via `subscriptionItems[product]` so that metered billing is accurate, idempotent, and no usage is lost across month boundaries.

#### Problem Statement

Hourly EventBridge-triggered Lambda. Per ARCHITECTURE.MD §5.6.2 (rewritten to fix the rotation double-count bug from PR #57 review #5):

- Reads `REGISTRY#active-keys` (one item)
- For each billable hash, recursively walks REDIRECT GSI to build the full attribution chain ([currentHash, ...predecessorHashes])
- Sums `requestCount` across the chain per product/month
- Compares to `currentHash.lastPushedCumulativeCount` ONLY (old hashes' pushed state is dead — including it would double-count)
- Pushes the cumulative count to Stripe via `createUsageRecord(itemId, { quantity: sumRequestCount, action: "set" })`
- After success, conditionally updates `currentHash.lastPushedCumulativeCount = sumRequestCount`

#### Definition of Done

##### Functional

- [ ] Scheduled Lambda runs hourly (EventBridge cron)
  - `Verify:` EventBridge rule exists
  - `Evidence:` SST config
- [ ] Reads `REGISTRY#active-keys` — targeted reads, not a scan
  - `Verify:` Lambda log shows single GetItem + BatchGet
  - `Evidence:` CloudWatch log
- [ ] For each billable key: BatchGet `prontiq-keys` for `subscriptionItems`; recursively walk `newHash-redirect-index` GSI to build the rotation chain (depth bounded by `MAX_CHAIN_DEPTH=10`); BatchGet `prontiq-usage` for `chain × {currentMonth, previousMonth}`
  - `Verify:` Integration test: rotate a key (A→B), make 50 requests against B, run cron; verify chain=[B,A] and Stripe usage record reflects 50 + A's previous-pushed cumulative
  - `Evidence:` Stripe usage record + Lambda log showing chain expansion
- [ ] **Cumulative push state is single-rooted on the current hash.** Field is `lastPushedCumulativeCount` (renamed from `lastPushedCount` for explicit semantics). Only `currentHash.lastPushedCumulativeCount` participates in the delta gate; old-hash counters are NOT summed.
  - `Verify:` Code review of the cron — the `currentLastPushed` variable reads from `chain[0]` only, never `chain[i] for i > 0`
  - `Evidence:` Unit test for the delta calculator
- [ ] Calculates `delta = sumRequestCount - currentLastPushed`; skips if `delta <= 0`. Negative delta → log WARN with chain dump; alarm after 3 consecutive negatives.
  - `Verify:` Unit test feeds chain with old-hash leftover state; assert delta is non-negative
- [ ] Calls `stripe.subscriptionItems.createUsageRecord(subscriptionItems[product], { quantity: sumRequestCount, action: "set" })` — pushes the **cumulative** count, not the delta
  - `Verify:` Inspect Stripe usage record after a cron run; quantity equals `sumRequestCount`
  - `Evidence:` Stripe → Billing → Meter usage
- [ ] **Conditional UpdateItem** on `prontiq-usage` SET `lastPushedCumulativeCount = sumRequestCount` ONLY IF `attribute_not_exists(lastPushedCumulativeCount) OR lastPushedCumulativeCount < :sumRequestCount`. Prevents clock-skew regression.
  - `Verify:` Re-running cron pushes equal cumulative (idempotent on Stripe due to `action: "set"`); no DDB write if value unchanged
  - `Evidence:` Lambda log shows "no-op" path for unchanged scopes
- [ ] **Rotation correctness test** (the case that broke the previous design):
  - T0: seed `pq_test_a` with requestCount=100, lastPushedCumulativeCount=100
  - T1: rotate A→B, REDIRECT(A→B), B with requestCount=0, lastPushedCumulativeCount=0
  - T2: 50 reqs against B → B.requestCount=50
  - T3: run cron. Assert: Stripe meter set to 150, B.lastPushedCumulativeCount=150
  - T4: 25 more reqs against B → B.requestCount=75
  - T5: run cron. Assert: Stripe meter set to 175 (NOT a negative delta), B.lastPushedCumulativeCount=175
  - `Evidence:` Integration test passes; demonstrates the §5.6.2 worked-example table
- [ ] **Multi-rotation test**: A→B→C, 10 reqs against C, verify cron walks chain=[C,B,A] and pushes correct cumulative
- [ ] DLQ (SQS) on failure; SNS alert after 3 consecutive failures OR any negative-delta observation
  - `Verify:` Disable Stripe connection; failures land in DLQ; SNS fires after 3rd. Manually corrupt a `lastPushedCumulativeCount` to be > requestCount; observe negative-delta alarm.
  - `Evidence:` SQS messages + SNS email
- [ ] Month boundary: first 6 hours of each month, process both current + previous month scopes

#### Scope

**In:** Hourly cron, targeted reads via registry, REDIRECT handling, idempotent writes, DLQ, SNS alerting

**Out — Do Not Implement:**

- Real-time billing → overkill
- Month-close finalisation → P1B.11

---

### Ticket P1B.11 — Month-close Lambda

```yaml
id: P1B.11
title: Month-close Lambda
status: pending
priority: p1-high
epic: P1B
persona: [ops]
depends_on: [P1B.10]
completed: null
```

#### User Story

As a platform operator, a dedicated Lambda finalises the previous month's usage at 00:30 UTC on day 1 so that Stripe invoices close cleanly and the hourly cron stops revisiting closed scopes.

#### Problem Statement

Stripe invoices finalise on the month boundary. Usage writes can arrive late (clock skew, retries). At 00:30 UTC on day 1, a dedicated Lambda sweeps previous-month scopes, pushes remaining deltas, sets `closed: true`. The hourly cron skips any scope with `closed: true`. See ARCHITECTURE.MD §5.6.2.

#### Definition of Done

##### Functional

- [ ] Scheduled Lambda runs monthly via EventBridge cron `30 0 1 * ? *` (UTC)
  - `Verify:` EventBridge rule exists
  - `Evidence:` SST config
- [ ] For each billable key, fetch previous-month `prontiq-usage` scope
- [ ] Push any remaining delta to Stripe
- [ ] UpdateItem SET `closed: true` on the scope
- [ ] Hourly cron (P1B.10) skips scopes with `closed: true`
  - `Verify:` Integration test: seed a closed scope with nonzero delta; hourly cron does not re-push
  - `Evidence:` Test assertion

#### Scope

**In:** Monthly finalisation Lambda, `closed` flag semantics

**Out — Do Not Implement:**

- Refund / correction flow → manual Stripe dashboard

---

### Ticket P1B.12 — Auth Middleware Integration Test

```yaml
id: P1B.12
title: Auth Middleware Integration Test
status: pending
priority: p1-high
epic: P1B
persona: [builder]
depends_on: [P1B.05, P1B.09, P1B.04b]
completed: null
```

#### User Story

As a builder, I need an integration test that verifies the full auth chain end-to-end against a real API key, the hash-based schema, and the burst limiter so that auth regressions are caught before deploy.

#### Problem Statement

Post-migration, auth middleware hashes the incoming key, looks up in `prontiq-keys`, falls back to REDIRECT, checks tier/product/quota/burst/paymentOverdue. The test must cover every error code in `packages/shared/src/constants.ts` ERROR_CODES (MISSING/INVALID/PRODUCT_NOT_ALLOWED/QUOTA_EXCEEDED/RATE_LIMITED) and the REDIRECT fallback. Error codes match live constants (`PRODUCT_NOT_ALLOWED`, not `PRODUCT_NOT_ENABLED`).

#### Definition of Done

##### Seed Script

- [ ] `scripts/seed-test-data.ts` creates test records in `prontiq-keys` + `prontiq-usage` with known hashes
  - `Verify:` `npx tsx scripts/seed-test-data.ts` exits 0
  - `Evidence:` Scan returns seeded records
- [ ] Seeds: `pq_test_valid` (free, address only), `pq_test_premium` (growth, all products), `pq_test_exhausted` (quota 0), `pq_test_overdue` (paymentOverdue=true)
- [ ] Idempotent: re-run is a no-op

##### Functional

- [ ] Valid key → 200 + rate-limit headers
  - `Verify:` `curl -H "X-Api-Key: pq_test_valid" .../v1/address/autocomplete?q=test`
  - `Evidence:` 200 with X-RateLimit-Remaining
- [ ] Missing key → 401 `MISSING_API_KEY`
- [ ] Unknown key → 401 `INVALID_API_KEY`
- [ ] Revoked key (active=false) → 401 `INVALID_API_KEY`
- [ ] Disallowed product → 403 `PRODUCT_NOT_ALLOWED`
- [ ] Quota exceeded (free) → 429 `QUOTA_EXCEEDED`
- [ ] Quota exceeded (paid) → 200 with `X-RateLimit-Over: true` header
- [ ] Burst exceeded → 429 `RATE_LIMITED` with `Retry-After` header (from P1B.09)
- [ ] paymentOverdue=true → 200 with `X-Payment-Overdue: true` header
- [ ] Rotated key (REDIRECT record, `authValidUntil` in future) → 200 (served via fallback lookup; quota counts against `newHash`)
  - `Verify:` Seed REDIRECT `{oldHash, "REDIRECT", newHash, authValidUntil = now + 5 min}`; hit API with old raw key
  - `Evidence:` Response 200; `prontiq-usage[newHash][product#month].requestCount` incremented (not on oldHash)
- [ ] **Rotated key, grace expired** (`authValidUntil` in past) → 401 `INVALID_API_KEY`
  - `Verify:` Seed REDIRECT with `authValidUntil = now - 1`; hit API with old raw key
  - `Evidence:` 401 even though `ttl` is still 90 days out
- [ ] **Rotated key, newHash revoked** → 401 `INVALID_API_KEY` (active check on redirected hash)
  - `Verify:` Seed REDIRECT pointing at a `pq_test_premium`-style record but flip `active: false`
  - `Evidence:` 401 — proves REVOKE-after-ROTATE closes the back-door without explicit REDIRECT cleanup
- [ ] **Atomic quota race** — fire 100 concurrent requests at a free-tier key with `quotaPerProduct = 50`; exactly 50 return 200, exactly 50 return 429 `QUOTA_EXCEEDED`
  - `Verify:` `Promise.all` of 100 concurrent fetches; count status codes
  - `Evidence:` `prontiq-usage[hash][product#month].requestCount === 50`. Proves the v2.2 §5.5.3 atomic conditional UpdateItem closes the race window vs the previous read-then-async-write design.
- [ ] **Webhook provisioning idempotency** (per new contract — webhook does NOT create keys; see P1B.05): replay the same Clerk `user.created` payload twice. Verify exactly:
  - 1 Stripe customer (Idempotency-Key dedup)
  - 1 `ORG#{orgId}` envelope row with `hasFirstKey: false`
  - 1 `ORG_PROVISIONED` audit row
  - **0 API-key rows** (no records that match the API-key shape for this org)
  - **0 calls to `generateKey` / `hashKey`** from the webhook code path (Vitest spy)
  - `Verify:` POST `/webhooks/clerk` with same Svix-signed body twice; assert all six conditions
  - `Evidence (schema-correct query — does NOT scan by hash prefix because `apiKeyHash` is a 64-char SHA-256 hex digest, not the raw key):`
    ```
    aws dynamodb query \
      --table prontiq-keys \
      --index-name orgId-index \
      --key-condition-expression "orgId = :org" \
      --filter-expression "NOT begins_with(apiKeyHash, :org_pfx) \
                           AND NOT begins_with(apiKeyHash, :reg_pfx) \
                           AND NOT begins_with(apiKeyHash, :prov_pfx) \
                           AND attribute_exists(keyPrefix) \
                           AND attribute_exists(active)" \
      --expression-attribute-values '{
        ":org":      {"S": "<test-org-id>"},
        ":org_pfx":  {"S": "ORG#"},
        ":reg_pfx":  {"S": "REGISTRY#"},
        ":prov_pfx": {"S": "PROVISION#"}
      }'
    ```
    Items in the result set MUST be 0. The filter excludes sentinel rows (ORG envelope, REGISTRY, legacy PROVISION lock if any) and requires the v2.2 API-key shape (`keyPrefix` + `active` attributes both present), so a malformed or partial key write is also caught. Plus: Stripe Dashboard customer count = 1; jest spy on `generateKey` records 0 calls.

> The first-key creation idempotency assertions live in **P1C.03** (the ticket that owns `POST /v1/account/keys/create`). Originally drafted here with a fallback "use a temporary endpoint stub" — but that would push the integration test to either (a) build throwaway API surface, or (b) test against a different code path than production. Cleaner: P1C.03 is the natural home, P1B.12 stays focused on auth middleware behavior using seeded post-cutover key records.
- [ ] Usage counter increments only on successful quota check (no orphan increments on 4xx responses)
- [ ] `prontiq-audit` unchanged by read-only paths (no writes from VERIFY)

##### Testing

- [ ] `pnpm --filter @prontiq/api test:integration` runs against real DynamoDB and OpenSearch

#### Scope

**In:** Full integration test covering every error code + REDIRECT + quota overage + burst limiter + paymentOverdue

**Out — Do Not Implement:**

- Load testing → future
- Key rotation flow test → P1C.03 ticket

---

## Phase 1C — Dashboard

> **Goal:** Developer portal with sign-up, key display, usage, billing, and playground.
>
> **Dependency:** P1C.07 (shadcn/ui) should be done first as all pages depend on it. P1C.01-06 are independent after that.

---

### Ticket P1C.01 — Landing Page with Autocomplete Demo

```yaml
id: P1C.01
title: Landing Page with Autocomplete Demo
status: pending
priority: p0-critical
epic: P1C
persona: [visitor]
depends_on: [P1A.02, P1D.05, P1C.07]
completed: null
```

#### User Story

As a visitor, I see a hero autocomplete demo that works live so that I immediately understand the product's value and want to sign up.

#### Problem Statement

The landing page IS the product pitch. A live autocomplete demo (type an address, see enriched results in real-time) is worth more than any marketing copy. The `<prontiq-address>` web component powers the demo. Below: pricing table (Stripe embedded), "Get Started Free" (Clerk sign-up). The page must be fast, mobile-responsive, and convert visitors to sign-ups.

#### Definition of Done

##### Functional

- [ ] `<prontiq-address>` web component embedded on landing page
  - `Verify:` Landing page renders autocomplete input
  - `Evidence:` Component visible, functional
- [ ] Live autocomplete against real API (uses demo key)
  - `Verify:` Type "9 endeavour" → suggestions appear from G-NAF data
  - `Evidence:` Real address data, not mocked
- [ ] Pricing table below hero (Stripe embedded pricing table)
  - `Verify:` Free / Starter / Growth plans visible with prices
  - `Evidence:` Stripe pricing table renders correctly
- [ ] "Get Started Free" button → Clerk sign-up modal
  - `Verify:` Click button → Clerk modal appears
  - `Evidence:` Sign-up flow works end-to-end
- [ ] Mobile-responsive
  - `Verify:` Test at 375px, 768px, 1280px widths
  - `Evidence:` Layout adapts correctly at all breakpoints

#### Scope

**In:** Landing page, hero demo, pricing table, sign-up CTA, responsive design

**Out — Do Not Implement:**

- SEO optimization → future
- Analytics/tracking → future
- Marketing copy refinement → ongoing

---

### Ticket P1C.02 — Dashboard Overview Page

```yaml
id: P1C.02
title: Dashboard Overview Page
status: pending
priority: p0-critical
epic: P1C
persona: [api-consumer]
depends_on: [P1B.04, P1B.05, P1C.07]
completed: null
```

#### User Story

As a logged-in developer, I see my API key, usage summary, and quick-start code snippets so that I can start using the API within 60 seconds of signing up.

#### Definition of Done

##### Functional

- [ ] API key displayed (masked by default, click to reveal, click to copy)
  - `Verify:` Key shows as `pq_live_****...****`; click reveals full key
  - `Evidence:` Clipboard API copies key
- [ ] Usage chart showing current month's usage across all products
  - `Verify:` Chart renders with bars/lines per product
  - `Evidence:` Data from DynamoDB usage counters
- [ ] Current plan name and quota remaining displayed
  - `Verify:` Shows "Free Plan — 4,200 / 5,000 requests remaining"
  - `Evidence:` Calculated from key metadata
- [ ] Quick-start code snippets with key pre-filled (curl, TypeScript, Python)
  - `Verify:` Snippets include the user's actual API key
  - `Evidence:` Copy button works; snippet is runnable
- [ ] Upgrade nudge banner when > 80% quota used
  - `Verify:` Seed key at 85% usage; banner appears
  - `Evidence:` "Upgrade to Starter for 10,000 requests/month" message

#### Scope

**In:** Overview dashboard, key display, usage chart, quick-start, upgrade nudge

**Out — Do Not Implement:**

- Multi-key management → P1C.03
- Detailed per-product usage charts → P1C.04
- Billing management → P1C.05

---

### Ticket P1C.03 — API Key Management Page

```yaml
id: P1C.03
title: API Key Management Page (incl. first-key flow)
status: pending
priority: p1-high
epic: P1C
persona: [api-consumer]
depends_on: [P1B.02, P1B.04b, P1B.05, P1C.07]
completed: null
tech_stack:
  ui: Next.js 15 + shadcn/ui
  keys: @prontiq/api account endpoints (DDB-backed, see ARCHITECTURE.MD §7.3)
```

#### User Story

As a new developer, my **first** API key is created from `/account` (not via webhook email). The raw key shows once in the response. As a returning developer, I can view, create, rotate, and revoke keys for different environments / team members.

#### Problem Statement

Per ARCHITECTURE.MD §5.7.1 + §10 Developer Journey (rewritten in PR #57 review #3 to address Bug 5), the **first** API key is minted by the user-driven `/v1/account/keys/create` call — not by the Clerk webhook. The webhook only provisions the org envelope (Stripe customer + `ORG#{orgId}` record). This is because hash-only key storage means a server-minted key with no in-flight HTTP response to the user is unrecoverable on SES failure.

The "first" and "Nth" key creation use the **same code path** — there is no special first-time logic. The `hasFirstKey` flag on the org envelope flips to `true` on the first successful create.

Key rotation must be atomic (TransactWrite swap) with a REDIRECT record per §5.5.1 (split auth grace `authValidUntil = 5 min` and billing attribution `ttl = 90d`). REVOKE-after-ROTATE is naturally handled by the active-flag check on the redirected hash — no explicit REDIRECT cleanup needed (§5.5.2). Sensitive actions (rotate, revoke) require Clerk step-up re-authentication per §5.9.2.

#### Definition of Done

##### Functional — First-Key Flow

- [ ] On first visit to `/account`: detect `ORG#{orgId}.hasFirstKey === false` → render "Create your first API key" CTA (instead of empty key list). If `ORG#{orgId}` does not exist (Clerk webhook missed): render "Set up your account" CTA which calls `POST /v1/account/setup` (P1B.05 recovery endpoint).
  - `Verify:` Sign up a new test user; observe `/account` shows "Create your first API key" button; click it; raw key appears in modal; refresh page; key list now shows masked prefix
  - `Evidence:` UI screenshot + DDB record diff
- [ ] **Missing-ORG recovery UI** (per PR #59 review #6 Bug 12 — moved here from P1B.05 because UI verification belongs to the ticket that owns the dashboard): if `/account` detects no `ORG#{orgId}` envelope (Clerk webhook missed entirely), render "Set up your account" CTA that calls `POST /v1/account/setup` (P1B.05 endpoint). After the call returns, transition to "Create your first API key" CTA.
  - `Verify:` Manually delete `ORG#{orgId}` for a test user; sign in to `/account`; assert "Set up your account" button is visible. Click it. Assert the page transitions to the first-key CTA after `POST /v1/account/setup` returns.
  - `Evidence:` E2E UI test (Playwright or similar)
- [ ] **First-key creation idempotency** (covers what used to be in P1B.12; moved here per PR #59 review #5 Bug 8 — assertions belong in the ticket that owns the endpoint). Call `POST /v1/account/keys/create` against a freshly-provisioned test user. Verify exactly:
  - 1 `prontiq-keys/{apiKeyHash}` row created
  - `ORG#{orgId}.hasFirstKey` flips `false → true` atomically (in the same `TransactWriteItems` as the key insert)
  - 1 `CREATE` audit row
  - Raw key returned ONLY in the response body — never persisted, never logged
  - On simulated `TransactWriteItems` failure on first attempt then retry: still exactly 1 key row, 1 audit row, no leaked or duplicated raw keys
  - Concurrent `POST /v1/account/keys/create` calls from the same org race-test: both succeed (each gets a different raw key); `ORG#{orgId}.hasFirstKey` ends as `true`; key count = 2
  - `Verify:` Three integration tests against the real `/v1/account/keys/create` route (no stubs):
    - (a) Single create → assert all five conditions
    - (b) Inject DDB throttle → retry succeeds → assert same five conditions, no orphan rows
    - (c) Two concurrent calls → both 201, two distinct raw keys, two distinct hash rows, hasFirstKey=true
  - `Evidence:` Vitest output + DDB scan results in test log

##### Functional — Key Management

- [ ] List all org keys via `GET /v1/account/keys` (DDB GSI on `orgId-index` with **`FilterExpression: "attribute_exists(keyPrefix) AND attribute_exists(active)"`** — sentinel guard per ARCHITECTURE.MD §5.5.1, prevents the ORG envelope from leaking into the response) with masked prefix, creation date, last-used timestamp, product scopes
  - `Verify:` `/account` keys tab loads with table of keys
  - `Evidence:` Table renders with real DDB data; raw key and hash never returned
- [ ] Create new key via `POST /v1/account/keys/create` (generates via `generateKey()` from P1B.02, hashes, TransactWriteItems: PutItem to `prontiq-keys` + UpdateItem `ORG#{orgId}` SET `hasFirstKey: true` + audit CREATE, returns raw key once in response body)
  - `Verify:` Click "Create Key" → new key shown once in modal; reload page hides raw key; only masked prefix in list. `ORG#{orgId}.hasFirstKey === true` after first call.
  - `Evidence:` DDB record created; response body has `{keyId, raw, createdAt}`
- [ ] Rotate key via `POST /v1/account/keys/rotate` (requires Clerk step-up; TransactWriteItems: delete old + put new + write REDIRECT with `authValidUntil = now + 5 min` and `ttl = now + 90d` + audit ROTATE; returns new raw key once)
  - `Verify:` Click "Rotate" → step-up modal → new key shown once; (a) within 5 min, request with old raw key succeeds via REDIRECT path; (b) after 5 min, request with old raw key returns 401 even though `ttl` is still 90d out (auth grace expired)
  - `Evidence:` REDIRECT item with both clocks present in `prontiq-usage`; integration test covers grace-active and grace-expired
- [ ] Revoke key via `POST /v1/account/keys/revoke` (requires Clerk step-up; UpdateItem `active: false`; audit REVOKE; **does NOT touch REDIRECT records** — see §5.5.2 / §12.3 for why active-flag check naturally handles REVOKE-after-ROTATE)
  - `Verify:` Click "Revoke" → confirmation dialog with step-up → key returns 401 on next API call. Separately: rotate key A → B, then revoke B; request with old raw A returns 401 (re-resolved through REDIRECT, fails active check on B)
  - `Evidence:` DDB record shows `active: false`; integration test covers REVOKE-after-ROTATE
- [ ] Audit trail visible on the page (last 10 lifecycle events from `prontiq-audit`)
  - `Verify:` Each action (create, rotate, revoke) appears with actor, timestamp, IP
  - `Evidence:` `prontiq-audit` query
- [ ] Key limits enforced per tier (Free 2, Starter 5, Growth 20, Enterprise unlimited) — GSI count query against `orgId-index` with **`FilterExpression: "attribute_exists(keyPrefix) AND attribute_exists(active)"`** before PutItem (sentinel guard prevents the ORG envelope from eating one of the user's quota slots)
  - `Verify:` Two tests: (a) Attempt 3rd key on Free tier → 403 `KEY_LIMIT_EXCEEDED`; (b) Verify the ORG envelope row is NOT counted — sign up + immediately try to create 2 keys on Free tier; both succeed (envelope doesn't count as a key)
  - `Evidence:` Error response on (a); 2 successful creates on (b) proving sentinel filter works

#### Scope

**In:** Key CRUD via `/v1/account/keys/*` endpoints, Clerk step-up for rotate/revoke, audit trail display, key-limit enforcement

**Out — Do Not Implement:**

- Sandbox (`pq_test_`) keys → future (single prefix today per ADR-001)
- Per-key rate limit customization → future
- Key expiration dates → future
- IP allowlisting per key → future

---

### Ticket P1C.04 — Usage Charts Page

```yaml
id: P1C.04
title: Usage Charts Page
status: pending
priority: p1-high
epic: P1C
persona: [api-consumer]
depends_on: [P1C.07]
completed: null
tech_stack:
  ui: Next.js 15 + shadcn/ui
  charts: Recharts
  data: DynamoDB usage counters
```

#### User Story

As a developer, I see per-product usage over time so that I can understand my consumption patterns, predict costs, and identify anomalies.

#### Problem Statement

Usage data lives in DynamoDB as atomic counters (per-key, per-product, per-month). The dashboard needs to query these counters, aggregate across keys (for org-level view), and render time-series charts. Daily granularity requires storing daily snapshots — the current schema only tracks monthly totals. Either add daily counters to DynamoDB or derive daily from hourly Stripe usage records.

#### Definition of Done

##### Functional

- [ ] Per-product usage charts with daily/weekly/monthly granularity toggle
  - `Verify:` Select "Daily" → chart shows per-day bars for current month
  - `Evidence:` Chart renders with real data, responsive to granularity change
- [ ] Data sourced from DynamoDB usage counters
  - `Verify:` Make 10 API calls, refresh usage page, count increases by 10
  - `Evidence:` Real-time data reflection (within 1 minute)
- [ ] Export CSV functionality
  - `Verify:` Click "Export CSV" → file downloads with usage data
  - `Evidence:` CSV contains columns: date, product, count
- [ ] Recharts (or equivalent) charting library integrated
  - `Verify:` Charts render as interactive SVG with tooltips
  - `Evidence:` Hover shows exact count per bar/point

#### Scope

**In:** Usage visualization, granularity toggle, CSV export, Recharts

**Out — Do Not Implement:**

- Real-time streaming usage (WebSocket) → future
- Org-level aggregation across multiple keys → P3.03 (team management)
- Cost projections → future

---

### Ticket P1C.05 — Billing Page

```yaml
id: P1C.05
title: Billing Page
status: pending
priority: p1-high
epic: P1C
persona: [api-consumer]
depends_on: [P1B.03, P1C.07]
completed: null
tech_stack:
  billing: Stripe embedded customer portal
```

#### User Story

As a developer, I manage my subscription, update payment methods, and view invoices without leaving the dashboard so that billing is self-service with zero support tickets.

#### Problem Statement

Stripe's embedded customer portal handles 90% of billing needs out of the box: plan changes, payment method updates, invoice history, cancellation. Building this custom would take weeks and introduce PCI compliance scope. The embedded portal is a single `<stripe-pricing-table>` element plus a "Manage Billing" link to the hosted portal. Total code: ~20 lines.

#### Definition of Done

##### Functional

- [ ] Stripe embedded customer portal accessible from "Manage Billing" button
  - `Verify:` Click "Manage Billing" → Stripe portal opens (same tab or new tab)
  - `Evidence:` Portal shows plan, payment method, invoices
- [ ] Plan management: upgrade from Free → Starter → Growth
  - `Verify:` Upgrade in portal → Stripe webhook updates `prontiq-keys` (tier, quota, subscriptionItems); next API request reflects the new limits
  - `Evidence:` API returns 200 for products previously blocked on free tier
- [ ] Payment method update
  - `Verify:` Add/change card in portal → card updated in Stripe
  - `Evidence:` Stripe dashboard shows new payment method
- [ ] Invoice history and receipts
  - `Verify:` Portal shows past invoices with download links
  - `Evidence:` PDF invoices downloadable
- [ ] Cancel subscription flow with confirmation
  - `Verify:` Cancel → confirmation prompt → subscription cancelled at period end
  - `Evidence:` Stripe shows "Canceled" status; key downgrades to free tier limits

#### Scope

**In:** Stripe embedded portal, plan changes, invoices, cancellation

**Out — Do Not Implement:**

- Custom pricing page (Stripe hosted handles this) → use embedded pricing table
- Custom invoice generation → Stripe handles this
- Enterprise custom billing → future

---

### Ticket P1C.06 — Playground Page

```yaml
id: P1C.06
title: Playground Page
status: pending
priority: p2-value
epic: P1C
persona: [api-consumer]
depends_on: [P1A.01, P1C.07]
completed: null
tech_stack:
  ui: Next.js 15 + shadcn/ui
  spec: OpenAPI 3.1 (drives endpoint/parameter discovery)
```

#### User Story

As a developer, I can try any API endpoint with my key in the browser so that I can explore the API interactively before writing integration code.

#### Problem Statement

Mintlify has playgrounds too (P1D.01), but the dashboard playground is pre-authenticated with the user's key — no copy-paste needed. The playground reads the OpenAPI spec to auto-generate forms for each endpoint's parameters. This is the "aha moment" — developers see real data from their first API call without leaving the browser.

#### Definition of Done

##### Functional

- [ ] Endpoint selector dropdown (autocomplete, validate, enrich, reverse, lookup/postcode, lookup/suburb)
  - `Verify:` Dropdown lists all 6 address endpoints
  - `Evidence:` Populated from OpenAPI spec or hardcoded list
- [ ] Parameter input fields auto-generated per endpoint
  - `Verify:` Select "autocomplete" → shows `q` (required), `state` (optional), `limit` (optional)
  - `Evidence:` Fields match OpenAPI spec parameters
- [ ] "Send" button makes live API call with user's pre-filled key
  - `Verify:` Click Send → request fires with user's API key → response appears
  - `Evidence:` Real data returned from OpenSearch
- [ ] JSON response viewer with syntax highlighting
  - `Verify:` Response JSON renders with colors for strings, numbers, keys
  - `Evidence:` Uses a JSON viewer component (e.g., react-json-view or custom)
- [ ] Response time displayed
  - `Verify:` Shows "Responded in 32ms" below the response
  - `Evidence:` Measured client-side (Date.now diff)
- [ ] Copy curl command button
  - `Verify:` Click "Copy curl" → clipboard contains a runnable curl command with the user's key
  - `Evidence:` Paste into terminal → same response

#### Scope

**In:** Interactive API explorer, all address endpoints, pre-authenticated, curl export

**Out — Do Not Implement:**

- Request history / saved queries → future
- WebSocket streaming → future
- Response schema validation → future

---

### Ticket P1C.07 — shadcn/ui Component Library Setup

```yaml
id: P1C.07
title: shadcn/ui Component Library Setup
status: pending
priority: p0-critical
epic: P1C
persona: [builder]
depends_on: [P0.02]
completed: null
tech_stack:
  ui: shadcn/ui + Tailwind CSS v4
  framework: Next.js 15
```

#### User Story

As a builder, I need a consistent component library so that all `/account` tabs share the same design system and I don't reinvent UI primitives.

#### Problem Statement

The `/account` page (ARCHITECTURE.MD §5.9) wraps Clerk's `<UserProfile />` with custom tabs for Usage, Billing, and API Keys. Each tab needs consistent UI primitives (buttons, tables, dialogs). shadcn/ui provides accessible, composable components built on Radix UI + Tailwind. It's not a dependency — components are copied into the project and can be customized. Lives in `packages/web/` (new package introduced by P1C).

#### Definition of Done

##### Functional

- [ ] Tailwind CSS v4 configured in the web package
  - `Verify:` `pnpm --filter @prontiq/web dev` → Tailwind classes apply correctly
  - `Evidence:` `packages/web/tailwind.config.ts` or CSS `@import` exists
- [ ] shadcn/ui initialized with core components
  - `Verify:` `ls packages/web/components/ui/` shows component files
  - `Evidence:` Button, Card, Input, Table, Dialog, Sheet, Tabs, Badge, Skeleton present
- [ ] Dark mode support (system preference + manual toggle)
  - `Verify:` Toggle dark mode → all components switch themes
  - `Evidence:` `ThemeProvider` wrapper in layout, `class="dark"` applied to `<html>`
- [ ] `/account` page layout — sidebar-lite (Clerk `<UserProfile />` with custom tabs per ARCHITECTURE.MD §5.9.1)
  - `Verify:` `/account` renders with tabs for Profile / Security / Usage / Billing / API Key
  - `Evidence:` Clerk profile wrapper with custom tab components
- [ ] Responsive: sidebar collapses to bottom nav or hamburger on mobile
  - `Verify:` Resize to 375px → sidebar becomes hamburger/bottom nav
  - `Evidence:` Working at mobile breakpoint

#### Scope

**In:** Component library init, layout shell, dark mode, responsive sidebar

**Out — Do Not Implement:**

- Custom branded theme (colors, fonts) → future (shadcn defaults for MVP)
- Animation library → future
- Custom icon set → use Lucide icons (bundled with shadcn)

---

## Phase 1D — Docs & SDK

> **Goal:** Beautiful docs and typed SDK, both auto-generated from the OpenAPI spec.
>
> **Dependency:** P1D.01-03 depend on P1A.01 (OpenAPI spec). P1D.04 depends on P1A.01. P1D.05 is independent.

---

### Ticket P1D.01 — Mintlify Docs Site

```yaml
id: P1D.01
title: Mintlify Docs Site
status: complete
priority: p0-critical
epic: P1D
persona: [api-consumer]
depends_on: [P1A.01]
completed: 2026-04-13
```

#### Problem Statement

This ticket sets up the Mintlify infrastructure — not the content. Mintlify reads the OpenAPI spec (from P1A.01) and auto-generates API reference pages with interactive playgrounds. The navigation skeleton and custom domain are configured here. Actual prose content (Getting Started guide, tutorials) is P1D.02-03.

#### Current Evidence

Mintlify is connected to the repository with monorepo docs root `/packages/docs`. The docs site is live at `docs.prontiq.dev` and deploys from `main`. The current checked-in config uses `packages/docs/docs.json` and intentionally exposes only the active Address product until the generated OpenAPI reference is wired into Mintlify.

#### Definition of Done

- [ ] Mintlify Hobby plan activated with OpenAPI spec import from `/openapi.json`
  - `Verify:` Mintlify dashboard shows synced spec with all address endpoints
  - `Evidence:` Mintlify dashboard URL
- [x] Navigation skeleton created: Getting Started and Address Validation
  - `Verify:` `docs.json` navigation includes only current active docs
  - `Evidence:` `packages/docs/docs.json`
- [ ] Interactive playground on each auto-generated endpoint page
  - `Verify:` Click "Try It" on /v1/address/autocomplete page
  - `Evidence:` Playground sends real request
- [x] Custom domain: `docs.prontiq.dev`
  - `Verify:` `curl https://docs.prontiq.dev` returns docs site
  - `Evidence:` DNS + Mintlify custom domain configured; MCP endpoint reachable at `https://docs.prontiq.dev/mcp`
- [x] Deploys on push to main (Mintlify Git integration)
  - `Verify:` Edit a docs page, push, site updates
  - `Evidence:` PR #14 Mintlify Deployment check passed after merging `packages/docs/docs.json`

#### Scope

**In:** Mintlify infrastructure, OpenAPI import, navigation skeleton, domain, deploy pipeline

**Out — Do Not Implement:**

- Getting Started prose content → P1D.02
- Per-endpoint documentation prose → P1D.03
- SDK documentation → P1D.04

---

### Ticket P1D.02 — Getting Started Guide

```yaml
id: P1D.02
title: Getting Started Guide
status: pending
priority: p0-critical
epic: P1D
persona: [api-consumer]
depends_on: [P1D.01]
completed: null
```

#### User Story

As a developer, I go from zero to first API call in < 5 minutes following the Getting Started guide.

#### Problem Statement

The Getting Started guide is the highest-traffic page on any API docs site. If a developer can't make their first call within 5 minutes of reading it, they bounce. The guide must cover the complete flow: sign up → get key → first curl → first SDK call. Authentication, rate limits, and error handling are separate pages but linked from the quick start.

#### Definition of Done

##### Functional

- [ ] Quick start page: sign up → get key → first curl → first SDK call
  - `Verify:` Follow the guide as a new user. Time from start to first successful API call < 5 minutes.
  - `Evidence:` Guide tested end-to-end by someone who hasn't used the API
- [ ] Authentication guide (X-Api-Key header, error codes 401/403)
  - `Verify:` Page explains header format, shows error responses for missing/invalid keys
  - `Evidence:` Code examples for curl, fetch, SDK
- [ ] Rate limits & quotas page with per-tier breakdown table
  - `Verify:` Table matches `PLANS` in `packages/shared/src/constants.ts` (per ARCHITECTURE.MD §5.6.1)
  - `Evidence:` Free: 5K/mo, Starter: 10K/mo, Growth: 50K/mo per product; rate limit rows per tier (10/50/100 req/sec)
- [ ] Error handling guide (all error codes per ARCHITECTURE.MD §9, retry logic, request_id tracing)
  - `Verify:` All live-today codes documented; forward-contract codes marked as "introduced in P1B.09 / P1C / etc."
  - `Evidence:` Live: `MISSING_API_KEY`, `INVALID_API_KEY`, `PRODUCT_NOT_ALLOWED`, `QUOTA_EXCEEDED`. Forward: `RATE_LIMITED`, `KEY_LIMIT_EXCEEDED`, `UNAUTHORIZED`, `ORG_REQUIRED`, `INVALID_SIGNATURE`, `VALIDATION_ERROR`, `SERVICE_UNAVAILABLE`, `INTERNAL_ERROR`

#### Scope

**In:** Quick start, authentication, rate limits, error handling pages

**Out — Do Not Implement:**

- Per-endpoint API reference (auto-generated from spec) → P1D.03
- SDK installation/usage guide → P1D.04
- Tutorials/cookbooks → future

---

### Ticket P1D.03 — Address API Documentation

```yaml
id: P1D.03
title: Address API Documentation
status: pending
priority: p0-critical
epic: P1D
persona: [api-consumer]
depends_on: [P1D.01, P1A.02]
completed: null
```

#### User Story

As a developer, I find per-endpoint documentation with request parameters, response schemas, and runnable code examples so that I can integrate each endpoint correctly.

#### Problem Statement

Mintlify auto-generates API reference from the OpenAPI spec (P1D.01), but the auto-generated pages lack context: when to use autocomplete vs validate, what confidence levels mean, how to interpret boundary data. P1D.03 adds human-written prose alongside the auto-generated reference — descriptions, use cases, field explanations, and SDK examples.

#### Definition of Done

##### Functional

- [ ] Per-endpoint pages: autocomplete, validate, enrich, reverse, lookup/postcode, lookup/suburb
  - `Verify:` Navigate to each endpoint page in docs
  - `Evidence:` 6 pages with human-written descriptions + auto-generated reference
- [ ] Request parameters table with types, constraints, and descriptions
  - `Verify:` Each param has type, required/optional, min/max, description
  - `Evidence:` Auto-generated from OpenAPI + human-written descriptions
- [ ] Response schema with field descriptions (especially boundary fields)
  - `Verify:` Response fields documented: what `confidence` means, what `boundaries.lga` contains
  - `Evidence:` Human-written explanations for non-obvious fields
- [ ] Code examples: curl, TypeScript SDK, Python SDK per endpoint
  - `Verify:` Examples are runnable (correct params, correct key placeholder)
  - `Evidence:` Copy-paste curl works against live API
- [ ] Live playground per endpoint (Mintlify built-in)
  - `Verify:` Click "Try It" → form pre-populated → response appears
  - `Evidence:` Real API call executed from docs page

#### Scope

**In:** Per-endpoint prose docs, field descriptions, code examples, playground

**Out — Do Not Implement:**

- Tutorials/cookbooks (e.g., "Build an address form") → future
- Video walkthroughs → future

---

### Ticket P1D.04 — Speakeasy TypeScript SDK

```yaml
id: P1D.04
title: Speakeasy TypeScript SDK
status: complete
priority: p1-high
epic: P1D
persona: [api-consumer]
depends_on: [P1A.01]
completed: 2026-04-13
tech_stack:
  sdk: Speakeasy (free tier: 1 SDK, 50 methods)
  publish: npm
  ci: GitHub Actions
```

#### User Story

As a developer, `npm install @prontiq/sdk` gives me a fully typed client so that I can integrate the API with zero boilerplate and full IDE autocompletion.

#### Problem Statement

Hand-written SDK clients drift from the API. Speakeasy auto-generates from the OpenAPI spec — type-safe, well-documented, published to npm. The free tier supports 1 SDK with up to 50 methods, which covers all Phase 1-3 endpoints (address: 6, ABN: 3, LEI: 2 = 11 methods). The GitHub Action regenerates on spec change and publishes automatically.

#### Definition of Done

##### Functional

- [ ] Speakeasy configured with OpenAPI spec from `/openapi.json`
  - `Verify:` `speakeasy generate` produces TypeScript client
  - `Evidence:` Generated SDK in a separate repo or `sdks/typescript/` directory
- [ ] SDK published to npm as `@prontiq/sdk`
  - `Verify:` `npm view @prontiq/sdk` returns package info
  - `Evidence:` Published with version matching OpenAPI spec version
- [ ] Namespaced: `prontiq.address.autocomplete()`, `prontiq.address.validate()`, etc.
  - `Verify:` Import SDK, check `prontiq.address` namespace has all 6 methods
  - `Evidence:` TypeScript IntelliSense shows methods with typed params
- [ ] TypeScript types for all request params and response shapes
  - `Verify:` `const result = await prontiq.address.autocomplete({ q: "9 endeavour" })` — `result.suggestions` is typed
  - `Evidence:` Type errors on wrong param names; autocompletion on response fields
- [ ] GitHub Action regenerates on OpenAPI spec change (`.github/workflows/generate-sdks.yml`)
  - `Verify:` Change a route schema → push → SDK regenerated and published
  - `Evidence:` Workflow run in GitHub Actions tab
- [ ] README with usage examples (install, init, call each endpoint)
  - `Verify:` README in npm package contains working examples
  - `Evidence:` Examples match current API version

#### Scope

**In:** Speakeasy config, TypeScript SDK generation, npm publish, CI pipeline

**Out — Do Not Implement:**

- Python SDK → P5.04 (when all products are live)
- PHP/Go/Ruby SDKs → future
- SDK changelog automation → future

---

### Ticket P1D.05 — `<prontiq-address>` Web Component

```yaml
id: P1D.05
title: <prontiq-address> Web Component
status: pending
priority: p1-high
epic: P1D
persona: [api-consumer]
depends_on: [P1A.02]
completed: null
tech_stack:
  ui: Custom Elements (Web Components API)
  build: esbuild or Vite library mode
  cdn: cdn.prontiq.dev (S3 + CloudFront)
```

#### User Story

As a developer, I embed address autocomplete in any frontend with one `<script>` tag so that I don't need to build autocomplete UI from scratch.

#### Problem Statement

The web component is three things: (1) the hero demo on the landing page that converts visitors, (2) a drop-in integration for developers who don't want to build UI, (3) the engine inside the Shopify and WooCommerce plugins. It must be framework-agnostic (works in React, Vue, vanilla HTML), lightweight (< 20KB gzipped), and customizable (CSS custom properties for styling).

#### Definition of Done

##### Functional

- [ ] Custom element: `<prontiq-address api-key="..." on-select="...">`
  - `Verify:` Add to an HTML page → renders input field with autocomplete dropdown
  - `Evidence:` Component visible and functional
- [ ] Renders autocomplete input with dropdown suggestions
  - `Verify:` Type "9 endeavour" → dropdown shows matching addresses
  - `Evidence:` Suggestions from real API data
- [ ] Calls `/v1/address/autocomplete` on input (debounced 200ms)
  - `Verify:` Network tab shows requests only after 200ms pause
  - `Evidence:` No request spam while typing
- [ ] Fires `select` custom event with full address object
  - `Verify:` `element.addEventListener("select", (e) => console.log(e.detail))` logs address
  - `Evidence:` Event detail contains `id`, `addressLabel`, `localityName`, `state`, `postcode`
- [ ] Published to CDN: `cdn.prontiq.dev/address-widget.js`
  - `Verify:` `<script src="https://cdn.prontiq.dev/address-widget.js"></script>` loads
  - `Evidence:` Script loads, component registers
- [ ] Works in React, Vue, and vanilla HTML
  - `Verify:` Test in each framework — component renders and events fire
  - `Evidence:` 3 test pages (React, Vue, HTML)
- [ ] Used on landing page hero demo (P1C.01)
  - `Verify:` Landing page embeds the component
  - `Evidence:` Live autocomplete on prontiq.dev

#### Scope

**In:** Web Component, CDN publish, debounced API calls, select event, framework-agnostic

**Out — Do Not Implement:**

- Address form auto-fill (populate separate fields) → future enhancement
- Styling customization beyond CSS custom properties → future
- Offline/cached suggestions → future

---

## Phase 1E — Ingestion (Phase 1)

> **Goal:** G-NAF data flows from flat-white pipeline → S3 → OpenSearch. Automated pipeline: S3 manifest upload → EventBridge → Router Lambda → Step Function (Lambda + Fargate). Manual CLI (`manual-run.ts`) available for operator overrides.

---

### Ticket P1E.01 — flat-white Manifest Output (Cross-Repo)

```yaml
id: P1E.01
title: flat-white Manifest Output (Cross-Repo)
status: complete
priority: p0-critical
epic: P1E
persona: [builder]
depends_on: []
completed: 2026-04-13
note: "CROSS-REPO TICKET — work happens in jbejenar/flat-white, not prontiq-platform"
```

#### User Story

As a builder, I need the flat-white pipeline to produce manifests conforming to the platform contract so that the ingestion system can index address data automatically.

#### Problem Statement

The flat-white pipeline currently outputs NDJSON files to S3 but doesn't produce a manifest.json in the format the platform expects (see ARCHITECTURE.MD section 5.1.2). This ticket tracks the changes needed in the **flat-white repo** — it's a coordination ticket, not internal work. The prontiq-platform side verifies the output conforms to the schema.

#### Definition of Done

> **Note:** These DoD items are completed in the `jbejenar/flat-white` repo, not here. Mark as done when verified from this repo's perspective.

- [x] flat-white pipeline updated to output `manifests/address-{version}.json` to S3
  - `Verify:` `aws s3 ls s3://flat-white-address-493712557159-ap-southeast-2-an/manifests/`
  - `Evidence:` Manifest file exists with correct naming convention
- [x] Manifest conforms to `manifestSchema` (Zod validation passes for v1 or v2)
  - `Verify:` Download manifest, run `manifestSchema.parse()` from @prontiq/shared
  - `Evidence:` Validation passes without errors. v2 manifests include `index.source_keys`.
- [x] Per-version `mappings.json` at `data/address/{version}/mappings.json`
  - `Verify:` `aws s3 ls s3://.../data/address/{version}/mappings.json`
  - `Evidence:` File exists
- [x] All NDJSON files uploaded with `ChecksumAlgorithm: SHA256`
  - `Verify:` `aws s3api head-object` returns `ChecksumSHA256` header
  - `Evidence:` Header present on each NDJSON file
- [x] `location` geo_point field added to each document (from `geocode.latitude`/`longitude`)
  - `Verify:` `head -1 data/address/{version}/vic.ndjson | jq .location`
  - `Evidence:` `{"lat": -37.93, "lon": 145.02}`

#### Scope

**In:** Verification that flat-white output conforms to manifest contract (work done in flat-white repo)

**Out — Do Not Implement (in this repo):**

- flat-white pipeline code changes (done in jbejenar/flat-white)
- Initial index creation (that's what P1E.03 does when the first manifest triggers ingestion)

---

### Ticket P1E.02 — GitHub Actions Cron Ingestion

```yaml
id: P1E.02
title: GitHub Actions Cron Ingestion
status: complete
priority: p0-critical
epic: P1E
persona: [ops]
depends_on: [P1E.01, P0.06]
completed: 2026-04-13
tech_stack:
  ci: GitHub Actions
  auth: OIDC → S3 + OpenSearch
```

#### User Story

As a platform operator, a GitHub Action checks for new manifests daily and triggers ingestion so that data updates flow automatically without manual intervention.

#### Problem Statement

Phase 1 uses GitHub Actions cron instead of EventBridge + Step Functions (that's P2.04). Simpler to implement, sufficient for one product with quarterly updates. The workflow lists the `manifests/` prefix in S3, compares against the current live index version (via alias), and triggers sequential ingestion steps if a newer manifest exists.

#### Definition of Done

##### Functional

- [x] Cron schedule: runs daily at 06:00 UTC (+ manual `workflow_dispatch`)
  - `Verify:` `.github/workflows/ingest.yml` has cron trigger + manual dispatch
  - `Evidence:` Workflow runs on schedule
- [x] Lists `manifests/` prefix in S3, finds newest manifest per product
  - `Verify:` Workflow logs show manifest discovery
  - `Evidence:` `aws s3 ls s3://bucket/manifests/ | sort` in workflow
- [x] Compares against current live index version (queries `_alias/addresses`)
  - `Verify:` Workflow compares manifest version with current index name
  - `Evidence:` Skips if already ingested (idempotent)
- [x] If newer manifest found: triggers ingestion steps (P1E.03 → P1E.04 → P1E.05)
  - `Verify:` New manifest triggers full pipeline; old manifest skips
  - `Evidence:` Workflow output shows "New version found, ingesting" or "Already current, skipping"
- [x] OIDC credentials for S3 read + OpenSearch write access
  - `Verify:` Workflow uses `aws-actions/configure-aws-credentials` with deploy role
  - `Evidence:` S3 reads and OpenSearch writes succeed

#### Scope

**In:** Cron workflow, manifest discovery, version comparison, sequential ingestion trigger

**Out — Do Not Implement:**

- EventBridge + Step Functions (that's P2.04) → replaces this workflow
- Parallel file processing (sequential is fine for Phase 1 with 8 files)
- Multi-product support (only address in Phase 1)

---

### Ticket P1E.03 — Index Creation + Bulk Load

```yaml
id: P1E.03
title: Index Creation + Bulk Load
status: complete
priority: p0-critical
epic: P1E
persona: [ops]
depends_on: [P1E.02]
completed: 2026-04-13
tech_stack:
  search: OpenSearch 2.13
  client: "@opensearch-project/opensearch"
  source: S3 NDJSON
```

#### User Story

As a platform operator, new data is indexed into a fresh versioned index without affecting the live alias so that users experience zero downtime during data updates.

#### Problem Statement

Blue-green deployment for OpenSearch: create `address-{version}` with mappings, disable refresh (faster bulk), stream each NDJSON file from S3 through `_bulk` API in 5000-doc batches. The old index stays live on the alias — users never see partial data or downtime. If bulk fails, the new index is deleted and the old one is untouched.

#### Definition of Done

##### Functional

- [x] Creates `address-{version}` index with mappings from `data/address/{version}/mappings.json`
  - `Verify:` `GET /_cat/indices/address-*` shows new index
  - `Evidence:` Index created with correct mappings
- [x] Refresh disabled during bulk load (`refresh_interval: -1`)
  - `Verify:` Index settings show `-1` during load
  - `Evidence:` Re-enabled to `1s` after load completes
- [x] Streams source-key NDJSON files from S3 → `_bulk` API (batch size 3,000 docs)
  - `Verify:` Source-key files ingested; `_count` matches `manifest.total_records`
  - `Evidence:` Bulk response shows 0 errors per batch
- [x] Error handling: abort on bulk errors exceeding 0.1% failure rate
  - `Verify:` Inject a malformed doc → bulk aborts → new index deleted
  - `Evidence:` Error logged with failed doc details
- [x] Blue-green: old index stays live on alias during entire load
  - `Verify:` Query API during ingestion → responses come from old index
  - `Evidence:` No downtime visible to clients

#### Scope

**In:** Index creation, mappings application, S3 streaming, \_bulk ingestion, error handling

**Out — Do Not Implement:**

- Parallel file processing (sequential for Phase 1) → P2.04 adds parallelism
- NDJSON content sampling → P2.04 adds this
- Health check → P1E.04
- Alias swap → P1E.04

---

### Ticket P1E.04 — Health Check + Alias Swap

```yaml
id: P1E.04
title: Health Check + Alias Swap
status: complete
priority: p0-critical
epic: P1E
persona: [ops]
depends_on: [P1E.03]
completed: 2026-04-13
```

#### User Story

As a platform operator, after indexing the new data is validated and swapped in atomically so that bad data never reaches customers and rollback is instant.

#### Problem Statement

The health check is the gate between "data is indexed" and "data is live." It verifies doc count, runs sample queries against the NEW index (not the alias), and checks latency. Only if all checks pass does the atomic alias swap happen. Failure keeps the old index live and alerts via SNS. See ARCHITECTURE.MD section 5.2.2 for the alias swap mechanics and section 5.2.4 for retention policy.

#### Definition of Done

##### Functional

- [x] Doc count matches `manifest.total_records` (within 0.1%)
  - `Verify:` `GET /address-{version}/_count` matches manifest
  - `Evidence:` Exact or near-exact match logged
- [x] Sample queries return expected results (5-10 known-good queries against NEW index)
  - `Verify:` Known address "9 ENDEAVOUR COURT COFFIN BAY SA 5607" appears in results
  - `Evidence:` Query hits the new index directly (not via alias)
- [x] Force merge to 5 segments
  - `Verify:` `POST /address-{version}/_forcemerge?max_num_segments=5` returns 200
  - `Evidence:` `_segments` API shows ≤ 5 segments per shard
- [x] Atomic alias swap: `POST /_aliases` with remove old + add new
  - `Verify:` `GET /_alias/addresses` points to new index immediately after swap
  - `Evidence:` Single API call, zero-downtime transition
- [x] Old index retained per product retention policy (7 days for address)
  - `Verify:` `GET /_cat/indices/address-*` shows both old and new indices
  - `Evidence:` Old index exists but is not on the alias
- [x] Failure path: old alias stays live, SNS alert, failed new index deleted
  - `Verify:` Simulate health check failure → alias unchanged → SNS notification received
  - `Evidence:` Alert email/notification received

#### Scope

**In:** Doc count check, sample queries, force merge, atomic alias swap, retention, failure alerting

**Out — Do Not Implement:**

- Automated rollback (manual procedure documented in ARCHITECTURE.MD 5.2.4) → future
- Pre-swap latency benchmarking → future

---

### Ticket P1E.05 — Cache Invalidation Post-Swap

```yaml
id: P1E.05
title: Cache Invalidation Post-Swap
status: pending
priority: p1-high
epic: P1E
persona: [ops]
depends_on: [P1E.04, P1A.09]
completed: null
```

#### User Story

As a platform operator, after an alias swap the API Gateway cache is flushed so that clients immediately see new data.

#### Problem Statement

Without cache invalidation, clients could receive stale data for up to 1 hour (the cache TTL) after a data update. The ingestion workflow must flush the cache after a successful alias swap. This is a single AWS API call.

#### Definition of Done

##### Functional

- [ ] API Gateway cache flushed after successful alias swap
  - `Verify:` `aws apigateway flush-stage-cache --rest-api-id XXX --stage-name prod` called in workflow
  - `Evidence:` Cache flush succeeds; next query hits Lambda (not cache)
- [ ] Verified: query after swap returns data from new index
  - `Verify:` Query known address → response includes data only present in new index
  - `Evidence:` Timestamp or version field in response matches new data

#### Scope

**In:** Cache flush API call post-swap

**Out — Do Not Implement:**

- Selective cache invalidation (flush all, not per-route) → future optimization
- CloudFront invalidation (dashboard) → not needed (API only)

---

### Ticket P1E.06 — Index Cleanup Lambda

```yaml
id: P1E.06
title: Index Cleanup Lambda
status: pending
priority: p1-high
epic: P1E
persona: [ops]
depends_on: [P1E.04]
completed: null
tech_stack:
  runtime: Lambda (Node.js 20)
  schedule: EventBridge (every 6 hours)
```

#### User Story

As a platform operator, expired old indices are automatically deleted so that OpenSearch storage doesn't grow unbounded, while keeping rollback targets available within the retention window.

#### Problem Statement

After each alias swap, the old index stays around for rollback (7 days for address, 48 hours for ABN/LEI). Without automated cleanup, indices accumulate and exhaust the 20GB gp3 storage on t3.small. The cleanup Lambda also verifies OpenSearch automated snapshots are running — the last line of defense against data loss.

#### Definition of Done

##### Functional

- [ ] Scheduled Lambda runs every 6 hours (EventBridge rule)
  - `Verify:` EventBridge rule exists; Lambda invoked on schedule
  - `Evidence:` CloudWatch logs show 4 invocations per day
- [ ] Lists indices per product, identifies which alias currently points to
  - `Verify:` Lambda logs show index inventory per product
  - `Evidence:` Correctly identifies active vs expired indices
- [ ] Deletes indices older than `retention_hours` from product registry
  - `Verify:` Index older than 7 days (address) is deleted on next run
  - `Evidence:` `_cat/indices` shows index removed
- [ ] Never deletes the only index for a product (safety net)
  - `Verify:` If only one address index exists, cleanup skips it even if expired
  - `Evidence:` Lambda logs "Skipping deletion — only index for product 'address'"
- [ ] Verifies latest automated OpenSearch snapshot is < 48 hours old
  - `Verify:` If snapshot is stale, SNS alert fires
  - `Evidence:` Alert received if `_snapshot/_status` shows age > 48h

#### Scope

**In:** Scheduled cleanup, retention enforcement, snapshot verification, alerting

**Out — Do Not Implement:**

- Manual snapshot creation → ARCHITECTURE.MD 5.2.5 documents the procedure
- Cross-region snapshot replication → future

---

## Phase 1F — Distribution

---

### Ticket P1F.01 — Custom Domain Setup

```yaml
id: P1F.01
title: Custom Domain Setup
status: complete
priority: p1-high
epic: P1F
persona: [builder]
depends_on: [P0.02]
completed: 2026-04-13
tech_stack:
  dns: Route 53 or external registrar
  ssl: ACM (AWS Certificate Manager)
  cdn: CloudFront (dashboard), API Gateway (API)
```

#### User Story

As a builder, the API and dashboard are accessible at branded domains so that the platform looks professional and is easy to remember.

#### Problem Statement

Currently the API is at a random AWS URL (`59jym47ia1.execute-api...`) and the dashboard at a CloudFront hash (`d2ttwndpb06ei3.cloudfront.net`). Custom domains (`api.prontiq.dev`, `app.prontiq.dev`, `docs.prontiq.dev`) are essential for credibility, documentation examples, and SDK defaults.

#### Definition of Done

##### Functional

- [ ] `api.prontiq.dev` → API Gateway custom domain
  - `Verify:` `curl https://api.prontiq.dev/v1/health` returns 200
  - `Evidence:` DNS CNAME configured, ACM cert validated
- [ ] `app.prontiq.dev` → Dashboard (CloudFront alternate domain)
  - `Verify:` `curl https://app.prontiq.dev` returns dashboard HTML
  - `Evidence:` CloudFront alternate domain configured
- [ ] `docs.prontiq.dev` → Mintlify custom domain
  - `Verify:` `curl https://docs.prontiq.dev` returns docs site
  - `Evidence:` Mintlify dashboard shows custom domain active
- [ ] SSL certificates provisioned via ACM (auto-renewing)
  - `Verify:` `aws acm describe-certificate` shows status ISSUED
  - `Evidence:` Cert covers `*.prontiq.dev` or individual domains
- [ ] DNS configured (CNAME/ALIAS records)
  - `Verify:` `dig api.prontiq.dev` resolves to AWS endpoint
  - `Evidence:` DNS records visible in registrar/Route 53

#### Scope

**In:** Three custom domains, SSL certs, DNS configuration

**Out — Do Not Implement:**

- CDN distribution (CloudFront for API) → future optimization (API Gateway is sufficient)
- `cdn.prontiq.dev` for web component → P1D.05

---

### Ticket P1F.02 — Monitoring + Alerting

```yaml
id: P1F.02
title: Monitoring + Alerting
status: pending
priority: p1-high
epic: P1F
persona: [ops]
depends_on: [P0.02]
completed: null
tech_stack:
  monitoring: CloudWatch + X-Ray
  alerting: SNS → email
```

#### User Story

As a platform operator, I know when things break within minutes so that I can respond before customers notice.

#### Problem Statement

Without monitoring, failures are discovered by customer complaints. CloudWatch alarms on 5xx rate, Lambda errors, and OpenSearch health provide the first line of defense. A CloudWatch dashboard gives at-a-glance visibility into latency percentiles, request volume, and storage utilization. X-Ray tracing enables latency debugging per-request. Cost: included with AWS (no additional service needed for Phase 1).

#### Definition of Done

##### Functional

- [ ] CloudWatch alarms configured and active
  - `Verify:` `aws cloudwatch describe-alarms` shows alarms
  - `Evidence:` Alarms: API 5xx > 1%, Lambda errors > 1%, OpenSearch cluster yellow/red, OpenSearch storage > 80%
- [ ] SNS topic for alerts → email notification
  - `Verify:` Trigger an alarm → email received within 5 minutes
  - `Evidence:` Email from SNS with alarm details
- [ ] CloudWatch dashboard: API latency (p50/p95/p99), request count, error rate, OpenSearch FreeStorageSpace
  - `Verify:` Dashboard URL accessible in AWS console
  - `Evidence:` Charts render with real data after API calls
- [ ] X-Ray tracing enabled on API Lambda
  - `Verify:` Make API call → trace visible in X-Ray console
  - `Evidence:` Trace shows Lambda → DynamoDB → OpenSearch segments with timing
- [ ] Structured JSON logging in all Lambda functions
  - `Verify:` CloudWatch Logs Insights query `fields @timestamp, request_id, path, latency | sort @timestamp desc`
  - `Evidence:` Structured log entries with queryable fields

#### Scope

**In:** CloudWatch alarms, SNS alerting, dashboard, X-Ray tracing, structured logging

**Out — Do Not Implement:**

- Third-party monitoring (Datadog, Sentry) → future (CloudWatch is sufficient for Phase 1)
- PagerDuty/OpsGenie integration → future
- Uptime monitoring (external) → future (Pingdom, Better Uptime)

---

## Phase 2 — ABN/ASIC Verification (Weeks 7-10)

> **Goal:** Second product. ABN verification + search. EventBridge + Step Functions replaces GitHub Actions cron.

---

### Ticket P2.01 — ABN Data Pipeline

```yaml
id: P2.01
title: ABN Data Pipeline
status: pending
priority: p0-critical
epic: P2
persona: [builder]
depends_on: []
completed: null
note: "CROSS-REPO — new repo jbejenar/abn-extract"
tech_stack:
  source: ABR bulk extract (data.gov.au)
  output: NDJSON + manifest to S3
  schedule: Daily
```

#### User Story

As a builder, I need an ABN data pipeline that downloads the ABR bulk extract daily, transforms it to NDJSON, and ships it to S3 with a manifest so that the platform can index ABN entities automatically.

#### Problem Statement

ABR provides daily bulk extracts of all Australian Business Numbers (~3M entities). The pipeline downloads, parses (XML → JSON), transforms to the platform's NDJSON format, uploads to S3, and produces a manifest conforming to the contract (ARCHITECTURE.MD 5.1.2). This is a separate repo (`abn-extract`) following the same pattern as `flat-white` for addresses.

#### Definition of Done

##### Functional

- [ ] New repo `jbejenar/abn-extract` created with pipeline code
  - `Verify:` `git clone jbejenar/abn-extract` succeeds
  - `Evidence:` Repo exists with README, pipeline code, CI workflow
- [ ] Downloads ABR bulk extract (daily schedule via GitHub Actions)
  - `Verify:` Workflow runs on cron; downloads latest extract
  - `Evidence:` S3 shows new NDJSON files at `data/abn/{date}/`
- [ ] Transforms to NDJSON matching OpenSearch mappings
  - `Verify:` `head -1 entities.ndjson | jq .` shows correct schema
  - `Evidence:` Fields: `abn`, `entityName`, `entityType`, `gstStatus`, `state`, `postcode`, `activeFrom`
- [ ] Uploads to `data/abn/{date}/` with per-version `mappings.json`
  - `Verify:` `aws s3 ls s3://bucket/data/abn/{date}/`
  - `Evidence:` NDJSON files + mappings.json present
- [ ] Produces `manifests/abn-{date}.json` conforming to manifest contract
  - `Verify:` Download manifest, validate with `manifestV1Schema.parse()`
  - `Evidence:` Validation passes
- [ ] All files uploaded with `ChecksumAlgorithm: SHA256`
  - `Verify:` `aws s3api head-object` returns ChecksumSHA256
  - `Evidence:` Header present on each file

#### Scope

**In:** ABR download, XML→NDJSON transform, S3 upload, manifest generation (in separate repo)

**Out — Do Not Implement:**

- ASIC director data → P2.08 (separate dataset)
- OpenSearch index creation → handled by Step Functions (P2.04)
- API routes → P2.03

---

### Ticket P2.02 — ABN OpenSearch Index + Mappings

```yaml
id: P2.02
title: ABN OpenSearch Index + Mappings
status: pending
priority: p0-critical
epic: P2
persona: [builder]
depends_on: [P2.01]
completed: null
```

#### User Story

As a builder, I need OpenSearch mappings designed for ABN entity search so that developers can verify ABN status and search businesses by name.

#### Problem Statement

ABN search has different requirements than address search: exact ABN lookup (11-digit match), business name fuzzy search, GST status filtering, entity type faceting. The mappings must support both exact match (ABN as keyword) and text search (entity name as analyzed text). Index alias: `abn-entities` (from product registry).

#### Definition of Done

##### Functional

- [ ] Mappings designed for ABN entity search
  - `Verify:` `data/abn/{date}/mappings.json` includes all required fields
  - `Evidence:` Fields: `abn` (keyword), `entityName` (text + keyword), `entityType` (keyword), `gstStatus` (keyword), `state` (keyword), `postcode` (keyword), `activeFrom` (date)
- [ ] Index alias: `abn-entities`
  - `Verify:` Product registry in `constants.ts` maps `abn` → `abn-entities`
  - `Evidence:` Already configured
- [ ] Verified: sample queries work against real ABN data
  - `Verify:` ABN lookup: `GET /abn-entities/_search?q=abn:51824753556` returns entity
  - `Evidence:` Name search: `GET /abn-entities/_search?q=entityName:acme` returns matches

#### Scope

**In:** Mappings design, sample query verification

**Out — Do Not Implement:**

- API routes → P2.03
- Ingestion pipeline → P2.04 (Step Functions handles this generically)

---

### Ticket P2.03 — ABN API Routes

```yaml
id: P2.03
title: ABN API Routes
status: pending
priority: p0-critical
epic: P2
persona: [api-consumer]
depends_on: [P2.02, P1A.01]
completed: null
tech_stack:
  api: Hono + @hono/zod-openapi
  search: OpenSearch
```

#### User Story

As an API consumer, `GET /v1/abn/verify?abn=51824753556` returns the entity's ABN status, GST registration, and entity type so that I can verify Australian businesses programmatically.

#### Problem Statement

ABN verification is the second product — the one that demonstrates the platform's multi-product value. It follows the same pattern as address: Zod schema → `createRoute()` → OpenAPI spec → Mintlify docs → Speakeasy SDK. The route group (`packages/api/src/routes/abn.ts`) already exists as a stub. Implementation adds the actual OpenSearch queries and response formatting.

#### Definition of Done

##### Functional

- [ ] `GET /v1/abn/verify?abn=51824753556` returns entity details
  - `Verify:` Curl with valid ABN → response with entity name, GST status, entity type, state
  - `Evidence:` Real data from OpenSearch `abn-entities` alias
- [ ] `GET /v1/abn/search?q=acme` returns matching entities with relevance ranking
  - `Verify:` Curl with search term → array of matching entities
  - `Evidence:` Results sorted by relevance score
- [ ] Routes defined with `createRoute()` — OpenAPI spec updated automatically
  - `Verify:` `GET /openapi.json` includes `/v1/abn/verify` and `/v1/abn/search`
  - `Evidence:` Spec has correct parameters and response schemas
- [ ] Rate limiting + usage tracking per-product (separate counter from address)
  - `Verify:` Make ABN request → DynamoDB `usage.abn.{month}` incremented (not `usage.address`)
  - `Evidence:` Counters are product-specific
- [ ] Docs + SDK namespace `prontiq.abn` generated
  - `Verify:` `prontiq.abn.verify({ abn: "51824753556" })` works in SDK
  - `Evidence:` Speakeasy regenerated with ABN namespace

#### Scope

**In:** ABN verify + search routes, OpenSearch queries, OpenAPI spec, SDK update

**Out — Do Not Implement:**

- ABN directors → P2.08
- Bulk ABN verification → future

---

### Ticket P2.04 — EventBridge + Step Functions Ingestion

```yaml
id: P2.04
title: EventBridge + Step Functions Ingestion
status: pending
priority: p0-critical
epic: P2
persona: [ops]
depends_on: [P1E.04]
completed: null
```

#### User Story

As a platform operator, any manifest landing in S3 automatically triggers the full ingestion pipeline (validate → index → health check → swap) so that I never manually run ingestion again.

#### Problem Statement

Phase 1 uses a GitHub Actions cron for ingestion — simple but manual. With two products (address quarterly, ABN daily), different cadences justify EventBridge + Step Functions. The Step Function is generic: it reads the manifest, looks up the product in the registry, and runs the standard pipeline. Adding a third product requires zero infrastructure changes — just a new pipeline producing manifests.

#### Definition of Done

- [ ] EventBridge rule: `prefix: manifests/`, `suffix: .json` → Step Function
- [ ] Step Function: validate → create index → parallel bulk → finalize → health check → alias swap → cache invalidate
- [ ] Concurrency control: max 1 execution per product (dedup via `ListExecutions`)
- [ ] Failure handling: SNS alert, cleanup failed index, old alias stays live
- [ ] Works for BOTH address and ABN (manifest-driven, product-agnostic)
- [ ] GitHub Actions cron ingestion retired
- [ ] NDJSON content sampling validation (first 500 records per file)

---

### Ticket P2.05 — ABN Docs + SDK Update

```yaml
id: P2.05
title: ABN Docs + SDK Update
status: pending
priority: p1-high
epic: P2
persona: [api-consumer]
depends_on: [P2.03]
completed: null
```

#### User Story

As an API consumer, I find ABN documentation and SDK methods alongside the existing address docs so that I can use both products with the same key and same SDK.

#### Definition of Done

##### Functional

- [ ] Mintlify: ABN Verification section with per-endpoint docs (verify, search)
  - `Verify:` Navigate to docs.prontiq.dev/abn → section exists with examples
  - `Evidence:` Auto-generated from OpenAPI spec + human-written descriptions
- [ ] Speakeasy SDK regenerated with `prontiq.abn.verify()`, `prontiq.abn.search()`
  - `Verify:` `npm install @prontiq/sdk@latest` → `prontiq.abn` namespace exists
  - `Evidence:` TypeScript types for ABN endpoints
- [ ] Getting started guide updated with ABN example
  - `Verify:` Quick start mentions ABN verification alongside address
  - `Evidence:` Code snippet: `const { entity } = await prontiq.abn.verify({ abn: "51824753556" })`

#### Scope

**In:** ABN docs section, SDK regeneration, getting started update

**Out — Do Not Implement:**

- ABN-specific tutorials → future
- Directors endpoint docs → P2.08

---

### Ticket P2.06 — Stripe ABN Usage Meter

```yaml
id: P2.06
title: Stripe ABN Usage Meter
status: pending
priority: p1-high
epic: P2
persona: [ops]
depends_on: [P1B.10]
completed: null
```

#### User Story

As a platform operator, ABN usage is metered and billed separately from address so that the invoice shows per-product line items.

#### Problem Statement

The billing cron (P1B.10) already reports address usage to Stripe via `subscriptionItems["address"]`. Adding ABN requires a new Stripe metered Price, an `"abn"` entry in each paid key's `subscriptionItems` map (populated on upgrade by P1B.06 Stripe webhook), and no changes to the cron itself — it already iterates the full `subscriptionItems` map. The invoice shows "Address API — X requests" and "ABN Verification — Y requests" as separate line items.

#### Definition of Done

##### Functional

- [ ] ABN metered Price created in Stripe (with tiered allocations per plan, same shape as address per ARCHITECTURE.MD §5.6.1)
  - `Verify:` Stripe dashboard Products → Prontiq ABN API shows metered Price with tiers
  - `Evidence:` Price ID documented in PLANS constants
- [ ] P1B.06 Stripe webhook populates `subscriptionItems["abn"]` on upgrade (automatic — already iterates all products in `checkout.session.completed` per §5.7.2)
  - `Verify:` Upgrade a test account to Starter; `aws dynamodb get-item` on prontiq-keys shows `subscriptionItems.abn: "si_..."`
  - `Evidence:` DDB record diff
- [ ] Billing cron (P1B.10) reports ABN usage on next hourly run — no code change required; iterates the full subscriptionItems map
  - `Verify:` Make 10 ABN requests → wait for hourly cron → Stripe usage records appear under ABN meter
  - `Evidence:` Stripe → Billing → Meter usage
- [ ] Invoice shows ABN line item alongside address line item
  - `Verify:` Generate test invoice → shows both product line items
  - `Evidence:` Invoice PDF with "Address API" and "ABN Verification" lines

#### Scope

**In:** Stripe ABN metered Price with tiers, PLANS constants update, invoice verification (no billing-cron code change — P1B.10 already iterates subscriptionItems map)

**Out — Do Not Implement:**

- Per-product overage pricing changes → use existing tier pricing

---

### Ticket P2.07 — OpenSearch HA Scaling

```yaml
id: P2.07
title: OpenSearch HA Scaling
status: pending
priority: p0-critical
epic: P2
persona: [ops]
depends_on: [P2.02]
completed: null
```

#### User Story

As a platform operator, OpenSearch runs on 2 nodes with a replica so that a single node failure doesn't take down all products.

#### Problem Statement

Phase 1 runs on a single t3.small with 0 replicas — acceptable pre-revenue. With two products and paying customers, single-node is a business risk. Scaling to t3.medium × 2 with 1 replica provides multi-AZ redundancy, doubles storage capacity, and enables maintenance windows without downtime. Cost: ~$150/month (up from $35).

#### Definition of Done

- [ ] t3.medium × 2 with 1 replica configured
- [ ] Multi-AZ enabled
- [ ] EBS gp3 scaled to 50GB per node
- [ ] Verified: alias swap works with replicas (both nodes serve queries)
- [ ] Maintenance window scheduled (Sunday 03:00 AEST)
- [ ] Force merge updated to `max_num_segments=1` (safe with 2 nodes)

---

### Ticket P2.08 — ACN Directors Endpoint (Starter+)

```yaml
id: P2.08
title: ACN Directors Endpoint (Starter+)
status: pending
priority: p2-value
epic: P2
persona: [api-consumer]
depends_on: [P2.01]
completed: null
tech_stack:
  source: ASIC company register
```

#### User Story

As an API consumer, `GET /v1/abn/directors?acn=...` returns company director details so that I can perform KYC and compliance checks.

#### Problem Statement

Director data comes from ASIC (separate dataset from ABR). This is a premium endpoint (Starter+) because it's high-value for compliance teams. The endpoint takes an ACN (Australian Company Number), looks up the company, and returns current directors with names and appointment dates.

#### Definition of Done

##### Functional

- [ ] ACN director data extracted from ASIC dataset and indexed
  - `Verify:` OpenSearch index contains director records linked to ACN
  - `Evidence:` Sample query returns directors for a known company
- [ ] `GET /v1/abn/directors?acn=...` returns list of directors
  - `Verify:` `curl .../v1/abn/directors?acn=004085616` returns director list
  - `Evidence:` Response includes director name, appointment date, cessation date (if applicable)
- [ ] Tier enforcement: Starter+ only (free tier gets 403 `PRODUCT_NOT_ALLOWED`)
  - `Verify:` Free-tier key → 403; Starter key → 200
  - `Evidence:` Auth middleware enforces tier check
- [ ] Docs + SDK updated with `prontiq.abn.directors()` method
  - `Verify:` SDK has typed `directors()` method; docs page exists
  - `Evidence:` Speakeasy regenerated

#### Scope

**In:** ASIC director lookup, ACN parameter, tier gating, docs + SDK

**Out — Do Not Implement:**

- Historical directors (only current) → future
- Director search by name → future
- Beneficial ownership → not available in public ASIC data

---

## Phase 3 — GLEIF/LEI + Full Dashboard (Weeks 11-13)

> **Goal:** Third product (international). Full dashboard build-out with team management.

---

### Ticket P3.01 — LEI Pipeline

```yaml
id: P3.01
title: LEI Pipeline
status: pending
priority: p0-critical
epic: P3
depends_on: []
completed: null
note: "CROSS-REPO — new repo jbejenar/lei-extract"
tech_stack:
  source: GLEIF Golden Copy (gleif.org)
  output: NDJSON + manifest to S3
  schedule: Daily
```

#### User Story

As a builder, I need a LEI pipeline that downloads the GLEIF Golden Copy daily and ships it to S3 so that the platform can offer international entity resolution.

#### Problem Statement

LEI (Legal Entity Identifier) is the first international product — used by banks, cross-border payments, and compliance teams. GLEIF provides a daily "Golden Copy" of all ~2M LEIs. The pipeline downloads, parses (XML/CSV → JSON), transforms to NDJSON, and produces a manifest. Same pattern as flat-white and abn-extract.

#### Definition of Done

##### Functional

- [ ] New repo `jbejenar/lei-extract` created with pipeline code
  - `Verify:` Repo exists with README, pipeline, CI
  - `Evidence:` `git clone jbejenar/lei-extract` succeeds
- [ ] GLEIF Golden Copy downloaded daily
  - `Verify:` Workflow runs daily; downloads latest Golden Copy
  - `Evidence:` S3 shows NDJSON at `data/lei/{date}/`
- [ ] Transformed to NDJSON with correct schema
  - `Verify:` `head -1 golden-copy.ndjson | jq .` shows fields
  - `Evidence:` Fields: `lei`, `legalName`, `jurisdiction`, `registrationStatus`, `entityCategory`, `registrationDate`
- [ ] Per-version mappings + manifest conforming to contract
  - `Verify:` `manifestV1Schema.parse()` passes
  - `Evidence:` Manifest at `manifests/lei-{date}.json`
- [ ] Index alias: `lei-entities` (matches product registry)
  - `Verify:` Product registry already maps `lei` → `lei-entities`
  - `Evidence:` `packages/shared/src/constants.ts`

#### Scope

**In:** GLEIF download, transform, S3 upload, manifest (in separate repo)

**Out — Do Not Implement:**

- LEI renewal tracking → future
- Relationship data (parent/child entities) → future

---

### Ticket P3.02 — LEI API Routes

```yaml
id: P3.02
title: LEI API Routes
status: pending
priority: p0-critical
epic: P3
depends_on: [P3.01, P1A.01]
completed: null
```

#### User Story

As an API consumer, `GET /v1/lei/lookup?lei=549300MLUDYVRQOOXS22` returns entity details so that I can resolve LEIs in cross-border payment and compliance workflows.

#### Definition of Done

##### Functional

- [ ] `GET /v1/lei/lookup?lei=549300MLUDYVRQOOXS22` → entity details
  - `Verify:` Curl with valid LEI → response with legal name, jurisdiction, status
  - `Evidence:` Real data from OpenSearch `lei-entities` alias
- [ ] `GET /v1/lei/search?q=acme` → matching entities
  - `Verify:` Curl with search term → array of matching entities
  - `Evidence:` Results sorted by relevance
- [ ] Routes defined with `createRoute()`, OpenAPI spec updated
  - `Verify:` `GET /openapi.json` includes LEI endpoints
  - `Evidence:` Spec has correct schemas
- [ ] Docs + SDK updated with `prontiq.lei` namespace
  - `Verify:` `prontiq.lei.lookup({ lei: "..." })` works in SDK
  - `Evidence:` Speakeasy regenerated

#### Scope

**In:** LEI lookup + search routes, OpenSearch queries, spec, SDK

**Out — Do Not Implement:**

- LEI validation (checksum) → future enhancement
- Bulk LEI lookup → future

---

### Ticket P3.03 — Dashboard: Team Management

```yaml
id: P3.03
title: Dashboard Team Management
status: pending
priority: p1-high
epic: P3
depends_on: [P1C.07]
completed: null
tech_stack:
  auth: Clerk Organizations
```

#### User Story

As a team lead, I invite colleagues to my Prontiq organization so that we share API keys, usage data, and billing under one account.

#### Problem Statement

Solo developers sign up individually. Teams need shared access: one billing account, shared API keys, role-based permissions (admin can manage keys, member can view usage, viewer is read-only). Clerk's `<OrganizationProfile>` component handles 90% of this out of the box.

#### Definition of Done

##### Functional

- [ ] Clerk `<OrganizationProfile>` component on Team page
  - `Verify:` Navigate to /dashboard/team → org management UI renders
  - `Evidence:` Clerk component loads with current org context
- [ ] Invite members by email
  - `Verify:` Enter email → invitation sent → recipient can accept and join
  - `Evidence:` Clerk invitation flow works end-to-end
- [ ] Assign roles (admin, member, viewer)
  - `Verify:` Change role → permissions update immediately
  - `Evidence:` Viewer cannot access key management page
- [ ] Remove members
  - `Verify:` Remove member → they lose dashboard access
  - `Evidence:` Removed user redirected to sign-in

#### Scope

**In:** Clerk org management, invitations, roles, member removal

**Out — Do Not Implement:**

- Custom role definitions → use Clerk's built-in roles
- SSO/SAML → Clerk handles this on higher plans
- Per-member API key scoping → future

---

### Ticket P3.04 — Dashboard: Integrations Page

```yaml
id: P3.04
title: Dashboard Integrations Page
status: pending
priority: p2-value
epic: P3
depends_on: [P1C.07]
completed: null
```

#### User Story

As a developer, I find integration options (Shopify, WooCommerce, web component) on a single page so that I can add Prontiq to my platform.

#### Definition of Done

##### Functional

- [ ] Shopify OAuth install card (placeholder — P4 implements the actual flow)
  - `Verify:` Card shows Shopify logo, "Coming soon" or install button
  - `Evidence:` Visible on /dashboard/integrations
- [ ] WooCommerce setup wizard card (placeholder for P4)
  - `Verify:` Card shows WooCommerce logo, setup instructions
  - `Evidence:` Links to WooCommerce plugin page
- [ ] Web component embed code with one-click copy
  - `Verify:` Click copy → clipboard contains `<script src="cdn.prontiq.dev/..."><prontiq-address api-key="...">`
  - `Evidence:` Code includes user's actual API key

#### Scope

**In:** Integration cards, web component embed code

**Out — Do Not Implement:**

- Shopify OAuth flow → P4.02
- WooCommerce plugin → P4.03

---

### Ticket P3.05 — Dashboard: Settings Page

```yaml
id: P3.05
title: Dashboard Settings Page
status: pending
priority: p2-value
epic: P3
depends_on: [P1C.07]
completed: null
```

#### User Story

As a developer, I configure webhook URLs, notification preferences, and can delete my account from the settings page.

#### Problem Statement

Webhook URLs allow developers to receive events (quota warnings, key changes) in their own systems. Notification preferences control email alerts. Account deletion (GDPR Article 17) must cascade: delete Clerk user, cancel Stripe subscription, purge `prontiq-keys` + `prontiq-usage` + `prontiq-audit` + `prontiq-ses-suppressions` for the org (see ARCHITECTURE.MD §11.1). Orchestrated by `scripts/purge-org.ts`.

#### Definition of Done

##### Functional

- [ ] Webhook URL configuration (receive events for usage alerts, billing changes)
  - `Verify:` Enter webhook URL → save → test webhook fires
  - `Evidence:` Webhook URL stored; test event delivered
- [ ] Notification preferences (email alerts for quota 80%/100% warnings)
  - `Verify:` Toggle quota warning → email sent when 80% reached
  - `Evidence:` Email received with quota details
- [ ] Account deletion flow (GDPR compliance; requires Clerk step-up + typed confirmation per ARCHITECTURE.MD §5.9.2)
  - `Verify:` Click "Delete Account" → step-up → typed confirmation → all data removed
  - `Evidence:` Clerk user deleted, Stripe subscription cancelled, all four DynamoDB tables purged for the org

#### Scope

**In:** Webhook config, notification preferences, account deletion

**Out — Do Not Implement:**

- Audit log → future
- Two-factor authentication settings → Clerk handles this
- API access logs → future

---

### Ticket P3.06 — Stripe LEI Usage Meter

```yaml
id: P3.06
title: Stripe LEI Usage Meter
status: pending
priority: p1-high
epic: P3
depends_on: [P1B.10]
completed: null
```

#### User Story

As a platform operator, LEI usage is metered and billed so that the invoice shows three product line items.

#### Definition of Done

##### Functional

- [ ] LEI metered Price created in Stripe with tiered allocations
  - `Verify:` Stripe dashboard shows LEI metered Price with tiers
  - `Evidence:` Price ID documented in PLANS constants
- [ ] P1B.06 Stripe webhook populates `subscriptionItems["lei"]` on upgrade (same auto-iteration as P2.06 for ABN)
  - `Verify:` Upgrade a test account; `aws dynamodb get-item` shows `subscriptionItems.lei: "si_..."`
  - `Evidence:` DDB record diff
- [ ] Invoice shows 3 product line items (address, ABN, LEI) — no cron change required
  - `Verify:` Generate test invoice with usage across all 3 products
  - `Evidence:` Invoice PDF shows 3 separate line items with correct quantities

#### Scope

**In:** Stripe LEI metered Price, PLANS constants update, invoice verification (no cron code changes — P1B.10 already iterates subscriptionItems)

**Out — Do Not Implement:**

- Custom per-product pricing → use tier-based pricing

---

### Ticket P3.07 — API Versioning Infrastructure

```yaml
id: P3.07
title: API Versioning Infrastructure
status: pending
priority: p2-value
epic: P3
depends_on: [P1A.01]
completed: null
```

#### User Story

As a platform operator, I can ship breaking changes as `/v2/` routes while keeping `/v1/` alive with a deprecation timeline so that existing integrations don't break.

#### Problem Statement

API versioning is needed before the first breaking change ships. The `/v1/` prefix is already in use. When a breaking change is needed (response schema change, parameter rename), it ships as a `/v2/` route alongside `/v1/`. Both run in the same Hono app — separate route groups, shared middleware. A `Sunset` header on `/v1/` responses warns consumers 90 days before removal. See ARCHITECTURE.MD 5.1.5.

#### Definition of Done

##### Functional

- [ ] `/v1/` routes return `Sunset` header 90 days before removal
  - `Verify:` `curl -v .../v1/address/autocomplete` shows `Sunset:` header (when deprecation is active)
  - `Evidence:` Middleware adds header conditionally
- [ ] `/v2/` route group can coexist alongside `/v1/` in the same Hono app
  - `Verify:` Add a test `/v2/health` route → both `/v1/health` and `/v2/health` respond
  - `Evidence:` Separate route groups in `index.ts`
- [ ] Versioning policy documented in Getting Started guide
  - `Verify:` Docs page explains versioning: additive changes in `/v1/`, breaking changes in `/v2/`, 90-day sunset
  - `Evidence:` docs.prontiq.dev versioning page

#### Scope

**In:** Sunset header middleware, `/v2/` route group infrastructure, docs

**Out — Do Not Implement:**

- Actual `/v2/` endpoints (no breaking changes planned yet) → when needed
- Per-client version pinning → future

---

## Phase 4 — Shopify + WooCommerce (Weeks 14-17)

> **Goal:** Distribution plugins for e-commerce checkout address validation.

---

### Ticket P4.01 — Shopify Checkout UI Extension

```yaml
id: P4.01
title: Shopify Checkout UI Extension
status: pending
priority: p1-high
epic: P4
depends_on: [P1A.02, P2.03]
completed: null
tech_stack:
  platform: Shopify Checkout Extensibility
  ui: Shopify Polaris / Checkout UI Extension API
```

#### User Story

As a Shopify merchant, address autocomplete appears at checkout so that my customers enter accurate addresses and my shipping costs decrease.

#### Problem Statement

Shopify is the largest e-commerce platform in Australia. A checkout UI extension that adds address autocomplete (and ABN verification for B2B stores) is the highest-leverage distribution channel. Merchants install from the Prontiq dashboard, a store-scoped API key is provisioned automatically, and the extension is live within minutes. No developer needed on the merchant side.

#### Definition of Done

##### Functional

- [ ] Address autocomplete renders at Shopify checkout
  - `Verify:` Install extension on test store → go to checkout → autocomplete appears
  - `Evidence:` Suggestions appear as customer types address
- [ ] ABN verification field for B2B stores (optional, merchant-configurable)
  - `Verify:` Enable ABN field in extension settings → B2B checkout shows ABN input
  - `Evidence:` ABN verified against live API before order submission
- [ ] OAuth install flow from Prontiq dashboard (P4.02 handles the auth)
  - `Verify:` Click "Install Shopify" → OAuth → extension installed
  - `Evidence:` Extension visible in merchant's Shopify admin
- [ ] Store-scoped API key provisioned automatically on install (per ADR-001 — single canonical `pq_live_` prefix; vendor scoping is metadata-driven, NOT encoded in the raw key format)
  - `Verify:` After install, `prontiq-keys` has a record with `keyPrefix = "pq_live_"`, `scope = "shopify"`, `shopDomain = "<store>.myshopify.com"`, and `products = ["address", "abn"]` (per P4.02 contract)
  - `Evidence:` `aws dynamodb query --table prontiq-keys --index-name orgId-index --filter-expression "scope = :s AND attribute_exists(keyPrefix)" --expression-attribute-values '{":s":{"S":"shopify"}}'` returns the record

#### Scope

**In:** Checkout UI extension, address autocomplete, ABN field, OAuth install

**Out — Do Not Implement:**

- Address enrichment at checkout → future (autocomplete is sufficient)
- Custom checkout styling → merchant uses Shopify's theme settings
- Shopify Admin app → future (only checkout extension for now)

---

### Ticket P4.02 — Shopify OAuth + Key Provisioning

```yaml
id: P4.02
title: Shopify OAuth + Key Provisioning
status: pending
priority: p1-high
epic: P4
depends_on: [P4.01]
completed: null
tech_stack:
  auth: Shopify OAuth 2.0
  keys: DDB-native (store-scoped record in prontiq-keys)
```

#### User Story

As a developer clicking "Install Shopify" on the dashboard, a store-scoped API key is created automatically so that the checkout extension works immediately without manual key configuration.

#### Problem Statement

The Shopify install flow must be frictionless: click install → OAuth consent → key provisioned → extension active. The store-scoped key uses the standard `pq_live_` prefix (no vendor subprefix — ADR-001) with a `scope: "shopify"` attribute and `shopDomain` metadata on the `prontiq-keys` record. Restricted to address + ABN products. Uninstalling deactivates the key.

#### Definition of Done

##### Functional

- [ ] Dashboard integrations page: "Install Shopify" button triggers OAuth flow
  - `Verify:` Click → Shopify OAuth consent screen → redirect back to dashboard
  - `Evidence:` OAuth handshake completes; store token stored
- [ ] `app.installed` webhook generates a store-scoped key via the DDB-native key module (P1B.02)
  - `Verify:` After install, `prontiq-keys` shows new record with `keyPrefix = "pq_live_"`, `scope = "shopify"`, `shopDomain` metadata
  - `Evidence:` `aws dynamodb get-item` shows store-scoped record
- [ ] Key restricted to address + ABN products (`products: ["address", "abn"]` on the record)
  - `Verify:` Request to `/v1/lei/lookup` with the store key → 403 `PRODUCT_NOT_ALLOWED`
  - `Evidence:` Integration test
- [ ] `app.uninstalled` webhook sets `active: false` on the store-scoped record
  - `Verify:` Uninstall from Shopify → DynamoDB key shows `active: false`
  - `Evidence:` Subsequent API calls with that key return 401

#### Scope

**In:** Shopify OAuth, store-scoped key provisioning, install/uninstall webhooks

**Out — Do Not Implement:**

- Shopify billing (use Prontiq billing, not Shopify's app billing) → keeps pricing consistent
- Multi-store support per account → future

---

### Ticket P4.03 — WooCommerce Plugin

```yaml
id: P4.03
title: WooCommerce Plugin
status: pending
priority: p2-value
epic: P4
depends_on: [P1A.02]
completed: null
tech_stack:
  platform: WordPress / WooCommerce
  language: PHP
```

#### User Story

As a WooCommerce store owner, I install a plugin that adds address autocomplete at checkout so that my customers enter accurate addresses.

#### Problem Statement

WooCommerce is the second-largest e-commerce platform in Australia. The plugin hooks into WooCommerce's checkout fields, adds the `<prontiq-address>` web component (P1D.05), and provides a settings page for the merchant to enter their API key. Distribution via the WordPress Plugin Directory gives organic reach.

#### Definition of Done

##### Functional

- [ ] Checkout field hooks add address autocomplete to shipping/billing fields
  - `Verify:` Install plugin → go to checkout → autocomplete appears
  - `Evidence:` Suggestions from Prontiq API
- [ ] Settings page in WP Admin for API key entry
  - `Verify:` Navigate to WooCommerce → Settings → Prontiq → enter key
  - `Evidence:` Key saved, autocomplete works on checkout
- [ ] WordPress Plugin Directory submission
  - `Verify:` Plugin submitted for review
  - `Evidence:` Review ticket / listing URL

#### Scope

**In:** WooCommerce checkout integration, settings page, Plugin Directory submission

**Out — Do Not Implement:**

- Auto-provisioned keys (merchant enters key manually, unlike Shopify) → simplicity
- ABN verification at WooCommerce checkout → future
- Gutenberg block → future

---

### Ticket P4.04 — Store-Scoped Key Management

```yaml
id: P4.04
title: Store-Scoped Key Management
status: pending
priority: p1-high
epic: P4
depends_on: [P4.02]
completed: null
```

#### User Story

As a developer, I see store-scoped keys separately from personal keys on the dashboard so that I can track usage and manage access per integration.

#### Definition of Done

##### Functional

- [ ] Dashboard keys page shows store-scoped keys in a separate section, grouped by **`scope` attribute** (NOT raw-key prefix substring — vendor scoping is metadata-driven per ADR-001, see P4.02 contract)
  - `Verify:` Keys with `scope === "shopify"` rendered under "Integrations" section; user-created keys (no `scope` attribute or `scope === "user"`) under "API Keys"
  - `Evidence:` Clear visual separation; UI groups by `scope`, not by string-matching the masked prefix
- [ ] Store-scoped keys restricted to the products provisioned at install (per P4.02: `products: ["address", "abn"]` for B2B-capable stores; `["address"]` for B2C-only stores)
  - `Verify:` Store key with `products: ["address", "abn"]` works for `/v1/address/*` and `/v1/abn/*`; `/v1/lei/*` returns 403 `PRODUCT_NOT_ALLOWED`
  - `Evidence:` Product scoping enforced in auth middleware against the v2.2 `products` list — same code path as user keys
- [ ] Usage tracked and billed per store key (appears on invoice as part of the org's overall usage)
  - `Verify:` Store key usage appears in `prontiq-usage` per `apiKeyHash`; aggregates into the org's billing
  - `Evidence:` Per-key counters (already per-key in v2.2 schema)

#### Scope

**In:** Store key display, product restriction, per-key usage tracking

**Out — Do Not Implement:**

- Per-store billing (all keys bill to account owner) → simplicity
- Store-to-store key migration → future

---

### Ticket P4.05 — Plugin Documentation

```yaml
id: P4.05
title: Plugin Documentation
status: pending
priority: p2-value
epic: P4
depends_on: [P4.01, P4.03]
completed: null
```

#### User Story

As a Shopify/WooCommerce merchant, I find clear integration guides so that I can install and configure Prontiq without developer help.

#### Definition of Done

##### Functional

- [ ] Shopify integration guide in Mintlify (install flow, configuration, testing)
  - `Verify:` docs.prontiq.dev/integrations/shopify exists with step-by-step guide
  - `Evidence:` Screenshots of OAuth flow, checkout preview, settings
- [ ] WooCommerce integration guide in Mintlify (install, API key, testing)
  - `Verify:` docs.prontiq.dev/integrations/woocommerce exists
  - `Evidence:` Screenshots of WP Admin settings, checkout preview
- [ ] Setup screenshots and video walkthrough
  - `Verify:` Visual aids embedded in docs pages
  - `Evidence:` Screenshots at minimum; video if bandwidth allows

#### Scope

**In:** Shopify + WooCommerce guides, screenshots

**Out — Do Not Implement:**

- Video production → can be added later
- Merchant-facing FAQ → future

---

## Phase 5 — CVE/NVD + Patents (Weeks 18-21)

> **Goal:** Tier 2 products. CVE integrates with ariscan. Patent search leverages OpenSearch fuzzy matching.

---

### Ticket P5.01 — CVE/NVD Pipeline + API

```yaml
id: P5.01
title: CVE/NVD Pipeline + API
status: pending
priority: p1-high
epic: P5
depends_on: [P2.04]
completed: null
note: "CROSS-REPO — new repo jbejenar/cve-extract"
tech_stack:
  source: NVD JSON feeds (nvd.nist.gov)
  schedule: Continuous (hourly delta)
```

#### User Story

As an API consumer, I look up CVEs and search for vulnerabilities by product/version so that I can integrate vulnerability intelligence into my security tooling.

#### Problem Statement

CVE/NVD data is the bridge between Prontiq's data platform and ariscan (the open-source AI readiness scanner). Ariscan's security pillar (P8) needs CVE data to score dependency vulnerabilities. The CVE API is a free-tier alternative to Snyk ($20-100K/yr) — attractive to security-conscious developers who are also ariscan users. Cross-pollination: ariscan users discover the data APIs, data API users discover ariscan.

#### Definition of Done

##### Functional

- [ ] New repo `jbejenar/cve-extract` with NVD JSON feed pipeline
  - `Verify:` Repo exists, pipeline downloads NVD feeds
  - `Evidence:` S3 shows NDJSON at `data/cve/{date}/`
- [ ] NDJSON + manifest to S3 (continuous — hourly delta updates)
  - `Verify:` Manifest produced, Step Function triggers ingestion
  - `Evidence:` Index refreshed hourly
- [ ] `GET /v1/cve/lookup?cve=CVE-2024-1234` → vulnerability details
  - `Verify:` Curl with known CVE → CVSS score, description, affected products, references
  - `Evidence:` Real NVD data
- [ ] `GET /v1/cve/search?product=apache&version=2.4` → matching CVEs
  - `Verify:` Search returns CVEs affecting Apache 2.4
  - `Evidence:` Results sorted by CVSS severity
- [ ] Integrates with ariscan security pillar (API endpoint callable from ariscan engine)
  - `Verify:` ariscan can call `/v1/cve/search` to enrich P8 scoring
  - `Evidence:` ariscan test with real CVE data
- [ ] Routes defined with `createRoute()`, docs + SDK namespace `prontiq.cve`
  - `Verify:` OpenAPI spec includes CVE endpoints; SDK has `prontiq.cve.lookup()`
  - `Evidence:` Speakeasy regenerated

#### Scope

**In:** NVD pipeline, CVE lookup + search, ariscan integration, docs, SDK

**Out — Do Not Implement:**

- CVE alerting/notifications → future
- Dependency scanning (that's ariscan's job) → ariscan uses this API
- CVE remediation guidance → future

---

### Ticket P5.02 — Patent/Trademark Pipeline + API

```yaml
id: P5.02
title: Patent/Trademark Pipeline + API
status: pending
priority: p2-value
epic: P5
depends_on: [P2.04]
completed: null
note: "CROSS-REPO — new repo jbejenar/patent-extract"
tech_stack:
  source: IP Australia + USPTO (public bulk data)
  schedule: Periodic (weekly)
  search: OpenSearch fuzzy matching
```

#### User Story

As an API consumer, I search Australian and US patents by keywords so that I can perform prior art searches and trademark clearance without paying $500-2K per search from commercial providers.

#### Problem Statement

Patent search is an expensive niche — commercial providers charge $500-2K per search. The data is publicly available from IP Australia and USPTO but hard to work with (XML bulk feeds, inconsistent schemas). OpenSearch's fuzzy matching (already proven with address autocomplete) works well for patent text search. The platform pattern handles the indexing; we just need the pipeline and routes.

#### Definition of Done

##### Functional

- [ ] New repo `jbejenar/patent-extract` with IP Australia + USPTO pipeline
  - `Verify:` Repo exists, pipeline downloads patent data
  - `Evidence:` S3 shows NDJSON at `data/patents/{date}/`
- [ ] NDJSON + manifest to S3 (periodic — weekly updates)
  - `Verify:` Manifest produced, ingested via Step Functions
  - `Evidence:` Index alias `au-patents` has data
- [ ] `GET /v1/patents/search?q=wireless+charging` → fuzzy search
  - `Verify:` Curl with search query → matching patents
  - `Evidence:` Results include patent title, abstract, application number, filing date
- [ ] `GET /v1/patents/lookup?application=2024123456` → application details
  - `Verify:` Curl with application number → full patent details
  - `Evidence:` Includes claims, applicant, status
- [ ] Routes defined with `createRoute()`, docs + SDK namespace `prontiq.patents`
  - `Verify:` OpenAPI spec includes patent endpoints; SDK has `prontiq.patents.search()`
  - `Evidence:` Speakeasy regenerated

#### Scope

**In:** Patent/trademark pipeline, search + lookup routes, fuzzy matching, docs, SDK

**Out — Do Not Implement:**

- Patent analytics (citation networks, patent landscaping) → future
- International patents beyond AU/US → future
- Trademark monitoring/alerts → future

---

### Ticket P5.03 — Stripe Meters for CVE + Patents

```yaml
id: P5.03
title: Stripe Meters for CVE + Patents
status: pending
priority: p1-high
epic: P5
depends_on: [P5.01, P5.02]
completed: null
```

#### User Story

As a platform operator, all 5 products are metered and billed so that the invoice shows the full per-product breakdown.

#### Problem Statement

With 5 products live, the invoice must show 5 separate usage line items. P1B.10 billing cron already iterates the full `subscriptionItems` map — it just needs new Stripe metered Prices and corresponding `subscriptionItems` entries populated by the Stripe webhook (P1B.06) on upgrade. This is the completion of the billing system: one subscription, one invoice, per-product line items, the Twilio model.

#### Definition of Done

##### Functional

- [ ] CVE + Patents metered Prices created in Stripe (tiered allocations per plan)
  - `Verify:` Stripe dashboard Products shows all 5 product metered Prices with tiers
  - `Evidence:` 5 Price IDs documented in PLANS constants
- [ ] P1B.06 Stripe webhook populates `subscriptionItems["cve"]` and `subscriptionItems["patents"]` on upgrade (auto — iterates full product set)
  - `Verify:` Upgrade a test account; DDB record shows both entries
  - `Evidence:` DDB diff
- [ ] Invoice shows 5 product line items
  - `Verify:` Generate test invoice with usage across all 5 products
  - `Evidence:` Invoice PDF: "Address API — X", "ABN Verification — Y", "LEI Lookup — Z", "CVE Search — W", "Patent Search — V"
- [ ] Billing cron (P1B.10) reports all 5 products on next hourly run — no code change
  - `Verify:` Usage across all products → hourly cron → Stripe records for each
  - `Evidence:` Stripe usage records for all 5 meters

#### Scope

**In:** Stripe metered Prices for CVE + Patents, PLANS constants update, invoice verification (no billing-cron code change)

**Out — Do Not Implement:**

- Per-product pricing tiers → use unified tier pricing

---

### Ticket P5.04 — Full SDK with All Products

```yaml
id: P5.04
title: Full SDK with All Products
status: pending
priority: p1-high
epic: P5
depends_on: [P5.01, P5.02]
completed: null
tech_stack:
  sdk: Speakeasy
  languages: TypeScript + Python
  publish: npm + PyPI
```

#### User Story

As an API consumer, `npm install @prontiq/sdk` (or `pip install prontiq`) gives me a fully typed client for all 5 products so that I can access the entire platform from one SDK.

#### Problem Statement

This is the capstone: one SDK, 5 product namespaces, 2 languages. The TypeScript SDK has been incrementally updated as each product launched (address → ABN → LEI → CVE → patents). This ticket adds the Python SDK (generated by Speakeasy from the same OpenAPI spec) and ensures both SDKs cover all products. The GitHub Action publishes both to npm and PyPI on spec change.

#### Definition of Done

##### Functional

- [ ] Speakeasy SDK covers all 5 products
  - `Verify:` `import { Prontiq } from "@prontiq/sdk"` → all 5 namespaces available
  - `Evidence:` TypeScript IntelliSense shows `prontiq.address`, `.abn`, `.lei`, `.cve`, `.patents`
- [ ] All 5 namespaces with typed methods
  - `Verify:` Each namespace has correct methods: `address.autocomplete()`, `abn.verify()`, `lei.lookup()`, `cve.search()`, `patents.search()`
  - `Evidence:` Type errors if wrong params; autocompletion on response fields
- [ ] Python SDK generated alongside TypeScript
  - `Verify:` `pip install prontiq` → `from prontiq import Prontiq` → all methods available
  - `Evidence:` PyPI package published
- [ ] Both published to npm/PyPI via GitHub Action
  - `Verify:` OpenAPI spec change → GitHub Action → new versions on npm + PyPI
  - `Evidence:` Workflow run shows publish step succeeded
- [ ] README with examples for both TypeScript and Python
  - `Verify:` npm and PyPI READMEs contain working examples for all 5 products
  - `Evidence:` Examples tested against live API

#### Scope

**In:** TypeScript + Python SDKs, all 5 products, npm + PyPI publish, CI pipeline

**Out — Do Not Implement:**

- PHP/Go/Ruby SDKs → future (Speakeasy supports them, but 2 languages is enough for launch)
- SDK changelog automation → future
- SDK versioning independent of API versioning → future

---

## End State

At completion of Phase 5:

- **5 products** on one platform
- **One API key, one SDK, one invoice**
- **Typed SDKs** in TypeScript + Python
- **Shopify + WooCommerce** plugins
- **~$170/month** infrastructure cost
- **Zero-downtime** data updates via manifest-driven ingestion
- **Full dashboard** with key management, usage, billing, team, playground
- **Comprehensive docs** auto-generated from OpenAPI spec
- **69 tickets completed**
