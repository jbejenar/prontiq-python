import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import {
  CreateTableCommand,
  DeleteTableCommand,
  DescribeTableCommand,
  DynamoDBClient,
} from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
} from "@aws-sdk/lib-dynamodb";
import { createSesFeedbackService } from "./ses-feedback.js";

const DDB_URL = process.env.DYNAMODB_TEST_URL ?? "http://localhost:8000";
const SUFFIX = Date.now().toString();
const SUPPRESSIONS_TABLE = `prontiq-ses-feedback-test-${SUFFIX}`;

const ddbRaw = new DynamoDBClient({
  endpoint: DDB_URL,
  region: "ap-southeast-2",
  credentials: { accessKeyId: "test", secretAccessKey: "test" },
});
const ddb = DynamoDBDocumentClient.from(ddbRaw);

before(async () => {
  await ddbRaw.send(
    new CreateTableCommand({
      TableName: SUPPRESSIONS_TABLE,
      AttributeDefinitions: [{ AttributeName: "email", AttributeType: "S" }],
      KeySchema: [{ AttributeName: "email", KeyType: "HASH" }],
      BillingMode: "PAY_PER_REQUEST",
    }),
  );
  for (let i = 0; i < 20; i += 1) {
    const described = await ddbRaw.send(new DescribeTableCommand({ TableName: SUPPRESSIONS_TABLE }));
    if (described.Table?.TableStatus === "ACTIVE") break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
});

after(async () => {
  await ddbRaw.send(new DeleteTableCommand({ TableName: SUPPRESSIONS_TABLE }));
});

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

test("hard bounce suppresses immediately with TTL", async () => {
  const service = createSesFeedbackService({
    ddb,
    logger: console,
    suppressionsTableName: SUPPRESSIONS_TABLE,
  });

  await service.handleSnsEvent(
    makeConfigurationSetSnsEvent({
      eventType: "BOUNCE",
      mail: { timestamp: "2026-04-19T00:00:00.000Z" },
      bounce: {
        bounceType: "Permanent",
        bouncedRecipients: [{ emailAddress: "HardBounce@example.com" }],
      },
    }),
  );

  const record = await ddb.send(
    new GetCommand({ TableName: SUPPRESSIONS_TABLE, Key: { email: "hardbounce@example.com" } }),
  );
  assert.equal(record.Item?.reason, "hard_bounce");
  assert.equal(typeof record.Item?.ttl, "number");
});

test("third soft bounce within the window suppresses", async () => {
  const service = createSesFeedbackService({
    ddb,
    logger: console,
    suppressionsTableName: SUPPRESSIONS_TABLE,
  });

  for (const timestamp of [
    "2026-04-01T00:00:00.000Z",
    "2026-04-10T00:00:00.000Z",
    "2026-04-20T00:00:00.000Z",
  ]) {
    await service.handleSnsEvent(
      makeConfigurationSetSnsEvent({
        eventType: "BOUNCE",
        mail: { timestamp },
        bounce: {
          bounceType: "Transient",
          bouncedRecipients: [{ emailAddress: "softbounce@example.com" }],
        },
      }),
    );
  }

  const record = await ddb.send(
    new GetCommand({ TableName: SUPPRESSIONS_TABLE, Key: { email: "softbounce@example.com" } }),
  );
  assert.equal(record.Item?.reason, "soft_bounce");
  assert.equal(record.Item?.bounceCount, 3);
  assert.equal(typeof record.Item?.ttl, "number");
});

test("complaint permanently overrides prior soft bounce state", async () => {
  const service = createSesFeedbackService({
    ddb,
    logger: console,
    suppressionsTableName: SUPPRESSIONS_TABLE,
  });

  await service.handleSnsEvent(
    makeConfigurationSetSnsEvent({
      eventType: "COMPLAINT",
      mail: { timestamp: "2026-04-25T00:00:00.000Z" },
      complaint: {
        complainedRecipients: [{ emailAddress: "softbounce@example.com" }],
      },
    }),
  );

  const record = await ddb.send(
    new GetCommand({ TableName: SUPPRESSIONS_TABLE, Key: { email: "softbounce@example.com" } }),
  );
  assert.equal(record.Item?.reason, "complaint");
  assert.equal(record.Item?.ttl, undefined);
});

test("complaint is not downgraded by a later hard bounce", async () => {
  const service = createSesFeedbackService({
    ddb,
    logger: console,
    suppressionsTableName: SUPPRESSIONS_TABLE,
  });

  await service.handleSnsEvent(
    makeConfigurationSetSnsEvent({
      eventType: "BOUNCE",
      mail: { timestamp: "2026-04-27T00:00:00.000Z" },
      bounce: {
        bounceType: "Permanent",
        bouncedRecipients: [{ emailAddress: "softbounce@example.com" }],
      },
    }),
  );

  const record = await ddb.send(
    new GetCommand({ TableName: SUPPRESSIONS_TABLE, Key: { email: "softbounce@example.com" } }),
  );
  assert.equal(record.Item?.reason, "complaint");
  assert.equal(record.Item?.ttl, undefined);
});

test("complaint is not downgraded by a later soft bounce", async () => {
  const service = createSesFeedbackService({
    ddb,
    logger: console,
    suppressionsTableName: SUPPRESSIONS_TABLE,
  });

  await service.handleSnsEvent(
    makeConfigurationSetSnsEvent({
      eventType: "BOUNCE",
      mail: { timestamp: "2026-04-27T12:00:00.000Z" },
      bounce: {
        bounceType: "Transient",
        bouncedRecipients: [{ emailAddress: "softbounce@example.com" }],
      },
    }),
  );

  const record = await ddb.send(
    new GetCommand({ TableName: SUPPRESSIONS_TABLE, Key: { email: "softbounce@example.com" } }),
  );
  assert.equal(record.Item?.reason, "complaint");
  assert.equal(record.Item?.ttl, undefined);
});

test("legacy notificationType payloads remain supported intentionally", async () => {
  const service = createSesFeedbackService({
    ddb,
    logger: console,
    suppressionsTableName: SUPPRESSIONS_TABLE,
  });

  await service.handleSnsEvent({
    Records: [
      {
        Sns: {
          Message: JSON.stringify({
            notificationType: "Bounce",
            mail: { timestamp: "2026-04-28T00:00:00.000Z" },
            bounce: {
              bounceType: "Permanent",
              bouncedRecipients: [{ emailAddress: "legacybounce@example.com" }],
            },
          }),
        },
      },
    ],
  });

  const record = await ddb.send(
    new GetCommand({ TableName: SUPPRESSIONS_TABLE, Key: { email: "legacybounce@example.com" } }),
  );
  assert.equal(record.Item?.reason, "hard_bounce");
});

test("malformed SNS payload is ignored without failing the batch", async () => {
  const warnings: string[] = [];
  const service = createSesFeedbackService({
    ddb,
    logger: {
      error: () => undefined,
      info: () => undefined,
      warn: (message: string) => {
        warnings.push(message);
      },
    },
    suppressionsTableName: SUPPRESSIONS_TABLE,
  });

  await service.handleSnsEvent({
    Records: [
      { Sns: { Message: "{not-json" } },
      {
        Sns: {
          Message: JSON.stringify({
            notificationType: "Complaint",
            eventType: "COMPLAINT",
            mail: { timestamp: "2026-04-26T00:00:00.000Z" },
            complaint: {
              complainedRecipients: [{ emailAddress: "malformed-batch@example.com" }],
            },
          }),
        },
      },
    ],
  });

  const record = await ddb.send(
    new GetCommand({
      TableName: SUPPRESSIONS_TABLE,
      Key: { email: "malformed-batch@example.com" },
    }),
  );

  assert.equal(record.Item?.reason, "complaint");
  assert.equal(warnings.length, 1);
});

test("unsupported SES feedback event is ignored with a warning", async () => {
  const warnings: string[] = [];
  const service = createSesFeedbackService({
    ddb,
    logger: {
      error: () => undefined,
      info: () => undefined,
      warn: (message: string) => {
        warnings.push(message);
      },
    },
    suppressionsTableName: SUPPRESSIONS_TABLE,
  });

  await service.handleSnsEvent(
    makeConfigurationSetSnsEvent({
      eventType: "DELIVERY",
      mail: { timestamp: "2026-04-29T00:00:00.000Z" },
    }),
  );

  assert.equal(warnings.length, 1);
});

test("expired hard bounce is ignored before applying a new transient bounce", async () => {
  await ddb.send(
    new PutCommand({
      TableName: SUPPRESSIONS_TABLE,
      Item: {
        bounceCount: 3,
        email: "expired-hard@example.com",
        lastEventAt: "2026-01-01T00:00:00.000Z",
        reason: "hard_bounce",
        ttl: Math.floor(new Date("2026-04-20T00:00:00.000Z").getTime() / 1000),
      },
    }),
  );

  const service = createSesFeedbackService({
    ddb,
    logger: console,
    suppressionsTableName: SUPPRESSIONS_TABLE,
  });

  await service.handleSnsEvent(
    makeConfigurationSetSnsEvent({
      eventType: "BOUNCE",
      mail: { timestamp: "2026-04-21T00:00:00.000Z" },
      bounce: {
        bounceType: "Transient",
        bouncedRecipients: [{ emailAddress: "expired-hard@example.com" }],
      },
    }),
  );

  const record = await ddb.send(
    new GetCommand({ TableName: SUPPRESSIONS_TABLE, Key: { email: "expired-hard@example.com" } }),
  );
  assert.equal(record.Item?.reason, "soft_bounce");
  assert.equal(record.Item?.bounceCount, 1);
  assert.equal(record.Item?.ttl, undefined);
});

test("expired thresholded soft bounce is ignored before applying a new first soft bounce", async () => {
  await ddb.send(
    new PutCommand({
      TableName: SUPPRESSIONS_TABLE,
      Item: {
        bounceCount: 3,
        email: "expired-soft@example.com",
        lastEventAt: "2026-01-01T00:00:00.000Z",
        reason: "soft_bounce",
        softBounceWindowStartedAt: "2026-01-01T00:00:00.000Z",
        ttl: Math.floor(new Date("2026-04-20T00:00:00.000Z").getTime() / 1000),
      },
    }),
  );

  const service = createSesFeedbackService({
    ddb,
    logger: console,
    suppressionsTableName: SUPPRESSIONS_TABLE,
  });

  await service.handleSnsEvent(
    makeConfigurationSetSnsEvent({
      eventType: "BOUNCE",
      mail: { timestamp: "2026-04-21T00:00:00.000Z" },
      bounce: {
        bounceType: "Transient",
        bouncedRecipients: [{ emailAddress: "expired-soft@example.com" }],
      },
    }),
  );

  const record = await ddb.send(
    new GetCommand({ TableName: SUPPRESSIONS_TABLE, Key: { email: "expired-soft@example.com" } }),
  );
  assert.equal(record.Item?.reason, "soft_bounce");
  assert.equal(record.Item?.bounceCount, 1);
  assert.equal(record.Item?.softBounceWindowStartedAt, "2026-04-21T00:00:00.000Z");
  assert.equal(record.Item?.ttl, undefined);
});

test("expired bounce state does not block a fresh permanent bounce", async () => {
  await ddb.send(
    new PutCommand({
      TableName: SUPPRESSIONS_TABLE,
      Item: {
        bounceCount: 3,
        email: "expired-then-hard@example.com",
        lastEventAt: "2026-01-01T00:00:00.000Z",
        reason: "soft_bounce",
        softBounceWindowStartedAt: "2026-01-01T00:00:00.000Z",
        ttl: Math.floor(new Date("2026-04-20T00:00:00.000Z").getTime() / 1000),
      },
    }),
  );

  const service = createSesFeedbackService({
    ddb,
    logger: console,
    suppressionsTableName: SUPPRESSIONS_TABLE,
  });

  await service.handleSnsEvent(
    makeConfigurationSetSnsEvent({
      eventType: "BOUNCE",
      mail: { timestamp: "2026-04-21T00:00:00.000Z" },
      bounce: {
        bounceType: "Permanent",
        bouncedRecipients: [{ emailAddress: "expired-then-hard@example.com" }],
      },
    }),
  );

  const record = await ddb.send(
    new GetCommand({
      TableName: SUPPRESSIONS_TABLE,
      Key: { email: "expired-then-hard@example.com" },
    }),
  );
  assert.equal(record.Item?.reason, "hard_bounce");
  assert.equal(record.Item?.bounceCount, 3);
  assert.equal(typeof record.Item?.ttl, "number");
});
