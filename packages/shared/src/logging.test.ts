import test from "node:test";
import assert from "node:assert/strict";
import { createLogger } from "./logging.js";

test("createLogger emits valid json with stable top-level fields", () => {
  const lines: string[] = [];
  const originalInfo = console.info;
  console.info = (value?: unknown) => {
    lines.push(String(value));
  };

  try {
    const logger = createLogger("api");
    logger.info("request completed", {
      request_id: "req_123",
      path: "/v1/address/autocomplete",
      latency: 42,
    });
  } finally {
    console.info = originalInfo;
  }

  assert.equal(lines.length, 1);
  const parsed = JSON.parse(lines[0] ?? "");
  assert.deepEqual(parsed, {
    level: "info",
    message: "request completed",
    service: "api",
    request_id: "req_123",
    path: "/v1/address/autocomplete",
    latency: 42,
  });
});

test("createLogger serializes error objects in extra args", () => {
  const lines: string[] = [];
  const originalWarn = console.warn;
  console.warn = (value?: unknown) => {
    lines.push(String(value));
  };

  try {
    const logger = createLogger("control-plane");
    logger.warn("send failed", {
      request_id: "req_456",
      cause: new Error("boom"),
    });
  } finally {
    console.warn = originalWarn;
  }

  assert.equal(lines.length, 1);
  const parsed = JSON.parse(lines[0] ?? "");
  assert.equal(parsed.level, "warn");
  assert.equal(parsed.message, "send failed");
  assert.equal(parsed.service, "control-plane");
  assert.equal(parsed.request_id, "req_456");
  assert.equal(parsed.cause.error_message, "boom");
  assert.equal(parsed.cause.error_name, "Error");
});

test("createLogger preserves reserved top-level fields when extra context collides", () => {
  const lines: string[] = [];
  const originalInfo = console.info;
  console.info = (value?: unknown) => {
    lines.push(String(value));
  };

  try {
    const logger = createLogger("api");
    logger.info("request completed", {
      level: "fake",
      message: "shadowed",
      service: "shadowed",
      path: "/v1/address/autocomplete",
    });
  } finally {
    console.info = originalInfo;
  }

  assert.equal(lines.length, 1);
  const parsed = JSON.parse(lines[0] ?? "");
  assert.equal(parsed.level, "info");
  assert.equal(parsed.message, "request completed");
  assert.equal(parsed.service, "api");
  assert.equal(parsed.path, "/v1/address/autocomplete");
});
