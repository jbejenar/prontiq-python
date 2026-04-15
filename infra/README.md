# infra/

Bootstrap infrastructure that cannot live inside `sst.config.ts` because SST itself depends on it. Everything here is **manually applied** — there's no automated drift-correction. These files are the **source of truth**; AWS state should mirror them exactly.

## Files

| File | What it is | Applied via |
|---|---|---|
| `deploy-role-trust-policy.json` | Assume-role policy on IAM role `prontiq-platform-deploy-role`. Grants GitHub Actions (OIDC) the right to assume the role, scoped to pushes/dispatches from `main` by this repo's own workflow files. | `aws iam update-assume-role-policy` |
| `deploy-role-policy.json` | Inline permissions policy on the same role — what the role is allowed to do once assumed. | `aws iam put-role-policy` |

Together these two files fully define the role. If AWS state is lost or the role is deleted, it can be recreated deterministically from this directory plus the `aws iam create-role` command documented below.

## Why these aren't in `sst.config.ts`

`prontiq-platform-deploy-role` is the role SST uses to authenticate and deploy every other resource. If SST managed its own deploy role, a broken policy change would lock us out of deploying the fix for itself — classic chicken-and-egg. Keeping both the trust policy and the permissions policy as versioned JSON gives us:

- **Provenance** — `git blame` shows who changed which permission (and trust condition) and why.
- **Review** — IAM and OIDC changes go through a normal PR, not an out-of-band console edit.
- **Recoverability** — if AWS state drifts or is lost, these two files plus the create-role command fully reconstruct the role.

## Trust boundary

The trust policy enforces three independent conditions (all must match for the role to be assumable):

1. **Audience** — `aud = sts.amazonaws.com`. Prevents token confusion attacks.
2. **Subject** — `sub = repo:jbejenar/prontiq-platform:ref:refs/heads/main`. Only pushes to `main` and `workflow_dispatch` from `main` can mint credentials. PR events, tag events, and pushes to non-main branches are rejected at the OIDC layer.
3. **Approved workflow allowlist** — `job_workflow_ref` must match one of the explicit entries below. Adding a new workflow file to `.github/workflows/` does **NOT** automatically grant deploy access; the trust policy must be updated in a separate PR with intentional review.

### Currently approved workflows

| Workflow file | Trigger | Purpose |
|---|---|---|
| `jbejenar/prontiq-platform/.github/workflows/ci.yml@refs/heads/main` | push to main | `deploy-dev` job |
| `jbejenar/prontiq-platform/.github/workflows/deploy-prod.yml@refs/heads/main` | `workflow_dispatch` | manual prod deploy |

If either of those file paths changes (rename, move, workflow removal), the trust policy must be updated to match. The `job_workflow_ref` values are pinned to the full file path plus `@refs/heads/main` — they're not globs.

### Adding a new workflow that needs deploy credentials

1. Open a PR that adds the new workflow file under `.github/workflows/`.
2. In the **same PR**, extend the `job_workflow_ref` array in `deploy-role-trust-policy.json` with the new file's full ref.
3. Update the "Currently approved workflows" table above.
4. After merge, follow the standard apply sequence below (permissions first if the PR touches them; then trust policy).

**Why explicit allowlist rather than a glob:** `main` is not branch-protected yet (per CLAUDE.md follow-up). Any pusher with write access could add an unreviewed workflow on `main`; a glob would give that workflow deploy credentials immediately. The allowlist forces a second, deliberate review step — authorship of a workflow is separated from authorization to deploy.

**Separate roles per deploy context (future improvement):** `deploy-dev` and `deploy-prod` currently share a role despite having different blast radii. Splitting into distinct roles (e.g., `prontiq-platform-deploy-dev-role` and `-prod-role`) with least-privilege scoping is a worthwhile future enhancement; out of scope for this iteration.

## Applying changes (normal flow)

After merging a PR that touches either file, apply the changes **in this order**. Permissions updates are low-risk (additive). Trust updates are higher-risk (can lock us out of deploying), so apply them **after** verifying permissions changes landed successfully.

### 1. Permissions policy update (low risk — apply first)

```bash
aws iam put-role-policy \
  --role-name prontiq-platform-deploy-role \
  --policy-name prontiq-platform-deploy-policy \
  --region ap-southeast-2 \
  --policy-document file://infra/deploy-role-policy.json
```

Then trigger a deploy (rerun CI on `main`) to verify the new permissions work.

### 2. Trust policy update (higher risk — apply only after step 1 verified)

```bash
aws iam update-assume-role-policy \
  --role-name prontiq-platform-deploy-role \
  --region ap-southeast-2 \
  --policy-document file://infra/deploy-role-trust-policy.json
```

Then push an empty commit to `main` (or rerun CI) to verify the deploy-dev job can still assume the role. If the workflow fails at `configure-aws-credentials` step, see the rollback below.

### Rollback for the trust policy

If a trust policy update locks CI out, restore the previous version **from a local AWS admin** (not from CI, which can no longer assume the role):

```bash
# Fetch the previous file contents from git (assuming the breaking change is
# in the HEAD commit of main):
git show HEAD~1:infra/deploy-role-trust-policy.json > /tmp/previous-trust.json

# Re-apply:
aws iam update-assume-role-policy \
  --role-name prontiq-platform-deploy-role \
  --region ap-southeast-2 \
  --policy-document file:///tmp/previous-trust.json
```

Confirm CI can assume the role again before making further changes.

## Verifying live state matches repo

Two stability concerns to handle:

