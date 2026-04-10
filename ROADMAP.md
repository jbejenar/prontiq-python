# Prontiq Platform — Roadmap

> A unified data API platform for Australian and global open data.
> Last updated: 2026-04-10 · v1.1
>
> **Reference:** `ARCHITECTURE.MD` is the authoritative design doc. This roadmap is the execution plan.

---

## Overview

**Pattern:** Free open dataset → independent pipeline → S3 (NDJSON + manifest.json) → event-driven indexing → OpenSearch → commercial API → auth / billing / docs / SDKs.

**Stack:** SST v3 + Pulumi · Hono + @hono/zod-openapi · OpenSearch 2.13 · DynamoDB · Clerk · Unkey · Stripe · Next.js 15 · Mintlify · Speakeasy

**Repo:** pnpm monorepo with Turborepo. 10 workspace packages. TypeScript strict. ESM only.

---

## Summary

| Phase     | Epic                       | Tickets | Done     | Target      |
| --------- | -------------------------- | ------- | -------- | ----------- |
| **P0**    | Infrastructure Foundation  | 6       | 5/6      | Week 1      |
| **P1A**   | API Core (Address)         | 10      | 1/10     | Weeks 2-3   |
| **P1B**   | Auth & Billing             | 9       | 0/9      | Weeks 3-4   |
| **P1C**   | Dashboard                  | 7       | 0/7      | Weeks 4-5   |
| **P1D**   | Docs & SDK                 | 5       | 0/5      | Week 5      |
| **P1E**   | Ingestion (Phase 1)        | 6       | 0/6      | Week 6      |
| **P1F**   | Distribution               | 2       | 0/2      | Week 6      |
| **P2**    | ABN/ASIC Verification      | 8       | 0/8      | Weeks 7-10  |
| **P3**    | GLEIF/LEI + Full Dashboard | 7       | 0/7      | Weeks 11-13 |
| **P4**    | Shopify + WooCommerce      | 5       | 0/5      | Weeks 14-17 |
| **P5**    | CVE/NVD + Patents          | 4       | 0/4      | Weeks 18-21 |
| **Total** |                            | **69**  | **6/69** |             |

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
status: pending
priority: p0-critical
epic: P0
persona: [builder]
depends_on: [P0.01, P0.02]
completed: null
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

Main branch CI has been exercised after staging removal. The `check` job succeeds, but `deploy-dev` is still failing in run `24234119406` during `pnpm deploy:dev`. Two residual blockers remain: SST's Lambda bundle cannot resolve the workspace package `@prontiq/shared`, and the GitHub Actions deploy role is missing `s3:PutObjectTagging` on the SST asset bucket.

#### Definition of Done

##### Functional

- [ ] Push to `main` triggers the `check` job
  - `Verify:` Push a commit, check GitHub Actions tab
  - `Evidence:` Workflow run URL
- [ ] `pnpm install --frozen-lockfile` succeeds in CI
  - `Verify:` Job log shows successful install
  - `Evidence:` Screenshot or log excerpt
- [ ] `pnpm typecheck` passes all packages in CI
  - `Verify:` Job log shows "Tasks: N successful"
  - `Evidence:` Turbo output in CI log
- [ ] `pnpm build` passes all packages in CI
  - `Verify:` Job log
  - `Evidence:` Turbo output
- [ ] `pnpm lint` passes in CI
  - `Verify:` Job log
  - `Evidence:` Zero lint errors
- [ ] OIDC credential exchange works in `deploy-dev` job
  - `Verify:` `aws-actions/configure-aws-credentials` step succeeds
  - `Evidence:` "Successfully assumed role" in job log
- [ ] `sst deploy --stage dev` succeeds from CI
  - `Verify:` SST output shows "Complete" with resource URLs
  - `Evidence:` Dev API URL accessible
- [ ] Manual dispatch workflow for `sst deploy --stage prod` exists
  - `Verify:` "Run workflow" button visible on Actions tab
  - `Evidence:` workflow_dispatch trigger in CI yaml

#### Scope

**In:** CI workflow validation, OIDC exchange, dev deploy, manual prod trigger

**Out — Do Not Implement:**

- Test execution (no tests yet) → P1B.09
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
- Test-specific lint rules → P1B.09
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
status: pending
priority: p0-critical
epic: P0
persona: [builder]
depends_on: [P0.02]
external_dependency: "flat-white pipeline must have published G-NAF data + created addresses index"
completed: null
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

Platform connectivity is verified: `/v1/health/opensearch` returns 200 with a green cluster from the live dev API. The final `addresses` alias/data check remains blocked by the external flat-white data publish; the live alias list currently contains only system aliases (`.kibana`) and no `addresses` alias.

#### Definition of Done

##### Functional

- [ ] `OPENSEARCH_ENDPOINT` environment variable set to the `flat-white` domain endpoint
  - `Verify:` `sst deploy` with endpoint set; Lambda env vars include it
  - `Evidence:` `aws lambda get-function-configuration` shows endpoint
- [ ] Lambda can reach OpenSearch domain via SigV4
  - `Verify:` Hit `/v1/health` or a test endpoint that queries OpenSearch `_cluster/health`
  - `Evidence:` Response includes cluster status (green/yellow)
- [ ] IAM execution role has `es:ESHttp*` on the domain
  - `Verify:` `aws iam get-role-policy` on the Lambda execution role
  - `Evidence:` Policy statement with `es:ESHttp*` on `arn:aws:es:ap-southeast-2:493712557159:domain/flat-white/*`
- [ ] Query against `addresses` alias returns results
  - `Verify:` `curl .../v1/address/autocomplete?q=16+heath+cres` with a test API key
  - `Evidence:` Response contains address suggestions from G-NAF data
- [ ] Connection pooling configured (keepAlive, maxSockets)
  - `Verify:` OpenSearch client instantiation in `search/client.ts`
  - `Evidence:` Already configured with lazy init, SigV4, maxRetries: 2, requestTimeout: 10000

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
status: pending
priority: p0-critical
epic: P1A
persona: [api-consumer]
depends_on: [P0.06, P1A.01]
completed: null
tech_stack:
  search: OpenSearch search_as_you_type
  target_latency: "<50ms warm"
