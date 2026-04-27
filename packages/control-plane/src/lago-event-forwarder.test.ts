import test from "node:test";
import assert from "node:assert/strict";
import {
  buildLagoUsageEventPayload,
  classifyLagoStatusCode,
  createLagoEventForwarderService,
  deriveLagoUsageExternalSubscriptionId,
  hashBillingEventPayload,
  HttpLagoUsageClient,
  isDuplicateLagoTransactionError,
  isPermanentLagoEventValidationError,
  LagoForwardingError,
  normalizeLagoApiUrl,
  type BillingEventDeliveryLedger,
  type BillingEventDeliveryRecord,
  type LagoUsageClient,
  type LagoUsageEventPayload,
} from "./lago-event-forwarder.js";
import {
  deriveBillingUsageEventId,
  type BillingUsageEventV1,
  type BillingUsageEventV2,
} from "@prontiq/shared";
import type { SQSEvent } from "aws-lambda";

const baseIdInput = {
  apiKeyHash: "a".repeat(64),
  billingEndpointKey: "address.enrich",
  creditDelta: 3,
  customerId: "pq_cust_01HYZ6Q4X6DJP2X9Q9FQKX4T7A",
  requestCountAfterIncrement: 42,
  usageScope: "address#2026-04",
};

function makeEvent(overrides: Partial<BillingUsageEventV1> = {}): BillingUsageEventV1 {
  const candidate = {
    version: 1 as const,
    eventId: deriveBillingUsageEventId(baseIdInput),
    occurredAt: "2026-04-25T00:00:00.000Z",
    customerId: baseIdInput.customerId,
    orgId: "org_123",
    apiKeyHash: baseIdInput.apiKeyHash,
    keyPrefix: "pq_test_abc",
    product: "address",
    billingEndpointKey: baseIdInput.billingEndpointKey,
    meterEventName: "prontiq_address_requests",
    creditDelta: baseIdInput.creditDelta,
    usageScope: baseIdInput.usageScope,
    requestCountAfterIncrement: baseIdInput.requestCountAfterIncrement,
    source: {
      requestId: "req_123",
      method: "GET",
      path: "/v1/address/enrich",
      stage: "test",
    },
    ...overrides,
  };
  return candidate;
}

const baseV2IdInput = {
  apiKeyHash: "b".repeat(64),
  billingEndpointKey: "address.autocomplete",
  creditDelta: 1,
  orgId: "org_ActiveV2",
  requestCountAfterIncrement: 11,
  usageScope: "address#2026-04",
};

function makeV2Event(overrides: Partial<BillingUsageEventV2> = {}): BillingUsageEventV2 {
  const candidate = {
    version: 2 as const,
    eventId: deriveBillingUsageEventId(baseV2IdInput),
    occurredAt: "2026-04-25T00:00:00.000Z",
    orgId: baseV2IdInput.orgId,
    apiKeyHash: baseV2IdInput.apiKeyHash,
    keyPrefix: "pq_test_v2",
    product: "address",
    billingEndpointKey: baseV2IdInput.billingEndpointKey,
    meterEventName: "prontiq_address_requests",
    creditDelta: baseV2IdInput.creditDelta,
    usageScope: baseV2IdInput.usageScope,
    requestCountAfterIncrement: baseV2IdInput.requestCountAfterIncrement,
    source: {
      requestId: "req_v2",
      method: "GET",
      path: "/v1/address/autocomplete",
      stage: "test",
    },
    ...overrides,
  };
  return candidate;
}

function makeSqsEvent(body: unknown, messageId = "msg_1"): SQSEvent {
  return {
    Records: [
      {
        attributes: {
          ApproximateFirstReceiveTimestamp: "0",
          ApproximateReceiveCount: "1",
          SenderId: "sender",
          SentTimestamp: "0",
        },
        awsRegion: "ap-southeast-2",
        body: typeof body === "string" ? body : JSON.stringify(body),
        eventSource: "aws:sqs",
        eventSourceARN: "arn:aws:sqs:ap-southeast-2:123:queue",
        md5OfBody: "md5",
        messageAttributes: {},
        messageId,
        receiptHandle: "receipt",
      },
    ],
  };
}

class FakeLedger implements BillingEventDeliveryLedger {
  records = new Map<string, BillingEventDeliveryRecord>();

