import {
  createTelemetryBootstrapHandler,
  SERVICE_NAMES,
  type LambdaHandler,
} from "@prontiq/observability";

export const handler = createTelemetryBootstrapHandler({
  loadHandler: async () => (await import("./month-close.js")).handler,
  serviceName: SERVICE_NAMES.billing,
}) as LambdaHandler;
