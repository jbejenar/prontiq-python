import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ensureFrontendDepsBuilt, lockDirFor } from "./ensure-frontend-deps-built.mjs";
import { getFrontendTaskEnv, getFrontendTaskSpec, runFrontendTask } from "./run-frontend-task.mjs";
import { getDevProcessSpecs, prepareFrontendDev } from "./start-frontend-dev.mjs";

async function makeRepoFixture() {
  const repoDir = await mkdtemp(join(tmpdir(), "prontiq-frontend-dev-"));
  await mkdir(join(repoDir, "apps", "landing"), { recursive: true });
  await mkdir(join(repoDir, "apps", "console"), { recursive: true });
  await mkdir(join(repoDir, "packages", "shared", "dist"), { recursive: true });
  await mkdir(join(repoDir, "packages", "tokens", "dist"), { recursive: true });
  await mkdir(join(repoDir, "sdks", "typescript", "esm"), { recursive: true });

  await writeFile(join(repoDir, "packages", "shared", "dist", "content.js"), "export {};\n", "utf8");
  await writeFile(join(repoDir, "packages", "tokens", "dist", "tokens.css"), ":root {}\n", "utf8");
  await writeFile(join(repoDir, "sdks", "typescript", "esm", "index.js"), "export {};\n", "utf8");

  return repoDir;
}

test("landing helper skips rebuilds when artifacts already exist from the app cwd", async () => {
  const repoDir = await makeRepoFixture();
  const builds = [];
  const previousCwd = process.cwd();
  process.chdir(join(repoDir, "apps", "landing"));

  try {
    await ensureFrontendDepsBuilt("landing", {
      root: repoDir,
      buildPackage: async (packageName) => {
        builds.push(packageName);
      },
      log: () => {},
    });
  } finally {
    process.chdir(previousCwd);
  }

  assert.deepEqual(builds, []);
});

test("frontend dependency locks are scoped per repo root as well as package name", async () => {
  const repoDirA = await makeRepoFixture();
  const repoDirB = await makeRepoFixture();

  const sharedLockA = lockDirFor("@prontiq/shared", repoDirA);
  const sharedLockB = lockDirFor("@prontiq/shared", repoDirB);
  const tokensLockA = lockDirFor("@prontiq/tokens", repoDirA);

  assert.notEqual(sharedLockA, sharedLockB);
  assert.notEqual(sharedLockA, tokensLockA);
});

test("console helper only rebuilds the missing dependency from the app cwd", async () => {
  const repoDir = await makeRepoFixture();
  const builds = [];
  const previousCwd = process.cwd();
  process.chdir(join(repoDir, "apps", "console"));

  await rm(join(repoDir, "packages", "tokens", "dist", "tokens.css"));

  try {
    await ensureFrontendDepsBuilt("console", {
      root: repoDir,
      buildPackage: async (packageName) => {
        builds.push(packageName);
      },
      log: () => {},
    });
  } finally {
    process.chdir(previousCwd);
  }

  assert.deepEqual(builds, ["@prontiq/tokens"]);
});

test("landing dev process spec uses argv arrays without POSIX-only quoting", () => {
  const specs = getDevProcessSpecs("landing");

  assert.equal(specs.length, 3);
  for (const spec of specs) {
    assert.ok(spec.args.every((arg) => !arg.includes("'")));
  }
});

test("console dev process spec uses argv arrays without POSIX-only quoting", () => {
  const specs = getDevProcessSpecs("console");

  assert.equal(specs.length, 3);
  for (const spec of specs) {
    assert.ok(spec.args.every((arg) => !arg.includes("'")));
  }
});

test("landing dev bootstrap rebuilds declared workspace deps even when artifacts already exist", async () => {
  const builds = [];

  await prepareFrontendDev("landing", {
    buildPackage: async (packageName) => {
      builds.push(packageName);
    },
    log: () => {},
  });

  assert.deepEqual(builds, ["@prontiq/shared", "@prontiq/tokens"]);
});

test("landing build task builds missing workspace deps before running the app-local command", async () => {
  const repoDir = await makeRepoFixture();
  const builds = [];
  const tasks = [];
  const previousCwd = process.cwd();
  const previousFlag = process.env.PRONTIQ_TURBO_MANAGED;
  process.chdir(join(repoDir, "apps", "landing"));

  await rm(join(repoDir, "packages", "shared", "dist", "content.js"));
  delete process.env.PRONTIQ_TURBO_MANAGED;

  try {
    await runFrontendTask("landing", "build", {
      root: repoDir,
      buildPackage: async (packageName) => {
        builds.push(packageName);
      },
      executeTask: async (spec) => {
        tasks.push(spec);
      },
    });
  } finally {
    process.chdir(previousCwd);
    if (previousFlag === undefined) {
      delete process.env.PRONTIQ_TURBO_MANAGED;
    } else {
      process.env.PRONTIQ_TURBO_MANAGED = previousFlag;
    }
  }

  assert.deepEqual(builds, ["@prontiq/shared", "@prontiq/tokens"]);
  assert.equal(tasks.length, 1);
  assert.deepEqual(tasks[0].args, ["exec", "next", "build"]);
  assert.equal(tasks[0].env.PRONTIQ_ALLOW_KEYLESS_CLERK, undefined);
});