  async get(eventId: string): Promise<BillingEventDeliveryRecord | undefined> {
    return this.records.get(eventId);
  }

  async recordAttempt(input: Parameters<BillingEventDeliveryLedger["recordAttempt"]>[0]) {
    const existing = this.records.get(input.event.eventId);
    if (existing?.eventPayloadHash && existing.eventPayloadHash !== input.eventPayloadHash) {
      return "hash_conflict" as const;
    }
    if (existing?.status === "accepted") {
      return "accepted_same_hash" as const;
    }
    this.records.set(input.event.eventId, {
      ...existing,
      eventId: input.event.eventId,
      eventPayloadHash: input.eventPayloadHash,
      externalSubscriptionId: input.externalSubscriptionId,
      status: "processing",
      attempts: (existing?.attempts ?? 0) + 1,
    });
    return "ok" as const;
  }

  async markAccepted(input: Parameters<BillingEventDeliveryLedger["markAccepted"]>[0]) {
    const existing = this.records.get(input.event.eventId);
    if (existing?.eventPayloadHash && existing.eventPayloadHash !== input.eventPayloadHash) {
      return "hash_conflict" as const;
    }
    if (existing?.status === "failed_permanent" || existing?.status === "invalid") {
      return "terminal_same_hash" as const;
    }
    this.records.set(input.event.eventId, {
      ...existing,
      acceptedAt: input.now.toISOString(),
      eventId: input.event.eventId,
      eventPayloadHash: input.eventPayloadHash,
      externalSubscriptionId: input.externalSubscriptionId,
      status: "accepted",
    });
    return existing?.status === "accepted" ? ("accepted_same_hash" as const) : ("ok" as const);
  }

  async markFailure(input: Parameters<BillingEventDeliveryLedger["markFailure"]>[0]) {
    const existing = this.records.get(input.event.eventId);
    if (existing?.status === "accepted" || existing?.status === "failed_permanent") {
      return;
    }
    this.records.set(input.event.eventId, {
      ...existing,
      eventId: input.event.eventId,
      eventPayloadHash: input.eventPayloadHash,
      externalSubscriptionId: input.externalSubscriptionId,
      lastError: input.error,
      status: input.status,
      attempts: (existing?.attempts ?? 0) + (input.countAttempt ? 1 : 0),
    });
  }
}

class FakeLagoClient implements LagoUsageClient {
  payloads: LagoUsageEventPayload[] = [];
  error?: Error;

  async sendUsageEvent(payload: LagoUsageEventPayload): Promise<void> {
    this.payloads.push(payload);
    if (this.error) {
      throw this.error;
    }
  }
}

function makeService(input: { ledger?: FakeLedger; lago?: FakeLagoClient } = {}) {
  const ledger = input.ledger ?? new FakeLedger();
  const lago = input.lago ?? new FakeLagoClient();
  const service = createLagoEventForwarderService({
    lagoClient: lago,
    ledger,
    logger: console,
    now: () => new Date("2026-04-25T01:00:00.000Z"),
  });
  return { lago, ledger, service };
}

test("builds minimal Lago usage payload with weighted credits", () => {
  const payload = buildLagoUsageEventPayload(makeEvent());

  assert.deepEqual(payload, {
    event: {
      code: "prontiq_address_requests",
      external_subscription_id: "pq_sub_01HYZ6Q4X6DJP2X9Q9FQKX4T7A",
      properties: {
        credits: 3,
      },
      timestamp: 1777075200,
      transaction_id: deriveBillingUsageEventId(baseIdInput),
    },
  });

  const serialized = JSON.stringify(payload);
  assert.equal(serialized.includes("apiKeyHash"), false);
  assert.equal(serialized.includes("keyPrefix"), false);
  assert.equal(serialized.includes("org_123"), false);
  assert.equal(serialized.includes("/v1/address/enrich"), false);
});

test("derives Lago subscription id from event version", () => {
  assert.equal(
    deriveLagoUsageExternalSubscriptionId(makeEvent()),
    "pq_sub_01HYZ6Q4X6DJP2X9Q9FQKX4T7A",
  );
  assert.equal(deriveLagoUsageExternalSubscriptionId(makeV2Event()), "lago_sub_org_ActiveV2");
});