```

#### User Story

As an API consumer, `GET /v1/address/autocomplete?q=16+heath+cres` returns matching addresses in < 50ms (warm) so that I can build real-time typeahead UIs.

#### Problem Statement

Address autocomplete is the flagship endpoint — the first thing developers try, the hero demo on the landing page, the reason they sign up. It must be fast (< 50ms warm), accurate (top result matches user intent), and rich enough to populate a form. The `search_as_you_type` field in OpenSearch handles prefix matching across n-grams, but the query needs tuning against real G-NAF data to ensure quality.

#### Definition of Done

##### Functional

- [ ] Returns top-N suggestions with `id`, `addressLabel`, `localityName`, `state`, `postcode`, `confidence`
  - `Verify:` `curl .../v1/address/autocomplete?q=16+heath+cres` with API key
  - `Evidence:` Response contains array of suggestions with all fields present
- [ ] `search_as_you_type` multi_match query works against `addressLabelSearch` field
  - `Verify:` Query for partial input "16 heath" returns "16 HEATH CRESCENT HAMPTON EAST VIC 3188"
  - `Evidence:` Top result matches expected address
- [ ] Optional `state` filter works (e.g., `?state=VIC`)
  - `Verify:` Query with `&state=VIC` returns only VIC addresses
  - `Evidence:` All results have `state: "VIC"`
- [ ] Optional `limit` parameter (default 5, max 20)
  - `Verify:` `?limit=3` returns 3 results; `?limit=25` returns 400 error
  - `Evidence:` Response array length matches limit; validation error for > 20
- [ ] Response includes total count for pagination context
  - `Verify:` Response includes `total` field
  - `Evidence:` `total` reflects total matches, not just returned count

##### Performance

- [ ] Response time < 50ms for warm Lambda invocation
  - `Verify:` X-Ray trace or `time curl` repeated 10 times
  - `Evidence:` P50 < 30ms, P95 < 50ms (warm), P99 includes cold starts ~300ms

#### Scope

**In:** Autocomplete query against real data, state filter, limit, response format

**Out — Do Not Implement:**

- Proximity biasing (lat/lon boost) → future enhancement
- Fuzzy matching for typos → future enhancement
- Address component parsing → P1A.03 (validate handles this)

---

### Ticket P1A.03 — Address Validate Endpoint

```yaml
id: P1A.03
title: Address Validate Endpoint
status: pending
priority: p0-critical
epic: P1A
persona: [api-consumer]
depends_on: [P0.06, P1A.01]
completed: null
tech_stack:
  search: OpenSearch best_fields
```

#### User Story

As an API consumer, `GET /v1/address/validate?q=16 heath crescent hampton east vic 3188` returns the best matching address with a confidence level so that I can verify user-entered addresses against the G-NAF database.

#### Problem Statement

Address validation is the core business use case. Users paste a full address string and need to know: (1) does this address exist in G-NAF? (2) how confident is the match? (3) what's the canonical form? The validate endpoint uses `best_fields` matching (not prefix-based like autocomplete) and returns a single best match with a confidence classification based on the relevance score.

#### Definition of Done

##### Functional

- [ ] Returns best match with `id`, full address fields, and confidence (`high`/`medium`/`low`)
  - `Verify:` Query with known address returns `confidence: "high"`
  - `Evidence:` "16 heath crescent hampton east vic 3188" → match with high confidence
- [ ] Returns `null` match and `confidence: 0` when no confident result found
  - `Verify:` Query with garbage string "zzz123 nonexistent" returns null match
  - `Evidence:` `{ "match": null, "confidence": 0 }`
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
status: pending
priority: p1-high
epic: P1A
persona: [api-consumer]
depends_on: [P0.06, P1A.01]
completed: null
```

#### User Story

As an API consumer, `GET /v1/address/enrich?id=GAVIC420559144` returns the full enriched address record including boundaries, electorates, and statistical geography so that I can enrich my data with government boundaries.

#### Problem Statement

Enrichment is the premium feature — boundaries (LGA, electorates, mesh blocks, SA2-SA4, GCCSA) are what no competitor offers at this price point. The enrich endpoint is a simple `GET` by document ID, returning all fields. It's gated to Starter+ tier because it's the upsell driver: free-tier autocomplete gets developers in, boundary enrichment converts them to paid.

#### Definition of Done

##### Functional

- [ ] Returns all fields: address, geocode, boundaries (LGA, ward, electorate, meshblock, SA2-SA4, GCCSA)
  - `Verify:` `curl .../v1/address/enrich?id=GAVIC420559144`
  - `Evidence:` Response includes `boundaries.lga.name: "Bayside"`, `boundaries.commonwealthElectorate.name: "GOLDSTEIN"`, etc.
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
status: pending
priority: p1-high
epic: P1A
persona: [api-consumer]
depends_on: [P0.06, P1A.01]
completed: null
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
status: pending
priority: p2-value
epic: P1A
persona: [api-consumer]
depends_on: [P0.06, P1A.01]
completed: null
```

#### User Story

As an API consumer, `GET /v1/address/lookup/postcode?postcode=3188` returns all localities in that postcode so that I can populate location dropdowns.

#### Definition of Done

##### Functional

- [ ] Returns list of localities with name, state, address count
  - `Verify:` `curl .../v1/address/lookup/postcode?postcode=3188`
  - `Evidence:` Response includes `{"postcode":"3188","localities":[{"name":"HAMPTON EAST","state":"VIC","address_count":...}]}`
- [ ] Uses `terms` aggregation on `localityName` field
  - `Verify:` OpenSearch query uses aggregation, not document scan
  - `Evidence:` `size: 0` in query body (aggregation only)
- [ ] Validates 4-digit Australian postcode format
  - `Verify:` `?postcode=999` returns 400; `?postcode=3188` returns 200
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
status: pending
priority: p2-value
epic: P1A
persona: [api-consumer]
depends_on: [P0.06, P1A.01]
completed: null
```

#### User Story

As an API consumer, `GET /v1/address/lookup/suburb?suburb=hampton+east` returns postcodes, geographic bounds, and address count for a suburb.

#### Definition of Done

##### Functional

