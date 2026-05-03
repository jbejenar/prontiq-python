import type { PlaygroundOperation, PlaygroundRequestConfig } from "../types.js";
import { buildPublicApiUrl } from "./request.js";

export interface DemoProxyPayload {
  bodyText: string;
  method: string;
  path: string;
  pathParams: Record<string, string>;
  queryParams: Record<string, string>;
}

export interface DemoProxyValidationError {
  code:
    | "DEMO_REQUEST_TOO_LARGE"
    | "MISSING_DEMO_PARAMETER"
    | "UNDECLARED_DEMO_PARAMETER"
    | "UNSUPPORTED_DEMO_PARAMETER_LOCATION";
  message: string;
}

const MAX_DEMO_BODY_BYTES = 16_384;
const MAX_DEMO_PARAM_BYTES = 2_048;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return (
    isRecord(value) &&
    Object.values(value).every((item) => typeof item === "string")
  );
}

const DEMO_PROXY_PAYLOAD_KEYS = new Set([
  "bodyText",
  "method",
  "path",
  "pathParams",
  "queryParams",
]);

export function parseDemoProxyPayload(value: unknown): DemoProxyPayload | null {
  if (!isRecord(value)) return null;
  if (!Object.keys(value).every((key) => DEMO_PROXY_PAYLOAD_KEYS.has(key))) return null;
  if (
    typeof value.bodyText !== "string" ||
    typeof value.method !== "string" ||
    typeof value.path !== "string" ||
    !isStringRecord(value.pathParams) ||
    !isStringRecord(value.queryParams)
  ) {
    return null;
  }
  return {
    bodyText: value.bodyText,
    method: value.method.toUpperCase(),
    path: value.path,
    pathParams: value.pathParams,
    queryParams: value.queryParams,
  };
}

export function assertSafeTemplatePath(path: string) {
  try {
    const lowerPath = path.toLowerCase();
    if (!path.startsWith("/v1/")) return false;
    if (path.startsWith("/v1/account/")) return false;
    if (path.includes("://") || path.startsWith("//")) return false;
    if (path.includes("..") || lowerPath.includes("%2e") || lowerPath.includes("%2f")) return false;
    return path === decodeURIComponent(new URL(path, "https://api.prontiq.dev").pathname);
  } catch {
    return false;
  }
}

function templateParameterNames(path: string) {
  return [...path.matchAll(/\{([^}]+)\}/g)]
    .map((match) => match[1])
    .filter((name): name is string => typeof name === "string" && name.length > 0);
}

function declaredParameterNames(
  operation: PlaygroundOperation,
  location: "path" | "query",
) {
  return new Set(
    operation.parameters
      .filter((parameter) => parameter.in === location)
      .map((parameter) => parameter.name),
  );
}

function findUndeclaredParameter(
  supplied: Record<string, string>,
  declared: Set<string>,
) {
  return Object.keys(supplied).find((name) => !declared.has(name));
}

function encodedLength(value: string) {
  return new TextEncoder().encode(value).length;
}

function findOversizedParameter(values: Record<string, string>) {
  return Object.entries(values).find(
    ([name, value]) => encodedLength(name) > MAX_DEMO_PARAM_BYTES || encodedLength(value) > MAX_DEMO_PARAM_BYTES,
  );
}

export function validateDemoProxyPayloadForOperation(
  operation: PlaygroundOperation,
  payload: DemoProxyPayload,
): DemoProxyValidationError | null {
  if (encodedLength(payload.bodyText) > MAX_DEMO_BODY_BYTES) {
    return {
      code: "DEMO_REQUEST_TOO_LARGE",
      message: "Demo request body is too large.",
    };
  }
  const oversizedPath = findOversizedParameter(payload.pathParams);
  if (oversizedPath) {
    return {
      code: "DEMO_REQUEST_TOO_LARGE",
      message: `Path parameter ${oversizedPath[0]} is too large.`,
    };
  }
  const oversizedQuery = findOversizedParameter(payload.queryParams);
  if (oversizedQuery) {
    return {
      code: "DEMO_REQUEST_TOO_LARGE",
      message: `Query parameter ${oversizedQuery[0]} is too large.`,
    };
  }

  if (operation.parameters.some((parameter) => parameter.in === "header" || parameter.in === "cookie")) {
    return {
      code: "UNSUPPORTED_DEMO_PARAMETER_LOCATION",
      message: "Demo mode supports path and query parameters only.",
    };
  }

  const declaredPathParams = declaredParameterNames(operation, "path");
  for (const templateName of templateParameterNames(operation.path)) {
    declaredPathParams.add(templateName);
  }
  const undeclaredPath = findUndeclaredParameter(payload.pathParams, declaredPathParams);
  if (undeclaredPath) {
    return {
      code: "UNDECLARED_DEMO_PARAMETER",
      message: `Path parameter ${undeclaredPath} is not declared for this operation.`,
    };
  }

  const declaredQueryParams = declaredParameterNames(operation, "query");
  const undeclaredQuery = findUndeclaredParameter(payload.queryParams, declaredQueryParams);
  if (undeclaredQuery) {
    return {
      code: "UNDECLARED_DEMO_PARAMETER",
      message: `Query parameter ${undeclaredQuery} is not declared for this operation.`,
    };
  }

  for (const parameter of operation.parameters) {
    if (!parameter.required || (parameter.in !== "path" && parameter.in !== "query")) continue;
    const source = parameter.in === "path" ? payload.pathParams : payload.queryParams;
    if (!source[parameter.name]?.trim()) {
      return {
        code: "MISSING_DEMO_PARAMETER",
        message: `${parameter.in} parameter ${parameter.name} is required.`,
      };
    }
  }

  for (const templateName of templateParameterNames(operation.path)) {
    if (!payload.pathParams[templateName]?.trim()) {
      return {
        code: "MISSING_DEMO_PARAMETER",
        message: `path parameter ${templateName} is required.`,
      };
    }
  }

  return null;
}

export function buildDemoUpstreamRequest(options: {
  apiBaseUrl: string;
  demoApiKey: string;
  operation: PlaygroundOperation;
  payload: DemoProxyPayload;
}): { body?: string; headers: HeadersInit; method: string; url: string } {
  const config: PlaygroundRequestConfig = {
    bodyText: options.payload.bodyText,
    pathParams: options.payload.pathParams,
    queryParams: options.payload.queryParams,
  };
  const body = options.operation.hasJsonRequestBody ? options.payload.bodyText.trim() : "";
  if (body) JSON.parse(body);
  return {
    url: buildPublicApiUrl(options.apiBaseUrl, options.operation, config),
    method: options.operation.method,
    headers: {
      Accept: "application/json",
      "X-Api-Key": options.demoApiKey,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body } : {}),
  };
}