test("normalizes Lago API URLs", () => {
  assert.equal(
    normalizeLagoApiUrl("https://billing.prontiq.dev"),
    "https://billing.prontiq.dev/api/v1",
  );
  assert.equal(
    normalizeLagoApiUrl("https://billing.prontiq.dev/api/v1/"),
    "https://billing.prontiq.dev/api/v1",
  );
  assert.throws(() => normalizeLagoApiUrl("billing.prontiq.dev"));
});

test("classifies Lago setup/auth failures as retryable and unambiguous bad requests as permanent", () => {
  assert.equal(classifyLagoStatusCode(400).retryable, false);
  assert.equal(classifyLagoStatusCode(422).retryable, true);
  assert.equal(classifyLagoStatusCode(401).retryable, true);
  assert.equal(classifyLagoStatusCode(403).retryable, true);
  assert.equal(classifyLagoStatusCode(404).retryable, true);
  assert.equal(classifyLagoStatusCode(409).retryable, true);
  assert.equal(classifyLagoStatusCode(429).retryable, true);
  assert.equal(classifyLagoStatusCode(500).retryable, true);
});

test("detects Lago duplicate transaction responses narrowly", () => {
  const transactionId = deriveBillingUsageEventId(baseIdInput);

  assert.equal(
    isDuplicateLagoTransactionError({
      body: JSON.stringify({
        error: `transaction_id ${transactionId} has already been taken`,
      }),
      statusCode: 422,
      transactionId,
    }),
    true,
  );
  assert.equal(
    isDuplicateLagoTransactionError({
      body: JSON.stringify({ error: "Validation failed for transaction id duplicate" }),
      statusCode: 422,
      transactionId,
    }),
    true,
  );
  assert.equal(
    isDuplicateLagoTransactionError({
      body: JSON.stringify({ error: "code is invalid" }),
      statusCode: 422,
      transactionId,
    }),
    false,
  );
  assert.equal(
    isDuplicateLagoTransactionError({
      body: JSON.stringify({
        error: `transaction_id ${transactionId} has already been taken`,
      }),
      statusCode: 400,
      transactionId,
    }),
    false,
  );
});

test("detects only specific Lago event validation errors as permanent", () => {
  assert.equal(
    isPermanentLagoEventValidationError({
      body: JSON.stringify({ error: "code is invalid" }),
      statusCode: 422,
    }),
    true,
  );
  assert.equal(
    isPermanentLagoEventValidationError({
      body: JSON.stringify({ error: "Validation failed" }),
      statusCode: 422,
    }),
    false,
  );
  assert.equal(
    isPermanentLagoEventValidationError({
      body: JSON.stringify({ error: "bad request" }),
      statusCode: 400,
    }),
    true,
  );
});

test("treats Lago duplicate transaction response as idempotent success", async () => {
  const event = makeEvent();
  const payload = buildLagoUsageEventPayload(event);
  const client = new HttpLagoUsageClient({
    apiKey: "test_lago_key",
    baseUrl: "https://billing.prontiq.dev",
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          error: `transaction_id ${event.eventId} has already been received`,
        }),
        { status: 422 },
      ),
  });

  await client.sendUsageEvent(payload);
});

test("confirms ambiguous Lago 422 responses before accepting replay as idempotent success", async () => {
  const event = makeEvent();
  const payload = buildLagoUsageEventPayload(event);
  const requestedUrls: string[] = [];
  const client = new HttpLagoUsageClient({
    apiKey: "test_lago_key",
    baseUrl: "https://billing.prontiq.dev",
    fetchImpl: async (input) => {
      requestedUrls.push(String(input));
      if (requestedUrls.length === 1) {
        return new Response(JSON.stringify({ error: "Validation failed" }), { status: 422 });
      }
      return new Response(
        JSON.stringify({
          event: {
            transaction_id: event.eventId,
            external_subscription_id: payload.event.external_subscription_id,
          },
        }),
        { status: 200 },
      );
    },
  });

  await client.sendUsageEvent(payload);

  assert.deepEqual(requestedUrls, [
    "https://billing.prontiq.dev/api/v1/events",
    `https://billing.prontiq.dev/api/v1/events/${event.eventId}`,
  ]);
});

