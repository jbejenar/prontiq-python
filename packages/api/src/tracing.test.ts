import test from "node:test";
import assert from "node:assert/strict";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { captureDynamoClient, withOpenSearchSubsegment } from "./tracing.js";

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