test("console typecheck task rebuilds declared workspace deps and generates Next types before tsc", async () => {
  const repoDir = await makeRepoFixture();
  const builds = [];
  const tasks = [];
  const previousCwd = process.cwd();
  const previousFlag = process.env.PRONTIQ_TURBO_MANAGED;
  process.chdir(join(repoDir, "apps", "console"));
  delete process.env.PRONTIQ_TURBO_MANAGED;

  try {
    await runFrontendTask("console", "typecheck", {
      buildPackage: async (packageName) => {
        builds.push(packageName);
      },
      executeTask: async (spec) => {
        tasks.push(spec);
      },
    });
  } finally {
    process.chdir(previousCwd);
    if (previousFlag === undefined) {
      delete process.env.PRONTIQ_TURBO_MANAGED;
    } else {
      process.env.PRONTIQ_TURBO_MANAGED = previousFlag;
    }
  }

  assert.deepEqual(builds, ["@prontiq/sdk", "@prontiq/tokens"]);
  assert.equal(tasks.length, 2);
  assert.deepEqual(tasks[0].args, ["exec", "next", "typegen"]);
  assert.deepEqual(tasks[1].args, ["exec", "tsc", "-p", "tsconfig.typecheck.json", "--noEmit"]);
  assert.equal(tasks[0].env.PRONTIQ_ALLOW_KEYLESS_CLERK, "1");
  assert.equal(tasks[1].env.PRONTIQ_ALLOW_KEYLESS_CLERK, "1");
});

test("frontend task skips local dependency rebuilds when turbo already owns the graph", async () => {
  const previousFlag = process.env.PRONTIQ_TURBO_MANAGED;
  const builds = [];
  const tasks = [];
  process.env.PRONTIQ_TURBO_MANAGED = "1";

  try {
    await runFrontendTask("landing", "build", {
      buildPackage: async (packageName) => {
        builds.push(packageName);
      },
      executeTask: async (spec) => {
        tasks.push(spec);
      },
    });
  } finally {
    if (previousFlag === undefined) {
      delete process.env.PRONTIQ_TURBO_MANAGED;
    } else {
      process.env.PRONTIQ_TURBO_MANAGED = previousFlag;
    }
  }

  assert.deepEqual(builds, []);
  assert.equal(tasks.length, 1);
  assert.deepEqual(tasks[0].args, ["exec", "next", "build"]);
  assert.equal(tasks[0].env.PRONTIQ_ALLOW_KEYLESS_CLERK, undefined);
});

test("frontend task specs use argv arrays without POSIX-only quoting", () => {
  const tasks = [
    getFrontendTaskSpec("landing", "build"),
    getFrontendTaskSpec("landing", "typecheck"),
    getFrontendTaskSpec("landing", "test"),
    getFrontendTaskSpec("console", "build"),
    getFrontendTaskSpec("console", "typecheck"),
    getFrontendTaskSpec("console", "test"),
  ];

  for (const task of tasks) {
    assert.ok(task.args.every((arg) => !arg.includes("'")));
    if (task.followUpArgs) {
      assert.ok(task.followUpArgs.every((arg) => !arg.includes("'")));
    }
  }
});

test("frontend test task rebuilds declared workspace deps before running the app-local test command", async () => {
  const repoDir = await makeRepoFixture();
  const builds = [];
  const tasks = [];
  const previousCwd = process.cwd();
  const previousFlag = process.env.PRONTIQ_TURBO_MANAGED;
  process.chdir(join(repoDir, "apps", "landing"));
  delete process.env.PRONTIQ_TURBO_MANAGED;

  try {
    await runFrontendTask("landing", "test", {
      buildPackage: async (packageName) => {
        builds.push(packageName);
      },
      executeTask: async (spec) => {
        tasks.push(spec);
      },
    });
  } finally {
    process.chdir(previousCwd);
    if (previousFlag === undefined) {
      delete process.env.PRONTIQ_TURBO_MANAGED;
    } else {
      process.env.PRONTIQ_TURBO_MANAGED = previousFlag;
    }
  }

  assert.deepEqual(builds, ["@prontiq/shared", "@prontiq/tokens"]);
  assert.equal(tasks.length, 1);
  assert.deepEqual(tasks[0].args, ["exec", "vitest", "run"]);
  assert.equal(tasks[0].env.PRONTIQ_ALLOW_KEYLESS_CLERK, undefined);
});

test("console frontend task env explicitly enables keyless Clerk mode for local and CI helpers", () => {
  const env = getFrontendTaskEnv("console");

  assert.equal(env.PRONTIQ_ALLOW_KEYLESS_CLERK, "1");
});

test("console dev app process explicitly enables keyless Clerk mode for local helper runs", () => {
  const specs = getDevProcessSpecs("console");
  const appSpec = specs.find((spec) => spec.name === "app");

  assert.ok(appSpec);
  assert.equal(appSpec.env?.PRONTIQ_ALLOW_KEYLESS_CLERK, "1");
});

test("checked-in Next type entrypoints keep the standard Next route-type references", async () => {
  const landingNextEnv = await readFile(new URL("../apps/landing/next-env.d.ts", import.meta.url), "utf8");
  const consoleNextEnv = await readFile(new URL("../apps/console/next-env.d.ts", import.meta.url), "utf8");
  const landingTsconfig = await readFile(new URL("../apps/landing/tsconfig.json", import.meta.url), "utf8");
  const consoleTsconfig = await readFile(new URL("../apps/console/tsconfig.json", import.meta.url), "utf8");

  assert.ok(landingNextEnv.includes(".next/types/routes.d.ts"));
  assert.ok(consoleNextEnv.includes(".next/types/routes.d.ts"));
  assert.ok(landingTsconfig.includes(".next/types/**/*.ts"));
  assert.ok(consoleTsconfig.includes(".next/types/**/*.ts"));
});
