import {
  SpanKind,
  SpanStatusCode,
  context as otelContext,
  trace,
} from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { registerInstrumentations } from "@opentelemetry/instrumentation";
import { AwsInstrumentation } from "@opentelemetry/instrumentation-aws-sdk";
import { HttpInstrumentation } from "@opentelemetry/instrumentation-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { getHoneycombConfig, setCurrentTelemetryState } from "./config.js";
import { sanitizeSpanAttributes, setActiveSpanAttributes, type SpanAttributesInput } from "./attributes.js";

export type LambdaHandler<TEvent = unknown, TResult = unknown, TContext = unknown> = (
  event: TEvent,
  context?: TContext,
) => Promise<TResult>;

export interface WrapLambdaHandlerOptions<TEvent, TResult, TContext = unknown> {
  attributes?: (event: TEvent, context: unknown) => SpanAttributesInput;
  handler: LambdaHandler<TEvent, TResult, TContext>;
  serviceName: string;
  spanName?: string | ((event: TEvent, context: unknown) => string);
}

interface TelemetryRuntimeState {
  enabled: boolean;
  forceFlush: () => Promise<void>;
  initialized: boolean;
  serviceName: string | null;
  shutdown: () => Promise<void>;
}

let runtimeState: TelemetryRuntimeState = {
  enabled: false,
  forceFlush: async () => {},
  initialized: false,
  serviceName: null,
  shutdown: async () => {},
};

let flushTelemetryOverride: (() => Promise<void>) | null = null;
const TELEMETRY_FLUSH_TIMEOUT_MS = 3500;

function buildSpanName<TEvent>(
  value: string | ((event: TEvent, context: unknown) => string) | undefined,
  event: TEvent,
  context: unknown,
  fallback: string,
): string {
  if (typeof value === "function") {
    return value(event, context);
  }

  return value ?? fallback;
}

export async function resetTelemetryForTesting(): Promise<void> {
  await runtimeState.shutdown();
  flushTelemetryOverride = null;
  runtimeState = {
    enabled: false,
    forceFlush: async () => {},
    initialized: false,
    serviceName: null,
    shutdown: async () => {},
  };
  setCurrentTelemetryState({ enabled: false, serviceName: null });
}

export function setFlushTelemetryOverrideForTesting(
  override: (() => Promise<void>) | null,
): void {
  flushTelemetryOverride = override;
}

export function initializeTelemetry(serviceName: string): void {
  if (runtimeState.initialized) {
    return;
  }

  const config = getHoneycombConfig();
  runtimeState.initialized = true;
  runtimeState.serviceName = serviceName;

  if (!config.enabled) {
    runtimeState.enabled = false;
    setCurrentTelemetryState({ enabled: false, serviceName });
    return;
  }

  const provider = new NodeTracerProvider({
    resource: resourceFromAttributes({
      "cloud.region": process.env.AWS_REGION ?? "ap-southeast-2",
      "deployment.environment.name": config.stage,
      "service.name": serviceName,
      "service.namespace": "prontiq",
    }),
    spanProcessors: [
      new BatchSpanProcessor(
        new OTLPTraceExporter({
          headers: {
            "x-honeycomb-team": config.apiKey,
          },
          url: config.tracesUrl,
        }),
        {
          exportTimeoutMillis: 3000,
          maxExportBatchSize: 32,
          scheduledDelayMillis: 200,
        },
      ),
    ],
  });

  provider.register({
    contextManager: new AsyncLocalStorageContextManager(),
  });

  registerInstrumentations({
    instrumentations: [new AwsInstrumentation(), new HttpInstrumentation()],
    tracerProvider: provider,
  });

  runtimeState.enabled = true;
  runtimeState.forceFlush = () => provider.forceFlush();
  runtimeState.shutdown = () => provider.shutdown();
  setCurrentTelemetryState({ enabled: true, serviceName });
}

async function flushTelemetry(): Promise<void> {
  if (flushTelemetryOverride) {
    await flushTelemetryOverride();
    return;
  }
  await runtimeState.forceFlush();
}

function writeTelemetryFailureLog(event: string, details: Record<string, unknown>): void {
  process.stderr.write(
    `${JSON.stringify({
      event,
      level: "error",
      service: "prontiq-observability",
      ...details,
    })}\n`,
  );
}

async function flushTelemetryBestEffort(serviceName: string, spanName: string): Promise<void> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      flushTelemetry(),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          reject(new Error(`telemetry forceFlush timed out after ${TELEMETRY_FLUSH_TIMEOUT_MS}ms`));
        }, TELEMETRY_FLUSH_TIMEOUT_MS);
      }),
    ]);
  } catch (error) {
    writeTelemetryFailureLog("telemetry.flush_failed", {
      error: error instanceof Error ? error.message : String(error),
      service_name: serviceName,
      span_name: spanName,
    });
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

export async function withActiveSpan<T>(
  name: string,
  attributes: SpanAttributesInput,
  fn: () => Promise<T>,
): Promise<T> {
  const tracer = trace.getTracer("prontiq-observability");
  const span = tracer.startSpan(name, {
    attributes: sanitizeSpanAttributes(attributes),
    kind: SpanKind.INTERNAL,
  });

  return otelContext.with(trace.setSpan(otelContext.active(), span), async () => {
    try {
      const result = await fn();
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      if (error instanceof Error) {
        span.recordException(error);
      }
      span.setStatus({ code: SpanStatusCode.ERROR });
      throw error;
    } finally {
      span.end();
    }
  });
}

export function wrapLambdaHandler<TEvent, TResult, TContext = unknown>(
  options: WrapLambdaHandlerOptions<TEvent, TResult, TContext>,
): LambdaHandler<TEvent, TResult, TContext> {
  return async function wrappedHandler(event: TEvent, context?: TContext): Promise<TResult> {
    initializeTelemetry(options.serviceName);
    const tracer = trace.getTracer(options.serviceName);
    const spanName = buildSpanName(options.spanName, event, context, `${options.serviceName}.invoke`);
    const span = tracer.startSpan(spanName, { kind: SpanKind.SERVER });

    return otelContext.with(trace.setSpan(otelContext.active(), span), async () => {
      let result: TResult | undefined;
      let thrownError: unknown;

      try {
        if (options.attributes) {
          setActiveSpanAttributes(span, options.attributes(event, context));
        }

        result = await options.handler(event, context);
        span.setStatus({ code: SpanStatusCode.OK });
      } catch (error) {
        thrownError = error;
        if (error instanceof Error) {
          span.recordException(error);
        }
        span.setStatus({ code: SpanStatusCode.ERROR });
      } finally {
        span.end();
        await flushTelemetryBestEffort(options.serviceName, spanName);
      }

      if (thrownError !== undefined) {
        throw thrownError;
      }

      return result as TResult;
    });
  };
}
