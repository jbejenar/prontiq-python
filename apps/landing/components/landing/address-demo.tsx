"use client";

import "@prontiq/web-component";

import { useEffect, useRef, useState } from "react";
import type { AddressSuggestion } from "@prontiq/web-component";

import { Badge } from "../ui/badge.js";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card.js";

interface AddressDemoProps {
  autocompleteEndpoint: string;
  heading: string;
  inputLabel: string;
  kicker: string;
  limit: number;
  placeholder: string;
  resultHeading: string;
  stateFilter?: string;
}

export function AddressDemo({
  autocompleteEndpoint,
  heading,
  inputLabel,
  kicker,
  limit,
  placeholder,
  resultHeading,
  stateFilter,
}: AddressDemoProps) {
  const hostRef = useRef<HTMLElement | null>(null);
  const [selectedSuggestion, setSelectedSuggestion] = useState<AddressSuggestion | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) {
      return undefined;
    }

    function handleSelection(event: Event) {
      const customEvent = event as CustomEvent<AddressSuggestion>;
      setSelectedSuggestion(customEvent.detail);
    }

    function handleQueryChange(_event: Event) {
      setSelectedSuggestion(null);
    }

    host.addEventListener("select", handleSelection as EventListener);
    host.addEventListener("querychange", handleQueryChange as EventListener);
    return () => {
      host.removeEventListener("select", handleSelection as EventListener);
      host.removeEventListener("querychange", handleQueryChange as EventListener);
    };
  }, []);

  return (
    <Card className="border-primary/20 bg-card/85 shadow-[0_0_48px_hsl(var(--accent)/0.08)]">
      <CardHeader className="space-y-4">
        <div className="space-y-2">
          <p className="text-xs uppercase tracking-[0.3em] text-primary/80">{kicker}</p>
          <CardTitle className="text-3xl sm:text-4xl">{heading}</CardTitle>
          <CardDescription className="max-w-xl text-sm leading-6 sm:text-base">
            Powered by the real autocomplete API through a constrained landing proxy. No client-side API key exposure.
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-lg border border-border/80 bg-background/90 p-4">
          <Badge className="mb-4 w-fit" variant="outline">
            {inputLabel}
          </Badge>
          <prontiq-address
            autocomplete-endpoint={autocompleteEndpoint}
            limit={String(limit)}
            placeholder={placeholder}
            ref={hostRef}
            state={stateFilter}
          />
        </div>
        <div className="rounded-lg border border-dashed border-border/80 bg-background/60 p-4">
          <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">{resultHeading}</p>
          <pre className="mt-3 overflow-x-auto whitespace-pre-wrap text-sm leading-6 text-foreground">
            {selectedSuggestion
              ? JSON.stringify(selectedSuggestion, null, 2)
              : "Choose a suggestion to inspect the structured payload returned by the widget."}
          </pre>
        </div>
      </CardContent>
    </Card>
  );
}
