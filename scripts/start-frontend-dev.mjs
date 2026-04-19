#!/usr/bin/env node

import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { rebuildFrontendDeps } from "./ensure-frontend-deps-built.mjs";

const scriptPath = fileURLToPath(import.meta.url);

export function getDevProcessSpecs(appName) {
  if (appName === "landing") {
    return [
      {
        name: "shared",
        command: "pnpm",
        args: [
          "exec",
          "chokidar",
          "../../packages/shared/src/**/*",
          "-c",
          "pnpm --filter @prontiq/shared build",
        ],
      },
      {
        name: "tokens",
        command: "pnpm",
        args: [
          "exec",
          "chokidar",
          "../../packages/tokens/src/**/*",
          "-c",
          "pnpm --filter @prontiq/tokens build",
        ],
      },
      {
        name: "app",
        command: "pnpm",
        args: ["exec", "next", "dev"],
      },
    ];
  }

  if (appName === "console") {
    return [
      {
        name: "sdk",
        command: "pnpm",
        args: [
          "exec",
          "chokidar",
          "../../sdks/typescript/src/**/*",
          "-c",
          "pnpm --filter @prontiq/sdk build",
        ],
      },
      {
        name: "tokens",
        command: "pnpm",
        args: [
          "exec",
          "chokidar",
          "../../packages/tokens/src/**/*",
          "-c",
          "pnpm --filter @prontiq/tokens build",
        ],
      },
      {
        name: "app",
        command: "pnpm",
        args: ["exec", "next", "dev"],
      },
    ];
  }

  throw new Error("Usage: start-frontend-dev.mjs <landing|console>");
}

function spawnProcess({ command, args, name }, cwd) {
  const executable = process.platform === "win32" && command === "pnpm" ? "pnpm.cmd" : command;
  return spawn(executable, args, {
    cwd,
    stdio: "inherit",
    env: process.env,
  });
}

export async function prepareFrontendDev(appName, { buildPackage, log } = {}) {
  await rebuildFrontendDeps(appName, { buildPackage, log });
}

async function main() {
  const appName = process.argv[2];
  const appCwd = process.cwd();
  await prepareFrontendDev(appName);

  const children = getDevProcessSpecs(appName).map((spec) => ({
    ...spec,
    child: spawnProcess(spec, appCwd),
  }));

  let shuttingDown = false;

  const shutdown = (exitCode = 0) => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;

    for (const { child } of children) {
      if (!child.killed) {
        child.kill("SIGTERM");
      }
    }

    process.exitCode = exitCode;
  };

  process.on("SIGINT", () => shutdown(130));
  process.on("SIGTERM", () => shutdown(143));

  for (const { child, name } of children) {
    child.on("error", (error) => {
      process.stderr.write(`[start-frontend-dev] ${name} failed to start: ${error.message}\n`);
      shutdown(1);
    });

    child.on("exit", (code, signal) => {
      if (shuttingDown) {
        return;
      }

      if (signal) {
        process.stderr.write(`[start-frontend-dev] ${name} exited via signal ${signal}\n`);
        shutdown(1);
        return;
      }

      shutdown(code ?? 0);
    });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  await main();
}
