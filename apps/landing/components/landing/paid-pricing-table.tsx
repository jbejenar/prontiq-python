"use client";

import { useEffect } from "react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card.js";

declare global {
  interface Window {
    __prontiqStripePricingTableScript?: Promise<void>;
  }
}

function loadStripePricingTableScript() {
  if (typeof window === "undefined") {
    return Promise.resolve();
  }

  if (window.__prontiqStripePricingTableScript) {
    return window.__prontiqStripePricingTableScript;
  }

  const existingScript = document.querySelector<HTMLScriptElement>('script[data-prontiq-stripe-pricing-table="true"]');
  if (existingScript) {
    window.__prontiqStripePricingTableScript = Promise.resolve();
    return window.__prontiqStripePricingTableScript;
  }

  window.__prontiqStripePricingTableScript = new Promise((resolvePromise, rejectPromise) => {
    const script = document.createElement("script");
    script.async = true;
    script.src = "https://js.stripe.com/v3/pricing-table.js";
    script.dataset.prontiqStripePricingTable = "true";
    script.onload = () => resolvePromise();
    script.onerror = () => {
      window.__prontiqStripePricingTableScript = undefined;
      script.remove();
      rejectPromise(new Error("Failed to load Stripe pricing table script."));
    };
    document.head.appendChild(script);
  });

  return window.__prontiqStripePricingTableScript;
}

interface PaidPricingTableProps {
  pricingTableId?: string;
  publishableKey?: string;
}

export function PaidPricingTable({ pricingTableId, publishableKey }: PaidPricingTableProps) {
  useEffect(() => {
    if (!pricingTableId || !publishableKey) {
      return;
    }

    void loadStripePricingTableScript().catch(() => undefined);
  }, [pricingTableId, publishableKey]);

  if (!pricingTableId || !publishableKey) {
    return (
      <Card className="border-border/80 bg-card/75">
        <CardHeader>
          <CardTitle className="text-2xl">Stripe pricing unavailable</CardTitle>
          <CardDescription>
            Add `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` and `NEXT_PUBLIC_STRIPE_PRICING_TABLE_ID` to render the live paid-plan table.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card className="border-primary/20 bg-card/75">
      <CardHeader>
        <CardTitle className="text-2xl">Starter and Growth</CardTitle>
        <CardDescription>
          Paid plan pricing is rendered directly from Stripe so the landing page does not become a second pricing authority.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <stripe-pricing-table
          pricing-table-id={pricingTableId}
          publishable-key={publishableKey}
        />
      </CardContent>
    </Card>
  );
}