test("keeps unconfirmed ambiguous Lago 422 responses retryable", async () => {
  const event = makeEvent();
  const payload = buildLagoUsageEventPayload(event);
  const client = new HttpLagoUsageClient({
    apiKey: "test_lago_key",
    baseUrl: "https://billing.prontiq.dev",
    fetchImpl: async (input) => {
      if (String(input).endsWith(`/events/${event.eventId}`)) {
        return new Response(JSON.stringify({ error: "not found" }), { status: 404 });
      }
      return new Response(JSON.stringify({ error: "Validation failed" }), { status: 422 });
    },
  });

  await assert.rejects(
    () => client.sendUsageEvent(payload),
    (error) =>
      error instanceof LagoForwardingError && error.statusCode === 422 && error.retryable === true,
  );
});

test("keeps genuine Lago validation 422 failures permanent", async () => {
  const event = makeEvent();
  const payload = buildLagoUsageEventPayload(event);
  const client = new HttpLagoUsageClient({
    apiKey: "test_lago_key",
    baseUrl: "https://billing.prontiq.dev",
    fetchImpl: async (input) => {
      if (String(input).endsWith(`/events/${event.eventId}`)) {
        return new Response(JSON.stringify({ error: "not found" }), { status: 404 });
      }
      return new Response(JSON.stringify({ error: "code is invalid" }), { status: 422 });
    },
  });

  await assert.rejects(
    () => client.sendUsageEvent(payload),
    (error) =>
      error instanceof LagoForwardingError && error.statusCode === 422 && error.retryable === false,
  );
});

test("forwards valid SQS billing event and marks ledger accepted", async () => {
  const { lago, ledger, service } = makeService();
  const event = makeEvent();

  const result = await service.handleSqsEvent(makeSqsEvent(event));

  assert.deepEqual(result.batchItemFailures, []);
  assert.equal(lago.payloads.length, 1);
  assert.equal(lago.payloads[0]?.event.transaction_id, event.eventId);
  assert.equal(
    lago.payloads[0]?.event.external_subscription_id,
    "pq_sub_01HYZ6Q4X6DJP2X9Q9FQKX4T7A",
  );
  const row = ledger.records.get(event.eventId);
  assert.equal(row?.status, "accepted");
  assert.equal(row?.externalSubscriptionId, lago.payloads[0]?.event.external_subscription_id);
});

test("forwards active V2 event and records matching Lago subscription evidence", async () => {
  const { lago, ledger, service } = makeService();
  const event = makeV2Event();

  const result = await service.handleSqsEvent(makeSqsEvent(event));

  assert.deepEqual(result.batchItemFailures, []);
  assert.equal(lago.payloads.length, 1);
  assert.equal(lago.payloads[0]?.event.transaction_id, event.eventId);
  assert.equal(lago.payloads[0]?.event.external_subscription_id, "lago_sub_org_ActiveV2");
  const row = ledger.records.get(event.eventId);
  assert.equal(row?.status, "accepted");
  assert.equal(row?.externalSubscriptionId, lago.payloads[0]?.event.external_subscription_id);
});

test("skips duplicate accepted event without resending to Lago", async () => {
  const event = makeEvent();
  const ledger = new FakeLedger();
  ledger.records.set(event.eventId, {
    eventId: event.eventId,
    eventPayloadHash: hashBillingEventPayload(event),
    status: "accepted",
  });
  const { lago, service } = makeService({ ledger });

  const result = await service.handleSqsEvent(makeSqsEvent(event));

  assert.deepEqual(result.batchItemFailures, []);
  assert.equal(lago.payloads.length, 0);
});

test("acknowledges hash-conflict events without retrying or resending to Lago", async () => {
  const event = makeEvent();
  const ledger = new FakeLedger();
  ledger.records.set(event.eventId, {
    eventId: event.eventId,
    eventPayloadHash: "different-payload-hash",
    status: "accepted",
  });
  const { lago, service } = makeService({ ledger });

  const result = await service.handleSqsEvent(makeSqsEvent(event));

  assert.deepEqual(result.batchItemFailures, []);
  assert.equal(lago.payloads.length, 0);
  assert.equal(ledger.records.get(event.eventId)?.status, "accepted");
});

test("rejects tampered event id before sending to Lago", async () => {
  const { lago, ledger, service } = makeService();
  const event = makeEvent({ eventId: "bevt_11111111111111111111111111111111" });

  const result = await service.handleSqsEvent(makeSqsEvent(event));

  assert.deepEqual(result.batchItemFailures, [{ itemIdentifier: "msg_1" }]);
  assert.equal(lago.payloads.length, 0);
  assert.equal(ledger.records.get(event.eventId)?.status, "invalid");
  assert.equal(ledger.records.get(event.eventId)?.attempts, 0);
});

