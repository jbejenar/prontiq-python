import type { PlaygroundMode, PlaygroundOperation, PlaygroundRequestConfig } from "../types.js";
import { buildCurlCommand } from "./curl.js";
import { buildPublicApiUrl, PlaygroundRequestError } from "./request.js";

export const playgroundSnippetLanguages = ["curl", "node.js", "python", "java", "go", "ruby"] as const;

export type PlaygroundSnippetLanguage = (typeof playgroundSnippetLanguages)[number];

type HttpsnippetConstructor = new (source: unknown) => {
  convert(target: string, client?: string, options?: { indent?: string }): false | string;
};

type HarHeader = Readonly<{ name: string; value: string }>;

type HarPostData = Readonly<{
  mimeType: "application/json";
  text: string;
}>;

type HarRequest = Readonly<{
  headers: readonly HarHeader[];
  method: string;
  postData?: HarPostData;
  url: string;
}>;

const targetByLanguage = {
  "node.js": { client: "fetch", target: "javascript" },
  python: { client: "requests", target: "python" },
  java: { client: "nethttp", target: "java" },
  go: { client: "native", target: "go" },
  ruby: { client: "native", target: "ruby" },
} as const satisfies Record<Exclude<PlaygroundSnippetLanguage, "curl">, { client: string; target: string }>;

let httpsnippetConstructorPromise: Promise<HttpsnippetConstructor> | null = null;

export function getSnippetPrismLanguage(language: PlaygroundSnippetLanguage) {
  if (language === "curl") return "bash";
  if (language === "node.js") return "javascript";
  return language;
}

export function buildPlaygroundSnippetHarRequest(options: {
  baseUrl: string;
  config: PlaygroundRequestConfig;
  operation: PlaygroundOperation;
}): HarRequest {
  const bodyText = getValidJsonBody(options.operation, options.config);
  return {
    headers: [
      { name: "Accept", value: "application/json" },
      { name: "X-Api-Key", value: "{{YOUR_API_KEY}}" },
      ...(bodyText ? [{ name: "Content-Type", value: "application/json" }] : []),
    ],
    method: options.operation.method,
    ...(bodyText ? { postData: { mimeType: "application/json", text: bodyText } } : {}),
    url: buildPublicApiUrl(options.baseUrl, options.operation, options.config),
  };
}

export async function generatePlaygroundSnippet(options: {
  apiKey?: string;
  baseUrl: string;
  config: PlaygroundRequestConfig;
  language: PlaygroundSnippetLanguage;
  mode: PlaygroundMode;
  operation: PlaygroundOperation;
}) {
  if (options.language === "curl") {
    return buildCurlCommand({
      apiKey: options.apiKey,
      baseUrl: options.baseUrl,
      config: options.config,
      includeRealKey: false,
      mode: options.mode,
      operation: options.operation,
    });
  }

  const HTTPSnippet = await loadHttpsnippetConstructor();
  const harRequest = buildPlaygroundSnippetHarRequest(options);
  const mapping = targetByLanguage[options.language];
  const converted = new HTTPSnippet(harRequest).convert(mapping.target, mapping.client, {
    indent: "  ",
  });

  if (!converted) {
    throw new PlaygroundRequestError(`Could not generate ${options.language} snippet.`, {
      code: "SNIPPET_GENERATION_FAILED",
    });
  }

  return compactSnippetWhitespace(converted);
}

export function compactSnippetWhitespace(snippet: string) {
  return snippet.replace(/\n[ \t]*\n(?:[ \t]*\n)+/g, "\n\n");
}

async function loadHttpsnippetConstructor(): Promise<HttpsnippetConstructor> {
  httpsnippetConstructorPromise ??= import("@httptoolkit/httpsnippet").then((module) => {
    if (typeof module === "function") return module;
    if (isObject(module) && "default" in module && typeof module.default === "function") {
      return module.default as HttpsnippetConstructor;
    }
    throw new PlaygroundRequestError("The snippet generator could not be loaded.", {
      code: "SNIPPET_GENERATOR_LOAD_FAILED",
    });
  });

  return httpsnippetConstructorPromise;
}

function getValidJsonBody(
  operation: PlaygroundOperation,
  config: PlaygroundRequestConfig,
): string | undefined {
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

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
