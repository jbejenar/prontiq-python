import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test } from "vitest";

test("Scalar overrides provide opaque Prontiq backgrounds for the body-mounted client", () => {
  const css = readFileSync(
    resolve(process.cwd(), "features/playground/components/scalar-client-overrides.css"),
    "utf8",
  );

  expect(css).toContain(".scalar-app");
  expect(css).toContain("--scalar-background-1");
  expect(css).toContain(".scalar-app-layout");
  expect(css).toContain("#scalar-client");
  expect(css).toContain("!important");
});
