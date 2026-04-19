#!/usr/bin/env node

import { spawn } from "node:child_process";

const task = process.argv[2];

if (!task) {
  throw new Error("Usage: run-turbo.mjs <task> [...args]");
}

const pnpmExecutable = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const child = spawn(pnpmExecutable, ["exec", "turbo", task, ...process.argv.slice(3)], {
  stdio: "inherit",
  env: {
    ...process.env,
    PRONTIQ_TURBO_MANAGED: "1",
  },
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 1);
});

