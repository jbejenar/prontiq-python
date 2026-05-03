"use client";

import type { PlaygroundOperation } from "../types.js";
import { Badge } from "../../../components/ui/badge.js";
import { Button } from "../../../components/ui/button.js";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../components/ui/card.js";

export function EndpointGroupList({
  operations,
  selectedOperationId,
  onSelect,
}: {
  operations: PlaygroundOperation[];
  selectedOperationId: string | null;
  onSelect: (operation: PlaygroundOperation) => void;
}) {
  const groups = new Map<string, PlaygroundOperation[]>();
  for (const operation of operations) {
    groups.set(operation.tag, [...(groups.get(operation.tag) ?? []), operation]);
  }

  return (
    <div className="space-y-4">
      {[...groups.entries()].map(([tag, groupedOperations]) => (
        <section className="space-y-3" key={tag}>
          <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{tag}</div>
          <div className="grid gap-3">
            {groupedOperations.map((operation) => (
              <Card
                className={
                  selectedOperationId === operation.operationId
                    ? "border-primary/70 bg-primary/5"
                    : "bg-card/80"
                }
                key={operation.operationId}
              >
                <CardHeader className="pb-3">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">{operation.method}</Badge>
                    <CardTitle className="text-base">{operation.summary}</CardTitle>
                  </div>
                  <CardDescription className="font-mono text-xs">{operation.path}</CardDescription>
                </CardHeader>
                <CardContent className="flex items-center justify-between gap-3">
                  <p className="line-clamp-2 text-sm text-muted-foreground">
                    {operation.description ?? "Public API operation from the committed spec."}
                  </p>
                  <Button size="sm" type="button" onClick={() => onSelect(operation)}>
                    Select
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
