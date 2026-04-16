#!/usr/bin/env node

import { readFile, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { dirname, extname, resolve } from "node:path";

const mode = process.argv[2] ?? "build";
const packageDir = process.cwd();
const targets = ["dist", "tsconfig.tsbuildinfo"];

function getTsconfigPath(projectDir) {
  return resolve(projectDir, "tsconfig.json");
}

async function readReferences(projectDir) {
  const tsconfigPath = getTsconfigPath(projectDir);
  const raw = await readFile(tsconfigPath, "utf8");
  const config = JSON.parse(raw);
  const references = Array.isArray(config.references) ? config.references : [];

  return references
    .map((reference) => {
      if (!reference || typeof reference !== "object" || typeof reference.path !== "string") {
        return null;
      }

      const referencePath = resolve(projectDir, reference.path);
      return extname(referencePath) === ".json" ? dirname(referencePath) : referencePath;
    })
    .filter((value) => value !== null);
}

async function collectProjectDirs(projectDir, seen = new Set()) {
  const normalizedDir = resolve(projectDir);
  if (seen.has(normalizedDir)) {
    return [];
  }

  seen.add(normalizedDir);

  const referencedDirs = await readReferences(normalizedDir);
  const nestedDirs = await Promise.all(
    referencedDirs.map((referencedDir) => collectProjectDirs(referencedDir, seen)),
  );

  return [normalizedDir, ...nestedDirs.flat()];
}

async function removeTargets(projectDirs) {
  await Promise.all(
    projectDirs.flatMap((projectDir) =>
      targets.map((target) =>
        rm(resolve(projectDir, target), {
          force: true,
          recursive: true,
        }),
      ),
    ),
  );
}

function runTsc(args) {
  return new Promise((resolve, reject) => {
    const pnpmExecutable = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
    const child = spawn(pnpmExecutable, ["exec", "tsc", ...args], {
      cwd: packageDir,
      stdio: "inherit",
    });

    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (signal) {
        reject(new Error(`tsc terminated by signal ${signal}`));
        return;
      }

      if (code !== 0) {
        reject(new Error(`tsc exited with code ${code ?? "unknown"}`));
        return;
      }

      resolve();
    });
  });
}

const projectDirs = await collectProjectDirs(packageDir);

await removeTargets(projectDirs);

if (mode === "clean") {
  process.exit(0);
}

if (mode !== "build") {
  throw new Error(`Unsupported mode: ${mode}`);
}

await runTsc(["--build", "--force"]);