- [ ] Returns postcodes, geographic bounds (bounding box), address count
  - `Verify:` `curl .../v1/address/lookup/suburb?suburb=hampton+east`
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

Address data changes quarterly. The same "16 heath cres" query from 1000 different users hits OpenSearch 1000 times with identical results. API Gateway caching sits in front of the Lambda — cache hits never invoke the function. At $0.02/hr for 0.5GB (~$15/month), this is the cheapest performance optimization possible. Cache invalidation is triggered by the ingestion Step Function after alias swap.

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

- Per-key per-second rate limiting (token bucket / sliding window) → P2 (per ARCHITECTURE.MD: "deferred to Phase 2+")
- Geographic restrictions → not needed (LEI is international)
- Custom WAF rules per customer → future
- Bot detection → future

---

## Phase 1B — Auth & Billing

> **Goal:** Sign-up → API key → rate-limited requests → usage tracking → billing.
>
> **Dependency:** P1B.01-03 (vendor setup) can run in parallel. P1B.04-06 (webhook handlers) depend on vendor setup. P1B.07-08 (reconciliation, billing) depend on webhook handlers.

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

As a builder, I need a Clerk application configured with OAuth providers and webhook so that users can sign up and the provisioning chain is triggered automatically.

#### Problem Statement

Clerk handles human identity: sign-up, login, OAuth (Google/GitHub), organisations, team management. The dashboard authenticates through Clerk. A webhook on `user.created` triggers the provisioning chain (Stripe customer → Unkey key → DynamoDB record). Without Clerk, there's no sign-up flow and no user identity for the dashboard.

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
  - `Verify:` `sst deploy` passes keys to Dashboard and webhook Lambda
  - `Evidence:` Lambda env vars include Clerk keys
- [ ] Clerk webhook secret stored and used for signature verification
  - `Verify:` `CLERK_WEBHOOK_SECRET` available in webhook handler env
  - `Evidence:` SST config passes it through

#### Scope

**In:** Clerk app creation, OAuth config, webhook config, secret management

**Out — Do Not Implement:**

- Webhook handler implementation → P1B.04
- Dashboard Clerk components → P1C.02
- Team/org management → P3.03

---

### Ticket P1B.02 — Unkey Setup

```yaml
id: P1B.02
title: Unkey Setup
status: pending
priority: p0-critical
epic: P1B
persona: [builder]
depends_on: []
completed: null
tech_stack:
  keys: Unkey
```

#### User Story

As a builder, I need Unkey configured for API key issuance with the `pq_live_` prefix so that the platform can issue, scope, and manage API keys.

#### Definition of Done

##### Functional

- [ ] Unkey API created in Unkey dashboard
  - `Verify:` Unkey dashboard shows API with key prefix configured
  - `Evidence:` API ID available
- [ ] Root key stored in SST secrets
  - `Verify:` `UNKEY_ROOT_KEY` available in webhook handler env
  - `Evidence:` SST config passes it through
- [ ] Key prefix: `pq_live_` (production), `pq_test_` (sandbox)
  - `Verify:` Create a test key; prefix matches
  - `Evidence:` Key starts with `pq_live_` or `pq_test_`
- [ ] Webhook URL configured for `key.created`, `key.updated`, `key.deleted`
  - `Verify:` Unkey dashboard webhooks section
  - `Evidence:` URL points to `{api-url}/webhooks/unkey`

#### Scope

**In:** Unkey API creation, root key, prefix config, webhook config

**Out — Do Not Implement:**

- Webhook handler → P1B.06
- Reconciliation Lambda → P1B.07
- Management UI in dashboard → P1C.03

---

### Ticket P1B.03 — Stripe Setup

```yaml
id: P1B.03
title: Stripe Setup
status: pending
priority: p0-critical
epic: P1B
persona: [builder]
depends_on: []
completed: null
tech_stack:
  billing: Stripe (metered)
```

#### User Story

As a builder, I need Stripe configured with subscription plans and per-product usage meters so that the platform can bill developers based on their actual API usage.

#### Problem Statement

Stripe metered billing uses one subscription per organisation with per-product usage line items. The pricing model (Free/Starter $29/Growth $99) is defined in ARCHITECTURE.MD section 5.6. Usage meters track per-product API calls and report to Stripe hourly. The embedded pricing table handles plan selection and card collection without custom UI.

#### Definition of Done

##### Functional

- [ ] Stripe products created: Free, Starter ($29/mo), Growth ($99/mo)
  - `Verify:` Stripe dashboard Products section
  - `Evidence:` Product IDs and price IDs documented
- [ ] Per-product usage meters created (address, abn, lei, cve, patents)
  - `Verify:` Stripe Billing → Meters section
  - `Evidence:` Meter IDs for each product
- [ ] Embedded pricing table configured
  - `Verify:` Stripe pricing table embed code available
  - `Evidence:` Pricing table ID for embedding in dashboard
- [ ] Webhook URL configured for `subscription.created`, `subscription.updated`
  - `Verify:` Stripe dashboard Webhooks section
  - `Evidence:` URL points to `{api-url}/webhooks/stripe`
- [ ] `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` in SST secrets
  - `Verify:` Webhook handler Lambda has access to Stripe keys
  - `Evidence:` SST config passes them through

#### Scope

**In:** Stripe products, prices, meters, pricing table, webhook config, secrets

**Out — Do Not Implement:**

- Webhook handler → P1B.05
- Usage reporting Lambda → P1B.08
- Dashboard billing page → P1C.05
- Enterprise custom pricing → future

---

### Ticket P1B.04 — Clerk Webhook Handler (Provisioning)

```yaml
id: P1B.04
title: Clerk Webhook Handler (Provisioning)
status: pending
priority: p0-critical
epic: P1B
persona: [api-consumer]
depends_on: [P1B.01, P1B.02, P1B.03]
completed: null
```

#### User Story

As a new user signing up, I automatically receive a Stripe customer account, an API key, and a DynamoDB record within seconds of creating my account — zero manual steps.

#### Problem Statement

The provisioning chain is the most critical webhook handler. It connects three vendors (Clerk → Stripe → Unkey → DynamoDB) in sequence. Each step must succeed or roll back. The handler must be idempotent (Clerk retries failed webhooks) and must verify the webhook signature (Svix) to prevent forged provisioning requests. A bug here = users can't get API keys = zero revenue.

