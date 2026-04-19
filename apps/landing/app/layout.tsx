import type { Metadata } from "next";
import type { ReactNode } from "react";

import "@prontiq/tokens/tokens.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Prontiq",
  description: "Australian address validation for developers.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
