"use client";

import "@prontiq/web-component";

import { useEffect, useRef, useState } from "react";
import type { AddressSuggestion } from "@prontiq/web-component";

import { Badge } from "../ui/badge.js";
import { MetricCard } from "./metric-card.js";

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
    <MetricCard heading={kicker} meta="live · landing-side proxy">
      <div className="space-y-4">
        <div className="space-y-1.5">
          <h2 className="font-display text-2xl leading-tight tracking-tight text-foreground sm:text-3xl">
            {heading}
          </h2>
          <p className="text-xs leading-6 text-muted-foreground sm:text-sm">
            Powered by the real autocomplete API through a constrained landing proxy. No client-side
            API key exposure.
          </p>
        </div>
        <div className="rounded-md border border-border bg-background/80 p-4">
          <Badge className="mb-3" variant="outline">
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
        <div className="rounded-md border border-dashed border-border-strong bg-background/40 p-4">
          <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            {resultHeading}
          </p>
          <pre className="mt-2 overflow-x-auto whitespace-pre-wrap text-xs leading-6 text-foreground sm:text-sm">
            {selectedSuggestion
              ? JSON.stringify(selectedSuggestion, null, 2)
              : "Choose a suggestion to inspect the structured payload returned by the widget."}
          </pre>
        </div>
      </div>
    </MetricCard>
  );
}
