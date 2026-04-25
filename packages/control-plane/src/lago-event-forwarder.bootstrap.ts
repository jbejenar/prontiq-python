import {
  createTelemetryBootstrapHandler,
  SERVICE_NAMES,
  type LambdaHandler,
} from "@prontiq/observability";
import type { SQSEvent, SQSBatchResponse } from "aws-lambda";

export const handler = createTelemetryBootstrapHandler<SQSEvent, SQSBatchResponse>({
  loadHandler: async () => (await import("./lago-event-forwarder.js")).handler,
  serviceName: SERVICE_NAMES.billing,
}) as LambdaHandler<SQSEvent, SQSBatchResponse>;
