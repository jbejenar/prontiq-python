# Prontiq Platform — Roadmap

> A unified data API platform for Australian and global open data.
> Last updated: 2026-04-25 · v1.7
>
> **Reference:** `ARCHITECTURE.MD` is the authoritative design doc. This roadmap is the execution plan.

---

## Overview

**Pattern:** Free open dataset → independent pipeline → S3 (NDJSON + manifest.json) → event-driven indexing → OpenSearch → commercial API → auth / billing / docs / SDKs.

**Stack:** SST v4 + Pulumi · Hono + @hono/zod-openapi · OpenSearch 2.19 · DynamoDB (DDB-native keys, hash-based) · Clerk · Lago (target) · Stripe (legacy live path / payment rail) · Next.js 15 · Mintlify · Speakeasy

**Repo:** pnpm monorepo with Turborepo. Frontend foundations are now scaffolded in-repo via `apps/landing`, `apps/console`, `packages/tokens`, and workspace-wired `sdks/typescript`. TypeScript strict. ESM only.

> **Commercial architecture migration note.** The repo currently ships a
> Stripe-centric billing path (`P1B.03`, `P1B.06`, `P1B.10`, `P1B.11`), but the
> forward-looking commercial architecture is now Lago-centered. Legacy
> Stripe-specific billing tickets remain below as historical implementation or
> superseded planning context until the Lago migration sequence fully replaces
> them.

---

## Summary

| Phase     | Epic                       | Tickets | Done      | Target      |
| --------- | -------------------------- | ------- | --------- | ----------- |
| **P0**    | Infrastructure Foundation  | 6       | 6/6 ✅    | Week 1      |
| **P1A**   | API Core (Address)         | 13      | 10/13     | Weeks 2-3   |
| **P1B**   | Auth & Billing             | 22      | 16/22     | Weeks 3-4   |
| **P1C**   | Frontend Surfaces          | 9       | 3/9       | Weeks 4-6   |
| **P1D**   | Docs & SDK                 | 5       | 2/5       | Week 5      |
| **P1E**   | Ingestion (Phase 1)        | 6       | 4/6       | Week 6      |
| **P1F**   | Distribution               | 3       | 3/3 ✅    | Week 6      |
| **P2**    | ABN/ASIC Verification      | 8       | 0/8       | Weeks 7-10  |
| **P3**    | GLEIF/LEI + Full Dashboard | 7       | 0/7       | Weeks 11-13 |
| **P4**    | Shopify + WooCommerce      | 5       | 0/5       | Weeks 14-17 |
| **P5**    | CVE/NVD + Patents          | 4       | 0/4       | Weeks 18-21 |
| **Total** |                            | **88**  | **43/88** |             |

---

## Phase 0 — Infrastructure Foundation

> **Goal:** Everything needed before the first line of product code runs in AWS.

---

### Ticket P0.01 — IAM Deploy Role for SST v3

```yaml
id: P0.01
title: IAM Deploy Role for SST v3
status: complete
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
status: complete
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

- Preview deployments per PR → future
- SDK generation workflow → P1D.04

---

### Ticket P0.04 — ESLint + Prettier Configuration

```yaml
id: P0.04
title: ESLint + Prettier Configuration
status: complete
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
- Commit message linting (conventional commits) → future

---

### Ticket P0.05 — Dependabot Configuration

```yaml
id: P0.05
title: Dependabot Configuration
status: complete
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
status: complete
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

Enrichment is the premium feature — boundaries (LGA, electorates, mesh blocks, SA2-SA4, GCCSA) are what no competitor offers at this price point. The enrich endpoint is a simple `GET` by document ID, returning all fields. It is commercially gated because it's the upsell driver: free-tier autocomplete gets developers in, boundary enrichment converts them to paid.

#### Definition of Done

##### Functional

- [ ] Returns all fields: address, geocode, boundaries (LGA, ward, electorate, meshblock, SA2-SA4, GCCSA)
  - `Verify:` `curl .../v1/address/enrich?id=GASA_422206807`
  - `Evidence:` Response includes `boundaries.lga.name: "Lower Eyre Council"`, `boundaries.stateElectorate.name: "FLINDERS"`, `boundaries.commonwealthElectorate.name: "GREY"`, `boundaries.gccsa.code: "4RSAU"`, etc.
- [ ] Returns 404 for unknown ID with proper error format
  - `Verify:` `curl .../v1/address/enrich?id=NONEXISTENT`
  - `Evidence:` `{"error":{"code":"NOT_FOUND","status":404,...}}`
- [ ] Commercial gating enforced for paid access (free tier gets 403)
  - `Verify:` Request with free-tier key returns 403 `PRODUCT_NOT_ALLOWED`
  - `Evidence:` Enrich route checks the active commercial entitlement in auth middleware

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
status: complete
priority: p1-high
epic: P1A
persona: [api-consumer]
depends_on: [P1A.01]
completed: 2026-04-19
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
status: done
priority: p1-high
epic: P1A
persona: [builder, ops]
depends_on: [P1A.02]
completed: 2026-04-25
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

> **Goal:** Sign-up → DDB-native API key → hash-verified requests → rate-limited with burst limiter → usage tracked per-month → migrate the commercial layer from the shipped Stripe path to the Lago target architecture.
>
> **Current state.** P1B.02, P1B.04, P1B.04b, P1B.05, P1B.06, P1B.07, P1B.08, P1B.09, P1B.10, P1B.11, P1B.12, P1B.14, P1B.15, and P1B.16 are shipped. The DynamoDB-native key model is live in prod, the prod migration was executed on 2026-04-16, the legacy Stripe billing path is live, per-key burst limiting is enforced in the API middleware, SES feedback / quota-email delivery is live in dev + prod, previous-month scopes are now explicitly finalized and closed by the monthly `PqMonthClose` sweep, the auth integration suite is reconciled to the real post-cutover middleware contract, and the Lago migration now has a platform-owned `customerId` contract, feature-flagged SQS billing-event buffer, and replay-safe Lago event forwarder. SES deliverability hardening is tracked separately in P1B.08a. The next Lago migration ticket is P1B.17.
>
> **Lago migration progress.** `3/7` complete for `P1B.14`–`P1B.20`. The `P1B` epic rollup includes completed historical Stripe-path work, so treat the Lago migration sequence as a separate track until the new commercial runtime is implemented.
>
> **Scope boundary.** The hot-path middleware rewrite (hash-based lookup, REDIRECT fallback, new usage-table writes) ships in **P1B.04b** (cutover), NOT in P1B.02. P1B.02 is pure crypto primitives only — no DDB dependency — which is why it remains parallel-safe. P1B.04b flips schema + code atomically once P1B.02 and P1B.04 are both done.
>
> **Dependency graph:** P1B.01/.02/.03/.04 can run in parallel. P1B.04b depends on .02 + .04 (needs the crypto module + the tables to write the code cutover). P1B.05 depends on .01/.02/.03/.04. P1B.06 depends on .03/.04. P1B.07/.08 depend on .04. P1B.08a depends on .08. **P1B.09 depends on .02 + .04b** (the burst limiter middleware reads `record.rateLimit` from context — that context is established by the post-cutover auth middleware in .04b, not by the pure crypto module). P1B.10 depends on .03/.04/.06. P1B.11 depends on .10. P1B.12 depends on .05/.09/.04b (tests the cutover end-to-end). The Lago migration sequence is intentionally linear enough to pin the commercial contract before the console UI builds on it: `P1B.14` → `P1B.15/.16` → `P1B.17/.18` → `P1B.19` → `P1B.20`, with `P1C.05` consuming the backend contract from `P1B.18`.
>
> **Repo-wide Unkey removal** completed in PR #68 (`chore(webhooks): remove Unkey code`) — `packages/webhooks/src/unkey.ts`, `unkeyWebhook` export, `lastSyncedFromUnkey` field, and `UNKEY_*` env vars all gone from main. **No P1B ticket owns this cleanup.** Going forward, P1B tickets only need to guarantee no NEW Unkey references are introduced.
>
> **Architecture reference:** ARCHITECTURE.MD §5.5 (schema), §5.6 (billing), §5.7 (webhooks), §7 (endpoints), §9 (error taxonomy). Decision rationale: ADR-001.

---

### Ticket P1B.01 — Clerk Application Setup

```yaml
id: P1B.01
title: Clerk Application Setup
status: done
priority: p0-critical
epic: P1B
persona: [builder]
depends_on: [P0.02]
completed: 2026-04-25
tech_stack:
  auth: Clerk
  framework: Next.js 15
```

#### User Story

As a builder, I need a Clerk application configured with OAuth providers and an org-membership webhook so that users can sign up and the org provisioning chain is triggered automatically.

#### Problem Statement

Clerk handles human identity: sign-up, login, OAuth (Google/GitHub), organisations, and team management. The console authenticates through Clerk. The shipped provisioning path hangs off `organizationMembership.created`, which creates the org envelope and the current migration-era commercial records idempotently. Without Clerk, there is no sign-up flow, no org context, and no authenticated dashboard path.

#### Definition of Done

##### Functional

- [ ] Clerk application created (dev + prod instances)
  - `Verify:` Clerk dashboard shows application with two instances
  - `Evidence:` Application ID and instance URLs
- [ ] Google and GitHub OAuth configured
  - `Verify:` Sign-up page shows Google + GitHub buttons
  - `Evidence:` Clerk dashboard OAuth providers list
- [ ] Webhook URL configured for the organisation-membership provisioning event
  - `Verify:` Clerk dashboard webhooks section shows endpoint URL and subscribed membership event
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
status: complete
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

### Ticket P1B.03 — Stripe Setup (Historical Stripe Catalog Baseline)

```yaml
id: P1B.03
title: Stripe Setup (Historical Stripe Catalog Baseline)
status: complete
priority: p0-critical
epic: P1B
persona: [builder]
depends_on: []
completed: 2026-04-18
tech_stack:
  billing: Stripe (metered, tiered Prices)
```

> Legacy shipped path. This ticket describes the current Stripe-centric
> implementation and is superseded as forward-looking architecture by the Lago
> migration sequence (`P1B.14`–`P1B.20`).

#### User Story

As a builder, I needed the historical Stripe billing baseline configured so the
initial shipped commercial path could provision customers, sync usage, and
invoice through Stripe while the platform still used the pre-Lago model.

#### Problem Statement

This ticket records the historical Stripe catalog and constants work that
backed the originally shipped billing path. It is retained as implementation
history only. The forward path is now the Lago migration sequence.

#### Historical Shipped State

This ticket is complete because the legacy Stripe billing baseline was
implemented and is still present in the shipped migration-era stack.

- [x] Historical Stripe catalog and family meters created for the legacy
      billing path
  - `Verify:` Stripe dashboard products/prices/meters exist for the old model
  - `Evidence:` legacy Stripe-backed catalog remains the current shipped path
    recorded by this ticket
- [x] Shared billing constants created for the historical Stripe-backed model
  - `Verify:` Stripe Billing → Prices section, inspect the family meter-backed prices
  - `Evidence:` historical constants and pricing assumptions remain captured in
    the repo and legacy Stripe configuration
- [x] `PLANS` and `BILLING_ENDPOINTS` constants added to `packages/shared/src/constants.ts` for the then-current model
  - `Verify:` `pnpm typecheck` passes
  - `Evidence:` current runtime still carries the legacy paid-tier ladder in
    `packages/shared/src/constants.ts`
- [x] Webhook URL configured for `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed`
  - `Verify:` Stripe dashboard Webhooks section
  - `Evidence:` legacy Stripe webhook remains deployed at `{api-url}/webhooks/stripe`
- [x] Historical retry and cancellation settings configured for the Stripe path
  - `Verify:` Stripe dashboard → Settings → Billing → Subscriptions and emails
  - `Evidence:` current legacy billing path still assumes the configured Stripe
    retry/cancellation behavior documented in the runbooks
- [x] `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` in SST secrets
  - `Verify:` Webhook handler Lambda has access
  - `Evidence:` the shipped legacy Stripe webhook path still depends on these
    secrets during the Lago migration window

#### Scope

**In:** historical Stripe products/prices/meters, retry policy, webhook
endpoints, constants, secrets

**Out — Do Not Implement:**

- Webhook handler → P1B.06
- Billing cron → P1B.10
- `/account` Billing tab → P1C.05
- Custom commercial contracts → future

---

### Ticket P1B.04 — DynamoDB Tables (4 tables + schema)

```yaml
id: P1B.04
title: DynamoDB Tables (4 tables + schema)
status: complete
priority: p0-critical
epic: P1B
persona: [builder]
depends_on: [P0.02]
completed: 2026-04-16
tech_stack:
  infra: SST v4 + Pulumi
  data: DynamoDB
```

#### User Story

As a builder, I need four DynamoDB tables (`prontiq-keys`,
`prontiq-usage`, `prontiq-audit`, `prontiq-ses-suppressions`) with the exact
schema defined in ARCHITECTURE.MD §5.5.1 so that subsequent tickets have the
infra they need to write auth, usage, audit, and suppression state.

#### Problem Statement

v2.2 splits the single legacy `ApiKeyTable` into four purpose-specific tables:
hot-path isolation, append-only audit logging, TTL-driven cleanup, and
hash-only API-key storage. Registry and provisioning-lock records are sentinel
items in `prontiq-keys` with reserved PKs.

#### Historical Shipped State

- [x] `prontiq-keys` table shipped with PK `apiKeyHash` and sparse
      `orgId-index`
- [x] `prontiq-usage` table shipped with PK `apiKeyHash`, SK `scope`, TTL, and
      sparse `newHash-redirect-index`
- [x] `prontiq-audit` table shipped with PK `orgId`, SK `timestamp#eventId`,
      and TTL
- [x] `prontiq-ses-suppressions` table shipped with PK `email` and TTL
- [x] all tables use on-demand billing
- [x] table definitions deployed successfully in `dev` and `prod` as part of
      the live v2.2 cutover

#### Scope

**In:** four DynamoDB tables via SST, TTL config, required GSIs

