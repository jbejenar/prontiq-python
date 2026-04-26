import type * as React from "react";

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "prontiq-address": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
        "autocomplete-endpoint"?: string;
        limit?: number | string;
        placeholder?: string;
        state?: string;
      };
    }
  }
}

export {};