test("fails invalid JSON without writing a ledger row", async () => {
  const { ledger, service } = makeService();

  const result = await service.handleSqsEvent(makeSqsEvent("{bad json"));

  assert.deepEqual(result.batchItemFailures, [{ itemIdentifier: "msg_1" }]);
  assert.equal(ledger.records.size, 0);
});

test("fails schema-invalid billing events without writing a ledger row", async () => {
  const { ledger, service } = makeService();
  const event = makeEvent({ customerId: "not-a-customer-id" });

  const result = await service.handleSqsEvent(makeSqsEvent(event));

  assert.deepEqual(result.batchItemFailures, [{ itemIdentifier: "msg_1" }]);
  assert.equal(ledger.records.size, 0);
});

test("records permanent Lago failures and leaves message failed", async () => {
  const lago = new FakeLagoClient();
  lago.error = new LagoForwardingError("Lago usage event rejected with HTTP 422", {
    retryable: false,
    statusCode: 422,
  });
  const { ledger, service } = makeService({ lago });
  const event = makeEvent();

  const result = await service.handleSqsEvent(makeSqsEvent(event));

  assert.deepEqual(result.batchItemFailures, [{ itemIdentifier: "msg_1" }]);
  assert.equal(ledger.records.get(event.eventId)?.status, "failed_permanent");
  assert.equal(ledger.records.get(event.eventId)?.attempts, 1);
});

test("records Lago auth and setup failures as retryable for operator replay", async () => {
  const lago = new FakeLagoClient();
  lago.error = new LagoForwardingError("Lago usage event rejected with HTTP 401", {
    retryable: true,
    statusCode: 401,
  });
  const { ledger, service } = makeService({ lago });
  const event = makeEvent();

  const result = await service.handleSqsEvent(makeSqsEvent(event));

  assert.deepEqual(result.batchItemFailures, [{ itemIdentifier: "msg_1" }]);
  assert.equal(ledger.records.get(event.eventId)?.status, "failed_retryable");
  assert.equal(ledger.records.get(event.eventId)?.attempts, 1);
});

test("retries an event after a prior retryable Lago auth failure", async () => {
  const event = makeEvent();
  const ledger = new FakeLedger();
  ledger.records.set(event.eventId, {
    eventId: event.eventId,
    eventPayloadHash: hashBillingEventPayload(event),
    status: "failed_retryable",
    attempts: 1,
    lastError: "Lago usage event rejected with HTTP 401",
  });
  const { lago, service } = makeService({ ledger });

  const result = await service.handleSqsEvent(makeSqsEvent(event));

  assert.deepEqual(result.batchItemFailures, []);
  assert.equal(lago.payloads.length, 1);
  assert.equal(ledger.records.get(event.eventId)?.status, "accepted");
  assert.equal(ledger.records.get(event.eventId)?.attempts, 2);
});

test("marks ledger accepted when replay receives Lago duplicate transaction response", async () => {
  const event = makeEvent();
  const ledger = new FakeLedger();
  ledger.records.set(event.eventId, {
    eventId: event.eventId,
    eventPayloadHash: hashBillingEventPayload(event),
    status: "processing",
    attempts: 1,
  });
  const service = createLagoEventForwarderService({
    lagoClient: new HttpLagoUsageClient({
      apiKey: "test_lago_key",
      baseUrl: "https://billing.prontiq.dev",
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            error: `transaction_id ${event.eventId} has already been received`,
          }),
          { status: 422 },
        ),
    }),
    ledger,
    logger: console,
    now: () => new Date("2026-04-25T01:00:00.000Z"),
  });

  const result = await service.handleSqsEvent(makeSqsEvent(event));

  assert.deepEqual(result.batchItemFailures, []);
  assert.equal(ledger.records.get(event.eventId)?.status, "accepted");
  assert.equal(ledger.records.get(event.eventId)?.attempts, 2);
});

