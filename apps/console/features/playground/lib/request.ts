import type { PlaygroundOperation, PlaygroundRequestConfig, PlaygroundResponse } from "../types.js";
import { filterSafeResponseHeaders } from "./safe-headers.js";

const DEFAULT_TIMEOUT_MS = 15_000;

export class PlaygroundRequestError extends Error {
  code: string;
  status?: number;

  constructor(message: string, options: { code: string; status?: number }) {
    super(message);
    this.name = "PlaygroundRequestError";
    this.code = options.code;
    if (options.status !== undefined) this.status = options.status;
  }
}

function encodePath(operation: PlaygroundOperation, config: PlaygroundRequestConfig) {
  return operation.path.replace(/\{([^}]+)\}/g, (_match, rawName: string) => {
    const value = config.pathParams[rawName];
    if (!value) {
      throw new PlaygroundRequestError(`Path parameter ${rawName} is required.`, {
        code: "MISSING_PATH_PARAMETER",
      });
    }
    return encodeURIComponent(value);
  });
}

export function buildPublicApiUrl(
  baseUrl: string,
  operation: PlaygroundOperation,
  config: PlaygroundRequestConfig,
) {
  const url = new URL(encodePath(operation, config), baseUrl);
  for (const [name, value] of Object.entries(config.queryParams)) {
    if (value.trim()) url.searchParams.set(name, value.trim());
  }
  return url.toString();
}

function getJsonBody(operation: PlaygroundOperation, config: PlaygroundRequestConfig) {
  if (!operation.hasJsonRequestBody) return undefined;
  const trimmed = config.bodyText.trim();
  if (!trimmed) return undefined;
  try {
    JSON.parse(trimmed);
  } catch {
    throw new PlaygroundRequestError("Request body must be valid JSON.", {
      code: "INVALID_JSON_BODY",
    });
  }
  return trimmed;
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<Response> {
  const controller = new AbortController();
  const abortFromCaller = () => controller.abort(signal?.reason);
  if (signal?.aborted) controller.abort(signal.reason);
  else signal?.addEventListener("abort", abortFromCaller, { once: true });
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new PlaygroundRequestError("The playground request timed out.", {
        code: "REQUEST_TIMEOUT",
      });
    }
    throw error;
  } finally {
    signal?.removeEventListener("abort", abortFromCaller);
    window.clearTimeout(timeout);
  }
}

export async function executeAccountRequest(options: {
  apiKey: string;
  baseUrl: string;
  config: PlaygroundRequestConfig;
  operation: PlaygroundOperation;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<PlaygroundResponse> {
  const body = getJsonBody(options.operation, options.config);
  const started = performance.now();
  const response = await fetchWithTimeout(
    buildPublicApiUrl(options.baseUrl, options.operation, options.config),
    {
      method: options.operation.method,
      headers: {
        Accept: "application/json",
        "X-Api-Key": options.apiKey,
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      ...(body !== undefined ? { body } : {}),
    },
    options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    options.signal,
  );
  return {
    bodyText: await response.text(),
    durationMs: Math.round(performance.now() - started),
    headers: filterSafeResponseHeaders(response.headers),
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
  };
}

export async function executeDemoRequest(options: {
  config: PlaygroundRequestConfig;
  operation: PlaygroundOperation;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<PlaygroundResponse> {
  const started = performance.now();
  const response = await fetchWithTimeout(
    "/api/playground/demo",
    {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({
        bodyText: options.config.bodyText,
        method: options.operation.method,
        path: options.operation.path,
        pathParams: options.config.pathParams,
        queryParams: options.config.queryParams,
      }),
    },
    options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    options.signal,
  );
  return {
    bodyText: await response.text(),
    durationMs: Math.round(performance.now() - started),
    headers: filterSafeResponseHeaders(response.headers),
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
  };
}