**Out — Do Not Implement:**

- Data migration from legacy table → P1B.04b
- Table writes → later tickets
- Registry sharding → Phase 5 trigger

---

### Ticket P1B.13 — Historical Stripe Checkout Orchestration Planning

```yaml
id: P1B.13
title: Historical Stripe Checkout Orchestration Planning
status: superseded
priority: p1-high
epic: P1B
persona: [builder]
depends_on: [P1B.03, P1B.06]
completed: null
tech_stack:
  billing: Stripe Checkout
```

> Superseded planning. The forward commercial direction is now Lago-backed
> billing orchestration rather than new Checkout-session investment.

#### User Story

As a builder, I planned a server-side Stripe purchase orchestration flow for the
old commercial model before the architecture pivoted to Lago.

#### Problem Statement

This ticket is retained only as superseded planning history. The new forward
path is the Lago migration sequence, not new Stripe purchase orchestration.

#### Historical Superseded State

- The historical idea was to add more server-side Checkout-session
  orchestration on top of the Stripe catalog established in `P1B.03`.
- That work should not be resumed. The forward commercial contract is now:
  Prontiq-owned customer mapping, SQS billing-event buffering, Lago event
  forwarding, and Lago-backed billing surfaces.
- Keep this ticket only as a record of what was intentionally abandoned so
  future planning does not accidentally reopen Stripe-first purchase work.

#### Scope

**In:** superseded historical planning only

**Out — Do Not Implement:**

- all new commercial implementation work → `P1B.14`–`P1B.20`

---

### Ticket P1B.14 — CustomerId + Customer Mapping Contract

```yaml
id: P1B.14
title: CustomerId + Customer Mapping Contract
status: complete
priority: p0-critical
epic: P1B
persona: [builder]
depends_on: [P1B.05]
completed: 2026-04-25
tech_stack:
  billing: Lago + DynamoDB
```

#### User Story

As a builder, I need one stable org-scoped `customerId` contract across Clerk,
Prontiq, Lago, and the migration-era Stripe records so that every human,
machine, and billing workflow resolves to the same commercial customer without
duplication.

#### Problem Statement

The shipped platform still carries Stripe-era customer linkage, while the
forward architecture makes Lago the target commercial system of record. Without
a first-class `customerId` contract, the console, billing worker, Lago event
forwarder, and reconciliation flows would each invent their own identity join
logic. That would make backfill unsafe and would leave the request path,
dashboard, and billing system disagreeing about who the customer actually is.

#### Definition of Done

##### Functional

- [x] Target `customerId` contract is defined as the org-scoped platform
      customer identifier
  - `Verify:` `ARCHITECTURE.MD`, roadmap ticket text, and billing guide all use
    the same identity wording
  - `Evidence:` `ARCHITECTURE.MD` §5.6.0.1 and `packages/docs/guides/billing.mdx`
    define `customerId` as opaque `pq_cust_<ulid>` shared across Clerk orgs,
    Prontiq, Lago `external_id`, and migration-era Stripe linkage
- [x] `customers` table / mapping row shape is specified
  - `Verify:` roadmap ticket defines required fields and ownership boundaries
  - `Evidence:` `ARCHITECTURE.MD` §5.5.1 defines target
    `prontiq-customers` with `orgId`, `customerId`,
    `lagoExternalCustomerId`, nullable `lagoCustomerId`, nullable
    `stripeCustomerId`, lifecycle status, timestamps, and conflict metadata
- [x] Existing orgs can be backfilled into the new mapping without minting
      duplicate commercial identities
  - `Verify:` backfill plan defines deterministic lookup precedence and
    duplicate-collision handling
  - `Evidence:` `ARCHITECTURE.MD` §5.6.0.1 and
    `docs/runbooks/lago-customer-sync.md` require preserving existing mapping by
    `orgId`, creating exactly one `customerId` from `ORG#{orgId}`, and marking
    ambiguous duplicate/mismatch cases as `migration_conflict`
- [x] Both human auth and API-key auth resolve to the same commercial customer
      model
  - `Verify:` ticket explicitly ties Clerk-authenticated console actions and
    API-key-authenticated usage to the same `customerId`
  - `Evidence:` `ARCHITECTURE.MD` §5.6.0.1 requires Clerk console flows to
    resolve by `orgId`, while API-key request flows use denormalized
    `customerId` from `prontiq-keys` without reading `prontiq-customers`

##### Operational

- [x] Migration rules are explicit before downstream Lago tickets start
  - `Verify:` `P1B.15`–`P1B.18` can consume `customerId` without redefining
    identity semantics
  - `Evidence:` ADR-013, ADR-014, ADR-015, architecture docs, and Lago runbooks
    define the identity, table, external-id mapping, backfill, conflict, and
    hot-path denormalization contracts

#### Scope

**In:** `customerId` contract, `customers` mapping ownership, backfill rules,
identity resolution contract across Clerk/orgs/API keys/Lago/legacy Stripe

**Out — Do Not Implement:**

- event buffering → `P1B.15`
- Lago event forwarding → `P1B.16`
- webhook reconciliation → `P1B.17`
- console billing UI → `P1C.05`

#### Shipped Evidence

- `docs/decisions/013-platform-owned-customer-id.md` chooses platform-owned
  `pq_cust_<ulid>` values and rejects Clerk, Stripe, Lago, and `ORG#{orgId}` as
  canonical commercial identity.
- `docs/decisions/014-dedicated-customers-table.md` defines the target
  `prontiq-customers` table and no-hot-path-read invariant.
- `docs/decisions/015-lago-external-id-equals-customer-id.md` pins
  `lagoExternalCustomerId = customerId` and treats Lago `lago_id` as nullable
  provider cache data.
- `ARCHITECTURE.MD`, Lago runbooks, public billing docs, frontend strategy, and
  handoff docs now align on the same customer mapping and migration contract.

---

### Ticket P1B.15 — SQS Billing Event Buffer + Hot-Path Emitter

```yaml
id: P1B.15
title: SQS Billing Event Buffer + Hot-Path Emitter
status: done
priority: p0-critical
epic: P1B
persona: [builder]
depends_on: [P1B.14]
completed: 2026-04-25
tech_stack:
  billing: SQS + DynamoDB
```

#### User Story

As a builder, I need the API hot path to emit durable billing events into SQS
instead of calling Lago directly so that request handling remains fast and safe
even when the billing system is degraded.

#### Problem Statement

Prontiq's request path must continue to enforce credits synchronously in
DynamoDB, but Lago cannot sit on the hot path. The new architecture requires a
durable queue between synchronous enforcement and asynchronous billing. Without
that buffer, Lago outages or retries would bleed into request latency and make
commercial correctness compete with API availability.

#### Definition of Done

##### Functional

- [x] Billing-event payload emitted from request handling is defined
  - `Verify:` ticket specifies required fields for downstream Lago forwarding
  - `Evidence:` payload includes `customerId`, api key identity, product /
    metric identity, credit delta, timestamp, source request metadata, and a
    deterministic event identity input
- [x] Request handling emits billing events only after synchronous enforcement
      succeeds
  - `Verify:` architecture text and ticket wording keep DynamoDB enforcement on
    the hot path and billing emission asynchronous
  - `Evidence:` DoD explicitly states "enforce first, enqueue second, never call
    Lago from the request handler"
- [x] Queue retry / DLQ / duplicate-delivery expectations are specified
  - `Verify:` ticket defines retry posture and how poison messages are handled
  - `Evidence:` SQS + DLQ behavior and replay assumptions are documented
- [x] Event identity is deterministic enough for downstream idempotency
  - `Verify:` `P1B.16` can derive a stable Lago transaction id from this event
    contract
  - `Evidence:` deterministic event-identity inputs described in ticket body

##### Operational

- [x] Lago unavailability does not break request handling
  - `Verify:` ticket explicitly states the availability boundary
  - `Evidence:` acceptance text says requests remain gated only by local
    enforcement + successful queue write
- [x] Queue failure semantics are explicit
  - `Verify:` ticket defines what happens when SQS write fails after local
    enforcement
  - `Evidence:` retry / audit / operator follow-up expectations are spelled out

#### Scope

**In:** SQS billing-event schema, emitter contract, queueing semantics,
idempotency inputs, hot-path boundary

**Out — Do Not Implement:**

- Lago forwarding worker → `P1B.16`
- webhook reconciliation → `P1B.17`
- console-facing billing APIs → `P1B.18`

#### Implementation Notes

- `BillingUsageEventV1` lives in `@prontiq/shared/billing-events`.
- `prontiq-customers` is declared in SST with `customerId-index`.
- `@prontiq/control-plane` writes `customerId` for new org provisioning and
  provides `backfill:customers` for legacy envelopes/API keys.
- The API producer is feature-flagged by `BILLING_EVENTS_ENABLED`; default is
  `false` until the `P1B.16` consumer is deployed and the environment passes
  Lago setup plus replay smoke checks.
- Queue type is standard SQS; deterministic event ids provide replay
  idempotency for the future Lago worker.

---

### Ticket P1B.16 — Lago Event Forwarder Worker + Idempotent Transaction IDs

```yaml
id: P1B.16
title: Lago Event Forwarder Worker + Idempotent Transaction IDs
status: done
priority: p0-critical
epic: P1B
persona: [builder]
depends_on: [P1B.15]
completed: 2026-04-25
tech_stack:
  billing: Lago
```

#### User Story

As a builder, I need a replay-safe worker that consumes queued billing events,
writes local delivery evidence, and forwards them to Lago with
deterministic transaction ids so that retries and replays never double-bill the
customer.

#### Problem Statement

Once billing events are buffered in SQS, Prontiq still needs a safe bridge into
Lago. If the worker generates ad hoc transaction ids or records delivery
evidence ambiguously, retries will either lose events or double charge. The
worker must therefore treat replay-safety and delivery evidence as the primary
invariants.

#### Definition of Done

##### Functional

- [x] Worker contract is defined from dequeue to Lago forward
  - `Verify:` roadmap text specifies dequeue, validation, delivery-ledger write,
    Lago payload construction, and ack/retry boundaries
  - `Evidence:` ticket body documents the ordered worker responsibilities
- [x] Lago transaction id generation is deterministic
  - `Verify:` same billing event always produces the same Lago transaction id
  - `Evidence:` transaction-id derivation rules are documented against the
    `P1B.15` event contract
- [x] Duplicate processing is safe
  - `Verify:` worker replay of the same event cannot double-bill in Lago
  - `Evidence:` ticket explicitly requires duplicate suppression via
    deterministic transaction ids and idempotent worker behavior
- [x] Platform-side delivery evidence is defined as a side-effect of the worker,
      not the request path
  - `Verify:` roadmap makes delivery-ledger persistence part of async billing
    flow
  - `Evidence:` ticket body describes delivery evidence responsibility and
    ordering

##### Operational

- [x] Worker failure leaves the event retryable
  - `Verify:` ticket defines failure boundaries before/after Lago acceptance
  - `Evidence:` retry semantics described for transient Lago/network failures
- [x] Replay path is explicit
  - `Verify:` operators can safely replay queued billing events without manual
    data surgery
  - `Evidence:` ticket text references deterministic replay-safety expectations

#### Scope

**In:** worker contract, deterministic transaction ids, Lago event payload
bridge, delivery-ledger side effects, retry/replay safety

**Out — Do Not Implement:**

- queue emitter semantics → `P1B.15`
- reconciliation from Lago back into counters → `P1B.17`
- console billing endpoints → `P1B.18`

#### Implementation Notes

- `PqLagoEventForwarder` subscribes to the standard billing-event queue with
  SQS partial batch responses.
- `eventId` is the Lago `transaction_id`; replaying the same event produces the
  same Lago idempotency key.
- `external_subscription_id` is derived from `customerId` by replacing
  `pq_cust_` with `pq_sub_`.
- The Lago payload is intentionally minimal: metric code, timestamp, and
  `properties.credits = creditDelta`.
- Delivery evidence is stored in `prontiq-billing-event-deliveries` with
  payload-hash conflict detection, accepted/failed/invalid statuses, attempt
  counts, and a customer/time GSI for operational review.
- `BILLING_EVENTS_ENABLED` remains a separate rollout flag. It must stay false
  until the target environment has canonical Lago metrics/subscriptions and a
  successful replay smoke check.

---

### Ticket P1B.17 — Lago Webhook Sync + Credit-Counter Reconciliation

```yaml
id: P1B.17
title: Lago Webhook Sync + Credit-Counter Reconciliation
status: pending
priority: p0-critical
epic: P1B
persona: [builder]
depends_on: [P1B.16]
completed: null
tech_stack:
  billing: Lago webhooks
```

#### User Story

As a builder, I need Lago subscription and billing-period events to reconcile
back into Prontiq's enforcement state so that capped plans reset correctly,
PAYG stays uncapped but tracked, and the platform can detect drift without
making Lago authoritative for hot-path enforcement.

#### Problem Statement

The target architecture deliberately splits responsibilities: Lago owns
commercial truth, while DynamoDB `credit_counters` remains enforcement state.
That split only works if the platform knows which Lago events it consumes, what
they are allowed to mutate locally, and how repeated delivery or drift is
handled. Without explicit reconciliation rules, capped plans will reset
incorrectly and the console will show stale state.

#### Definition of Done

##### Functional

- [ ] Consumed Lago event set is defined
  - `Verify:` ticket names the subscription / invoice / billing-boundary events
    the platform reacts to
  - `Evidence:` reconciliation contract documents event categories and local
    side-effects
- [ ] Authority boundary between Lago and `credit_counters` is explicit
  - `Verify:` roadmap text states Lago is commercial truth while
    `credit_counters` remains enforcement state
  - `Evidence:` ticket body distinguishes plan / invoice / wallet state from
    request-time local counters
- [ ] Billing-boundary reset behavior is defined for capped plans
  - `Verify:` monthly / billing-period reset semantics are described
  - `Evidence:` ticket states which local counters reset and which audit/history
    rows remain append-only
