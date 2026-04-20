import {
  createTelemetryBootstrapHandler,
  SERVICE_NAMES,
  type LambdaHandler,
} from "@prontiq/observability";

export const handler = createTelemetryBootstrapHandler({
  loadHandler: async () => (await import("./read-manifest.js")).handler,
  serviceName: SERVICE_NAMES.ingestion,
}) as LambdaHandler;
