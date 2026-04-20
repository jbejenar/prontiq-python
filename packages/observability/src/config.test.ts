import test from "node:test";
import assert from "node:assert/strict";
import { getHoneycombConfig } from "./config.js";

test("getHoneycombConfig trims values and disables export when key missing", () => {
  delete process.env.HONEYCOMB_API_KEY;
  process.env.PRONTIQ_STAGE = "dev";

  const config = getHoneycombConfig();

  assert.equal(config.enabled, false);
  assert.equal(config.apiKey, "");
  assert.equal(config.stage, "dev");
});

test("getHoneycombConfig enables export when key is present after trimming", () => {
  process.env.HONEYCOMB_API_KEY = "  abc123  ";
  process.env.PRONTIQ_STAGE = "prod";
  delete process.env.HONEYCOMB_ENABLED;

  const config = getHoneycombConfig();

  assert.equal(config.enabled, true);
  assert.equal(config.apiKey, "abc123");
  assert.equal(config.stage, "prod");
});

test("getHoneycombConfig disables export when HONEYCOMB_ENABLED is false", () => {
  process.env.HONEYCOMB_API_KEY = "abc123";
  process.env.HONEYCOMB_ENABLED = " false ";
  process.env.PRONTIQ_STAGE = "prod";

  const config = getHoneycombConfig();

  assert.equal(config.enabled, false);
  assert.equal(config.apiKey, "abc123");
  assert.equal(config.stage, "prod");
});