- [ ] PAYG reconciliation behavior is defined separately from capped plans
  - `Verify:` roadmap text does not pretend PAYG needs hard reset semantics
  - `Evidence:` ticket says PAYG remains uncapped but tracked and reconciled for
    visibility / drift only
- [ ] Drift-detection path is documented
  - `Verify:` ticket describes what mismatch between Lago state and local
    counters looks like and how operators recover
  - `Evidence:` reconciliation section includes drift follow-up expectation

##### Operational

- [ ] Webhook processing is idempotent
  - `Verify:` repeated Lago delivery does not corrupt counters or duplicate
    transitions
  - `Evidence:` ticket text requires idempotent local writes keyed by event
    identity
- [ ] Reconciliation remains off the request path
  - `Verify:` no live request depends on synchronous webhook processing
  - `Evidence:` ticket preserves async-only reconciliation model

#### Scope

**In:** Lago webhook consumption, authority boundaries, counter resets,
PAYG-vs-capped reconciliation, drift handling

**Out — Do Not Implement:**

- initial customer mapping → `P1B.14`
- queue emitter / forwarder implementation → `P1B.15` / `P1B.16`
- billing UI rendering → `P1C.05`

---

### Ticket P1B.18 — Console Billing Proxy Surfaces + Plan Changes

```yaml
id: P1B.18
title: Console Billing Proxy Surfaces + Plan Changes
status: pending
priority: p1-high
epic: P1B
persona: [api-consumer]
depends_on: [P1B.17]
completed: null
tech_stack:
  billing: Lago + account APIs
```

#### User Story

As an API consumer using the console, I need Prontiq-owned billing/account
surfaces for current billing state, current plan, invoices, and plan changes so
that the dashboard is built on a stable platform contract rather than direct
Stripe-first UX.

#### Problem Statement

The console billing page should consume Prontiq-owned contract surfaces, not
invent billing logic in the UI and not hard-code a Stripe-hosted user journey
as the long-term model. This ticket exists to define the backend/orchestration
contract that `P1C.05` renders. Without this contract, the frontend would again
be forced to couple itself to migration residue instead of the Lago target
architecture.

#### Definition of Done

##### Functional

- [ ] Console billing/account contract is defined
  - `Verify:` roadmap ticket specifies the backend surfaces the console will
    call
  - `Evidence:` contract covers current billing state, current plan, invoice /
    history links, payment-status messaging, and plan-change actions
- [ ] Plan changes are modeled as Prontiq-owned actions
  - `Verify:` ticket does not treat Stripe Checkout or Customer Portal as the
    forward plan-change surface
  - `Evidence:` contract wording centers on platform-owned proxy/orchestration
    routes with migration-era hosted links clearly labeled if retained
- [ ] `P1C.05` boundary is explicit
  - `Verify:` roadmap shows `P1B.18` defining the contract and `P1C.05`
    rendering the UI on top of it
  - `Evidence:` no circular dependency between backend contract and console page
- [ ] Migration-only legacy links are explicitly constrained
  - `Verify:` any retained Stripe invoice / payment / portal links are described
    as temporary compatibility surfaces
  - `Evidence:` ticket body distinguishes target contract from migration residue

##### Operational

- [ ] Backend contract is stable enough for the console to build against
  - `Verify:` `NEXT-WORK.md` sequencing remains `P1B.18` before deeper billing
    UI work
  - `Evidence:` roadmap dependency chain + ticket wording align

#### Scope

**In:** platform-owned console billing state, migration-aware billing actions,
invoice/history surfaces, plan-change orchestration contract

**Out — Do Not Implement:**

- billing page UI implementation → `P1C.05`
- direct Stripe-first self-service UX as the long-term contract
- custom enterprise/commercial contracting workflows → future

---

### Ticket P1B.19 — Stripe Legacy Billing Retirement and Cutover

```yaml
id: P1B.19
title: Stripe Legacy Billing Retirement and Cutover
status: pending
priority: p1-high
epic: P1B
persona: [ops]
depends_on: [P1B.18]
completed: null
tech_stack:
  billing: Lago + Stripe
```

#### User Story

As an operator, I need a controlled cutover that retires the legacy
Stripe-centric billing path only after the Lago path is verified end to end so
that no active customer is stranded on the old billing flow and rollback remains
possible.

#### Problem Statement

The legacy Stripe path is real production behavior today: provisioning-era
customer linkage, Stripe webhooks, billing cron, and month-close. The Lago
target architecture is not complete until that old path is retired cleanly.
Without an explicit cutover ticket, the repo would accumulate two parallel
billing systems with no clear stop point, no migration evidence, and no safe
rollback plan.

#### Definition of Done

##### Functional

- [ ] Cutover preconditions are defined and satisfied
  - `Verify:` ticket requires `P1B.14`–`P1B.18` to be shipped and verified
  - `Evidence:` cutover checklist references customer mapping, event buffer,
    forwarder, reconciliation, and console billing contract as prerequisites
- [ ] Retirement scope is explicit
  - `Verify:` roadmap names the legacy Stripe cron / month-close /
    control-plane billing path being retired
  - `Evidence:` ticket body lists the legacy billing components and active
    operational paths that are retired at cutover, before follow-on config and
    surface cleanup in `P1B.20`
- [ ] No active customer remains on the retired path
  - `Verify:` cutover validation confirms all live customers are mapped to the
    Lago-backed flow before final retirement
  - `Evidence:` operator verification checklist / migration evidence referenced
- [ ] Cutover-time operating posture is switched to the Lago path
  - `Verify:` operators have one active runbook path for the live commercial
    system immediately after cutover
  - `Evidence:` cutover checklist demotes the legacy Stripe billing runbooks
    from active operations guidance, with deeper config/surface cleanup
    deferred to `P1B.20`

##### Operational

- [ ] Rollback posture is defined before the cutover starts
  - `Verify:` ticket describes what evidence is required to continue or revert
  - `Evidence:` rollback expectations captured in the ticket body
- [ ] Cutover is observable
  - `Verify:` operators have clear signals for Lago-forward path success and
    legacy-path quiescence
  - `Evidence:` acceptance text references operational checks / monitoring

#### Scope

**In:** cutover criteria, legacy Stripe retirement scope, rollback posture,
post-cutover documentation and operations cleanup

**Out — Do Not Implement:**

- initial customer / event / reconciliation contract work → `P1B.14`–`P1B.18`
- legacy config / env / frontend-surface cleanup → `P1B.20`
- future commercial model expansion beyond Free + PAYG

---

### Ticket P1B.20 — Legacy Stripe Config and Surface Cleanup

```yaml
id: P1B.20
title: Legacy Stripe Config and Surface Cleanup
status: pending
priority: p1-high
epic: P1B
persona: [ops, builder]
depends_on: [P1B.19]
completed: null
tech_stack:
  billing: Lago + Stripe
  config: SST + Next.js env contracts
```

#### User Story

As an operator and builder, I need the repo cleaned of retired Stripe-era
billing configuration and migration-only frontend surfaces after cutover so
that the codebase, deploy config, and docs reflect the actual Lago target
architecture instead of preserving dead billing paths indefinitely.

#### Problem Statement

`P1B.19` gets the platform across the commercial cutover, but it is not enough
to leave legacy Stripe-era configuration hanging around afterward. The repo
still contains billing-only secrets, env contracts, landing-page pricing-table
surfaces, and deploy wiring that are valid during migration but should not
survive as silent permanent debt. If they are not removed explicitly, the repo
will keep telling future engineers that both billing systems still matter.

#### Definition of Done

##### Functional

- [ ] Billing-only Stripe env and secret contracts are audited and reduced to
      the post-cutover minimum
  - `Verify:` every remaining `STRIPE_*` env/secret has an intentional
    payment-rail consumer in the final architecture
  - `Evidence:` env contract diff across `sst.config.ts`, app env schemas,
    deploy docs, and runbooks
- [ ] Retired landing pricing-table surfaces are removed once no active flow
      depends on them
  - `Verify:` `apps/landing` no longer renders or documents the legacy Stripe
    pricing-table path
  - `Evidence:` component/env/content/test cleanup removes the pricing-table
    fallback surface when the post-cutover billing UX is live
- [ ] Legacy Stripe billing deploy/runtime wiring is removed or explicitly
      tombstoned
  - `Verify:` webhook/cron/month-close billing-only paths are no longer treated
    as active deploy targets after cutover
  - `Evidence:` code/config/docs diff shows retired Stripe billing surfaces
    deleted or moved into historical-only context
- [ ] Operator docs are reconciled to post-cutover reality
  - `Verify:` canonical docs and runbooks no longer instruct operators to set
    or maintain retired Stripe billing config
  - `Evidence:` runbook/doc updates describe only intentional remaining Stripe
    payment-rail responsibilities

##### Operational

- [ ] Cleanup is verified by search, not just by spot checks
  - `Verify:` targeted grep over `STRIPE_`, `pricing table`, `PqBillingCron`,
    and `PqMonthClose` leaves only intentional historical/payment-rail matches
  - `Evidence:` recorded verification commands / outputs in PR or session notes
- [ ] Post-cutover deploy contract is simpler than the migration contract
  - `Verify:` deploy-stage secret inventory shrinks after cleanup
  - `Evidence:` AGENTS / README / runbooks no longer require migration-only
    Stripe billing config

#### Scope

**In:** legacy Stripe billing config cleanup, landing pricing-table retirement,
post-cutover secret/env cleanup, doc/runbook reconciliation, grep-based proof

**Out — Do Not Implement:**

- the Lago cutover itself → `P1B.19`
- removing Stripe payment-rail responsibilities that still exist in the final
  Lago architecture
- broader frontend redesign work beyond removing migration-only surfaces

---

### Ticket P1B.04b — Data Migration + Middleware Cutover (Legacy Schema → v2.2)

```yaml
id: P1B.04b
title: Data Migration + Middleware Cutover (Legacy Schema → v2.2)
status: complete
priority: p0-critical
epic: P1B
persona: [ops]
depends_on: [P1B.02, P1B.04]
completed: 2026-04-16
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

- [x] `packages/api/src/middleware/auth.ts` rewritten: hash incoming `X-Api-Key` via `hashKey` (from P1B.02), `GetItem` from `prontiq-keys` by hash
  - `Verify:` Unit + integration test — valid key returns 200; invalid returns 401 `INVALID_API_KEY`
  - `Evidence:` `packages/api/src/middleware/auth.ts` now reads `prontiq-keys` by `apiKeyHash` and is covered by integration tests
- [x] REDIRECT fallback with `authValidUntil` grace check (per ARCHITECTURE.MD §5.5.1 + §12.3): on `prontiq-keys` miss, `GetItem` from `prontiq-usage` with `{apiKeyHash: oldHash, scope: "REDIRECT"}`; if present AND `authValidUntil > now()` → re-resolve via `record.newHash` and GetItem the new key (one retry, no loop). If `authValidUntil <= now()` → 401 `INVALID_API_KEY` regardless of `ttl`. The redirected-to record is then subject to the standard `active` check (so REVOKE-after-ROTATE naturally rejects).
  - `Verify:` Three integration tests — (a) seed REDIRECT with `authValidUntil` in future + valid newHash → 200; (b) same but with `authValidUntil` in past → 401; (c) seed REDIRECT pointing at a revoked (`active: false`) newHash → 401 via active check
  - `Evidence:` `packages/api/src/middleware/auth.integration.test.ts` covers redirect success, expired redirect, inactive target, missing target, and self-loop rejection
- [x] **Atomic quota enforcement** (per ARCHITECTURE.MD §5.5.3 step 4): replace the read-then-async-write pattern in `usage.ts` with a single conditional `UpdateItem` on `prontiq-usage`:
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
  - `Evidence:` Integration tests cover free-tier quota boundaries, paid overage, and the live middleware path through `prontiq-usage`
- [x] **Expression syntax test** (catches the SET/ADD mistake before deploy):
  - `Verify:` Unit test invokes the auth middleware against DynamoDB Local with a seeded `prontiq-keys` row and an absent `prontiq-usage` row. First request creates the usage item with `requestCount=1` and `lastUsedAt` set. Second request increments. Test deliberately constructs the UpdateExpression as a string and fails-fast if any `ADD ... = ...` substring is present anywhere in the codebase (regex: `ADD\s+\w+\s+\S+\s*,\s*\w+\s*=`).
  - `Evidence:` Local build/test validation plus middleware integration coverage against DynamoDB Local
- [x] `packages/api/src/middleware/usage.ts` deleted or reduced to a thin wrapper — the atomic UpdateItem now lives inside `auth.ts` (combined check + increment) since they share the DDB call
  - `Verify:` `grep -n "UpdateCommand" packages/api/src/middleware/auth.ts` shows the conditional update
  - `Evidence:` Hot-path usage accounting now lives in `auth.ts`; the old nested-map update path is no longer the runtime path
- [x] `ApiKeyRecord` type in `packages/shared/src/types.ts` updated to v2.2 shape: `apiKeyHash`, `keyPrefix`, `ownerEmail`, `orgId`, `tier`, `products`, `quotaPerProduct`, `rateLimit`, `active`, `paymentOverdue`, `stripeCustomerId`, `stripeSubscriptionId`, `subscriptionItems`, `createdAt`, `lastUsedAt` — **no `usage` nested map**, **no `monthlyQuotaPerProduct`**
  - `Verify:` `pnpm typecheck` passes
  - `Evidence:` Shared types/constants were updated to the v2.2 key model and build cleanly
- [x] `TABLE_NAME` env var updated from `ApiKeyTable` to `KEYS_TABLE_NAME=prontiq-keys` + new `USAGE_TABLE_NAME=prontiq-usage` (wired via SST)
  - `Verify:` Lambda env vars inspected via `aws lambda get-function-configuration`
  - `Evidence:` `sst.config.ts` now wires the API Lambda to `KEYS_TABLE_NAME` and `USAGE_TABLE_NAME`

##### Functional — Data Migration

- [x] `scripts/migrate-api-keys.ts` reads every item in legacy `ApiKeyTable`
  - `Verify:` Scan count logged
  - `Evidence:` `packages/api/src/scripts/migrate-api-keys.ts` shipped with focused migration tests
- [x] For each legacy item: compute `hashKey(rawKey)`, `PutItem` to `prontiq-keys` with v2.2 shape (`subscriptionItems` may be empty until P1B.06 populates them on next Stripe event)
  - `Verify:` `aws dynamodb get-item` on new table returns expected record
  - `Evidence:` The shipped migration script writes v2.2 key records and is idempotent across reruns
- [x] For each `usage.{product}.{month}` entry, `PutItem` to `prontiq-usage` with PK=apiKeyHash, SK=`{product}#{month}`, `requestCount`, `lastPushedCumulativeCount: requestCount` (set to the live count so the next cron sees a delta of 0 — legacy usage was never pushed via this cron, but the rename happens in v2.2 and we're not retroactively pushing existing usage), `ttl` 90 days out
  - `Verify:` Row count in `prontiq-usage` matches sum of nested entries
  - `Evidence:` Prod `prontiq-usage` rows were created during the executed migration; current auth traffic increments the new monthly rows