#### Definition of Done

##### Functional

- [ ] Webhook signature verified via Svix
  - `Verify:` Send unsigned request → 401; send signed request → 200
  - `Evidence:` `svix.webhooks.verify()` call in handler
- [ ] Stripe customer created with free tier subscription
  - `Verify:` After sign-up, Stripe dashboard shows new customer with Free subscription
  - `Evidence:` `stripe.customers.create()` + `stripe.subscriptions.create()` in handler
- [ ] Unkey key created with free tier limits (`pq_live_` prefix)
  - `Verify:` After sign-up, Unkey dashboard shows new key
  - `Evidence:` Unkey API `keys.createKey()` with metadata from TIER_LIMITS
- [ ] DynamoDB record created with key metadata + usage counters
  - `Verify:` `aws dynamodb get-item` with the new API key
  - `Evidence:` Record includes `apiKey`, `ownerEmail`, `tier: "free"`, `products`, `monthlyQuotaPerProduct`, `usage: {}`
- [ ] Idempotent: re-processing same `user.created` event doesn't create duplicates
  - `Verify:` Send same webhook payload twice; only one Stripe customer, one Unkey key, one DynamoDB record
  - `Evidence:` Handler checks if customer already exists before creating

#### Scope

**In:** Webhook verification, Stripe customer + subscription, Unkey key, DynamoDB record, idempotency

**Out — Do Not Implement:**

- Welcome email → deferred (can add later)
- Team/org provisioning → P3.03
- Sandbox key creation → future

---

### Ticket P1B.05 — Stripe Webhook Handler (Tier Changes)

```yaml
id: P1B.05
title: Stripe Webhook Handler (Tier Changes)
status: pending
priority: p0-critical
epic: P1B
persona: [api-consumer]
depends_on: [P1B.03]
completed: null
```

#### User Story

As a developer upgrading from Free to Starter, my API key limits update automatically within seconds so that I can immediately use the higher quota and additional products.

#### Definition of Done

##### Functional

- [ ] Webhook signature verified via Stripe SDK (`stripe.webhooks.constructEvent()`)
  - `Verify:` Unsigned request → 400; signed request → 200
  - `Evidence:` Stripe SDK verification in handler
- [ ] Subscription tier mapped to `TIER_LIMITS` constants from `@prontiq/shared`
  - `Verify:` Upgrade to Starter → `monthlyQuotaPerProduct: 10000`, `products: ["address","abn","lei","cve","patents"]`
  - `Evidence:` Handler imports and uses `TIER_LIMITS`
- [ ] Unkey key updated with new tier limits + product scopes
  - `Verify:` After upgrade, Unkey key metadata reflects new tier
  - `Evidence:` Unkey API `keys.updateKey()` call
- [ ] DynamoDB record updated with new tier + quota
  - `Verify:` `aws dynamodb get-item` shows updated tier and quota
  - `Evidence:` DynamoDB `UpdateItem` in handler
- [ ] Downgrade: existing usage preserved, new lower limit enforced on next request
  - `Verify:` Downgrade from Growth (50K) to Starter (10K) with 12K usage → next request returns 429
  - `Evidence:` Auth middleware checks `currentUsage >= monthlyQuotaPerProduct`

#### Scope

**In:** Stripe webhook verification, tier mapping, Unkey key update, DynamoDB update, downgrade handling

**Out — Do Not Implement:**

- Prorated billing → Stripe handles this automatically
- Cancellation flow → P1C.05

---

### Ticket P1B.06 — Unkey Webhook Handler (Key Sync)

```yaml
id: P1B.06
title: Unkey Webhook Handler (Key Sync)
status: pending
priority: p1-high
epic: P1B
persona: [ops]
depends_on: [P1B.02]
completed: null
```

#### User Story

As a platform operator, when a key is created/updated/deleted in Unkey (via dashboard or API), DynamoDB stays in sync so that the hot-path verification always has current key state.

#### Definition of Done

##### Functional

- [ ] Webhook signature verified
  - `Verify:` Unsigned request → 401
  - `Evidence:` Verification code in handler
- [ ] `key.created` → DynamoDB PutItem
  - `Verify:` Create key in Unkey; DynamoDB record appears
  - `Evidence:` PutItem with full metadata
- [ ] `key.updated` → DynamoDB UpdateItem (tier, products, quota)
  - `Verify:` Update key in Unkey; DynamoDB record reflects change
  - `Evidence:` UpdateItem with changed fields
- [ ] `key.deleted` → DynamoDB UpdateItem (active: false)
  - `Verify:` Delete key in Unkey; DynamoDB record shows `active: false`
  - `Evidence:` Soft delete, not hard delete (audit trail)
- [ ] Idempotent: re-processing same event is safe
  - `Verify:` Send same webhook twice; DynamoDB state is correct
  - `Evidence:` Conditional writes or idempotency checks

#### Scope

**In:** Key lifecycle sync to DynamoDB (create, update, delete)

**Out — Do Not Implement:**

- Reconciliation (catch missed webhooks) → P1B.07
- Key rotation flow → P1C.03

---

### Ticket P1B.07 — Unkey Reconciliation Lambda

```yaml
id: P1B.07
title: Unkey Reconciliation Lambda
status: pending
priority: p1-high
epic: P1B
persona: [ops]
depends_on: [P1B.06]
completed: null
```

#### User Story

As a platform operator, DynamoDB stays consistent with Unkey even if webhooks fail so that a deleted key never continues working and a downgraded key never keeps old limits.

#### Problem Statement

Webhooks can fail: Lambda cold start timeout, network issues, Unkey webhook delivery failure. Without reconciliation, a deleted key in Unkey continues working via DynamoDB (security hole). A 15-minute scheduled Lambda diffs Unkey against DynamoDB and fixes discrepancies. Cost: negligible (one Unkey API call + one DynamoDB scan per run).

#### Definition of Done

##### Functional

- [ ] Scheduled Lambda runs every 15 minutes (EventBridge rule)
  - `Verify:` EventBridge rule exists with 15-min cron
  - `Evidence:` SST config defines the schedule
