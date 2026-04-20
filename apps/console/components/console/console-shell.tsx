"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import {
  Activity,
  Gauge,
  KeyRound,
  Menu,
  PlaySquare,
  ReceiptText,
  ShieldAlert,
  SquareTerminal,
} from "lucide-react";

import { UserControls } from "./user-controls.js";
import { Badge } from "../ui/badge.js";
import { Button } from "../ui/button.js";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card.js";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "../ui/sheet.js";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table.js";
import { env } from "../../lib/env.js";

const navGroups = [
  {
    label: "Console",
    items: [
      { href: "#overview", icon: Gauge, label: "Overview" },
      { href: "#keys", icon: KeyRound, label: "Keys" },
      { href: "#usage", icon: Activity, label: "Usage" },
      { href: "#billing", icon: ReceiptText, label: "Billing" },
      { href: "#playground", icon: PlaySquare, label: "Playground" },
      { href: "#danger-zone", icon: ShieldAlert, label: "Danger Zone" },
    ],
  },
];

const navTargets = new Set(navGroups.flatMap((group) => group.items.map((item) => item.href.replace(/^#/, ""))));

const statCards = [
  { label: "Plan", value: "Free", detail: "Credits-based onboarding shell" },
  { label: "Usage", value: "4,200 / 10,000", detail: "Static placeholder until P1C.02" },
  { label: "Keys", value: "1 active", detail: "Key management lands in P1C.03" },
];

const tableRows = [
  { endpoint: "/v1/address/autocomplete", auth: "X-Api-Key", status: "Live" },
  { endpoint: "/v1/address/validate", auth: "X-Api-Key", status: "Live" },
  { endpoint: "/v1/account/setup", auth: "Clerk JWT", status: "Live" },
];

function ConsoleNav() {
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
            {group.items.map((item) => (
              <Link
                className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm transition ${
                  item.href === "#overview"
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-accent/10 hover:text-accent"
                }`}
                href={item.href}
                key={item.label}
              >
                <item.icon className="h-4 w-4" />
                <span>{item.label}</span>
              </Link>
            ))}
          </nav>
        </div>
      ))}
      <div className="mt-auto rounded-lg border border-border bg-card/60 p-4 text-xs leading-6 text-muted-foreground">
        <p>UI shell extracted from the canonical console prototype.</p>
        <p>Live data, TanStack Query, and key management land in later tickets.</p>
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
            <div className="space-y-8">
              <section className="flex scroll-mt-24 flex-col gap-4 lg:flex-row lg:items-end lg:justify-between" id="overview">
                <div className="space-y-3">
                  <Badge>p1c.07</Badge>
                  <div>
                    <h1 className="text-5xl leading-none tracking-tight sm:text-6xl">Overview</h1>
                    <p className="mt-4 max-w-2xl text-sm leading-6 text-muted-foreground">
                      This is the real console shell and Clerk boundary. Live dashboard data, onboarding state, and key actions come in `P1C.02` and `P1C.03`.
                    </p>
                  </div>
                </div>
                <Card className="w-full max-w-sm bg-card/80">
                  <CardHeader>
                    <CardDescription>API host</CardDescription>
                    <CardTitle className="text-2xl">{env.NEXT_PUBLIC_API_URL}</CardTitle>
                  </CardHeader>
                </Card>
              </section>

              <section className="grid gap-4 xl:grid-cols-3">
                {statCards.map((card) => (
                  <Card key={card.label}>
                    <CardHeader>
                      <CardDescription>{card.label}</CardDescription>
                      <CardTitle className="text-4xl">{card.value}</CardTitle>
                    </CardHeader>
                    <CardContent className="text-sm text-muted-foreground">{card.detail}</CardContent>
                  </Card>
                ))}
              </section>

              {children}

              <section className="grid gap-4 xl:grid-cols-3">
                <Card className="scroll-mt-24" id="keys">
                  <CardHeader>
                    <CardDescription>Keys</CardDescription>
                    <CardTitle className="text-3xl">Key display pattern</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="rounded-lg border border-border bg-background/70 p-4 text-sm text-muted-foreground">
                      Static shell data only in this ticket. The real masked/reveal/copy flow is `P1C.03`.
                    </div>
                    <div className="flex flex-wrap gap-3">
                      <Button type="button">Primary action</Button>
                      <Button type="button" variant="outline">
                        Secondary
                      </Button>
                    </div>
                  </CardContent>
                </Card>

                <Card className="scroll-mt-24" id="usage">
                  <CardHeader>
                    <CardDescription>Usage</CardDescription>
                    <CardTitle className="text-3xl">Consumption snapshot</CardTitle>
                  </CardHeader>
                  <CardContent className="text-sm leading-6 text-muted-foreground">
                    Static usage placeholders land here until `P1C.02` wires real dashboard reads and quota progress.
                  </CardContent>
                </Card>

                <Card className="scroll-mt-24" id="billing">
                  <CardHeader>
                    <CardDescription>Billing</CardDescription>
                    <CardTitle className="text-3xl">Plan + invoice posture</CardTitle>
                  </CardHeader>
                  <CardContent className="text-sm leading-6 text-muted-foreground">
                    Billing actions remain read-only in this shell. Real plan and invoice surfaces come in later console tickets.
                  </CardContent>
                </Card>
              </section>

              <section className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
                <Card className="scroll-mt-24" id="playground">
                  <CardHeader>
                    <CardTitle>Quickstart shape</CardTitle>
                    <CardDescription>
                      Prototype-derived panel language, ready for the real account, usage, and key surfaces.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Endpoint</TableHead>
                          <TableHead>Auth</TableHead>
                          <TableHead>Status</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {tableRows.map((row) => (
                          <TableRow key={row.endpoint}>
                            <TableCell className="font-medium">{row.endpoint}</TableCell>
                            <TableCell>{row.auth}</TableCell>
                            <TableCell>
                              <Badge variant="secondary">{row.status}</Badge>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>

                <Card className="scroll-mt-24" id="danger-zone">
                  <CardHeader>
                    <CardDescription>Danger Zone</CardDescription>
                    <CardTitle className="text-3xl">Protected destructive actions</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="rounded-lg border border-border bg-background/70 p-4 text-sm text-muted-foreground">
                      This section is intentionally non-destructive in `P1C.07`. Key revocation, member removal, and account teardown stay deferred until their real flows exist.
                    </div>
                  </CardContent>
                </Card>
              </section>
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}

export function getConsoleNavTargets() {
  return navTargets;
}
