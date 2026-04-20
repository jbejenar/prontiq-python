import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test } from "vitest";

test("landing globals.css does not import runtime Google Fonts", () => {
  const css = readFileSync(resolve(process.cwd(), "app/globals.css"), "utf8");

  expect(css).not.toContain("fonts.googleapis.com");
});
