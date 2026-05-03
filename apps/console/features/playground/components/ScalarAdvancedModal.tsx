"use client";

import { useState } from "react";
import dynamic from "next/dynamic";

import type { PlaygroundOperation } from "../types.js";
import { Button } from "../../../components/ui/button.js";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../components/ui/card.js";

const ScalarClientAdapter = dynamic(
  () => import("./ScalarClientAdapter.js").then((module) => module.ScalarClientAdapter),
  { ssr: false },
);

export function ScalarAdvancedModal({
  baseUrl,
  operation,
}: {
  baseUrl: string;
  operation: PlaygroundOperation;
}) {
  const [isLoaded, setIsLoaded] = useState(false);

  return (
    <Card className="bg-card/80">
      <CardHeader>
        <CardTitle className="text-base">Advanced client</CardTitle>
        <CardDescription>
          Scalar is isolated as a spec-driven workbench. Do not enter raw keys here unless the
          credential-persistence gate has been re-run for the installed version.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoaded ? (
          <ScalarClientAdapter baseUrl={baseUrl} operation={operation} />
        ) : (
          <Button type="button" variant="outline" onClick={() => setIsLoaded(true)}>
            Load Scalar workbench
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
