"use client";

import { useState } from "react";
import { Copy } from "lucide-react";
import { toast } from "sonner";

import type { PlaygroundMode, PlaygroundOperation, PlaygroundRequestConfig } from "../types.js";
import { buildCurlCommand } from "../lib/curl.js";
import { Button } from "../../../components/ui/button.js";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../components/ui/card.js";

export function CurlPreviewPanel({
  apiKey,
  baseUrl,
  config,
  mode,
  operation,
}: {
  apiKey: string;
  baseUrl: string;
  config: PlaygroundRequestConfig;
  mode: PlaygroundMode;
  operation: PlaygroundOperation;
}) {
  const [realKeyApprovedFor, setRealKeyApprovedFor] = useState<string | null>(null);
  const includeRealKey = mode === "account" && Boolean(apiKey) && realKeyApprovedFor === apiKey;
  const command = buildCurlCommand({ apiKey, baseUrl, config, includeRealKey, mode, operation });

  async function copyCommand() {
    await navigator.clipboard.writeText(command);
    toast.success("Copied curl command");
  }

  return (
    <Card className="bg-card/80">
      <CardHeader>
        <CardTitle className="text-base">Curl</CardTitle>
        <CardDescription>
          Demo curl is production-shaped and never uses the console proxy URL.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {mode === "account" && apiKey ? (
          <Button
            size="sm"
            type="button"
            variant={includeRealKey ? "default" : "outline"}
            onClick={() => setRealKeyApprovedFor((value) => (value === apiKey ? null : apiKey))}
          >
            {includeRealKey ? "Using real key in curl" : "Use real key in curl"}
          </Button>
        ) : null}
        <pre className="overflow-auto rounded-lg border border-border bg-background/80 p-4 text-xs">
          {command}
        </pre>
        <Button type="button" variant="outline" onClick={() => void copyCommand()}>
          <Copy className="h-4 w-4" />
          Copy curl
        </Button>
      </CardContent>
    </Card>
  );
}
