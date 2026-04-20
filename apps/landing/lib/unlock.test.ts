import { expect, test } from "vitest";

import { createLockedPageHtml, evaluateLandingUnlock } from "./unlock.js";

test("evaluateLandingUnlock allows public access when no token is configured", () => {
  expect(evaluateLandingUnlock({ configuredToken: undefined })).toEqual({ kind: "allow" });
});

test("evaluateLandingUnlock allows access when the unlock cookie matches", () => {
  expect(
    evaluateLandingUnlock({
      configuredToken: "preview-secret",
      cookieToken: "preview-secret",
    }),
  ).toEqual({ kind: "allow" });
});

test("evaluateLandingUnlock redirects and sets a cookie for a valid unlock token", () => {
  expect(
    evaluateLandingUnlock({
      configuredToken: "preview-secret",
      queryToken: "preview-secret",
    }),
  ).toEqual({ kind: "redirect", shouldSetCookie: true });
});

test("evaluateLandingUnlock redirects without a cookie for an invalid unlock token", () => {
  expect(
    evaluateLandingUnlock({
      configuredToken: "preview-secret",
      queryToken: "wrong-secret",
    }),
  ).toEqual({ kind: "redirect", shouldSetCookie: false });
});

test("evaluateLandingUnlock keeps the root page locked without a cookie or valid token", () => {
  expect(
    evaluateLandingUnlock({
      configuredToken: "preview-secret",
    }),
  ).toEqual({ kind: "locked" });
});

test("createLockedPageHtml returns a minimal black holding page", () => {
  const html = createLockedPageHtml();

  expect(html).toContain("<title>Prontiq</title>");
  expect(html).toContain("background: #000");
  expect(html).not.toContain("unlock");
});
