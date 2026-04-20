import { expect, test } from "vitest";

import { DEFAULT_ACCOUNT_URL } from "@prontiq/shared/constants";

import {
  getInitialLandingAccountUrlForTestOptions,
  resolveLandingAccountUrl,
} from "./account-url.js";

test("resolveLandingAccountUrl keeps production landing on the canonical console host", () => {
  expect(resolveLandingAccountUrl("https://prontiq.dev")).toBe(DEFAULT_ACCOUNT_URL);
  expect(resolveLandingAccountUrl("https://www.prontiq.dev")).toBe(DEFAULT_ACCOUNT_URL);
});

test("resolveLandingAccountUrl maps preview and local landing hosts to the console surface", () => {
  expect(
    resolveLandingAccountUrl("https://prontiq-web-public-jqmzq3cip-jbejenar-2089s-projects.vercel.app"),
  ).toBe("https://prontiq-web-console-jqmzq3cip-jbejenar-2089s-projects.vercel.app");
  expect(resolveLandingAccountUrl("http://localhost:3000")).toBe("http://localhost:3001");
});

test("resolveLandingAccountUrl falls back to the canonical console host for unknown environments", () => {
  expect(resolveLandingAccountUrl("https://unknown.example")).toBe(DEFAULT_ACCOUNT_URL);
});

test("initial landing account URL state is resolved in production", () => {
  expect(getInitialLandingAccountUrlForTestOptions({ deploymentEnv: "production" })).toEqual({
    accountUrl: DEFAULT_ACCOUNT_URL,
    isResolved: true,
  });
});

test("initial landing account URL state stays unresolved outside production without an explicit override", () => {
  expect(getInitialLandingAccountUrlForTestOptions({ deploymentEnv: "preview" })).toEqual({
    accountUrl: null,
    isResolved: false,
  });
});
