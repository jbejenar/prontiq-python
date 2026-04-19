import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { access, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { renderArtifacts } from "./build.js";

test("renderArtifacts emits the expected token artifacts", () => {
  const artifacts = renderArtifacts();

  assert.match(artifacts.tokensCss, /--color-accent:/);
  assert.match(artifacts.tailwindPresetJs, /var\(--color-accent\)/);
  assert.match(artifacts.mintThemeJson, /"primary"/);
  assert.match(artifacts.sesVarsJson, /"accentColor"/);
});

async function assertCompiledBuildEntrypointEmitsArtifacts(
  packageRoot: string,
  entrypoint: string,
): Promise<void> {
  const expectedArtifacts = [
    "mint-theme.json",
    "ses-vars.json",
    "tailwind-preset.js",
    "tokens.css",
  ];

  await Promise.all(
    expectedArtifacts.map((artifact) => rm(join(packageRoot, "dist", artifact), { force: true })),
  );

  const result = spawnSync(process.execPath, [entrypoint], {
    cwd: packageRoot,
    encoding: "utf8",
  });

  assert.equal(result.status, 0, result.stderr);
  await Promise.all(expectedArtifacts.map((artifact) => access(join(packageRoot, "dist", artifact))));
}

test("compiled build entrypoint emits exported artifacts when invoked via package command shape", async () => {
  const repoRoot = join(import.meta.dirname, "..", "..", "..");
  const packageRoot = join(repoRoot, "packages", "tokens");

  await assertCompiledBuildEntrypointEmitsArtifacts(packageRoot, "dist/build-cli.js");
});

test("compiled build entrypoint emits exported artifacts when invoked through a symlinked path", async () => {
  const repoRoot = join(import.meta.dirname, "..", "..", "..");
  const packageRoot = join(repoRoot, "packages", "tokens");
  const tempDir = await mkdtemp(join(tmpdir(), "prontiq-tokens-build-"));
  const symlinkPath = join(tempDir, "build-cli-link.js");

  try {
    await symlink(join(packageRoot, "dist", "build-cli.js"), symlinkPath);
    await assertCompiledBuildEntrypointEmitsArtifacts(packageRoot, symlinkPath);
  } finally {
    await rm(tempDir, { force: true, recursive: true });
  }
});