- [ ] Lists all Unkey keys, diffs against DynamoDB
  - `Verify:` Lambda execution logs show diff results
  - `Evidence:` CloudWatch logs
- [ ] Deactivates orphaned keys (in DynamoDB but not in Unkey)
  - `Verify:` Delete key in Unkey, wait 15 min; DynamoDB record shows `active: false`
  - `Evidence:` Reconciliation log shows "deactivated 1 orphaned key"
- [ ] Creates missing records (in Unkey but not in DynamoDB)
  - `Verify:` Create key directly in Unkey (bypassing webhook); record appears in DynamoDB within 15 min
  - `Evidence:` Reconciliation log shows "created 1 missing record"
- [ ] Updates stale metadata (tier, quota mismatch)
  - `Verify:` Update key in Unkey (bypassing webhook); DynamoDB updates within 15 min
  - `Evidence:` Reconciliation log shows "updated 1 stale record"
- [ ] Logs all discrepancies as CloudWatch warnings
  - `Verify:` CloudWatch Insights query for reconciliation warnings
  - `Evidence:` Structured log entries with discrepancy details

#### Scope

**In:** Scheduled reconciliation, diff logic, fix orphaned/missing/stale keys, logging

**Out — Do Not Implement:**

- Real-time consistency (webhooks handle the common case) → P1B.06
- Alerting on high discrepancy count → P1F.02

---

### Ticket P1B.08 — Usage → Stripe Batch Lambda

```yaml
id: P1B.08
title: Usage → Stripe Batch Lambda
status: pending
priority: p0-critical
epic: P1B
persona: [ops]
depends_on: [P1B.03]
completed: null
```

#### User Story

As a platform operator, usage data flows from DynamoDB to Stripe hourly so that metered billing is accurate and no usage is lost.

#### Problem Statement

Usage counters accumulate in DynamoDB (atomic `ADD` per request). Stripe needs these reported as usage records for metered billing. The pipeline must be idempotent (re-processing doesn't double-count), durable (failures don't lose data), and timely (end-of-month sweep ensures all usage is billed). See ARCHITECTURE.MD section 5.6 for the full durability guarantee.

#### Definition of Done

##### Functional

- [ ] Scheduled Lambda runs hourly (EventBridge rule)
  - `Verify:` EventBridge rule with hourly cron
  - `Evidence:` SST config
- [ ] Scans DynamoDB for keys with usage > `lastReportedCount`
  - `Verify:` Lambda execution log shows scan results
  - `Evidence:` CloudWatch logs
- [ ] Reports delta to Stripe via `subscriptionItems.createUsageRecord()`
  - `Verify:` Stripe dashboard shows usage records
  - `Evidence:` Usage records appear with correct quantities
- [ ] Updates `lastReportedCount` in DynamoDB after successful Stripe write
  - `Verify:` DynamoDB record shows updated `lastReportedCount`
  - `Evidence:` Re-running Lambda reports zero (no new usage)
- [ ] DLQ (SQS) for failures, SNS alert after 3 consecutive failures
  - `Verify:` Break Stripe connection; DLQ receives messages; SNS alert fires
  - `Evidence:` SQS messages and email alert
- [ ] End-of-month sweep at 23:55 UTC
  - `Verify:` EventBridge rule for monthly sweep
  - `Evidence:` SST config
- [ ] Idempotent: re-processing doesn't double-count
  - `Verify:` Run Lambda twice with same data; Stripe shows correct total (not doubled)
  - `Evidence:` `lastReportedCount` prevents double-reporting

#### Scope

**In:** Hourly batch, delta reporting, idempotency, DLQ, end-of-month sweep

**Out — Do Not Implement:**

- Real-time usage reporting → overkill for Phase 1 volumes
- Usage analytics dashboard → P1C.04

---

### Ticket P1B.09 — Auth Middleware Integration Test

```yaml
id: P1B.09
title: Auth Middleware Integration Test
status: pending
priority: p1-high
epic: P1B
persona: [builder]
depends_on: [P1B.04]
completed: null
```

#### User Story

As a builder, I need an integration test that verifies the full auth chain end-to-end with a real API key so that auth regressions are caught before deploy.

#### Definition of Done

##### Seed Script (prerequisite — `scripts/seed-test-data.ts`)

- [ ] Seed script implemented: creates test API keys in DynamoDB with known values
  - `Verify:` `npx tsx scripts/seed-test-data.ts` exits 0; DynamoDB has test records
  - `Evidence:` Script creates: `pq_test_valid` (free tier, address+abn), `pq_test_premium` (growth tier, all products), `pq_test_exhausted` (quota 0)
- [ ] Seed script is idempotent (safe to re-run)
  - `Verify:` Run twice; no errors, same DynamoDB state
  - `Evidence:` Uses PutItem (overwrites)

##### Functional

- [ ] Request with valid key returns 200
  - `Verify:` `curl -H "X-Api-Key: pq_test_..." .../v1/health`
  - `Evidence:` 200 OK
- [ ] Request with missing key returns 401 `MISSING_API_KEY`
  - `Verify:` `curl .../v1/address/autocomplete?q=test` (no key)
  - `Evidence:` `{"error":{"code":"MISSING_API_KEY",...}}`
- [ ] Request with invalid key returns 401 `INVALID_API_KEY`
  - `Verify:` `curl -H "X-Api-Key: pq_test_invalid" .../v1/address/autocomplete?q=test`
  - `Evidence:` `{"error":{"code":"INVALID_API_KEY",...}}`
- [ ] Request exceeding quota returns 429 `QUOTA_EXCEEDED`
  - `Verify:` Seed key with quota 1, make 2 requests
  - `Evidence:` Second request returns 429
- [ ] Request for disallowed product returns 403 `PRODUCT_NOT_ALLOWED`
  - `Verify:` Seed free-tier key, request `/v1/lei/lookup`
  - `Evidence:` `{"error":{"code":"PRODUCT_NOT_ALLOWED",...}}`
- [ ] Usage counter increments after successful request
  - `Verify:` Check DynamoDB before and after request; counter increased
  - `Evidence:` `usage.address.2026-04` incremented by 1

##### Testing

