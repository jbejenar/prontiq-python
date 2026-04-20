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
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  resetTelemetryForTesting,
  SERVICE_NAMES,
  wrapLambdaHandler,
} from "@prontiq/observability";
import { captureDynamoClient, withOpenSearchSubsegment } from "./tracing.js";

const require = createRequire(import.meta.url);
const http = require("node:http") as typeof HttpModule;

test("captureDynamoClient preserves the client shape", () => {
  const client = new DynamoDBClient({});
  const captured = captureDynamoClient(client);
  assert.equal(typeof captured.send, "function");
});

test("withOpenSearchSubsegment no-ops safely without an active segment", async () => {
  let invoked = false;
  const result = await withOpenSearchSubsegment("search", async () => {
    invoked = true;
    return 42;
  });
  assert.equal(invoked, true);
  assert.equal(result, 42);
});

test("withOpenSearchSubsegment exports the named Honeycomb child span through the wrapped handler path", async () => {
  await resetTelemetryForTesting();
  process.env.HONEYCOMB_API_KEY = "test-key";
  process.env.PRONTIQ_STAGE = "dev";
  process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT = "http://127.0.0.1:4318/v1/traces";

  let receivedBody = "";
  const originalRequest = http.request;
  http.request = ((_options: RequestOptions, callback?: (res: IncomingMessage) => void) => {
    const response = new EventEmitter() as IncomingMessage;
    response.statusCode = 200;
    response.statusMessage = "OK";
    response.headers = {};

    const request = new Writable({
      write(chunk, _encoding, next) {
        receivedBody += chunk.toString("utf8");
        next();
      },
    }) as ClientRequest;

    request.setTimeout = ((_timeout: number, _callback?: () => void) => request) as ClientRequest["setTimeout"];
    request.setHeader = ((_name: string, _value: string | number | readonly string[]) => request) as ClientRequest["setHeader"];
    request.destroy = (() => request) as ClientRequest["destroy"];

    request.on("finish", () => {
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
      handler: async () => withOpenSearchSubsegment("validate", async () => 42),
      serviceName: SERVICE_NAMES.api,
      spanName: "prontiq-api.test-request",
    });

    const result = await handler({}, {});
    assert.equal(result, 42);
  } finally {
    http.request = originalRequest;
    delete process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT;
  }

  assert.match(receivedBody, /"name":"validate"/);
});