- [x] Legacy seed key `pq_live_prod_000...` rotated: new key in new format issued to the owner (manual step — document who owns the seed and notify before running)
  - `Verify:` Old seed returns 401 after cutover; new key works
  - `Evidence:` Rotation was executed in prod on 2026-04-16; the old seed is revoked and the replacement `pq_live_...` key is active
- [x] Migration script is idempotent: re-running on an already-migrated table is a no-op
  - `Verify:` Run twice on dev; second run reports zero writes
  - `Evidence:` The migration logic was fixed to repair partial runs and surface real conflicts rather than silently drift

##### Functional — Cutover & Rollback

- [x] Dev cutover rehearsed before prod: migration + middleware deploy run successfully in `--stage dev`, integration tests pass against migrated data
  - `Verify:` CI run log
  - `Evidence:` Dev deploy and subsequent `main` CI stayed green before prod cutover
- [x] Rollback plan documented: keep legacy `ApiKeyTable` intact (do not delete) for at least 14 days post-cutover; revert plan ships the previous `auth.ts`/`usage.ts` + re-point SST env to `ApiKeyTable`
  - `Verify:` SST config does not delete `ApiKeyTable`; rollback instructions in PR description
  - `Evidence:` `docs/runbooks/p1b04b-cutover.md` documents the cutover, rollback window, and the new rotation command path
- [x] Prod cutover executed successfully: migration ran, auth validated, and prod traffic now uses the v2.2 key model
  - `Verify:` Authenticated prod smoke passed after migration and rotation; old key now returns 401
  - `Evidence:` Production smoke checks passed and the old seed key was revoked after the replacement key was verified

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
status: complete
priority: p0-critical
epic: P1B
persona: [api-consumer]
depends_on: [P1B.01, P1B.02, P1B.03, P1B.04]
completed: 2026-04-18
```

#### User Story

As a new user signing up, my org is auto-provisioned (Stripe customer + DynamoDB org envelope) within seconds. I sign in to `/account` and create my first API key from there — the raw key is shown to me once in the response.

#### Problem Statement

Per ARCHITECTURE.MD §5.7.1 (rewritten in PR #57 review #3 to address Bug 5), **the webhook does NOT mint API keys**. Hash-only storage means a key generated server-side without an in-flight HTTP response to the user is unrecoverable — an SES failure would leave the org with a `prontiq-keys` row whose raw value can never be revealed.

Instead, the webhook provisions the **org envelope** (`ORG#{orgId}` record + Stripe customer). The first API key is minted by the user-driven `POST /v1/account/keys/create` (P1C.03) where the raw value is returned in the HTTP response and shown once.

This ticket covers only the webhook side. P1C.03 covers the user-driven key creation.

#### Definition of Done

##### Functional

- [x] Webhook signature verified via Svix
  - `Verify:` Unsigned request → 401; signed request → 200
  - `Evidence:` `packages/webhooks/src/clerk.ts` uses `new Webhook(secret).verify(rawBody, headers)`. Test "invalid signature → 401" + "missing svix headers → 401" + happy-path tests confirm both branches.
- [x] **Read-first idempotency check** — `GetItem ORG#{orgId}`. If found → return 200 (no side effects).
  - `Verify:` Webhook payload sent twice; second returns 200; second invocation makes ZERO Stripe API calls and ZERO DDB writes
  - `Evidence:` Integration test "end-to-end: signed admin membership writes envelope + audit row, replay is no-op" asserts Stripe `customers.create` count = 1 and audit row count = 1 across both calls.
- [x] **Stripe customer create with idempotency key** — `Idempotency-Key: clerk-provision-{orgId}`. Repeated calls return the same `cus_...`.
  - `Verify:` Force a step-4 transaction failure; retry the webhook; `customers.list({email: …})` shows exactly one customer
  - `Evidence:` `packages/control-plane/src/provisioning.ts` passes `idempotencyKey: clerk-provision-${input.orgId}` to `customers.create`. Unit test "happy path: creates Stripe customer and writes envelope + audit transactionally" asserts the idempotency-key shape.
- [x] **No raw API key generated in this handler.** `grep -n "generateKey\|hashKey" packages/webhooks/src/clerk.ts` returns zero. The handler creates only the Stripe customer + ORG envelope + audit entry.
  - `Verify:` Code review
  - `Evidence:` `grep -n "generateKey\|hashKey" packages/webhooks/src/clerk.ts` → no matches.
- [x] **Atomic commit via `TransactWriteItems`** — single transaction writes:
  1. `prontiq-keys/ORG#{orgId}` with `{stripeCustomerId, ownerEmail, tier="free", hasFirstKey: false, completedAt}` and `attribute_not_exists(apiKeyHash)`
  2. `prontiq-audit/{orgId}/{ts#ulid}` with `action="ORG_PROVISIONED"` and `attribute_not_exists(orgId) AND attribute_not_exists(SK)`
     Either both commit or neither does.
  - `Verify:` Happy path: send webhook → verify both items exist
  - `Evidence:` `buildProvisioningTransactWrite` in `packages/control-plane/src/provisioning.ts` constructs both Put items into a single `TransactWriteCommand`. Integration test asserts the envelope row + audit row exist after a single signed delivery.
- [x] **TransactionCanceledException handling per ARCHITECTURE.MD §5.7.1** — distinguish cancellation reasons before deciding the response code. The unified `classifyDdbError` walks `error.CancellationReasons[]` and:
  - `ConditionalCheckFailed` on item (a) or (b): post-failure reconciliation `readOrgEnvelope` → if envelope confirmed present, return `already_exists` → 200.
  - `TransactionConflict` / `ProvisionedThroughputExceeded` / `ThrottlingError`: classified transient, retry the entire `TransactWriteItems` with backoff (max 3 attempts).
  - Any other reason (`ValidationError`, `ResourceNotFound`, etc.): provably fatal, return `fatal_failure` → 500 so Svix redelivers (then DLQ alarm fires).
  - **Invariant enforced:** `provisionOrg` never throws (Bug 4 fix); never returns `created` without a strongly-confirmed ORG envelope (defensive guard); strong reads on every envelope check (Bug 1 fix).
  - `Verify:` Bug 1/2/4/7 regression tests in `packages/control-plane/src/provisioning.test.ts` cover every branch: ConditionalCheckFailed-during-race → already_exists; ProvisionedThroughputExceeded reason → retry; ValidationError reason → fatal; TimeoutError on writes → retryable (Bug 7).
  - `Evidence:` 51/51 control-plane tests pass.
- [x] **No partial state possible** — kill the Lambda after Stripe customer creation but before TransactWrite; retry the webhook; verify the same Stripe customer is reused (Idempotency-Key) and exactly one ORG envelope row results
  - `Verify:` `packages/control-plane/src/provisioning.test.ts` "ConditionalCheckFailed during a race → reconciliation read finds envelope → already_exists" asserts this. The reconciliation read with `ConsistentRead: true` correctly detects the prior writer's commit.
  - `Evidence:` Test passes. Manual chaos verification deferred to post-deploy on dev (operator runbook §"Healthy redelivery").
- [x] Welcome email sent via SES (subject "Welcome to Prontiq.", body includes a sign-in link to `/account` + docs link). **Does NOT contain an API key** — the user creates one from `/account` after sign-in. SES failure does not block provisioning durability.
  - `Verify:` `packages/control-plane/src/provisioning.ts:sendSignedSesEmail` constructs the body with subject "Welcome to Prontiq." + signInUrl + docsUrl, no key material. Bug 6 boundary guard ensures any sender failure → `emailSent: false` rather than thrown.
  - `Evidence:` Live SES simulator verification completed on 2026-04-19 in both `dev` and `prod` after the shared SES identity / suppression work shipped. `prontiq.dev` is verified with DKIM active, and the operator source of truth is now `docs/runbooks/ses-suppression.md`. SES remains in sandbox, so arbitrary-recipient delivery still depends on AWS production access.

##### Recovery Endpoint

- [x] Implement `POST /v1/account/setup` (Clerk-authenticated). Idempotent. If `ORG#{orgId}` exists → 200 (no side effects). If missing → run the same Stripe-customer-create + ORG-envelope-PutItem flow as the webhook handler (factored into a shared service).
  - `Verify:` **Route-level integration tests** (no UI dependency — UI is owned by P1C.03):
    - (a) Call `POST /v1/account/setup` with a Clerk-authenticated test principal whose ORG envelope does not exist → 201 + envelope created + audit row
    - (b) Call same endpoint twice in a row → second returns 200 with no DDB writes (idempotent)
    - (c) Inject Stripe-create success then DDB failure on first attempt → retry succeeds; verify exactly 1 Stripe customer (Idempotency-Key reuse) and 1 ORG envelope
    - (d) Verify both the webhook handler AND `/setup` endpoint import from the same shared service
  - `Evidence:` `packages/api/src/routes/account.integration.test.ts` covers (a), (b), (c) against DDB Local with stubbed Stripe + Clerk + JWT verifier. (d) verified via `grep -rn "provisionOrg" packages/` showing 1 definition (`@prontiq/control-plane/src/provisioning.ts`) + 2 imports (`@prontiq/webhooks/src/clerk.ts`, `@prontiq/api/src/routes/account.ts`). `resolvePrimaryEmail` lives in `@prontiq/control-plane` and is shared by both consumers (PR 3a refactor, 2026-04-18). New `PqAccount` Lambda separate from address-API `$default` so the hot path bundle stays minimal; mounted via `api.route("ANY /v1/account/{proxy+}", accountFn.arn)` with explicit-route precedence in front of `$default`. `PqAccountErrors` CloudWatch alarm wired to the existing `PqIngestAlerts` SNS topic.
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
status: complete
priority: p0-critical
epic: P1B
persona: [api-consumer]
depends_on: [P1B.03, P1B.04]
completed: 2026-04-18
```

> Legacy shipped path. This ticket remains implemented in the current platform
> but is superseded as forward-looking commercial architecture by the Lago
> migration sequence.

#### Shipped State

`POST /webhooks/stripe` is live in dev and prod.

Implemented event contract:

- `checkout.session.completed`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `invoice.payment_failed` (log-only)

Shipped behavior:

- Verifies `stripe-signature` via `stripe.webhooks.constructEvent()`
- Resolves `orgId` from Stripe customer metadata
- Rebuilds billing state from live Stripe metadata:
  - recurring Price/Product `metadata.prontiqTier`
  - metered Product `metadata.prontiqProduct`
- Reconciles the full same-tier billing snapshot on every `customer.subscription.updated`
- Uses replay-safe webhook claim/finalize markers in `prontiq-keys`
- Rejects malformed or duplicate metered product mappings instead of silently skipping them
- Handles zero-key orgs by updating the `ORG#{orgId}` envelope as the authoritative billing snapshot
- Applies `paymentOverdue` transitions on `past_due` / recovery
- Logs `invoice.payment_failed` without mutating DynamoDB

Verification evidence:

- Unit + integration coverage in `packages/webhooks`
- Real Stripe sandbox deliveries exercised in `dev` on 2026-04-19 for:
  - tier reconciliation
  - `past_due`
  - recovery back to `active`
  - cancellation / downgrade
  - `invoice.payment_failed` log-only
- Production deploy completed successfully on 2026-04-19 (workflow run `24617074850`)

Operator source of truth:

- `docs/runbooks/stripe-webhook.md`
- `ARCHITECTURE.MD` §5.7.2–§5.7.5

#### Scope

**In:** 4 Stripe event handlers, orgId resolution, batched org-key updates, registry mutations, best-effort `past_due` email, audit writes, replay-safe idempotency

**Out — Do Not Implement:**

- Prorated billing → Stripe handles automatically
- Initial subscription creation from scratch without checkout → not supported; user must go through Checkout

---

### Ticket P1B.07 — `prontiq-audit` Writer Helper

```yaml
id: P1B.07
title: prontiq-audit Writer Helper
status: complete
priority: p1-high
epic: P1B
persona: [builder]
depends_on: [P1B.04]
completed: 2026-04-17
```

#### User Story

As a builder of lifecycle-event code (webhook handlers, rotation, revoke), I need a single `writeAudit()` helper in `packages/shared/src/audit.ts` so that every lifecycle event writes a consistent shape to `prontiq-audit` without copy-pasted boilerplate.

#### Problem Statement

CREATE/ROTATE/REVOKE/UPGRADE/DOWNGRADE events need identical row shapes for later query ("who rotated the key?"). Centralise so every caller passes `{orgId, action, apiKeyHash, actorId, metadata}` and the helper handles ULID generation, ISO timestamp, TTL math.

#### Definition of Done

##### Functional

