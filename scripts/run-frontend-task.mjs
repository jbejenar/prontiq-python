#!/usr/bin/env node

import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { rebuildFrontendDeps } from "./ensure-frontend-deps-built.mjs";

const scriptPath = fileURLToPath(import.meta.url);

function validateAppName(appName) {
  if (appName !== "landing" && appName !== "console") {
    throw new Error("Usage: run-frontend-task.mjs <landing|console> <build|typecheck|test>");
  }
}

function validateTask(taskName) {
  if (taskName !== "build" && taskName !== "typecheck" && taskName !== "test") {
    throw new Error("Usage: run-frontend-task.mjs <landing|console> <build|typecheck|test>");
  }
}

export function getFrontendTaskSpec(appName, taskName) {
  validateAppName(appName);
  validateTask(taskName);

  if (taskName === "build") {
    return {
      name: `${appName}-build`,
      command: "pnpm",
      args: ["exec", "next", "build"],
      cleanNext: true,
    };
  }

  if (taskName === "test") {
    return {
      name: `${appName}-test`,
      command: "pnpm",
      args: ["exec", "vitest", "run"],
      cleanNext: false,
    };
  }

  return {
    name: `${appName}-typecheck`,
    command: "pnpm",
    args: ["exec", "next", "typegen"],
    followUpArgs: ["exec", "tsc", "-p", "tsconfig.typecheck.json", "--noEmit"],
    cleanNext: false,
  };
}

export function getFrontendTaskEnv(appName) {
  validateAppName(appName);

  if (appName === "console" || appName === "landing") {
    return {
      ...process.env,
      PRONTIQ_ALLOW_KEYLESS_CLERK: "1",
    };
  }
}

function spawnTask(spec, cwd) {
  const executable = process.platform === "win32" && spec.command === "pnpm" ? "pnpm.cmd" : spec.command;

  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(executable, spec.args, {
      cwd,
      stdio: "inherit",
      env: spec.env ?? process.env,
    });

    child.on("error", rejectPromise);
    child.on("exit", (code, signal) => {
      if (signal) {
        rejectPromise(new Error(`${spec.name} terminated by signal ${signal}`));
        return;
      }

      if (code !== 0) {
        rejectPromise(new Error(`${spec.name} exited with code ${code ?? "unknown"}`));
        return;
      }

      resolvePromise();
    });
  });
}

export async function runFrontendTask(
  appName,
  taskName,
  {
    buildPackage,
    executeTask = spawnTask,
  } = {},
) {
  validateAppName(appName);
  validateTask(taskName);

  if (process.env.PRONTIQ_TURBO_MANAGED !== "1") {
    await rebuildFrontendDeps(appName, { buildPackage });
  }

  const spec = getFrontendTaskSpec(appName, taskName);
  const taskEnv = getFrontendTaskEnv(appName);
  if (spec.cleanNext) {
    await rm(".next", { recursive: true, force: true });
  }

  await executeTask({ ...spec, env: taskEnv }, process.cwd());
  if (spec.followUpArgs) {
    await executeTask(
      {
        name: `${spec.name}-follow-up`,
        command: spec.command,
        args: spec.followUpArgs,
        cleanNext: false,
        env: taskEnv,
      },
      process.cwd(),
    );
  }
}

if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  const appName = process.argv[2];
  const taskName = process.argv[3];
  await runFrontendTask(appName, taskName);
}
