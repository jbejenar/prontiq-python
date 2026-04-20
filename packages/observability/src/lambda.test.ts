import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { EventEmitter } from "node:events";
import { Writable } from "node:stream";
import type {
  ClientRequest,
  IncomingMessage,
  RequestOptions,
} from "node:http";
import type * as HttpModule from "node:http";
import {
  resetTelemetryForTesting,
  setFlushTelemetryOverrideForTesting,
  wrapLambdaHandler,
} from "./lambda.js";
import { createTelemetryBootstrapHandler } from "./bootstrap.js";
import { getCurrentTelemetryState } from "./config.js";

const require = createRequire(import.meta.url);
const http = require("node:http") as typeof HttpModule;

test("wrapLambdaHandler no-ops safely when HONEYCOMB_API_KEY is absent", async () => {
  await resetTelemetryForTesting();
  delete process.env.HONEYCOMB_API_KEY;
  process.env.PRONTIQ_STAGE = "dev";

  const handler = wrapLambdaHandler({
    handler: async () => ({ ok: true }),
    serviceName: "test-noop",
  });

  const result = await handler({}, {});

  assert.deepEqual(result, { ok: true });
  assert.deepEqual(getCurrentTelemetryState(), {
    enabled: false,
    serviceName: "test-noop",
  });
});

test("wrapLambdaHandler flushes traces to OTLP endpoint before returning", async () => {
  await resetTelemetryForTesting();
  process.env.HONEYCOMB_API_KEY = "test-key";
  process.env.PRONTIQ_STAGE = "dev";
  process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT = "http://127.0.0.1:4318/v1/traces";

  let receivedHeaders: Record<string, string | string[] | undefined> | undefined;
  let receivedBodyLength = 0;
  let requestEnded = false;

  const originalRequest = http.request;
  http.request = ((options: RequestOptions, callback?: (res: IncomingMessage) => void) => {
    receivedHeaders = options.headers as Record<string, string | string[] | undefined>;

    const response = new EventEmitter() as IncomingMessage;
    response.statusCode = 200;
    response.statusMessage = "OK";
    response.headers = {};

    const request = new Writable({
      write(chunk, _encoding, next) {
        receivedBodyLength += Buffer.byteLength(chunk);
        next();
      },
    }) as ClientRequest;

    request.setTimeout = ((_timeout: number, _callback?: () => void) => request) as ClientRequest["setTimeout"];
    request.setHeader = ((_name: string, _value: string | number | readonly string[]) => request) as ClientRequest["setHeader"];
    request.destroy = (() => request) as ClientRequest["destroy"];

    request.on("finish", () => {
      requestEnded = true;
      callback?.(response);
      queueMicrotask(() => {
        response.emit("data", Buffer.from("ok"));
        response.emit("end");
      });
    });

    return request;
  }) as typeof http.request;

  try {
    const handler = wrapLambdaHandler({
      attributes: () => ({
        "prontiq.method": "GET",
        "prontiq.route": "/v1/health",
        "prontiq.stage": "dev",
      }),
      handler: async () => ({ ok: true }),
      serviceName: "test-export",
    });

    await handler({}, {});
  } finally {
    http.request = originalRequest;
    delete process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT;
  }

  assert.equal(requestEnded, true);
  assert.equal(receivedHeaders?.["x-honeycomb-team"], "test-key");
  assert.ok(receivedBodyLength > 0);
});

test("wrapLambdaHandler flushes traces before rethrowing handler errors", async () => {
  await resetTelemetryForTesting();
  process.env.HONEYCOMB_API_KEY = "test-key";
  process.env.PRONTIQ_STAGE = "dev";
  let flushCalled = false;
  setFlushTelemetryOverrideForTesting(async () => {
    flushCalled = true;
  });

  try {
    const handler = wrapLambdaHandler({
      handler: async () => {
        throw new Error("boom");
      },
      serviceName: "test-export-error",
    });

    await assert.rejects(() => handler({}, {}), /boom/);
  } finally {
    setFlushTelemetryOverrideForTesting(null);
  }

  assert.equal(flushCalled, true);
});

test("wrapLambdaHandler preserves successful handler results when telemetry flush fails", async () => {
  await resetTelemetryForTesting();
  process.env.HONEYCOMB_API_KEY = "test-key";
  process.env.PRONTIQ_STAGE = "dev";
  setFlushTelemetryOverrideForTesting(async () => {
    throw new Error("flush failed");
  });

  try {
    const handler = wrapLambdaHandler({
      handler: async () => ({ ok: true }),
      serviceName: "test-export-flush-success",
    });

    const result = await handler({}, {});
    assert.deepEqual(result, { ok: true });
  } finally {
    setFlushTelemetryOverrideForTesting(null);
  }
});

test("wrapLambdaHandler preserves the original handler error when telemetry flush fails", async () => {
  await resetTelemetryForTesting();
  process.env.HONEYCOMB_API_KEY = "test-key";
  process.env.PRONTIQ_STAGE = "dev";
  setFlushTelemetryOverrideForTesting(async () => {
    throw new Error("flush failed");
  });

  try {
    const handler = wrapLambdaHandler({
      handler: async () => {
        throw new Error("boom");
      },
      serviceName: "test-export-flush-error",
    });

    await assert.rejects(() => handler({}, {}), /boom/);
  } finally {
    setFlushTelemetryOverrideForTesting(null);
  }
});

test("createTelemetryBootstrapHandler initializes telemetry before loading the target handler", async () => {
  await resetTelemetryForTesting();
  process.env.HONEYCOMB_API_KEY = "test-key";
  process.env.PRONTIQ_STAGE = "dev";

  const handler = createTelemetryBootstrapHandler({
    loadHandler: async () => {
      assert.deepEqual(getCurrentTelemetryState(), {
        enabled: true,
        serviceName: "test-bootstrap",
      });
      return async () => ({ ok: true });
    },
    serviceName: "test-bootstrap",
  });

  const result = await handler({}, {});
  assert.deepEqual(result, { ok: true });
});

test("createTelemetryBootstrapHandler retries loadHandler after an initial failure", async () => {
  await resetTelemetryForTesting();
  process.env.HONEYCOMB_API_KEY = "test-key";
  process.env.PRONTIQ_STAGE = "dev";

  let attempts = 0;
  const handler = createTelemetryBootstrapHandler({
    loadHandler: async () => {
      attempts += 1;
      if (attempts === 1) {
        throw new Error("bootstrap failed");
      }
      return async () => ({ ok: true, attempts });
    },
    serviceName: "test-bootstrap-retry",
  });

  await assert.rejects(() => handler({}, {}), /bootstrap failed/);
  const result = await handler({}, {});

  assert.deepEqual(result, { ok: true, attempts: 2 });
});
