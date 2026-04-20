import {
  createTelemetryBootstrapHandler,
  SERVICE_NAMES,
  type LambdaHandler,
} from "@prontiq/observability";

export const handler = createTelemetryBootstrapHandler({
  loadHandler: async () => (await import("./account-handler.js")).handler,
  serviceName: SERVICE_NAMES.api,
}) as LambdaHandler;
