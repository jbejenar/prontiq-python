import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const ciWorkflow = fs.readFileSync(".github/workflows/ci.yml", "utf8");
const prodWorkflow = fs.readFileSync(".github/workflows/deploy-prod.yml", "utf8");

function extractJob(workflow, jobName) {
  const start = workflow.indexOf(`  ${jobName}:`);
  assert.notEqual(start, -1, `${jobName} job must exist`);
  const nextJob = workflow.slice(start + 1).match(/\n  [a-zA-Z0-9_-]+:\n/);
  if (!nextJob?.index) return workflow.slice(start);
  return workflow.slice(start, start + 1 + nextJob.index);
}

test("dev deploy smoke runs the public Address API smoke with a stage-owned API key", () => {
  const smokeDev = extractJob(ciWorkflow, "smoke-dev");

  assert.match(smokeDev, /needs:\s*deploy-dev/, "smoke-dev must run after deploy-dev");
  assert.match(smokeDev, /PRONTIQ_API:\s*\$\{\{\s*needs\.deploy-dev\.outputs\.api_url\s*\}\}/);
  assert.match(smokeDev, /PRONTIQ_KEY:\s*\$\{\{\s*secrets\.PRONTIQ_KEY\s*\}\}/);
  assert.match(smokeDev, /pnpm --filter @prontiq\/api smoke\b/, "smoke-dev must run address smoke");
  assert.match(smokeDev, /pnpm --filter @prontiq\/api smoke:account-setup\b/);
  assert.ok(
    smokeDev.indexOf("pnpm --filter @prontiq/api smoke\n") <
      smokeDev.indexOf("pnpm --filter @prontiq/api smoke:account-setup"),
    "smoke-dev must run address smoke before Clerk-authenticated account smokes",
  );
});

test("prod deploy exposes the deployed API URL and runs a prod Address API smoke", () => {
  const deploy = extractJob(prodWorkflow, "deploy");
  const smokeProd = extractJob(prodWorkflow, "smoke-prod");

  assert.match(
    prodWorkflow,
    /force_smoke_failure:/,
    "prod workflow must expose forced smoke-failure validation input",
  );
  assert.match(
    deploy,
    /outputs:\s*\n\s*api_url:\s*\$\{\{\s*steps\.api-url\.outputs\.api_url\s*\}\}/,
  );
  assert.match(deploy, /id:\s*api-url/);
  assert.match(smokeProd, /needs:\s*deploy/, "smoke-prod must run after prod deploy");
  assert.match(smokeProd, /environment:\s*prod/);
  assert.match(smokeProd, /PRONTIQ_API:\s*\$\{\{\s*needs\.deploy\.outputs\.api_url\s*\}\}/);
  assert.match(smokeProd, /PRONTIQ_KEY:\s*\$\{\{\s*inputs\.force_smoke_failure/);
  assert.match(
    smokeProd,
    /pnpm --filter @prontiq\/api smoke\b/,
    "smoke-prod must run address smoke",
  );
  assert.doesNotMatch(smokeProd, /smoke:account-setup|smoke:keys|smoke:keys-stepup/);
});