- [ ] Tests runnable via `pnpm test` (Vitest)
  - `Verify:` `pnpm --filter @prontiq/api test`
  - `Evidence:` All auth integration tests pass

#### Scope

**In:** Auth chain integration tests, seed script, all error code verification

**Out — Do Not Implement:**

- Load testing → future
- Rate limiting tests (per-second) → future (only monthly quota tested)

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
  - `Verify:` Type "16 heath" → suggestions appear from G-NAF data
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
depends_on: [P1B.04, P1C.07]
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
title: API Key Management Page
status: pending
priority: p1-high
epic: P1C
persona: [api-consumer]
depends_on: [P1B.02, P1C.07]
completed: null
tech_stack:
  ui: Next.js 15 + shadcn/ui
  keys: Unkey management API
```

#### User Story

As a developer, I can view, create, rotate, and delete API keys so that I can manage access for different environments and team members.

#### Problem Statement

Developers need multiple keys: one for production, one for staging, one for each team member. Key rotation (create new, deactivate old) must be atomic — there should never be a moment where the old key is dead and the new key isn't active. Sandbox keys (`pq_test_`) allow testing against the API without consuming production quota.

#### Definition of Done

##### Functional

- [ ] List all keys with creation date, last used timestamp, product scopes
  - `Verify:` Dashboard keys page loads with table of keys
  - `Evidence:` Table renders with real data from Unkey API
- [ ] Create new key (calls Unkey API, syncs to DynamoDB via webhook)
  - `Verify:` Click "Create Key" → new key appears in list within 5 seconds
  - `Evidence:` Key visible in Unkey dashboard and DynamoDB
- [ ] Rotate key (create new, deactivate old — single click, atomic)
  - `Verify:` Click "Rotate" → old key shows "Deactivated", new key active
  - `Evidence:` Old key returns 401 on API call; new key returns 200
- [ ] Delete key (calls Unkey API, cascades to DynamoDB soft-delete)
  - `Verify:` Click "Delete" → confirmation dialog → key removed from list
  - `Evidence:` DynamoDB record shows `active: false`
- [ ] Sandbox vs live toggle (key prefix `pq_test_` vs `pq_live_`)
  - `Verify:` Toggle shows sandbox keys separately, prefix clearly visible
  - `Evidence:` Sandbox keys don't count against production quota

#### Scope

**In:** Key CRUD, rotation, sandbox/live toggle, Unkey API integration

**Out — Do Not Implement:**

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
  - `Verify:` Upgrade in portal → Unkey key limits update within 60 seconds (via webhook)
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

As a builder, I need a consistent component library so that all dashboard pages share the same design system and I don't reinvent UI primitives.

#### Problem Statement

Without a design system, each dashboard page will look different — inconsistent spacing, colors, button styles, table layouts. shadcn/ui provides accessible, composable components built on Radix UI + Tailwind. It's not a dependency — components are copied into the project and can be customized. The dashboard layout (sidebar navigation with collapsible mobile nav) is the shared shell for all pages.

#### Definition of Done

##### Functional

- [ ] Tailwind CSS v4 configured in dashboard package
  - `Verify:` `pnpm --filter @prontiq/dashboard dev` → Tailwind classes apply correctly
  - `Evidence:` `packages/dashboard/tailwind.config.ts` or CSS `@import` exists
- [ ] shadcn/ui initialized with core components
  - `Verify:` `ls packages/dashboard/components/ui/` shows component files
  - `Evidence:` Button, Card, Input, Table, Dialog, Sheet, Tabs, Badge, Skeleton present
- [ ] Dark mode support (system preference + manual toggle)
  - `Verify:` Toggle dark mode → all components switch themes
  - `Evidence:` `ThemeProvider` wrapper in layout, `class="dark"` applied to `<html>`
- [ ] Dashboard layout component with sidebar navigation
  - `Verify:` All dashboard pages render inside the sidebar layout
  - `Evidence:` Sidebar shows: Overview, Keys, Usage, Billing, Playground, Settings
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
status: pending
priority: p0-critical
epic: P1D
persona: [api-consumer]
depends_on: [P1A.01]
completed: null
```

#### Problem Statement

This ticket sets up the Mintlify infrastructure — not the content. Mintlify reads the OpenAPI spec (from P1A.01) and auto-generates API reference pages with interactive playgrounds. The navigation skeleton and custom domain are configured here. Actual prose content (Getting Started guide, tutorials) is P1D.02-03.

#### Definition of Done

- [ ] Mintlify Hobby plan activated with OpenAPI spec import from `/openapi.json`
  - `Verify:` Mintlify dashboard shows synced spec with all address endpoints
  - `Evidence:` Mintlify dashboard URL
- [ ] Navigation skeleton created: Getting Started (placeholder), Address API (auto-generated from spec), Rate Limits (placeholder), SDKs (placeholder)
  - `Verify:` `mint.json` navigation matches planned structure
  - `Evidence:` `packages/docs/mint.json`
- [ ] Interactive playground on each auto-generated endpoint page
  - `Verify:` Click "Try It" on /v1/address/autocomplete page
  - `Evidence:` Playground sends real request
- [ ] Custom domain: `docs.prontiq.dev`
  - `Verify:` `curl https://docs.prontiq.dev` returns docs site
  - `Evidence:` DNS + Mintlify custom domain configured
- [ ] Deploys on push to main (Mintlify Git integration)
  - `Verify:` Edit a docs page, push, site updates
  - `Evidence:` Mintlify webhook/Git sync active

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
  - `Verify:` Table matches TIER_LIMITS in `packages/shared/src/constants.ts`
  - `Evidence:` Free: 5K/mo, Starter: 10K/mo, Growth: 50K/mo per product
- [ ] Error handling guide (all error codes, retry logic, request_id tracing)
  - `Verify:` All 8 error codes documented with example responses
  - `Evidence:` `INVALID_API_KEY`, `MISSING_API_KEY`, `RATE_LIMIT_EXCEEDED`, `QUOTA_EXCEEDED`, `PRODUCT_NOT_ALLOWED`, `INVALID_PARAMETERS`, `NOT_FOUND`, `INTERNAL_ERROR`

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
status: pending
priority: p1-high
epic: P1D
persona: [api-consumer]
depends_on: [P1A.01]
completed: null
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
  - `Verify:` `const result = await prontiq.address.autocomplete({ q: "16 heath" })` — `result.suggestions` is typed
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
  - `Verify:` Type "16 heath" → dropdown shows matching addresses
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