1. **Encoding** — IAM's API surface returns policy documents either as parsed JSON objects (AWS CLI v2 with `--output json`, the current normal case) or as URL-encoded strings (older CLI versions, raw SDK calls). The normalizer handles both shapes.
2. **Key ordering** — AWS IAM returns object keys in **non-deterministic order** across calls (empirically, the same `get-role` call can return `aud`/`sub`/`job_workflow_ref` in different orders on back-to-back invocations). Comparing raw JSON would produce false-positive drift. The normalizer uses `sort_keys=True` on both sides to force canonical alphabetical key ordering. The repo files are also written in this canonical order so the diff always resolves cleanly.

```bash
# Trust policy
aws iam get-role \
  --role-name prontiq-platform-deploy-role \
  --region ap-southeast-2 \
  --output json \
  | python3 -c "
import json, sys, urllib.parse
doc = json.load(sys.stdin)['Role']['AssumeRolePolicyDocument']
if isinstance(doc, str):
    doc = json.loads(urllib.parse.unquote(doc))
print(json.dumps(doc, indent=2, sort_keys=True))
" \
  | diff - infra/deploy-role-trust-policy.json

# Permissions policy
aws iam get-role-policy \
  --role-name prontiq-platform-deploy-role \
  --policy-name prontiq-platform-deploy-policy \
  --region ap-southeast-2 \
  --output json \
  | python3 -c "
import json, sys, urllib.parse
doc = json.load(sys.stdin)['PolicyDocument']
if isinstance(doc, str):
    doc = json.loads(urllib.parse.unquote(doc))
print(json.dumps(doc, indent=2, sort_keys=True))
" \
  | diff - infra/deploy-role-policy.json
```

### Regenerating the repo files from live state

If you ever need to re-sync the repo files to match live AWS state (e.g., after an intentional console edit that needs to be captured back), replace the `| diff - …` tail with `> infra/deploy-role-trust-policy.json` (or `-policy.json`) in the commands above. The `sort_keys=True` + `indent=2` combination is the canonical form — any future diff will then be clean.

No output from either command = match. Any diff = drift; investigate before making further changes.

### Spot-check: are any unapproved workflows currently authorized?

The normalized-diff above is the authoritative check (catches any drift, including new allowlist entries). This extra assertion extracts the live `job_workflow_ref` list and prints any entry that isn't in the README's approved set — useful as a quick sanity check after rotating workflows:

```bash
aws iam get-role \
  --role-name prontiq-platform-deploy-role \
  --region ap-southeast-2 \
  --output json \
  | python3 -c "
import json, sys, urllib.parse
doc = json.load(sys.stdin)['Role']['AssumeRolePolicyDocument']
if isinstance(doc, str):
    doc = json.loads(urllib.parse.unquote(doc))
approved = {
    'jbejenar/prontiq-platform/.github/workflows/ci.yml@refs/heads/main',
    'jbejenar/prontiq-platform/.github/workflows/deploy-prod.yml@refs/heads/main',
}
raw = doc['Statement'][0]['Condition']['StringEquals'].get('token.actions.githubusercontent.com:job_workflow_ref', [])
live = {raw} if isinstance(raw, str) else set(raw)
unapproved = live - approved
missing = approved - live
if unapproved: print('UNAPPROVED (live but not in allowlist):', unapproved)
if missing: print('MISSING (in allowlist but not live):', missing)
if not (unapproved or missing): print('OK — live matches approved allowlist')
"
```

## Recreating the role from scratch (disaster recovery)

If the role is deleted entirely, these commands reconstruct it deterministically from this repo:

```bash
# 1. Create the role with the trust policy.
aws iam create-role \
  --role-name prontiq-platform-deploy-role \
  --region ap-southeast-2 \
  --assume-role-policy-document file://infra/deploy-role-trust-policy.json

# 2. Attach the inline permissions policy.
aws iam put-role-policy \
  --role-name prontiq-platform-deploy-role \
  --policy-name prontiq-platform-deploy-policy \
  --region ap-southeast-2 \
  --policy-document file://infra/deploy-role-policy.json

# 3. Verify (see "Verifying live state matches repo" above).
aws iam get-role --role-name prontiq-platform-deploy-role --region ap-southeast-2
```

Role ARN (stable): `arn:aws:iam::493712557159:role/prontiq-platform-deploy-role`.

### Prerequisite: OIDC provider

The trust policy references `arn:aws:iam::493712557159:oidc-provider/token.actions.githubusercontent.com`. If that provider is also missing (unlikely — it's account-scoped, not role-scoped), recreate it first:

```bash
aws iam create-open-id-connect-provider \
  --url https://token.actions.githubusercontent.com \
  --client-id-list sts.amazonaws.com \
  --thumbprint-list 6938fd4d98bab03faadb97b34396831e3780aea1
```

The thumbprint above is GitHub's published OIDC signing certificate thumbprint; verify against <https://docs.github.com/en/actions/deployment/security-hardening-your-deployments/about-security-hardening-with-openid-connect> before running.

## History

- 2026-04-09 (P0.01) — role created manually with OIDC trust scoped to `repo:jbejenar/prontiq-platform:*`.
- 2026-04-15 (PR #50) — role definition captured in this directory; `ec2:DescribeVpcAttribute` added to unblock Fargate bulk-ingest deploys; trust policy narrowed from `repo:*` wildcard to (a) `sub = ref:refs/heads/main` + (b) an explicit `job_workflow_ref` allowlist of the two approved deployment workflows. Intentional review now required before any new workflow can mint deploy credentials.
