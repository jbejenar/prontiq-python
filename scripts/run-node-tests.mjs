#!/usr/bin/env node

import { glob } from "node:fs/promises";
import { spawn } from "node:child_process";

function unique(values) {
  return [...new Set(values)];
}

async function expandPatterns(patterns) {
  const matches = await Promise.all(
    patterns.map(async (pattern) => {
      const entries = [];
      for await (const match of glob(pattern)) {
        entries.push(match);
      }
      return entries;
    }),
  );

  return unique(matches.flat()).sort((left, right) => left.localeCompare(right));
}

function spawnNodeTests(files) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, ["--test", ...files], {
      env: process.env,
      stdio: "inherit",
    });

    child.on("error", rejectPromise);
    child.on("exit", (code, signal) => {
      if (signal) {
        rejectPromise(new Error(`node --test terminated by signal ${signal}`));
        return;
      }

      resolvePromise(code ?? 1);
    });
  });
}

const patterns = process.argv.slice(2);

if (patterns.length === 0) {
  throw new Error("Usage: run-node-tests.mjs <glob> [<glob>...]");
}

const files = await expandPatterns(patterns);
if (files.length === 0) {
  throw new Error(`No test files matched: ${patterns.join(", ")}`);
}

const exitCode = await spawnNodeTests(files);
process.exit(exitCode);