- [x] `writeAudit({orgId, action, apiKeyHash, actorId, metadata})` in `packages/control-plane/src/audit.ts` — **location revised from `packages/shared/src/audit.ts` because the helper requires the AWS SDK DynamoDB clients, which don't belong in `@prontiq/shared` (kept dep-light for cross-package consumption). The new `@prontiq/control-plane` package is the natural home; webhooks and API consume it as a workspace dep.**
  - `Verify:` Called from P1B.05 (ORG_PROVISIONED — via `buildAuditTransactItem` inside the provisioning service TransactWriteItems); ready for P1B.06 (UPGRADE / DOWNGRADE) and P1C.03 (ROTATE / REVOKE) to import
  - `Evidence:` `packages/control-plane/src/provisioning.ts` imports `buildAuditTransactItem`; `packages/control-plane/src/index.ts` re-exports `writeAudit` + `buildAuditTransactItem`
- [x] ULID generated per call (monotonic); timestamp is ISO 8601; SK = `{timestamp}#{ulid}`
  - `Verify:` `packages/control-plane/src/audit.test.ts` asserts SK format + monotonicity across same-ms calls
  - `Evidence:` Test "ULID sort keys generated within the same millisecond are strictly monotonic" passes
- [x] TTL set to `now + 365 days` (unix seconds)
  - `Verify:` `getAuditTtlSeconds(now) === floor(now/1000) + 365*24*60*60`
  - `Evidence:` Test "buildAuditTransactItem TTL is now + 365 days in seconds" passes
- [x] Unit test covers all 5 action values
  - `Verify:` Test "all 5 lifecycle actions produce a valid row" iterates CREATE / ROTATE / REVOKE / UPGRADE / DOWNGRADE
  - `Evidence:` 20/20 tests pass in `pnpm --filter @prontiq/control-plane test`

##### Dual API (above the DoD baseline)

- [x] `buildAuditTransactItem()` returns a DynamoDB `TransactWriteItem` so callers that need atomicity (P1B.05 provisioning, future rotation) can bundle the audit write into a single transaction. Standalone `writeAudit()` remains available for callers that don't need grouping (P1B.10 billing cron).

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
status: complete
priority: p1-high
epic: P1B
persona: [ops]
depends_on: [P1B.04]
completed: 2026-04-19
```

#### Shipped Behavior

- SES now uses one shared `prontiq.dev` domain identity in `ap-southeast-2`, with stage-specific configuration sets (`prontiq-transactional` / `prontiq-transactional-<stage>`) publishing bounce and complaint events to each stage’s SNS topic.
- `PqSesFeedback` subscribes to that SNS topic and writes `prontiq-ses-suppressions`.
- Suppression rules:
  - hard bounce → immediate suppression, 90-day TTL
  - soft bounce → suppress on the third bounce inside a 30-day window, 90-day TTL
  - complaint → permanent suppression, no TTL
- All current SES send paths are suppression-aware:
  - welcome email
  - quota warning / limit emails
  - Stripe `past_due` email
- Quota-threshold emails are now implemented for the credits model:
  - 80% warning
  - 100% limit / overage
  - sent asynchronously by `PqQuotaEmailWorker`
  - exactly-once per `{product}#{month}` scope via `warningEmailSent` / `limitEmailSent` plus short pending leases

#### Verification Evidence

- `packages/control-plane/src/ses-feedback.integration.test.ts`
  - hard bounce suppression
  - third soft bounce suppression
  - complaint overriding prior soft-bounce state
- `packages/control-plane/src/quota-email.integration.test.ts`
  - warning email exactly-once
  - suppression skip finalises without retry loop
  - failed sender releases lease for retry
- `packages/control-plane/src/provisioning.integration.test.ts`
  - suppressed welcome email skips without blocking durable provisioning
- `packages/webhooks/src/stripe.integration.test.ts`
  - Stripe plan-change reset clears warning/limit email sent state and pending lease state

---

### Ticket P1B.08a — SES Deliverability Hardening: Production Access + Custom MAIL FROM

```yaml
id: P1B.08a
title: SES Deliverability Hardening: Production Access + Custom MAIL FROM
status: pending
priority: p1-high
epic: P1B
persona: [ops]
depends_on: [P1B.08]
completed: null
tech_stack:
  email: SES + Vercel DNS
```

#### User Story

As an operator, I need SES sender authentication and account production access
completed so Prontiq transactional emails can reach normal recipients with a
verified custom return-path domain.

#### Problem Statement

P1B.08 shipped suppression handling and simulator-verified SES flows, but the
account is still sandboxed and the SES identity does not yet use a custom MAIL
FROM domain. That leaves normal-recipient delivery blocked and leaves SPF
alignment dependent on default SES return-path behavior. Production readiness
requires the custom MAIL FROM subdomain, DMARC alignment policy, and AWS
production-access approval to be tracked explicitly.

#### Definition of Done

##### Functional

- [ ] `prontiq.dev` SES identity remains verified in `ap-southeast-2`
  - `Verify:` `aws sesv2 get-email-identity --email-identity prontiq.dev --region ap-southeast-2`
  - `Evidence:` `VerifiedForSendingStatus=true`
- [ ] DKIM remains enabled and successful
  - `Verify:` SES identity DKIM status and all three public CNAMEs
  - `Evidence:` `DkimAttributes.Status=SUCCESS`
- [ ] custom MAIL FROM is configured as `bounce.prontiq.dev`
  - `Verify:` SES identity reports `MailFromDomain=bounce.prontiq.dev`
  - `Evidence:` `MailFromStatus=SUCCESS`
- [ ] Vercel DNS contains required MAIL FROM records
  - `Verify:` `dig +short MX bounce.prontiq.dev` and `dig +short TXT bounce.prontiq.dev`
  - `Evidence:` MX points to `feedback-smtp.ap-southeast-2.amazonses.com`; TXT includes `amazonses.com`
- [ ] DMARC policy intentionally supports subdomain SPF alignment
  - `Verify:` `dig +short TXT _dmarc.prontiq.dev`
  - `Evidence:` record includes `aspf=r`
- [ ] SES production access is approved
  - `Verify:` `aws sesv2 get-account --region ap-southeast-2`
  - `Evidence:` `ProductionAccessEnabled=true`

##### Operational

- [ ] SES simulator success, bounce, and complaint flows still pass after
      custom MAIL FROM is configured
  - `Verify:` run existing simulator checks from `docs/runbooks/ses-suppression.md`
  - `Evidence:` `PqSesFeedback` and `PqQuotaEmailWorker` behavior remains healthy
- [ ] one normal-recipient transactional test send succeeds after production
      access approval
  - `Verify:` send to a non-simulator recipient from `noreply@prontiq.dev`
  - `Evidence:` recipient receives the email and SES accepts the send

#### Scope

**In:** SES custom MAIL FROM, Vercel DNS records, DMARC alignment, production
access resubmission, post-approval normal-recipient verification

**Out — Do Not Implement:**

- Email content/template changes
- Suppression semantics changes
- New marketing email flows
- Public API changes

---

### Ticket P1B.09 — Burst Rate Limiter Middleware

```yaml
id: P1B.09
title: Burst Rate Limiter Middleware
status: complete
priority: p1-high
epic: P1B
persona: [builder]
depends_on: [P1B.02, P1B.04b]
completed: 2026-04-19
```

#### User Story

As a platform operator, a single abusive key cannot overwhelm OpenSearch in one second — each key has a per-Lambda-instance token bucket sized from `record.rateLimit` on the loaded `prontiq-keys` record.

#### Problem Statement

Monthly quotas (§5.4 middleware) prevent 30-day overruns but not one-second floods. In-memory token bucket per `apiKeyHash` prevents the latter. See ARCHITECTURE.MD §5.4.1.

**Why this depends on P1B.04b** (not just P1B.02): the burst limiter needs both `apiKeyHash` (the bucket key) AND `record.rateLimit` (the bucket capacity), which are both produced by the post-cutover auth middleware that loads the v2.2 `ApiKeyRecord` shape. Wiring the limiter against the legacy `ApiKeyTable` shape (`record.apiKey` raw + nested usage map) would require a temporary translation layer that gets thrown away at cutover. Cleaner to wait for P1B.04b.

Known caveat: per-Lambda-instance, not global — documented and accepted for Phase 1.

#### Definition of Done

##### Functional

- [x] Middleware `packages/api/src/middleware/rate-limit.ts` instantiates a module-scoped `Map<apiKeyHash, TokenBucket>`
  - `Verify:` Code review
  - `Evidence:` `packages/api/src/middleware/rate-limit.ts`
- [x] Reads `apiKeyHash` and `record.rateLimit` from request context (set by the post-P1B.04b auth middleware)
  - `Verify:` auth middleware delegates to the extracted limiter after loading the post-cutover `ApiKeyRecord`
  - `Evidence:` `packages/api/src/middleware/auth.ts`
- [x] On each request: consume 1 token from the bucket for this key (create bucket with capacity = `record.rateLimit` on first encounter)
  - `Verify:` unit test
  - `Evidence:` `packages/api/src/middleware/rate-limit.test.ts`
- [x] Empty bucket → return 429 with `code: "RATE_LIMITED"` body and `Retry-After` header
  - `Verify:` integration test
  - `Evidence:` `packages/api/src/middleware/auth.integration.test.ts`
- [x] Buckets refill at `rateLimit` tokens/second (continuous refill, floor at capacity)
  - `Verify:` unit + integration tests
  - `Evidence:` `packages/api/src/middleware/rate-limit.test.ts`, `packages/api/src/middleware/auth.integration.test.ts`
- [x] Notes section in ticket + README call out the per-instance caveat — global burst control is deferred (Redis / API Gateway usage plans, post-Phase-1)
  - `Verify:` docs review
  - `Evidence:` `ARCHITECTURE.MD`, `README.md`

##### Testing

- [x] Integration test covers burst + refill + multiple keys isolated

#### Scope

**In:** Middleware, unit + integration tests, documented Lambda-concurrency caveat

**Out — Do Not Implement:**

- Global (cross-Lambda) rate limiter → post-Phase-1
- Per-product burst — single bucket per key today

#### Shipped Evidence

- `packages/api/src/middleware/rate-limit.ts` now owns the module-scoped per-key token bucket and 429 `RATE_LIMITED` response helper.
- `packages/api/src/middleware/auth.ts` still owns auth, product gating, and quota accounting, but delegates burst enforcement before usage increment.
- `packages/api/src/middleware/rate-limit.test.ts` covers consumption, refill, capacity cap, per-key isolation, and bypass semantics.
- `packages/api/src/middleware/auth.integration.test.ts` proves burst exhaustion, refill, isolated buckets, and no orphan usage increments on `RATE_LIMITED`.

---

### Ticket P1B.10 — Billing Cron (hourly → Stripe)

```yaml
id: P1B.10
title: Billing Cron (hourly → Stripe)
status: complete
priority: p0-critical
epic: P1B
persona: [ops]
depends_on: [P1B.03, P1B.04, P1B.06]
completed: 2026-04-18
```

> Legacy shipped path. This ticket remains implemented in the current platform
> but is superseded as forward-looking commercial architecture by the Lago
> migration sequence.

#### User Story

As a platform operator, usage data flows from `prontiq-usage` to Stripe every hour via family-level Stripe credit meters so that billing is accurate, replay-safe, and no usage is lost across month boundaries.

#### Problem Statement

