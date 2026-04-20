import {
  initializeTelemetry,
  type LambdaHandler,
} from "./lambda.js";

export interface CreateTelemetryBootstrapHandlerOptions<
  TEvent = unknown,
  TResult = unknown,
  TContext = unknown,
> {
  loadHandler: () => Promise<LambdaHandler<TEvent, TResult, TContext>>;
  serviceName: string;
}

export function createTelemetryBootstrapHandler<
  TEvent = unknown,
  TResult = unknown,
  TContext = unknown,
>(
  options: CreateTelemetryBootstrapHandlerOptions<TEvent, TResult, TContext>,
): LambdaHandler<TEvent, TResult, TContext> {
  let cachedHandler: LambdaHandler<TEvent, TResult, TContext> | undefined;
  let handlerPromise: Promise<LambdaHandler<TEvent, TResult, TContext>> | undefined;

  async function getHandler(): Promise<LambdaHandler<TEvent, TResult, TContext>> {
    if (cachedHandler) {
      return cachedHandler;
    }

    if (!handlerPromise) {
      initializeTelemetry(options.serviceName);
      handlerPromise = Promise.resolve(options.loadHandler())
        .then((handler) => {
          cachedHandler = handler;
          return handler;
        })
        .catch((error) => {
          handlerPromise = undefined;
          throw error;
        });
    }

    return handlerPromise;
  }

  return async function bootstrappedHandler(event: TEvent, context?: TContext): Promise<TResult> {
    const handler = await getHandler();
    return handler(event, context);
  };
}