> **Goal:** G-NAF data flows from flat-white pipeline → S3 → OpenSearch. Phase 1 uses GitHub Actions cron, not Step Functions.

---

### Ticket P1E.01 — flat-white Manifest Output (Cross-Repo)

```yaml
id: P1E.01
title: flat-white Manifest Output (Cross-Repo)
status: pending
priority: p0-critical
epic: P1E
persona: [builder]
depends_on: []
completed: null
note: "CROSS-REPO TICKET — work happens in jbejenar/flat-white, not prontiq-platform"
```

#### User Story

As a builder, I need the flat-white pipeline to produce manifests conforming to the platform contract so that the ingestion system can index address data automatically.

#### Problem Statement

The flat-white pipeline currently outputs NDJSON files to S3 but doesn't produce a manifest.json in the format the platform expects (see ARCHITECTURE.MD section 5.1.2). This ticket tracks the changes needed in the **flat-white repo** — it's a coordination ticket, not internal work. The prontiq-platform side verifies the output conforms to the schema.

#### Definition of Done

> **Note:** These DoD items are completed in the `jbejenar/flat-white` repo, not here. Mark as done when verified from this repo's perspective.

- [ ] flat-white pipeline updated to output `manifests/address-{version}.json` to S3
  - `Verify:` `aws s3 ls s3://flat-white-address-493712557159-ap-southeast-2-an/manifests/`
  - `Evidence:` Manifest file exists with correct naming convention
- [ ] Manifest conforms to `manifestV1Schema` (Zod validation passes)
  - `Verify:` Download manifest, run `manifestV1Schema.parse()` from @prontiq/shared
  - `Evidence:` Validation passes without errors
- [ ] Per-version `mappings.json` at `data/address/{version}/mappings.json`
  - `Verify:` `aws s3 ls s3://.../data/address/{version}/mappings.json`
  - `Evidence:` File exists
- [ ] All NDJSON files uploaded with `ChecksumAlgorithm: SHA256`
  - `Verify:` `aws s3api head-object` returns `ChecksumSHA256` header
  - `Evidence:` Header present on each NDJSON file
- [ ] `location` geo_point field added to each document (from `geocode.latitude`/`longitude`)
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
status: pending
priority: p0-critical
epic: P1E
persona: [ops]
depends_on: [P1E.01, P0.06]
completed: null
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

- [ ] Cron schedule: runs daily at 06:00 UTC (+ manual `workflow_dispatch`)
  - `Verify:` `.github/workflows/ingest.yml` has cron trigger + manual dispatch
  - `Evidence:` Workflow runs on schedule
- [ ] Lists `manifests/` prefix in S3, finds newest manifest per product
  - `Verify:` Workflow logs show manifest discovery
  - `Evidence:` `aws s3 ls s3://bucket/manifests/ | sort` in workflow
- [ ] Compares against current live index version (queries `_alias/addresses`)
  - `Verify:` Workflow compares manifest version with current index name
  - `Evidence:` Skips if already ingested (idempotent)
- [ ] If newer manifest found: triggers ingestion steps (P1E.03 → P1E.04 → P1E.05)
  - `Verify:` New manifest triggers full pipeline; old manifest skips
  - `Evidence:` Workflow output shows "New version found, ingesting" or "Already current, skipping"
- [ ] OIDC credentials for S3 read + OpenSearch write access
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
status: pending
priority: p0-critical
epic: P1E
persona: [ops]
depends_on: [P1E.02]
completed: null
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

- [ ] Creates `address-{version}` index with mappings from `data/address/{version}/mappings.json`
  - `Verify:` `GET /_cat/indices/address-*` shows new index
  - `Evidence:` Index created with correct mappings
- [ ] Refresh disabled during bulk load (`refresh_interval: -1`)
  - `Verify:` Index settings show `-1` during load
  - `Evidence:` Re-enabled to `1s` after load completes
- [ ] Streams each NDJSON file from S3 → `_bulk` API (batch size 5000 docs)
  - `Verify:` All NDJSON files ingested; `_count` matches expected total
  - `Evidence:` Bulk response shows 0 errors per batch
- [ ] Error handling: abort on bulk errors exceeding 0.1% failure rate
  - `Verify:` Inject a malformed doc → bulk aborts → new index deleted
  - `Evidence:` Error logged with failed doc details
- [ ] Blue-green: old index stays live on alias during entire load
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
status: pending
priority: p0-critical
epic: P1E
persona: [ops]
depends_on: [P1E.03]
completed: null
```

#### User Story

As a platform operator, after indexing the new data is validated and swapped in atomically so that bad data never reaches customers and rollback is instant.

#### Problem Statement

The health check is the gate between "data is indexed" and "data is live." It verifies doc count, runs sample queries against the NEW index (not the alias), and checks latency. Only if all checks pass does the atomic alias swap happen. Failure keeps the old index live and alerts via SNS. See ARCHITECTURE.MD section 5.2.2 for the alias swap mechanics and section 5.2.4 for retention policy.

#### Definition of Done

##### Functional

- [ ] Doc count matches `manifest.total_records` (within 0.1%)
  - `Verify:` `GET /address-{version}/_count` matches manifest
  - `Evidence:` Exact or near-exact match logged
- [ ] Sample queries return expected results (5-10 known-good queries against NEW index)
  - `Verify:` Known address "16 HEATH CRESCENT HAMPTON EAST VIC 3188" appears in results
  - `Evidence:` Query hits the new index directly (not via alias)
- [ ] Force merge to 5 segments
  - `Verify:` `POST /address-{version}/_forcemerge?max_num_segments=5` returns 200
  - `Evidence:` `_segments` API shows ≤ 5 segments per shard
- [ ] Atomic alias swap: `POST /_aliases` with remove old + add new
  - `Verify:` `GET /_alias/addresses` points to new index immediately after swap
  - `Evidence:` Single API call, zero-downtime transition
- [ ] Old index retained per product retention policy (7 days for address)
  - `Verify:` `GET /_cat/indices/address-*` shows both old and new indices
  - `Evidence:` Old index exists but is not on the alias
- [ ] Failure path: old alias stays live, SNS alert, failed new index deleted
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
status: pending
priority: p1-high
epic: P1F
persona: [builder]
depends_on: [P0.02]
completed: null
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
depends_on: [P1B.08]
completed: null
```

