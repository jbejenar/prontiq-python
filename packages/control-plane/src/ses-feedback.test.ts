import test from "node:test";
import assert from "node:assert/strict";
import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import { GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import type { SesSuppressionRecord } from "@prontiq/shared";
import { createSesFeedbackService } from "./ses-feedback.js";

interface FakeDdbCommand {
  input?: {
    ConditionExpression?: string;
    ExpressionAttributeValues?: Record<string, unknown>;
    Item?: SesSuppressionRecord;
  };
}

function makeConfigurationSetSnsEvent(message: Record<string, unknown>) {
  return {
    Records: [
      {
        Sns: {
          Message: JSON.stringify(message),
        },
      },
    ],
  };
}

test("ses feedback retries concurrent complaint promotion instead of letting a weaker bounce win", async () => {
  let store: SesSuppressionRecord | undefined;
  let putAttempts = 0;

  const service = createSesFeedbackService({
    ddb: {
      async send(command: FakeDdbCommand) {
        if (command instanceof GetCommand) {
          return { Item: store };
        }
        if (command instanceof PutCommand) {
          putAttempts += 1;
          assert.equal(typeof command.input.ConditionExpression, "string");
          if (putAttempts === 1) {
            store = {
              email: "race@example.com",
              lastEventAt: "2026-04-19T10:00:00.000Z",
              reason: "complaint",
            };
            throw new ConditionalCheckFailedException({
              message: "simulated concurrent complaint write",
              $metadata: {},
            });
          }
          store = command.input.Item as SesSuppressionRecord;
          return {};
        }
        throw new Error(`Unexpected command: ${command.constructor.name}`);
      },
    } as never,
    logger: console,
    suppressionsTableName: "prontiq-ses-suppressions-test",
  });

  await service.handleSnsEvent(
    makeConfigurationSetSnsEvent({
      eventType: "BOUNCE",
      mail: { timestamp: "2026-04-19T11:00:00.000Z" },
      bounce: {
        bounceType: "Permanent",
        bouncedRecipients: [{ emailAddress: "race@example.com" }],
      },
    }),
  );

  assert.equal(putAttempts, 2);
  assert.deepEqual(store, {
    email: "race@example.com",
    lastEventAt: "2026-04-19T11:00:00.000Z",
    reason: "complaint",
  });
});

test("ses feedback retries concurrent soft bounces so thresholded counts are not lost", async () => {
  let store: SesSuppressionRecord | undefined = {
    bounceCount: 1,
    email: "soft-race@example.com",
    lastEventAt: "2026-04-01T00:00:00.000Z",
    reason: "soft_bounce",
    softBounceWindowStartedAt: "2026-04-01T00:00:00.000Z",
  };
  let putAttempts = 0;

  const service = createSesFeedbackService({
    ddb: {
      async send(command: FakeDdbCommand) {
        if (command instanceof GetCommand) {
          return { Item: store };
        }
        if (command instanceof PutCommand) {
          putAttempts += 1;
          assert.equal(typeof command.input.ConditionExpression, "string");
          if (putAttempts === 1) {
            store = {
              bounceCount: 2,
              email: "soft-race@example.com",
              lastEventAt: "2026-04-10T00:00:00.000Z",
              reason: "soft_bounce",
              softBounceWindowStartedAt: "2026-04-01T00:00:00.000Z",
            };
            throw new ConditionalCheckFailedException({
              message: "simulated concurrent soft-bounce increment",
              $metadata: {},
            });
          }
          store = command.input.Item as SesSuppressionRecord;
          return {};
        }
        throw new Error(`Unexpected command: ${command.constructor.name}`);
      },
    } as never,
    logger: console,
    suppressionsTableName: "prontiq-ses-suppressions-test",
  });

  await service.handleSnsEvent(
    makeConfigurationSetSnsEvent({
      eventType: "BOUNCE",
      mail: { timestamp: "2026-04-20T00:00:00.000Z" },
      bounce: {
        bounceType: "Transient",
        bouncedRecipients: [{ emailAddress: "soft-race@example.com" }],
      },
    }),
  );

  assert.equal(putAttempts, 2);
  assert.equal(store?.reason, "soft_bounce");
  assert.equal(store?.bounceCount, 3);
  assert.equal(store?.softBounceWindowStartedAt, "2026-04-01T00:00:00.000Z");
  assert.equal(store?.lastEventAt, "2026-04-20T00:00:00.000Z");
  assert.equal(typeof store?.ttl, "number");
});
