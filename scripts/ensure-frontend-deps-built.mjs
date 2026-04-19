#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { access, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const scriptDir = dirname(scriptPath);
export const repoRoot = resolve(scriptDir, "..");

export const dependencyMap = {
  landing: [
    {
      packageName: "@prontiq/shared",
      artifacts: ["packages/shared/dist/content.js"],
    },
    {
      packageName: "@prontiq/tokens",
      artifacts: ["packages/tokens/dist/tokens.css"],
    },
  ],
  console: [
    {
      packageName: "@prontiq/sdk",
      artifacts: ["sdks/typescript/esm/index.js"],
    },
    {
      packageName: "@prontiq/tokens",
      artifacts: ["packages/tokens/dist/tokens.css"],
    },
  ],
};

function validateAppName(appName) {
  if (!appName || !(appName in dependencyMap)) {
    throw new Error("Usage: ensure-frontend-deps-built.mjs <landing|console>");
  }
}

async function artifactExists(absolutePath) {
  try {
    await access(absolutePath);
    return true;
  } catch {
    return false;
  }
}

export function lockDirFor(packageName, root = repoRoot) {
  const safeName = packageName.replace(/[^a-z0-9@._-]/gi, "-");
  const repoHash = createHash("sha256").update(resolve(root)).digest("hex").slice(0, 16);
  return join(tmpdir(), "prontiq-frontend-build-locks", repoHash, safeName);
}

async function sleep(ms) {
  await new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

async function acquireLock(packageName, { root = repoRoot, log = process.stderr.write.bind(process.stderr) } = {}) {
  const lockDir = lockDirFor(packageName, root);
  const lockMetaPath = join(lockDir, "owner.json");
  const staleMs = 10 * 60 * 1000;
  await mkdir(dirname(lockDir), { recursive: true });

  while (true) {
    try {
      await mkdir(lockDir, { recursive: false });
      await writeFile(
        lockMetaPath,
        JSON.stringify({ pid: process.pid, repoRoot: resolve(root), acquiredAt: new Date().toISOString() }),
        "utf8",
      );

      return async () => {
        await rm(lockDir, { recursive: true, force: true });
      };
    } catch (error) {
      if (!(error instanceof Error) || !("code" in error) || error.code !== "EEXIST") {
        throw error;
      }

      try {
        const lockStats = await stat(lockDir);
        if ((Date.now() - lockStats.mtimeMs) > staleMs) {
          await rm(lockDir, { recursive: true, force: true });
          continue;
        }

        const owner = await readFile(lockMetaPath, "utf8").catch(() => "");
        if (owner) {
          log(`[ensure-frontend-deps-built] Waiting for ${packageName} lock held by ${owner}\n`);
        }
      } catch {
        // Another process may have released the lock between stat/read attempts.
      }

      await sleep(200);
    }
  }
}

function runPnpmBuild(packageName) {
  return new Promise((resolvePromise, rejectPromise) => {
    const pnpmExecutable = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
    const child = spawn(
      pnpmExecutable,
      ["--filter", packageName, "build"],
      { stdio: "inherit", cwd: repoRoot },
    );

    child.on("error", rejectPromise);
    child.on("exit", (code, signal) => {
      if (signal) {
        rejectPromise(new Error(`pnpm build terminated by signal ${signal}`));
        return;
      }

      if (code !== 0) {
        rejectPromise(new Error(`pnpm build exited with code ${code ?? "unknown"}`));
        return;
      }

      resolvePromise();
    });
  });
}

export function getDependencyArtifacts(appName, root = repoRoot) {
  validateAppName(appName);
  return dependencyMap[appName].map((dependency) => ({
    packageName: dependency.packageName,
    artifacts: dependency.artifacts.map((artifact) => resolve(root, artifact)),
  }));
}

export function getDependencyPackageNames(appName) {
  validateAppName(appName);
  return dependencyMap[appName].map((dependency) => dependency.packageName);
}

export async function ensureFrontendDepsBuilt(
  appName,
  {
    root = repoRoot,
    buildPackage = runPnpmBuild,
    log = process.stderr.write.bind(process.stderr),
  } = {},
) {
  validateAppName(appName);

  for (const dependency of getDependencyArtifacts(appName, root)) {
    const missingArtifact = !(await Promise.all(
      dependency.artifacts.map(artifactExists),
    )).every(Boolean);

    if (!missingArtifact) {
      continue;
    }

    const releaseLock = await acquireLock(dependency.packageName, { root, log });
    try {
      const stillMissingArtifact = !(await Promise.all(
        dependency.artifacts.map(artifactExists),
      )).every(Boolean);

      if (stillMissingArtifact) {
        await buildPackage(dependency.packageName);
      }
    } finally {
      await releaseLock();
    }
  }
}

export async function rebuildFrontendDeps(
  appName,
  {
    root = repoRoot,
    buildPackage = runPnpmBuild,
    log = process.stderr.write.bind(process.stderr),
  } = {},
) {
  validateAppName(appName);

  for (const packageName of getDependencyPackageNames(appName)) {
    const releaseLock = await acquireLock(packageName, { root, log });
    try {
      await buildPackage(packageName);
    } finally {
      await releaseLock();
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  const appName = process.argv[2];
  await ensureFrontendDepsBuilt(appName);
}
