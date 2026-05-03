"use client";

import { KeyRound, X } from "lucide-react";

import { Button } from "../../../components/ui/button.js";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../components/ui/card.js";
import { Input } from "../../../components/ui/input.js";

export function ApiKeyEntryPanel({
  apiKey,
  onApiKeyChange,
  onClear,
}: {
  apiKey: string;
  onApiKeyChange: (value: string) => void;
  onClear: () => void;
}) {
  return (
    <Card className="bg-card/80">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <KeyRound className="h-4 w-4" />
          API key
        </CardTitle>
        <CardDescription>
          Stored in memory only. It clears on sign-out, org switch, or manual clear.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex gap-2">
        <Input
          autoComplete="off"
          placeholder="pq_live_..."
          type="password"
          value={apiKey}
          onChange={(event) => onApiKeyChange(event.target.value)}
        />
        <Button type="button" variant="outline" onClick={onClear}>
          <X className="h-4 w-4" />
          Clear
        </Button>
      </CardContent>
    </Card>
  );
}
