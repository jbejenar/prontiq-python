import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const packagesWithProjectReferences = [
  "packages/api",
  "packages/control-plane",
  "packages/ingestion",
  "packages/webhooks",
];

test("referenced backend packages use the shared typecheck helper", async () => {
  for (const packageDir of packagesWithProjectReferences) {
    const packageJson = JSON.parse(
      await readFile(new URL(`../${packageDir}/package.json`, import.meta.url), "utf8"),
    );

    assert.equal(
      packageJson.scripts?.typecheck,
      "node ../../scripts/ts-package-build.mjs typecheck",
      `${packageDir} must bootstrap referenced project outputs before local typecheck`,
    );
  }
});
