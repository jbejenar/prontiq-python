import type { Metadata } from "next";
import type { ReactNode } from "react";

import "@prontiq/tokens/tokens.css";
import "./globals.css";

import { ThemeProvider } from "../lib/theme-provider.js";

export const metadata: Metadata = {
  title: "Prontiq",
  description: "Australian address validation for developers.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
