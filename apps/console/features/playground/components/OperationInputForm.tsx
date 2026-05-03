"use client";

import type { PlaygroundOperation, PlaygroundRequestConfig } from "../types.js";
import { Input } from "../../../components/ui/input.js";

export function makeInitialRequestConfig(operation: PlaygroundOperation): PlaygroundRequestConfig {
  const pathParams: Record<string, string> = {};
  const queryParams: Record<string, string> = {};
  for (const parameter of operation.parameters) {
    if (parameter.in === "path") pathParams[parameter.name] = "";
    if (parameter.in === "query") queryParams[parameter.name] = "";
  }
  return {
    pathParams,
    queryParams,
    bodyText:
      operation.requestBodyExample !== undefined
        ? JSON.stringify(operation.requestBodyExample, null, 2)
        : "",
  };
}

export function OperationInputForm({
  config,
  operation,
  onConfigChange,
}: {
  config: PlaygroundRequestConfig;
  operation: PlaygroundOperation;
  onConfigChange: (config: PlaygroundRequestConfig) => void;
}) {
  const pathParameters = operation.parameters.filter((parameter) => parameter.in === "path");
  const queryParameters = operation.parameters.filter((parameter) => parameter.in === "query");

  return (
    <div className="space-y-5">
      {pathParameters.length > 0 ? (
        <div className="space-y-3">
          <div className="text-sm font-medium">Path parameters</div>
          {pathParameters.map((parameter) => (
            <label className="block space-y-1" key={parameter.name}>
              <span className="text-xs text-muted-foreground">
                {parameter.name}
                {parameter.required ? " *" : ""}
              </span>
              <Input
                value={config.pathParams[parameter.name] ?? ""}
                onChange={(event) =>
                  onConfigChange({
                    ...config,
                    pathParams: { ...config.pathParams, [parameter.name]: event.target.value },
                  })
                }
              />
            </label>
          ))}
        </div>
      ) : null}

      {queryParameters.length > 0 ? (
        <div className="space-y-3">
          <div className="text-sm font-medium">Query parameters</div>
          {queryParameters.map((parameter) => (
            <label className="block space-y-1" key={parameter.name}>
              <span className="text-xs text-muted-foreground">
                {parameter.name}
                {parameter.required ? " *" : ""}
              </span>
              <Input
                value={config.queryParams[parameter.name] ?? ""}
                onChange={(event) =>
                  onConfigChange({
                    ...config,
                    queryParams: { ...config.queryParams, [parameter.name]: event.target.value },
                  })
                }
              />
            </label>
          ))}
        </div>
      ) : null}

      {operation.hasJsonRequestBody ? (
        <label className="block space-y-2">
          <span className="text-sm font-medium">JSON body</span>
          <textarea
            className="min-h-40 w-full rounded-md border border-border bg-background/80 p-3 font-mono text-sm outline-none focus:ring-2 focus:ring-primary/30"
            spellCheck={false}
            value={config.bodyText}
            onChange={(event) => onConfigChange({ ...config, bodyText: event.target.value })}
          />
        </label>
      ) : null}
    </div>
  );
}