#### User Story

As a platform operator, ABN usage is metered and billed separately from address so that the invoice shows per-product line items.

#### Problem Statement

The usage batch Lambda (P1B.08) already reports address usage to Stripe. Adding ABN requires a new Stripe meter and updating the batch Lambda to report ABN usage separately. The invoice should show "Address API — X requests" and "ABN Verification — Y requests" as separate line items.

#### Definition of Done

##### Functional

- [ ] ABN usage meter created in Stripe
  - `Verify:` Stripe dashboard Billing → Meters shows ABN meter
  - `Evidence:` Meter ID documented
- [ ] Usage batch Lambda reports ABN usage separately from address
  - `Verify:` Make 10 ABN requests → hourly batch runs → Stripe shows 10 ABN usage records
  - `Evidence:` Stripe usage records for ABN meter
- [ ] Invoice shows ABN line item alongside address line item
  - `Verify:` Generate test invoice → shows both product line items
  - `Evidence:` Invoice PDF with "Address API" and "ABN Verification" lines

#### Scope

**In:** Stripe ABN meter, batch Lambda update, invoice verification

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

Webhook URLs allow developers to receive events (quota warnings, key changes) in their own systems. Notification preferences control email alerts. Account deletion (GDPR Article 17) must cascade: delete Clerk user, cancel Stripe subscription, deactivate Unkey keys, soft-delete DynamoDB records.

#### Definition of Done

##### Functional

- [ ] Webhook URL configuration (receive events for usage alerts, billing changes)
  - `Verify:` Enter webhook URL → save → test webhook fires
  - `Evidence:` Webhook URL stored; test event delivered
- [ ] Notification preferences (email alerts for quota 80%/100% warnings)
  - `Verify:` Toggle quota warning → email sent when 80% reached
  - `Evidence:` Email received with quota details
- [ ] Account deletion flow (GDPR compliance)
  - `Verify:` Click "Delete Account" → confirmation → all data removed
  - `Evidence:` Clerk user deleted, Stripe subscription cancelled, Unkey keys deactivated, DynamoDB records soft-deleted

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
depends_on: [P1B.08]
completed: null
```

#### User Story

As a platform operator, LEI usage is metered and billed so that the invoice shows three product line items.

#### Definition of Done

##### Functional

- [ ] LEI usage meter created in Stripe
  - `Verify:` Stripe dashboard shows LEI meter
  - `Evidence:` Meter ID documented
- [ ] Invoice shows 3 product line items (address, ABN, LEI)
  - `Verify:` Generate test invoice with usage across all 3 products
  - `Evidence:` Invoice PDF shows 3 separate line items with correct quantities

#### Scope

**In:** Stripe LEI meter, batch Lambda update, invoice verification

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
- [ ] Store-scoped API key provisioned automatically on install
  - `Verify:` After install, DynamoDB has a `pq_live_shopify_` key for the store
  - `Evidence:` Key used by extension for API calls

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
  keys: Unkey (store-scoped)
```

#### User Story

As a developer clicking "Install Shopify" on the dashboard, a store-scoped API key is created automatically so that the checkout extension works immediately without manual key configuration.

#### Problem Statement

The Shopify install flow must be frictionless: click install → OAuth consent → key provisioned → extension active. The store-scoped key has a `pq_live_shopify_` prefix, is restricted to address + ABN products, and is tied to the merchant's Prontiq account for billing. Uninstalling deactivates the key.

#### Definition of Done

##### Functional

- [ ] Dashboard integrations page: "Install Shopify" button triggers OAuth flow
  - `Verify:` Click → Shopify OAuth consent screen → redirect back to dashboard
  - `Evidence:` OAuth handshake completes; store token stored
- [ ] Store-scoped Unkey key created with `pq_live_shopify_` prefix
  - `Verify:` After install, Unkey shows key with store metadata
  - `Evidence:` Key scoped to address + ABN products
- [ ] Key synced to DynamoDB with store metadata (shop domain, install date)
  - `Verify:` DynamoDB record includes `shopDomain` field
  - `Evidence:` `aws dynamodb get-item` shows store-scoped key
- [ ] `app.installed` webhook creates key; `app.uninstalled` deactivates it
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

- [ ] Dashboard keys page shows store-scoped keys in a separate section
  - `Verify:` Keys with `pq_live_shopify_` prefix grouped under "Integrations"
  - `Evidence:` Clear visual separation from personal keys
- [ ] Store-scoped keys restricted to address product by default (expandable)
  - `Verify:` Store key only works for `/v1/address/*`; `/v1/abn/*` returns 403
  - `Evidence:` Product scoping enforced in auth middleware
- [ ] Usage tracked and billed per store key (appears on invoice)
  - `Verify:` Store key usage shows separately in usage charts
  - `Evidence:` DynamoDB tracks usage per key (already per-key)

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

With 5 products live, the invoice must show 5 separate usage line items. The batch Lambda already supports multiple products — it just needs the new Stripe meters. This is the completion of the billing system: one subscription, one invoice, per-product line items, the Twilio model.

#### Definition of Done

##### Functional

- [ ] CVE + Patents usage meters created in Stripe
  - `Verify:` Stripe dashboard Billing → Meters shows all 5 product meters
  - `Evidence:` 5 meter IDs documented
- [ ] Invoice shows 5 product line items
  - `Verify:` Generate test invoice with usage across all 5 products
  - `Evidence:` Invoice PDF: "Address API — X", "ABN Verification — Y", "LEI Lookup — Z", "CVE Search — W", "Patent Search — V"
- [ ] Batch Lambda reports all 5 products
  - `Verify:` Usage across all products → hourly batch → Stripe records for each
  - `Evidence:` Stripe usage records for all 5 meters

#### Scope

**In:** Stripe meters for CVE + Patents, batch Lambda update, invoice verification

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
