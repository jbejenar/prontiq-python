type LogLevel = "debug" | "error" | "info" | "log" | "warn";

type LogValue = Record<string, unknown> | undefined;

function serializeError(error: Error): Record<string, unknown> {
  return {
    error_message: error.message,
    error_name: error.name,
    ...(error.stack ? { stack: error.stack } : {}),
  };
}

function normalizeLogValue(value: unknown): unknown {
  if (value instanceof Error) {
    return serializeError(value);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeLogValue(entry));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, normalizeLogValue(entry)]),
    );
  }
  return value;
}

function normalizeArgs(args: unknown[]): { message: string; extra: LogValue } {
  const [first, ...rest] = args;
  if (typeof first === "string") {
    if (rest.length === 0) {
      return { message: first, extra: undefined };
    }
    if (rest.length === 1 && rest[0] && typeof rest[0] === "object" && !Array.isArray(rest[0])) {
      return { message: first, extra: normalizeLogValue(rest[0]) as Record<string, unknown> };
    }
    return {
      message: first,
      extra: {
        args: rest.map((value) => normalizeLogValue(value)),
      },
    };
  }

  return {
    message: "log",
    extra: {
      args: args.map((value) => normalizeLogValue(value)),
    },
  };
}

function emit(level: LogLevel, service: string, args: unknown[]): void {
  const { message, extra } = normalizeArgs(args);
  const payload = {
    ...(extra ?? {}),
    level,
    message,
    service,
  };
  const line = JSON.stringify(payload);
  if (level === "error") {
    console.error(line);
    return;
  }
  if (level === "warn") {
    console.warn(line);
    return;
  }
  if (level === "debug") {
    console.debug(line);
    return;
  }
  if (level === "info") {
    console.info(line);
    return;
  }
  console.log(line);
}

export type AppLogger = Pick<Console, "debug" | "error" | "info" | "log" | "warn">;

export function createLogger(service: string): AppLogger {
  return {
    debug: (...args: unknown[]) => emit("debug", service, args),
    error: (...args: unknown[]) => emit("error", service, args),
    info: (...args: unknown[]) => emit("info", service, args),
    log: (...args: unknown[]) => emit("log", service, args),
    warn: (...args: unknown[]) => emit("warn", service, args),
  };
}