test("marks ledger accepted when replay confirms an ambiguous Lago 422 was already stored", async () => {
  const event = makeEvent();
  const payload = buildLagoUsageEventPayload(event);
  const ledger = new FakeLedger();
  ledger.records.set(event.eventId, {
    eventId: event.eventId,
    eventPayloadHash: hashBillingEventPayload(event),
    status: "processing",
    attempts: 1,
  });
  const service = createLagoEventForwarderService({
    lagoClient: new HttpLagoUsageClient({
      apiKey: "test_lago_key",
      baseUrl: "https://billing.prontiq.dev",
      fetchImpl: async (input) => {
        if (String(input).endsWith(`/events/${event.eventId}`)) {
          return new Response(
            JSON.stringify({
              event: {
                transaction_id: event.eventId,
                external_subscription_id: payload.event.external_subscription_id,
              },
            }),
            { status: 200 },
          );
        }
        return new Response(JSON.stringify({ error: "Validation failed" }), { status: 422 });
      },
    }),
    ledger,
    logger: console,
    now: () => new Date("2026-04-25T01:00:00.000Z"),
  });

  const result = await service.handleSqsEvent(makeSqsEvent(event));

  assert.deepEqual(result.batchItemFailures, []);
  assert.equal(ledger.records.get(event.eventId)?.status, "accepted");
  assert.equal(ledger.records.get(event.eventId)?.attempts, 2);
});

test("does not resend an event after a permanent Lago failure", async () => {
  const event = makeEvent();
  const ledger = new FakeLedger();
  ledger.records.set(event.eventId, {
    eventId: event.eventId,
    eventPayloadHash: hashBillingEventPayload(event),
    status: "failed_permanent",
  });
  const { lago, service } = makeService({ ledger });

  const result = await service.handleSqsEvent(makeSqsEvent(event));

  assert.deepEqual(result.batchItemFailures, [{ itemIdentifier: "msg_1" }]);
  assert.equal(lago.payloads.length, 0);
  assert.equal(ledger.records.get(event.eventId)?.status, "failed_permanent");
});

test("does not double-count a Lago send attempt when marking failure", async () => {
  const lago = new FakeLagoClient();
  lago.error = new LagoForwardingError("Lago usage event rejected with HTTP 500", {
    retryable: true,
    statusCode: 500,
  });
  const { ledger, service } = makeService({ lago });
  const event = makeEvent();

  const result = await service.handleSqsEvent(makeSqsEvent(event));

  assert.deepEqual(result.batchItemFailures, [{ itemIdentifier: "msg_1" }]);
  assert.equal(ledger.records.get(event.eventId)?.status, "failed_retryable");
  assert.equal(ledger.records.get(event.eventId)?.attempts, 1);
});

test("does not downgrade an accepted event when a duplicate worker later fails", async () => {
  const event = makeEvent();
  const ledger = new FakeLedger();
  ledger.records.set(event.eventId, {
    eventId: event.eventId,
    eventPayloadHash: hashBillingEventPayload(event),
    status: "accepted",
    attempts: 1,
  });

  await ledger.markFailure({
    event,
    eventPayloadHash: hashBillingEventPayload(event),
    externalSubscriptionId: "pq_sub_01HYZ6Q4X6DJP2X9Q9FQKX4T7A",
    now: new Date("2026-04-25T01:00:00.000Z"),
    countAttempt: false,
    error: "late duplicate failure",
    status: "failed_retryable",
  });

  assert.equal(ledger.records.get(event.eventId)?.status, "accepted");
  assert.equal(ledger.records.get(event.eventId)?.attempts, 1);
});

test("does not overwrite a permanent failure when a late duplicate marks accepted", async () => {
  const event = makeEvent();
  const ledger = new FakeLedger();
  ledger.records.set(event.eventId, {
    eventId: event.eventId,
    eventPayloadHash: hashBillingEventPayload(event),
    status: "failed_permanent",
    attempts: 1,
    lastError: "Lago usage event rejected with HTTP 422",
  });

  const result = await ledger.markAccepted({
    event,
    eventPayloadHash: hashBillingEventPayload(event),
    externalSubscriptionId: "pq_sub_01HYZ6Q4X6DJP2X9Q9FQKX4T7A",
    now: new Date("2026-04-25T01:00:00.000Z"),
  });

  assert.equal(result, "terminal_same_hash");
  assert.equal(ledger.records.get(event.eventId)?.status, "failed_permanent");
  assert.equal(ledger.records.get(event.eventId)?.attempts, 1);
});
