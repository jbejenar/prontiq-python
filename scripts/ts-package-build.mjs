#!/usr/bin/env node

/**
 * Per-package TypeScript build helper.
 *
 * Modes:
 *   build → remove this package's own dist/ + tsbuildinfo, then
 *           run `tsc --build` for this package.
 *   clean → remove this package's own dist/ + tsbuildinfo and exit.
 *
 * Two intentional design choices, both load-bearing:
 *
 * 1. **Only the current package's outputs are deleted.** Earlier
 *    iterations of this script walked tsconfig `references`
 *    recursively and deleted every upstream project's dist/ and
 *    tsbuildinfo too. That created a race: when Turbo schedules
 *    `<downstream>:build` and `<sibling-of-downstream>:typecheck` in
 *    parallel after a shared upstream's build completes (both depend
 *    on `^build`), the build's pre-cleanup wipes the upstream dist
 *    that the sibling's typecheck is currently reading. Result:
 *    intermittent TS2307 "Cannot find module '@prontiq/shared'" in
 *    CI on packages whose source is correct.
 *
 *    Each Turbo task owns only its own outputs. Workspace-wide cleanup
 *    is `turbo clean` (which runs each package's clean serially per
 *    the task graph), not a recursive nuke from any single package.
 *
 * 2. **`tsc --build` is invoked WITHOUT `--force`.** With composite
 *    project references, `--force` rebuilds every referenced project
 *    too — meaning `control-plane:build --force` would re-emit
 *    `shared/dist/`, racing concurrent reads from `ingestion:typecheck`
 *    even after fix #1. Turbo's `dependsOn: ["^build"]` already
 *    guarantees upstream dist is fresh by the time a downstream task
 *    runs, so plain `tsc --build` is correct: it incrementally
 *    rebuilds this package and trusts the upstream `tsbuildinfo`.
 *
 * If you ever genuinely need a workspace-wide rebuild, run
 * `turbo clean && turbo build` — that orchestrates clean+build with
 * proper task-level serialization, instead of having every per-package
 * build try to police its dependencies' lifecycle.
 */

import { rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { resolve } from "node:path";

const mode = process.argv[2] ?? "build";
const packageDir = process.cwd();
const targets = ["dist", "tsconfig.tsbuildinfo"];

async function removeOwnTargets() {
  await Promise.all(
    targets.map((target) =>
      rm(resolve(packageDir, target), {
        force: true,
        recursive: true,
      }),
    ),
  );
}

function runTsc(args) {
  return new Promise((resolvePromise, rejectPromise) => {
    const pnpmExecutable = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
    const child = spawn(pnpmExecutable, ["exec", "tsc", ...args], {
      cwd: packageDir,
      stdio: "inherit",
    });

    child.on("error", rejectPromise);
    child.on("exit", (code, signal) => {
      if (signal) {
        rejectPromise(new Error(`tsc terminated by signal ${signal}`));
        return;
      }

      if (code !== 0) {
        rejectPromise(new Error(`tsc exited with code ${code ?? "unknown"}`));
        return;
      }

      resolvePromise();
    });
  });
}

await removeOwnTargets();

if (mode === "clean") {
  process.exit(0);
}

if (mode !== "build") {
  throw new Error(`Unsupported mode: ${mode}`);
}

await runTsc(["--build"]);
