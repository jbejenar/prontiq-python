"use client";

import type { OpenApiParameter, PlaygroundOperation, PlaygroundRequestConfig } from "../types.js";
import { Input } from "../../../components/ui/input.js";

function exampleToString(value: unknown) {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

export function makeInitialRequestConfig(operation: PlaygroundOperation): PlaygroundRequestConfig {
  const pathParams: Record<string, string> = {};
  const queryParams: Record<string, string> = {};
  for (const parameter of operation.parameters) {
    if (parameter.in === "path") pathParams[parameter.name] = exampleToString(parameter.example);
    if (parameter.in === "query") queryParams[parameter.name] = exampleToString(parameter.example);
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
  const headerParameters = operation.parameters.filter((parameter) => parameter.in === "header");

  return (
    <div className="space-y-4">
      <ParameterSection
        parameters={pathParameters}
        title="Path"
        values={config.pathParams}
        onChange={(name, value) =>
          onConfigChange({
            ...config,
            pathParams: { ...config.pathParams, [name]: value },
          })
        }
      />
      <ParameterSection
        parameters={queryParameters}
        title="Query"
        values={config.queryParams}
        onChange={(name, value) =>
          onConfigChange({
            ...config,
            queryParams: { ...config.queryParams, [name]: value },
          })
        }
      />
      {headerParameters.length > 0 ? (
        <ParameterSection
          parameters={headerParameters}
          readOnly
          title="Header"
          values={{}}
          onChange={() => undefined}
        />
      ) : null}

      {operation.hasJsonRequestBody ? (
        <label className="grid gap-2 md:grid-cols-[110px_minmax(0,1fr)] md:items-start">
          <span className="pt-1 font-mono text-[11px] text-foreground">body</span>
          <textarea
            className="min-h-[96px] w-full rounded-[5px] border border-border bg-background px-2 py-2 font-mono text-[12px] text-foreground outline-none transition focus-visible:ring-2 focus-visible:ring-ring"
            spellCheck={false}
            value={config.bodyText}
            onChange={(event) => onConfigChange({ ...config, bodyText: event.target.value })}
          />
        </label>
      ) : null}
    </div>
  );
}

function ParameterSection({
  parameters,
  readOnly = false,
  title,
  values,
  onChange,
}: {
  parameters: OpenApiParameter[];
  readOnly?: boolean;
  title: string;
  values: Record<string, string>;
  onChange: (name: string, value: string) => void;
}) {
  if (parameters.length === 0) return null;

  return (
    <section className="space-y-2">
      <div className="font-mono text-[10px] font-medium uppercase tracking-[0.06em] text-muted-2">
        {title}
      </div>
      <div className="space-y-2">
        {parameters.map((parameter) => (
          <label
            className="grid gap-2 md:grid-cols-[110px_minmax(0,1fr)] md:items-center"
            key={`${parameter.in}-${parameter.name}`}
          >
            <span className="flex items-center gap-1.5 font-mono text-[11px] text-foreground">
              {parameter.name}
              {parameter.required ? (
                <span aria-label="required" className="h-1 w-1 rounded-full bg-destructive" />
              ) : null}
            </span>
            <Input
              className="h-7 rounded-[5px] px-2 font-mono text-[12px]"
              disabled={readOnly}
              placeholder={readOnly ? "Header parameters are not forwarded in playground v1" : undefined}
              value={readOnly ? "" : (values[parameter.name] ?? "")}
              onChange={(event) => onChange(parameter.name, event.target.value)}
            />
          </label>
        ))}
      </div>
    </section>
  );
}
