"use client";

import type { PlaygroundResponse } from "../types.js";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../components/ui/card.js";

export function ResponseViewer({ response }: { response: PlaygroundResponse | null }) {
  return (
    <Card className="bg-card/80">
      <CardHeader>
        <CardTitle className="text-base">Response</CardTitle>
        <CardDescription>
          Shows status, safe headers, timing, and body. Sensitive infrastructure headers are hidden.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {!response ? (
          <div className="rounded-lg border border-border bg-background/70 p-4 text-sm text-muted-foreground">
            Send a request to see the response.
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2 text-sm">
              <span className={response.ok ? "text-primary" : "text-destructive"}>
                {response.status} {response.statusText}
              </span>
              <span className="text-muted-foreground">{response.durationMs}ms</span>
            </div>
            {Object.keys(response.headers).length > 0 ? (
              <pre className="overflow-auto rounded-lg border border-border bg-background/80 p-4 text-xs">
                {JSON.stringify(response.headers, null, 2)}
              </pre>
            ) : null}
            <pre className="max-h-96 overflow-auto rounded-lg border border-border bg-background/80 p-4 text-xs">
              {formatBody(response.bodyText)}
            </pre>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function formatBody(bodyText: string) {
  try {
    return JSON.stringify(JSON.parse(bodyText), null, 2);
  } catch {
    return bodyText || "(empty response)";
  }
}
