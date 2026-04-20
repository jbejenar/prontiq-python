import { expect, test } from "vitest";

import { DEFAULT_ACCOUNT_URL } from "@prontiq/shared/constants";

import { resolveLandingAccountUrl, resolveLandingAccountUrlFromHeaders } from "./account-url.js";

test("resolveLandingAccountUrl keeps production landing on the canonical console host", () => {
  expect(resolveLandingAccountUrl("https://prontiq.dev")).toBe(DEFAULT_ACCOUNT_URL);
  expect(resolveLandingAccountUrl("https://www.prontiq.dev")).toBe(DEFAULT_ACCOUNT_URL);
});

test("resolveLandingAccountUrl stays on the current origin for preview and local by default", () => {
  expect(
    resolveLandingAccountUrl("https://prontiq-web-public-jqmzq3cip-jbejenar-2089s-projects.vercel.app"),
  ).toBe("https://prontiq-web-public-jqmzq3cip-jbejenar-2089s-projects.vercel.app");
  expect(resolveLandingAccountUrl("http://localhost:3000")).toBe("http://localhost:3000");
});

test("resolveLandingAccountUrlFromHeaders uses trusted request host data during SSR", () => {
  expect(
    resolveLandingAccountUrlFromHeaders(
      new Headers({
        "x-forwarded-host": "prontiq-web-public-jqmzq3cip-jbejenar-2089s-projects.vercel.app",
        "x-forwarded-proto": "https",
      }),
    ),
  ).toBe("https://prontiq-web-public-jqmzq3cip-jbejenar-2089s-projects.vercel.app");

  expect(
    resolveLandingAccountUrlFromHeaders(
      new Headers({
        host: "localhost:3000",
      }),
    ),
  ).toBe("http://localhost:3000");

  expect(
    resolveLandingAccountUrlFromHeaders(
      new Headers({
        "x-forwarded-host": "prontiq.dev",
        "x-forwarded-proto": "https",
      }),
    ),
  ).toBe(DEFAULT_ACCOUNT_URL);
});

test("resolveLandingAccountUrlFromHeaders ignores spoofed origin headers", () => {
  expect(
    resolveLandingAccountUrlFromHeaders(
      new Headers({
        origin: "https://evil.example",
        "x-forwarded-host": "prontiq-web-public-jqmzq3cip-jbejenar-2089s-projects.vercel.app",
        "x-forwarded-proto": "https",
      }),
    ),
  ).toBe("https://prontiq-web-public-jqmzq3cip-jbejenar-2089s-projects.vercel.app");

  expect(
    resolveLandingAccountUrlFromHeaders(
      new Headers({
        origin: "https://evil.example",
        host: "localhost:3000",
      }),
    ),
  ).toBe("http://localhost:3000");
});
