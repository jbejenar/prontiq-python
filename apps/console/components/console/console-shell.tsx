"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, Gauge, KeyRound, Menu, PlaySquare, ReceiptText, ShieldAlert, SquareTerminal } from "lucide-react";

import { UserControls } from "./user-controls.js";
import { Badge } from "../ui/badge.js";
import { Button } from "../ui/button.js";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "../ui/sheet.js";

const navGroups = [
  {
    label: "Console",
    items: [
      { href: "#overview", icon: Gauge, label: "Overview" },
      { href: "/keys", icon: KeyRound, label: "Keys" },
      { href: "/usage", icon: Activity, label: "Usage" },
      { href: "/billing", icon: ReceiptText, label: "Billing" },
      { href: "/playground", icon: PlaySquare, label: "Playground" },
      { href: "#danger-zone", icon: ShieldAlert, label: "Danger Zone" },
    ],
  },
];

function getDashboardHref(target: string, pathname: string | null) {
  return pathname === "/" ? `#${target}` : `/#${target}`;
}

const navTargets = new Set(
  navGroups
    .flatMap((group) => group.items)
    .filter((item) => item.href.startsWith("#"))
    .map((item) => item.href.replace(/^#/, "")),
);

function ConsoleNav() {
  const pathname = usePathname();

  return (
    <div className="flex h-full flex-col gap-8">
      <div className="flex items-baseline gap-2">
        <span className="text-lg font-medium tracking-tight">prontiq</span>
        <span className="text-primary">.</span>
        <Badge variant="outline">console</Badge>
      </div>
      {navGroups.map((group) => (
        <div className="space-y-3" key={group.label}>
          <div className="px-2 text-xs uppercase tracking-[0.18em] text-muted-foreground">{group.label}</div>
          <nav className="space-y-1">
            {group.items.map((item) => {
              const isDashboardAnchor = item.href.startsWith("#");
              const target = item.href.replace(/^#/, "");
              const href = isDashboardAnchor ? getDashboardHref(target, pathname) : item.href;

              return (
                <Link
                  className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm transition ${
                    item.href === "#overview" && pathname === "/"
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:bg-accent/10 hover:text-accent"
                  }`}
                  href={href}
                  key={item.label}
                >
                  <item.icon className="h-4 w-4" />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </nav>
        </div>
      ))}
      <div className="mt-auto rounded-lg border border-border bg-card/60 p-4 text-xs leading-6 text-muted-foreground">
        <p>UI shell extracted from the canonical console prototype.</p>
        <p>Keys, usage, and billing now live on dedicated pages.</p>
      </div>
    </div>
  );
}

interface ConsoleShellProps {
  clerkEnabled: boolean;
  children?: ReactNode;
}

export function ConsoleShell({ clerkEnabled, children }: ConsoleShellProps) {
  return (
    <div className="min-h-screen bg-transparent">
      <div className="grid min-h-screen lg:grid-cols-[250px_1fr]">
        <aside className="hidden border-r border-border/80 bg-background/60 px-5 py-6 backdrop-blur lg:block">
          <ConsoleNav />
        </aside>

        <div className="flex min-h-screen flex-col">
          <header className="border-b border-border/80 px-5 py-4 sm:px-6 lg:px-8">
            <div className="flex items-center gap-3">
              <Sheet>
                <SheetTrigger asChild>
                  <Button className="lg:hidden" size="icon" type="button" variant="outline">
                    <Menu className="h-4 w-4" />
                  </Button>
                </SheetTrigger>
                <SheetContent className="w-[88vw] max-w-xs" side="left">
                  <SheetHeader>
                    <SheetTitle>Navigation</SheetTitle>
                  </SheetHeader>
                  <div className="mt-6 h-full">
                    <ConsoleNav />
                  </div>
                </SheetContent>
              </Sheet>

              <div>
                <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">console</div>
                <div className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
                  <SquareTerminal className="h-4 w-4 text-primary" />
                  <span className="text-foreground">Authenticated developer shell</span>
                </div>
              </div>

              <div className="ml-auto">
                <UserControls clerkEnabled={clerkEnabled} />
              </div>
            </div>
          </header>

          <main className="flex-1 px-5 py-8 sm:px-6 lg:px-8">
            <div className="space-y-8">{children}</div>
          </main>
        </div>
      </div>
    </div>
  );
}

export function getConsoleNavTargets() {
  return navTargets;
}
