import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { access, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { renderArtifacts } from "./build.js";
import { tokens } from "./tokens.js";

test("renderArtifacts emits the expected token artifacts", () => {
  const artifacts = renderArtifacts();

  assert.match(artifacts.tokensCss, /--color-accent:/);
  assert.match(artifacts.tokensCss, /--background:/);
  assert.match(artifacts.tokensCss, /--shadow-lift:/);
  assert.match(artifacts.tokensCss, new RegExp(`:root \\{[\\s\\S]*--background: ${tokens.color.light.background.hsl};`));
  assert.match(artifacts.tokensCss, new RegExp(`\\.dark,[\\s\\S]*--background: ${tokens.color.dark.background.hsl};`));
  assert.match(artifacts.tailwindPresetJs, /hsl\(var\(--accent\) \/ <alpha-value>\)/);
  assert.match(artifacts.tailwindPresetJs, /borderRadius/);
  assert.match(artifacts.mintThemeJson, /"primary"/);
  assert.match(artifacts.sesVarsJson, /"accentColor"/);
});

test("renderArtifacts emits new HSL-channel semantic colors in both modes", () => {
  const artifacts = renderArtifacts();

  for (const cssVar of ["--info", "--warn", "--muted-2", "--border-strong", "--surface-hover"]) {
    assert.match(
      artifacts.tokensCss,
      new RegExp(`:root \\{[\\s\\S]*${cssVar}:`),
      `expected ${cssVar} in :root block`,
    );
    assert.match(
      artifacts.tokensCss,
      new RegExp(`\\.dark,[\\s\\S]*${cssVar}:`),
      `expected ${cssVar} in .dark block`,
    );
  }

  assert.match(
    artifacts.tokensCss,
    new RegExp(`:root \\{[\\s\\S]*--info: ${tokens.color.light.info.hsl};`),
  );
  assert.match(
    artifacts.tokensCss,
    new RegExp(`\\.dark,[\\s\\S]*--info: ${tokens.color.dark.info.hsl};`),
  );
});

test("renderArtifacts emits atmospheric tokens in both modes", () => {
  const artifacts = renderArtifacts();

  for (const cssVar of ["--accent-glow", "--scanline"]) {
    assert.match(
      artifacts.tokensCss,
      new RegExp(`:root \\{[\\s\\S]*${cssVar}:`),
      `expected ${cssVar} in :root block`,
    );
    assert.match(
      artifacts.tokensCss,
      new RegExp(`\\.dark,[\\s\\S]*${cssVar}:`),
      `expected ${cssVar} in .dark block`,
    );
  }

  assert.match(artifacts.tokensCss, /--accent-glow: rgba\(0, 229, 160, 0\.18\);/);
  assert.match(artifacts.tokensCss, /--scanline: transparent;/);
});

test("renderArtifacts emits widget alias vars on :root only", () => {
  const artifacts = renderArtifacts();

  assert.match(
    artifacts.tokensCss,
    /:root \{[\s\S]*--prontiq-widget-accent: hsl\(var\(--accent\)\);/,
  );
  assert.match(
    artifacts.tokensCss,
    /:root \{[\s\S]*--prontiq-widget-accent-soft: hsl\(var\(--accent\) \/ 0\.08\);/,
  );

  // The widget aliases should not be duplicated under .dark — they pick up the active mode dynamically.
  const darkBlockMatch = artifacts.tokensCss.match(/\.dark,[\s\S]*?\}/);
  assert.ok(darkBlockMatch, "expected a .dark block in the emitted CSS");
  assert.doesNotMatch(darkBlockMatch[0], /--prontiq-widget-accent:/);
});

test("renderArtifacts exposes new semantic colors in the Tailwind preset", () => {
  const artifacts = renderArtifacts();

  assert.match(artifacts.tailwindPresetJs, /info: "hsl\(var\(--info\) \/ <alpha-value>\)"/);
  assert.match(artifacts.tailwindPresetJs, /warn: "hsl\(var\(--warn\) \/ <alpha-value>\)"/);
  assert.match(artifacts.tailwindPresetJs, /"muted-2": "hsl\(var\(--muted-2\) \/ <alpha-value>\)"/);
  assert.match(artifacts.tailwindPresetJs, /"border-strong": "hsl\(var\(--border-strong\) \/ <alpha-value>\)"/);
  assert.match(artifacts.tailwindPresetJs, /"surface-hover": "hsl\(var\(--surface-hover\) \/ <alpha-value>\)"/);
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