Hourly EventBridge-triggered Lambda. Per ARCHITECTURE.MD §5.6.2 (rewritten to fix the rotation double-count bug from PR #57 review #5):

- Reads `REGISTRY#active-keys` (one item)
- For each billable hash, recursively walks REDIRECT GSI to build the full attribution chain ([currentHash, ...predecessorHashes])
- Sums usage across the chain, then rates that usage into credits per API family
- Compares to `currentHash.lastPushedCumulativeCount` ONLY (old hashes' pushed state is dead — including it would double-count)
- Reserves a replay-safe pending push on the current hash row (`pendingMeterEventIdentifier`, `pendingMeterTargetCumulativeCount`)
- Pushes the **credit delta** to Stripe via `stripe.billing.meterEvents.create(...)` with deterministic `event_name = prontiq_${product}_requests`
- After Stripe accepts the event, finalizes by setting `currentHash.lastPushedCumulativeCount = pendingMeterTargetCumulativeCount` and clearing the pending marker

#### Definition of Done

##### Functional

- [x] Scheduled Lambda runs hourly (EventBridge cron)
  - `Verify:` EventBridge rule exists
  - `Evidence:` SST config
- [x] Reads `REGISTRY#active-keys` — targeted reads, not a scan
  - `Verify:` Lambda log shows single GetItem + BatchGet
  - `Evidence:` CloudWatch log
- [x] For each billable key: targeted-read `prontiq-keys` for `stripeCustomerId` + enabled products; recursively walk `newHash-redirect-index` GSI to build the rotation chain (depth bounded by `MAX_CHAIN_DEPTH=10`); targeted-read `prontiq-usage` for `chain × billing scopes × {currentMonth, previousMonth}`
  - `Verify:` Integration test: rotate a key (A→B), make 50 requests against B, run cron; verify chain=[B,A] and Stripe usage record reflects 50 + A's previous-pushed cumulative
  - `Evidence:` Stripe usage record + Lambda log showing chain expansion
- [x] **Cumulative push state is single-rooted on the current hash.** Field is `lastPushedCumulativeCount` (renamed from `lastPushedCount` for explicit semantics). Only `currentHash.lastPushedCumulativeCount` participates in the delta gate; old-hash counters are NOT summed.
  - `Verify:` Code review of the cron — the `currentLastPushed` variable reads from `chain[0]` only, never `chain[i] for i > 0`
  - `Evidence:` Unit test for the delta calculator
- [x] Calculates `delta = sumRequestCount - currentLastPushed`; skips if `delta <= 0`. Negative delta → log WARN with chain dump; alarm on cron failure path.
  - `Verify:` Unit test feeds chain with old-hash leftover state; assert delta is non-negative
- [x] Calls `stripe.billing.meterEvents.create({ event_name, identifier, payload })` — pushes the **delta credits** to Stripe's family-level meter stream
  - `Verify:` Inspect Stripe meter events after a cron run; payload quantity equals the credit delta since `lastPushedCumulativeCount`
  - `Evidence:` Stripe → Billing → Meter usage
- [x] **Replay-safe pending marker** on `prontiq-usage`. The cron first reserves `pendingMeterEventIdentifier` + `pendingMeterTargetCumulativeCount` on the current hash row, then reuses that same identifier on retry if Stripe accepted the event but the DDB finalize write failed.
  - `Verify:` Integration test simulates a failure between Stripe acceptance and finalize; retry reuses the same identifier and finishes without double billing
  - `Evidence:` `billing-cron.integration.test.ts`
- [x] **Rotation correctness test** (the case that broke the previous design):
  - T0: seed `pq_test_a` with requestCount=100, lastPushedCumulativeCount=100
  - T1: rotate A→B, REDIRECT(A→B), B with requestCount=0, lastPushedCumulativeCount=0
  - T2: 50 reqs against B → B.requestCount=50
  - T3: run cron. Assert: Stripe meter set to 150, B.lastPushedCumulativeCount=150
  - T4: 25 more reqs against B → B.requestCount=75
  - T5: run cron. Assert: Stripe meter set to 175 (NOT a negative delta), B.lastPushedCumulativeCount=175
  - `Evidence:` Integration test passes; demonstrates the §5.6.2 worked-example table
- [x] **Multi-rotation test**: A→B→C, 10 reqs against C, verify cron walks chain=[C,B,A] and pushes correct cumulative
- [x] CloudWatch alarm on cron errors (`PqBillingCronErrors`)
- [x] Month boundary: first 6 hours of each month, process both current + previous month scopes

#### Scope

**In:** Hourly cron, targeted reads via registry, REDIRECT handling, replay-safe pending meter markers, family-level Stripe credit meters, CloudWatch alarming

**Out — Do Not Implement:**

- Real-time billing → overkill
- Month-close finalisation → P1B.11

---

### Ticket P1B.11 — Month-close Lambda

```yaml
id: P1B.11
title: Month-close Lambda
status: complete
priority: p1-high
epic: P1B
persona: [ops]
depends_on: [P1B.10]
completed: 2026-04-19
```

> Legacy shipped path. This ticket remains implemented in the current platform
> but is superseded as forward-looking commercial architecture by the Lago
> migration sequence.

#### User Story

As a platform operator, a dedicated Lambda finalises the previous month's usage at 00:30 UTC on day 1 so that Stripe invoices close cleanly and the hourly cron stops revisiting closed scopes.

#### Problem Statement

Stripe invoices finalise on the month boundary. Usage writes can arrive late (clock skew, retries). At 00:30 UTC on day 1, a dedicated Lambda sweeps previous-month scopes, pushes remaining deltas, sets `closed: true`. The hourly cron skips any scope with `closed: true`. See ARCHITECTURE.MD §5.6.2.

#### Definition of Done

##### Functional

- [x] Scheduled Lambda runs monthly via EventBridge cron `30 0 1 * ? *` (UTC)
  - `Verify:` `PqMonthClose` exists in SST and deploys in dev + prod
  - `Evidence:` `sst.config.ts`
- [x] For each billable key, fetch previous-month `prontiq-usage` scope
  - `Evidence:` `packages/control-plane/src/month-close.ts`
- [x] Push any remaining delta to Stripe
  - `Verify:` integration test pushes remaining previous-month delta exactly once
  - `Evidence:` `packages/control-plane/src/month-close.integration.test.ts`
- [x] UpdateItem SET `closed: true` on the scope
  - `Verify:` integration tests assert `closed=true` after finalisation and zero-delta close
  - `Evidence:` `packages/control-plane/src/month-close.integration.test.ts`
- [x] Hourly cron (P1B.10) skips scopes with `closed: true`
  - `Verify:` integration test seeds a closed scope with nonzero delta and proves no repush
  - `Evidence:` `packages/control-plane/src/billing-cron.integration.test.ts`

#### Scope

**In:** Monthly finalisation Lambda, `closed` flag semantics

**Out — Do Not Implement:**

- Refund / correction flow → manual Stripe dashboard

#### Shipped Evidence

- `packages/control-plane/src/billing-runtime.ts` now holds the shared chain-discovery and replay-safe scope-reconciliation logic used by both hourly billing and month-close.
- `packages/control-plane/src/month-close.ts` implements `createMonthCloseService()` and the Lambda handler.
- `sst.config.ts` wires `PqMonthClose` plus `PqMonthCloseErrors`.
- `docs/runbooks/month-close.md` is the operator runbook.

---

### Ticket P1B.12 — Auth Middleware Integration Test

```yaml
id: P1B.12
title: Auth Middleware Integration Test
status: complete
priority: p1-high
epic: P1B
persona: [builder]
depends_on: [P1B.05, P1B.09, P1B.04b]
completed: 2026-04-19
```

#### User Story

As a builder, I need an integration test that verifies the full auth chain end-to-end against a real API key, the hash-based schema, and the burst limiter so that auth regressions are caught before deploy.

#### Problem Statement

Post-migration, auth middleware hashes the incoming key, looks up in `prontiq-keys`, falls back to REDIRECT, checks tier/product/quota/burst/paymentOverdue. The test must cover every error code in `packages/shared/src/constants.ts` ERROR_CODES (MISSING/INVALID/PRODUCT_NOT_ALLOWED/QUOTA_EXCEEDED/RATE_LIMITED) and the REDIRECT fallback. Error codes match live constants (`PRODUCT_NOT_ALLOWED`, not `PRODUCT_NOT_ENABLED`).

#### Definition of Done

##### Functional

- [x] Valid key → 200 + rate-limit headers
  - `Verify:` `packages/api/src/middleware/auth.integration.test.ts` `"valid free-tier key allows requests up to quota then rejects the next one"`
  - `Evidence:` 200 responses assert `X-RateLimit-Remaining`
- [x] Missing key → 401 `MISSING_API_KEY`
- [x] Unknown key → 401 `INVALID_API_KEY`
- [x] Revoked key (active=false) → 401 `INVALID_API_KEY`
- [x] Disallowed product → 403 `PRODUCT_NOT_ALLOWED`
- [x] Quota exceeded (free) → 429 `QUOTA_EXCEEDED`
- [x] Quota exceeded (paid) → 200 with `X-RateLimit-Over: true` header
- [x] Burst exceeded → 429 `RATE_LIMITED` with `Retry-After` header (from P1B.09)
- [x] paymentOverdue=true → 200 with `X-Payment-Overdue: true` header
- [x] Rotated key (REDIRECT record, `authValidUntil` in future) → 200 (served via fallback lookup; quota counts against `newHash`)
  - `Verify:` existing REDIRECT success integration test hits the API with old raw key
  - `Evidence:` `prontiq-usage[newHash][product#month].requestCount` asserted to increment while oldHash remains empty
- [x] **Rotated key, grace expired** (`authValidUntil` in past) → 401 `INVALID_API_KEY`
- [x] **Rotated key, newHash revoked** → 401 `INVALID_API_KEY` (active check on redirected hash)
- [x] **Atomic quota race** — fire 100 concurrent requests at a free-tier key with `quotaPerProduct = 50`; exactly 50 return 200, exactly 50 return 429 `QUOTA_EXCEEDED`
  - `Verify:` `auth.integration.test.ts` concurrent `Promise.all`
  - `Evidence:` final `prontiq-usage[hash][product#month].requestCount === 50`

> The first-key creation idempotency assertions live in **P1C.03** (the ticket that owns `POST /v1/account/keys/create`). Originally drafted here with a fallback "use a temporary endpoint stub" — but that would push the integration test to either (a) build throwaway API surface, or (b) test against a different code path than production. Cleaner: P1C.03 is the natural home, P1B.12 stays focused on auth middleware behavior using seeded post-cutover key records.

- [x] Usage counter increments only on successful quota check (no orphan increments on 4xx responses)
  - `Verify:` unknown-key, revoked-key, product-gating, rate-limit, and free-tier quota assertions all prove no excess usage write on failure paths
  - `Evidence:` integration tests assert missing/no-op usage rows or capped `requestCount` after rejection

##### Testing

- [x] Auth middleware integration coverage is wired into the API integration harness that runs against real DynamoDB and OpenSearch
  - `Verify:` `node --test packages/api/dist/middleware/auth.integration.test.js`
  - `Evidence:` direct auth integration slice passes with the new unknown-key / revoked-key / redirect-usage / atomic-quota-race assertions

#### Shipped Evidence

- `packages/api/src/middleware/auth.integration.test.ts` now covers the remaining direct `INVALID_API_KEY` cases, REDIRECT success on `newHash`, and the atomic free-tier quota race.
- Clerk webhook provisioning idempotency remains covered in `packages/webhooks/src/clerk.integration.test.ts` under `P1B.05`.
- First-key creation idempotency remains owned by `P1C.03`.

#### Scope

**In:** Full integration test covering every error code + REDIRECT + quota overage + burst limiter + paymentOverdue

**Out — Do Not Implement:**

- Load testing → future
- Key rotation flow test → P1C.03 ticket
- Standalone seed/smoke script → not needed; existing integration harness owns fixture setup

---

## Phase 1C — Frontend Surfaces

> **Goal:** Ship the customer-facing frontend stack: `apps/landing` for `prontiq.dev`, `apps/console` for `console.prontiq.dev`, and the shared frontend foundations that support both.
>
> **Dependency:** P1C.00 lays the foundation. P1C.07 establishes the component/tooling base. Feature tickets build on top of those two anchors.
>
> **Observability default:** Browser/frontend telemetry remains deferred unless a ticket explicitly introduces it. Backend routes, handlers, or webhook delivery flows added by Phase 1C tickets should inherit the shipped `CloudWatch + SNS` operations baseline and emit Honeycomb traces through the established backend observability path where they add new Lambda-executed behavior.

---

### Ticket P1C.00 — Frontend Foundations

```yaml
id: P1C.00
title: Frontend Foundations
status: complete
priority: p0-critical
epic: P1C
persona: [builder]
depends_on: [P0.02]
completed: 2026-04-19
tech_stack:
  framework: Next.js 15
  package_manager: pnpm workspace
  tokens: packages/tokens
```

#### User Story

As a builder, I need the repo shaped for a two-app frontend so that landing and console work can proceed without inventing structure ticket by ticket.

#### Problem Statement

The old `packages/web` / `prontiq.dev/account` model has been retired by the ratified frontend strategy. The repo needs first-class `apps/landing` and `apps/console` workspaces, shared token plumbing via `packages/tokens`, and a consistent env / SDK / content-contract setup before any page-level work starts.
The console visual direction should follow `docs/prototypes/console-dashboard-v1.html`; foundations work should preserve that shell/layout language without trying to ship every analytics panel shown in the prototype.

#### Definition of Done

##### Functional

- [x] Workspace wiring includes `apps/*`
  - `Verify:` `pnpm -r list --depth -1` shows landing and console workspaces
  - `Evidence:` `pnpm-workspace.yaml`
- [x] `apps/landing` scaffolded as the future `prontiq.dev`
  - `Verify:` `pnpm --filter landing build`
  - `Evidence:` Next.js app directory exists
- [x] `apps/console` scaffolded as the future `console.prontiq.dev`
  - `Verify:` `pnpm --filter console build`
  - `Evidence:` Next.js app directory exists
- [x] `packages/tokens` scaffolded with emitted artifacts contract
  - `Verify:` `pnpm --filter @prontiq/tokens build`
  - `Evidence:` package emits CSS + Tailwind preset placeholders
- [x] Shared frontend env validation pattern established
  - `Verify:` invalid env fails build in one app
  - `Evidence:` app-local `lib/env.ts`
- [x] Existing `sdks/typescript` is the documented frontend SDK source
  - `Verify:` console imports `@prontiq/sdk` without a parallel SDK package
  - `Evidence:` no `packages/sdk` introduced

#### Scope

**In:** Repo shape, workspace plumbing, app scaffolds, token package scaffold, env pattern

**Out — Do Not Implement:**

- Landing page UX
- Console feature pages
- Final token design values

---

### Ticket P1C.01 — Landing Page with Autocomplete Demo

```yaml
id: P1C.01
title: Landing Page with Autocomplete Demo
status: complete
priority: p0-critical
epic: P1C
persona: [visitor]
depends_on: [P1C.00, P1A.02, P1D.05, P1C.07]
completed: 2026-04-20
```

#### User Story

As a visitor, I see a hero autocomplete demo that works live so that I immediately understand the product's value and want to sign up.

#### Problem Statement

`apps/landing` is the public marketing and conversion surface for `prontiq.dev`. It needs to demonstrate the product instantly while staying safe: the hero demo must be live without exposing an API key in client code. The page should be SSG-first, fast, mobile-responsive, and built for conversion instead of doubling as the authenticated app shell.

#### Definition of Done

##### Functional

- [x] Hero interaction embedded on the landing page
  - `Verify:` Landing page renders `<prontiq-address>` inside the hero demo section
  - `Evidence:` `apps/landing/components/landing/address-demo.tsx`
- [x] Demo path chosen and implemented safely
  - `Verify:` Type "9 endeavour" → real suggestions appear through `/api/demo/address/autocomplete` with no client-side API key
  - `Evidence:` landing-side proxy route + app-local rate limiter + `@prontiq/web-component`
- [x] Pricing section below hero (Prontiq Free card + paid-plan section)
  - `Verify:` Free card plus paid-plan section visible
  - `Evidence:` Free is rendered by the site config; the original Stripe Pricing Table path shipped as an interim implementation and is now superseded by `P1C.08` + `P1B.13`
- [x] "Get Started Free" button → Clerk sign-up modal
  - `Verify:` CTA wrappers open Clerk modal when `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` is present; deterministic disabled state otherwise
  - `Evidence:` `apps/landing/components/landing/signup-cta-button.tsx`
- [x] Mobile-responsive
  - `Verify:` Test at 375px, 768px, 1280px widths
  - `Evidence:` responsive landing layout in `apps/landing/components/landing/landing-shell.tsx`

#### Scope

**In:** Landing page, hero demo, pricing section, sign-up CTA, responsive design

**Out — Do Not Implement:**

- SEO optimization → future
- Analytics/tracking → future
- Marketing copy refinement → ongoing

---

### Ticket P1C.02 — Console Overview Page

```yaml
id: P1C.02
title: Console Overview Page
status: pending
priority: p0-critical
epic: P1C
persona: [api-consumer]
depends_on: [P1C.00, P1B.04, P1B.05, P1C.07]
completed: null
```

#### User Story

As a logged-in developer, I land in `apps/console` and see my API key, usage summary, and quick-start code snippets so that I can start using the API within 60 seconds of signing up.

#### Definition of Done

##### Functional

- [ ] API key displayed (masked by default, click to reveal, click to copy)
  - `Verify:` Key shows as `pq_live_****...****`; click reveals full key
  - `Evidence:` Clipboard API copies key
- [ ] Usage chart showing current month's usage across all products
  - `Verify:` Chart renders with bars/lines per product
  - `Evidence:` Data from DynamoDB usage counters
- [ ] Current plan name and quota remaining displayed
  - `Verify:` Shows "Free Plan — 4,200 / 10,000 credits remaining"
  - `Evidence:` Calculated from key metadata
- [ ] Quick-start code snippets with key pre-filled (curl, TypeScript, Python)
  - `Verify:` Snippets include the user's actual API key
  - `Evidence:` Copy button works; snippet is runnable
- [ ] Upgrade nudge banner when > 80% quota used
  - `Verify:` Seed key at 85% usage; banner appears
  - `Evidence:` "Upgrade to PAYG" or equivalent migration-safe billing message

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
depends_on: [P1C.00, P1B.02, P1B.04b, P1B.05, P1C.07]
completed: null
tech_stack:
  ui: Next.js 15 + shadcn/ui
  keys: @prontiq/api account endpoints (DDB-backed, see ARCHITECTURE.MD §7.3)
```

#### User Story

As a new developer, my **first** API key is created from the console key-management flow (not via webhook email). The raw key shows once in the response. As a returning developer, I can view, create, rotate, and revoke keys for different environments / team members.

#### Problem Statement

Per ARCHITECTURE.MD §5.7.1 + §10 Developer Journey (rewritten in PR #57 review #3 to address Bug 5), the **first** API key is minted by the user-driven `/v1/account/keys/create` call — not by the Clerk webhook. The webhook only provisions the org envelope (Stripe customer + `ORG#{orgId}` record). This is because hash-only key storage means a server-minted key with no in-flight HTTP response to the user is unrecoverable on SES failure.

The "first" and "Nth" key creation use the **same code path** — there is no special first-time logic. The `hasFirstKey` flag on the org envelope flips to `true` on the first successful create.

Key rotation must be atomic (TransactWrite swap) with a REDIRECT record per §5.5.1 (split auth grace `authValidUntil = 5 min` and billing attribution `ttl = 90d`). REVOKE-after-ROTATE is naturally handled by the active-flag check on the redirected hash — no explicit REDIRECT cleanup needed (§5.5.2). Sensitive actions (rotate, revoke) require Clerk step-up re-authentication per §5.9.2.

#### Definition of Done

##### Functional — First-Key Flow

- [ ] On first visit to the console keys surface: detect `ORG#{orgId}.hasFirstKey === false` → render "Create your first API key" CTA (instead of empty key list). If `ORG#{orgId}` does not exist (Clerk webhook missed): render "Set up your account" CTA which calls `POST /v1/account/setup` (P1B.05 recovery endpoint).
  - `Verify:` Sign up a new test user; observe the console shows "Create your first API key" button; click it; raw key appears in modal; refresh page; key list now shows masked prefix
  - `Evidence:` UI screenshot + DDB record diff
- [ ] **Missing-ORG recovery UI** (per PR #59 review #6 Bug 12 — moved here from P1B.05 because UI verification belongs to the ticket that owns the dashboard): if the console detects no `ORG#{orgId}` envelope (Clerk webhook missed entirely), render "Set up your account" CTA that calls `POST /v1/account/setup` (P1B.05 endpoint). After the call returns, transition to "Create your first API key" CTA.
  - `Verify:` Manually delete `ORG#{orgId}` for a test user; sign in to the console; assert "Set up your account" button is visible. Click it. Assert the page transitions to the first-key CTA after `POST /v1/account/setup` returns.
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
  - `Verify:` console keys page loads with table of keys
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
- [ ] Key limits enforced for Free and the active paid commercial contract — GSI count query against `orgId-index` with **`FilterExpression: "attribute_exists(keyPrefix) AND attribute_exists(active)"`** before PutItem (sentinel guard prevents the ORG envelope from eating one of the user's quota slots)
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
depends_on: [P1C.00, P1C.07]
completed: null
tech_stack:
  ui: Next.js 15 + shadcn/ui
  charts: Recharts
  data: DynamoDB usage counters
```

#### User Story

As a developer, I see per-product usage over time so that I can understand my consumption patterns, predict costs, and identify anomalies.

#### Problem Statement

Usage data lives in DynamoDB as atomic counters (per-key, per-product, per-month). The dashboard needs to query these counters, aggregate across keys (for org-level view), and render time-series charts. Daily granularity requires either storing daily snapshots in Prontiq-controlled counters or deriving chart data from the billing-event analytics stream that feeds Lago. The forward path is not Stripe-derived usage.

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
depends_on: [P1C.00, P1B.18, P1C.07]
completed: null
tech_stack:
  billing: Lago-backed console billing surface
```

> Stripe-specific Billing Page planning in this ticket is superseded. The
> forward path is Lago-backed billing state and plan-management surfaces in
> `apps/console`.

#### User Story

As a developer, I manage my plan, payment details, and invoices through a Prontiq-owned billing surface so that billing is self-service without being routed through Stripe-first UX.

#### Problem Statement

This ticket originally assumed Stripe-hosted self-service as the destination
billing UX. That Stripe-specific planning is now superseded. The forward
direction is a Prontiq-owned billing surface aligned to the Lago architecture,
using Lago-backed billing state and migration-aware portal or invoice links
where needed. Any retained Stripe-hosted controls are migration-only behavior,
not the target design.

#### Definition of Done

##### Functional

- [ ] Console billing page shows platform-owned billing state and plan
      information
  - `Verify:` Authenticated developer sees current commercial status in-app
  - `Evidence:` Console billing page renders without relying on embedded Stripe UI
- [ ] Upgrade and plan-management controls align to the active commercial
      backend contract
  - `Verify:` UI actions route through the current supported orchestration path
  - `Evidence:` Billing page wiring matches the architecture in `ARCHITECTURE.MD`
- [ ] Migration-era payment-method or invoice links are clearly labeled if they
      still point to legacy Stripe-hosted surfaces
  - `Verify:` No Stripe-hosted surface is presented as the forward-looking UX
  - `Evidence:` UI copy and docs match the Lago-target posture

#### Scope

**In:** platform-owned console billing state, migration-aware billing actions,
legacy-link labeling where needed

**Out — Do Not Implement:**

- Pricing Table-based upgrades → superseded
- treating Stripe-hosted controls as the long-term billing UX
- Custom commercial contracts → future

---

### Ticket P1C.08 — Replace Embedded Pricing Table with Prontiq-rendered Paid Plan Cards

```yaml
id: P1C.08
title: Replace Embedded Pricing Table with Prontiq-rendered Paid Plan Cards
status: superseded
priority: p1-high
epic: P1C
persona: [visitor, api-consumer]
depends_on: [P1B.13, P1C.01]
completed: null
tech_stack:
  frontend: Next.js 15 + React 19
```

#### User Story

> Superseded planning. The old Checkout-session replacement path is no longer
> the forward commercial direction; landing and console pricing work should now
> align to Lago-backed commercial surfaces.

As a visitor or logged-in developer, I see Prontiq-rendered plan cards that
reflect the active commercial model and do not depend on embedded Stripe
widgets.

#### Problem Statement

The original embedded pricing-table integration shipped as an interim path, but
it is not the forward contract. Landing and console pricing surfaces should now
align to the Lago-target commercial architecture and the current business
direction of Free + PAYG.

#### Historical Superseded State

- The original plan was to replace the embedded Stripe Pricing Table with
  Prontiq-rendered cards while keeping Stripe-hosted commercial flows as the
  forward direction.
- That is no longer the target model. Future landing and console pricing
  surfaces should build against Lago-target billing contracts and the current
  Free + PAYG direction instead.
- Keep this ticket only as a record of the retired Pricing Table replacement
  plan so future work does not accidentally revive it.

#### Scope

**In:** landing pricing section replacement, first-party plan cards, active CTA
wiring, console billing UI alignment

**Out — Do Not Implement:**

- historical Stripe catalog/orchestration work
- legacy hosted portal behaviors

---

### Ticket P1C.06 — Playground Page

```yaml
id: P1C.06
title: Playground Page
status: pending
priority: p2-value
epic: P1C
persona: [api-consumer]
depends_on: [P1C.00, P1A.01, P1C.07]
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
status: complete
priority: p0-critical
epic: P1C
persona: [builder]
depends_on: [P1C.00]
completed: 2026-04-20
tech_stack:
  ui: shadcn/ui + Tailwind CSS v3.4
  framework: Next.js 15
```

#### User Story

As a builder, I need a consistent component library so that both `apps/landing` and `apps/console` share the same design vocabulary and I don't reinvent UI primitives.

#### Problem Statement

The ratified frontend architecture uses `apps/landing` and `apps/console`, not `packages/web`. Both apps need source-local shadcn/ui primitives, shared token-aware Tailwind setup, dark mode support, and predictable layout foundations. shadcn/ui provides accessible, composable components built on Radix UI + Tailwind and is owned as source code inside each app.
For the console specifically, the initial shell and component vocabulary should be extracted from `docs/prototypes/console-dashboard-v1.html`: sidebar, top bar, page header, KPI strip, cards, tables, pills, and key-display patterns. The richer analytics panels in that file are reference material, not mandatory launch scope.

#### Definition of Done

##### Functional

- [x] Tailwind CSS v3.4 configured for both apps via the shared token strategy
  - `Verify:` `pnpm --filter landing dev` and `pnpm --filter console dev` both render styled components
  - `Evidence:` `apps/landing/tailwind.config.ts` and `apps/console/tailwind.config.ts` now consume the emitted `@prontiq/tokens/preset` contract; both apps import `@prontiq/tokens/tokens.css` from `app/layout.tsx`.
- [x] shadcn/ui initialized with core components in the app-local `components/ui/` directories
  - `Verify:` `ls apps/landing/components/ui/` and `ls apps/console/components/ui/` show component files
  - `Evidence:` Button, Card, Input, Table, Dialog, Sheet, Tabs, Badge, Skeleton plus the shell support primitives now live under both app-local `components/ui/` directories.
- [x] Dark mode support (system preference + manual toggle)
  - `Verify:` Toggle dark mode → all components switch themes
  - `Evidence:` both apps now wrap layouts with `ThemeProvider`, render a manual theme toggle, and consume semantic token CSS vars from `@prontiq/tokens`.
- [x] Console app shell established
  - `Verify:` authenticated console route renders sidebar/top-level navigation and protected layout
  - `Evidence:` `apps/console/app/(dashboard)/layout.tsx`, `apps/console/components/console/console-shell.tsx`, and `apps/console/middleware.ts` now establish the responsive shell plus env-gated Clerk boundary.
- [x] Landing app shell established
  - `Verify:` landing home route renders using the same token-aware component system
  - `Evidence:` `apps/landing/app/page.tsx` now renders a token-aware landing shell from `apps/landing/components/landing/landing-shell.tsx`.
- [x] Responsive: sidebar collapses to bottom nav or hamburger on mobile
  - `Verify:` Resize to 375px → sidebar becomes hamburger/bottom nav
  - `Evidence:` console mobile navigation now uses a hamburger-triggered `Sheet`; landing and console layouts both render responsively across mobile/desktop breakpoints.

#### Scope

**In:** Component library init, app-local primitives, layout shells, dark mode, responsive navigation

**Out — Do Not Implement:**

- Full branded token package authoring → P1C.00 follow-on / dedicated implementation ticket
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
status: in-progress
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
  - `Verify:` Table matches the published business direction and the billing/credits docs
  - `Evidence:` Free: 10K credits/mo, PAYG: no hard monthly cap; docs distinguish request-time enforcement counters from billing truth
- [ ] Error handling guide (all error codes per ARCHITECTURE.MD §9, retry logic, request_id tracing)
  - `Verify:` All live-today codes documented; forward-contract codes marked as "introduced in P1C / etc."
  - `Evidence:` Live: `MISSING_API_KEY`, `INVALID_API_KEY`, `PRODUCT_NOT_ALLOWED`, `QUOTA_EXCEEDED`, `RATE_LIMITED`. Forward: `KEY_LIMIT_EXCEEDED`, `UNAUTHORIZED`, `ORG_REQUIRED`, `INVALID_SIGNATURE`, `VALIDATION_ERROR`, `SERVICE_UNAVAILABLE`, `INTERNAL_ERROR`

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
status: in-progress
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

- [ ] Custom element: `<prontiq-address autocomplete-endpoint="..." on-select="...">` (proxy-compatible endpoint override required; direct API-key mode is optional)
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
status: in-progress
priority: p1-high
epic: P1E
persona: [ops]
depends_on: [P1E.04]
completed: null
tech_stack:
  runtime: Lambda (Node.js 24)
  schedule: EventBridge (every 6 hours)
```

#### User Story

As a platform operator, expired old indices are automatically deleted so that OpenSearch storage doesn't grow unbounded, while keeping rollback targets available within the retention window.

#### Problem Statement

After each alias swap, the old index stays around for rollback (7 days for address, 48 hours for ABN/LEI). Without automated cleanup, indices accumulate and consume the shared 50GB gp3 storage on the current domain. The cleanup Lambda also verifies OpenSearch automated snapshots are running — the last line of defense against data loss.

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

Currently the API is at a random AWS URL (`59jym47ia1.execute-api...`) and the future console host is planned at a branded subdomain. Custom domains (`api.prontiq.dev`, `console.prontiq.dev`, `docs.prontiq.dev`) are essential for credibility, documentation examples, and SDK defaults.

#### Definition of Done

##### Functional

- [ ] `api.prontiq.dev` → API Gateway custom domain
  - `Verify:` `curl https://api.prontiq.dev/v1/health` returns 200
  - `Evidence:` DNS CNAME configured, ACM cert validated
- [ ] `console.prontiq.dev` → Console app
  - `Verify:` `curl https://console.prontiq.dev` returns console HTML
  - `Evidence:` hosting/domain configuration active
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
status: complete
priority: p1-high
epic: P1F
persona: [ops]
depends_on: [P0.02]
completed: 2026-04-19
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

- [x] CloudWatch alarms configured and active
  - `Verify:` `aws cloudwatch describe-alarms` shows the new prod alarms plus the existing webhook/control-plane alarms
  - `Evidence:` verified 2026-04-19 in prod: `PqApi5xxRate`, `PqApiLambdaErrorRate`, `PqOpenSearchYellow`, `PqOpenSearchRed`, `PqOpenSearchLowFreeStorage` all present and `OK`
- [x] SNS topic for alerts → email notification
  - `Verify:` Trigger an alarm → email received within 5 minutes
  - `Evidence:` verified 2026-04-19 in prod: forced `PqApiLambdaErrorRate-6848399` to `ALARM`; confirmed SNS email received on `jbejenar@gmail.com`; alarm restored to `OK`
- [x] CloudWatch dashboard: API latency (p50/p95/p99), request count, error rate, OpenSearch FreeStorageSpace
  - `Verify:` Dashboard URL accessible in AWS console
  - `Evidence:` verified 2026-04-19 in prod: dashboard `prontiq-production` exists in CloudWatch
- [x] X-Ray tracing enabled on API Lambda
  - `Verify:` Make authenticated address API call → trace visible in X-Ray console
  - `Evidence:` verified 2026-04-19 in prod: trace `1-69e4c337-5fa58fb877e8c5a611ed93e5` includes Lambda + DynamoDB + explicit `OpenSearch` subsegments after adding X-Ray write permissions to `PqApi`
- [x] Structured JSON logging in all Lambda functions
  - `Verify:` CloudWatch Logs Insights query `fields @timestamp, request_id, path, latency | sort @timestamp desc`
  - `Evidence:` verified 2026-04-19 in prod on `PqApi` logs: JSON request lifecycle events include `request_id`, `path`, `method`, `latency`, and structured error fields

#### Scope

**In:** CloudWatch alarms, SNS alerting, dashboard, X-Ray tracing, structured logging

**Out — Do Not Implement:**

- Third-party monitoring (Datadog, Sentry) → future (CloudWatch is sufficient for Phase 1)
- PagerDuty/OpsGenie integration → future
- Uptime monitoring (external) → future (Pingdom, Better Uptime)

---

### Ticket P1F.03 — Honeycomb Backend Telemetry

```yaml
id: P1F.03
title: Honeycomb Backend Telemetry
status: complete
priority: p1-high
epic: P1F
persona: [ops, builder]
depends_on: [P1F.02]
completed: 2026-04-20
tech_stack:
  tracing: Honeycomb OTLP/HTTP
  signals: traces only
  runtime: OpenTelemetry SDK for Node Lambda
  secret: HONEYCOMB_API_KEY
```

#### User Story

As a platform operator, I need backend traces in Honeycomb for deployed Lambdas so that request and workflow debugging does not stop at CloudWatch metrics or a single API X-Ray trace surface.

#### Problem Statement

`P1F.02` gave Prontiq a solid AWS-native baseline, but it still leaves trace-level debugging fragmented: X-Ray exists only on `PqApi`, deeper billing/webhook/ingestion flows are not in a shared trace-analysis plane, and production debugging still depends heavily on log reconstruction. Honeycomb is the next layer: backend traces for all deployed Lambdas, stage-scoped by environment, without removing CloudWatch/SNS or the existing X-Ray API path during rollout.

#### Definition of Done

##### Functional

- [x] `@prontiq/observability` package added and consumed by all in-scope deployed Lambda handlers
  - `Verify:` `rg -n "wrapLambdaHandler\\(|withActiveSpan\\(" packages/api/src packages/webhooks/src packages/control-plane/src packages/ingestion/src`
  - `Evidence:` verified in repo and exercised in deployed `dev` + `prod` on 2026-04-20
- [x] `HONEYCOMB_API_KEY` required for deployed `dev` and `prod` in both workflow validation and `sst.config.ts`
  - `Verify:` `rg -n "HONEYCOMB_API_KEY" sst.config.ts .github/workflows/ci.yml .github/workflows/deploy-prod.yml`
  - `Evidence:` verified in repo and exercised in deployed `dev` + `prod` on 2026-04-20
- [x] Honeycomb traces visible for all four backend service families in `dev`
  - `Verify:` Honeycomb shows traces for `prontiq-api`, `prontiq-webhooks`, `prontiq-billing`, and `prontiq-ingestion` in environment `prontiq-dev`
  - `Evidence:` verified 2026-04-20 after direct API/webhook/billing/ingestion probes in `dev`
- [x] Honeycomb traces visible for all four backend service families in `prod`
  - `Verify:` Honeycomb shows traces for `prontiq-api`, `prontiq-webhooks`, `prontiq-billing`, and `prontiq-ingestion` in environment `prontiq-prod`
  - `Evidence:` verified 2026-04-20 after production deploy plus direct API/webhook/billing/ingestion probes in `prod`
- [x] CloudWatch alarms, SNS delivery, dashboard, and `PqApi` X-Ray remain intact
  - `Verify:` existing P1F.02 validation still passes after rollout
  - `Evidence:` verified 2026-04-20: `dev` and `prod` deploys succeeded, Honeycomb traces landed for all four service families, and the retained CloudWatch/X-Ray paths remained available

#### Scope

**In:** Honeycomb backend traces for deployed Lambdas, Honeycomb runbook/ADR/docs, stage secret wiring, OpenTelemetry wrapper package

**Out — Do Not Implement:**

- Browser/frontend telemetry → future
- ECS/Fargate bulk-ingest telemetry → future
- X-Ray retirement → future
- Log forwarding to Honeycomb → future

---

## Phase 2 — ABN/ASIC Verification (Weeks 7-10)

> **Goal:** Second product. ABN verification + search. EventBridge + Step Functions replaces GitHub Actions cron.
>
> **Observability default:** New backend routes, ingestion steps, or scheduled workflows introduced in Phase 2 should preserve `CloudWatch + SNS` for alerting/ops and emit Honeycomb traces for backend execution debugging. Browser/frontend telemetry remains out of scope unless a ticket says otherwise.

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
- [ ] Step Function + Lambda execution path visible in Honeycomb for debugging
  - `Verify:` Trigger one address and one ABN manifest-driven execution → traces appear in Honeycomb for the orchestration + Lambda steps
  - `Evidence:` Honeycomb traces show manifest validation, index creation, health check, and alias swap path for the new workflow
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

### Ticket P2.06 — Historical Stripe ABN Usage Meter Planning

```yaml
id: P2.06
title: Historical Stripe ABN Usage Meter Planning
status: superseded
priority: p1-high
epic: P2
persona: [ops]
depends_on: [P1B.10]
completed: null
```

#### User Story

> Superseded planning. Future ABN billing work should map ABN usage into Lago
> billable metrics and product mappings rather than new Stripe meters.

As a platform operator, I retain the historical Stripe-meter planning context for ABN while steering future ABN commercialisation toward Lago billable metrics instead.

#### Problem Statement

This ticket is retained only as a record of the retired Stripe-meter expansion idea. Do not schedule new engineering work from it. When ABN commercialisation resumes under the Lago target architecture, track billable-metric definition, customer/product mapping, and billing-surface visibility in a Lago-target ticket instead.

#### Historical Superseded State

- The retired idea was to add ABN-specific Stripe usage meters and prices on top
  of the legacy billing path.
- That should not be resumed. When ABN commercialisation returns, define Lago
  billable metrics, product mappings, and billing-surface visibility instead of
  introducing new Stripe meters.

#### Scope

**In:** historical context only; explicit reminder not to continue ABN commercialisation through new Stripe-meter work

**Out — Do Not Implement:**

- new Stripe meters/prices for ABN

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

### Ticket P2.08 — ACN Directors Endpoint (Paid)

```yaml
id: P2.08
title: ACN Directors Endpoint (Paid)
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

Director data comes from ASIC (separate dataset from ABR). This is a commercially gated endpoint because it's high-value for compliance teams. The endpoint takes an ACN (Australian Company Number), looks up the company, and returns current directors with names and appointment dates.

#### Definition of Done

##### Functional

- [ ] ACN director data extracted from ASIC dataset and indexed
  - `Verify:` OpenSearch index contains director records linked to ACN
  - `Evidence:` Sample query returns directors for a known company
- [ ] `GET /v1/abn/directors?acn=...` returns list of directors
  - `Verify:` `curl .../v1/abn/directors?acn=004085616` returns director list
  - `Evidence:` Response includes director name, appointment date, cessation date (if applicable)
- [ ] Commercial gating enforced for paid access (free tier gets 403 `PRODUCT_NOT_ALLOWED`)
  - `Verify:` Free-tier key → 403; paid key → 200
  - `Evidence:` Auth middleware enforces the active commercial entitlement
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
>
> **Observability default:** Backend work in Phase 3 should keep CloudWatch/SNS as the ops plane and use Honeycomb for backend trace verification on new API, webhook, background-job, or data-pipeline execution paths. Browser/frontend telemetry remains deferred unless a ticket explicitly adds it.

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

Webhook URLs allow developers to receive events (quota warnings, key changes) in their own systems. Notification preferences control email alerts. Account deletion (GDPR Article 17) must cascade: delete the Clerk user, retire the active commercial account in Lago, clean up any still-present legacy Stripe artifacts during migration, and purge `prontiq-customers` + `prontiq-keys` + `prontiq-usage` + `prontiq-audit` + `prontiq-ses-suppressions` for the org (see `ARCHITECTURE.MD` §11.1). Orchestrated by `scripts/purge-org.ts`.

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
  - `Evidence:` Clerk user deleted, Lago customer/subscription retired, any migration-era Stripe artifacts cleaned up, all customer/key/usage/audit/suppression DynamoDB state purged for the org

#### Scope

**In:** Webhook config, notification preferences, account deletion

**Out — Do Not Implement:**

- Audit log → future
- Two-factor authentication settings → Clerk handles this
- API access logs → future

---

### Ticket P3.06 — Historical Stripe LEI Usage Meter Planning

```yaml
id: P3.06
title: Historical Stripe LEI Usage Meter Planning
status: superseded
priority: p1-high
epic: P3
depends_on: [P1B.10]
completed: null
```

#### User Story

> Superseded planning. Future LEI billing work should map LEI usage into Lago
> billable metrics and product mappings rather than new Stripe meters.

As a platform operator, I retain the historical Stripe-meter planning context for LEI while steering future LEI commercialisation toward Lago billable metrics instead.

#### Historical Superseded State

- The retired idea was to add LEI-specific Stripe usage meters and prices on top
  of the legacy billing path.
- That should not be resumed. When LEI commercialisation returns, define Lago
  billable metrics, product mappings, and billing-surface visibility instead of
  introducing new Stripe meters.

#### Scope

**In:** historical context only; explicit reminder not to continue LEI commercialisation through new Stripe-meter work

**Out — Do Not Implement:**

- new Stripe meters/prices for LEI

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
>
> **Observability default:** Backend work in Phase 4 should keep CloudWatch/SNS as the ops plane and use Honeycomb for backend trace verification on new OAuth, webhook, API, or background execution paths. Browser/plugin-side telemetry remains out of scope unless a ticket explicitly adds it.

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
- [ ] OAuth callback + install/uninstall webhook execution path visible in Honeycomb
  - `Verify:` Complete one install and one uninstall flow in a non-prod environment → traces appear in Honeycomb for the OAuth callback and webhook handlers
  - `Evidence:` Honeycomb traces show the store provisioning and deactivation path for the Shopify integration flow

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
>
> **Observability default:** New backend APIs, pipelines, and scheduled jobs introduced in Phase 5 should continue to alert through CloudWatch/SNS and emit Honeycomb traces for request, pipeline, and workflow debugging. Browser/frontend telemetry remains out of scope unless explicitly introduced by a future ticket.

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

### Ticket P5.03 — Historical Stripe Meter Planning for CVE + Patents

```yaml
id: P5.03
title: Historical Stripe Meter Planning for CVE + Patents
status: superseded
priority: p1-high
epic: P5
depends_on: [P5.01, P5.02]
completed: null
```

#### User Story

> Superseded planning. Future CVE/Patents billing work should map usage into
> Lago billable metrics and product mappings rather than additional Stripe
> meters.

As a platform operator, I retain the historical Stripe-meter planning context for CVE and Patents while steering future commercialisation toward Lago billable metrics instead.

#### Problem Statement

This ticket is retained only as a record of the retired Stripe-meter expansion idea for later product families. Do not schedule new engineering work from it. When CVE or Patents commercialisation resumes under the Lago target architecture, track billable-metric definition, customer/product mapping, and billing-surface visibility in Lago-target tickets instead.

#### Historical Superseded State

- The retired idea was to add additional Stripe meters and prices for CVE and
  Patents on top of the legacy billing stack.
- That should not be resumed. When those product families are commercialised,
  define Lago billable metrics, product mappings, and billing-surface behavior
  instead of introducing new Stripe meters.

#### Scope

**In:** historical context only; explicit reminder not to continue CVE/Patents commercialisation through new Stripe-meter work

**Out — Do Not Implement:**

- new Stripe meters/prices for CVE or Patents

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
- **88 tickets completed**
