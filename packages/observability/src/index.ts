export {
  HONEYCOMB_TRACES_URL_US,
  SERVICE_NAMES,
  getHoneycombConfig,
  getCurrentTelemetryState,
} from "./config.js";
export {
  setActiveSpanAttributes,
  sanitizeSpanAttributes,
  type SpanAttributesInput,
} from "./attributes.js";
export {
  createTelemetryBootstrapHandler,
  type CreateTelemetryBootstrapHandlerOptions,
} from "./bootstrap.js";
export {
  initializeTelemetry,
  resetTelemetryForTesting,
  wrapLambdaHandler,
  withActiveSpan,
  type LambdaHandler,
  type WrapLambdaHandlerOptions,
} from "./lambda.js";
