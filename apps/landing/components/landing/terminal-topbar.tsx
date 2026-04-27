"use client";

import Link from "next/link";

import type { SiteNav, SitePill, SiteTopbar } from "@prontiq/shared/content";

import { ThemeToggle } from "../theme-toggle.js";
import { cn } from "../../lib/utils.js";
import type { LandingClerkRuntimeMode } from "../../lib/clerk.js";
import { SignupCTAButton } from "./signup-cta-button.js";

interface TerminalTopbarProps {
  brandLabel: string;
  ctaLabel: string;
  clerkMode: LandingClerkRuntimeMode;
  domainLabel?: string;
  links: SiteNav["links"];
  topbar?: SiteTopbar;
}

const toneClass: Record<SitePill["tone"], { dot: string; text: string }> = {
  ok: { dot: "bg-accent shadow-[0_0_8px_hsl(var(--accent))]", text: "text-foreground" },
  warn: { dot: "bg-warn shadow-[0_0_8px_hsl(var(--warn))]", text: "text-warn" },
  neutral: { dot: "bg-muted-2", text: "text-muted-foreground" },
};

function StatusPill({ pill }: { pill: SitePill }) {
  const tone = toneClass[pill.tone];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 rounded-full border border-border px-3 py-1 text-[11px]",
        tone.text,
      )}
    >
      <span aria-hidden="true" className={cn("h-1.5 w-1.5 rounded-full", tone.dot)} />
      <span>{pill.label}</span>
    </span>
  );
}

export function TerminalTopbar({
  brandLabel,
  ctaLabel,
  clerkMode,
  domainLabel,
  links,
  topbar,
}: TerminalTopbarProps) {
  return (
    <header className="sticky top-0 z-30 -mx-6 border-b border-border bg-background/85 px-6 py-3 backdrop-blur sm:-mx-8 sm:px-8 lg:-mx-12 lg:px-12">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <span aria-hidden="true" className="text-accent">
            ▮
          </span>
          <span className="font-display text-lg leading-none tracking-tight text-foreground">
            {brandLabel}
          </span>
          <span aria-hidden="true" className="pq-cursor-blink ml-1 inline-block h-3.5 w-1.5 bg-accent" />
          {topbar?.versionLabel ? (
            <span className="ml-2 rounded-sm border border-border px-1.5 py-0.5 text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
              {topbar.versionLabel}
            </span>
          ) : null}
          {domainLabel ? (
            <span className="ml-2 hidden rounded-sm border border-border px-1.5 py-0.5 text-[10px] uppercase tracking-[0.08em] text-muted-foreground sm:inline-block">
              {domainLabel}
            </span>
          ) : null}
        </div>

        <nav className="ml-2 hidden items-center gap-4 md:flex">
          {links.map((link) => (
            <Link
              className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground transition-colors hover:text-foreground"
              href={link.href}
              key={link.label}
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex flex-wrap items-center gap-3">
          {topbar?.statusPill ? <StatusPill pill={topbar.statusPill} /> : null}
          {topbar?.secondaryPill ? (
            <span className="hidden lg:block">
              <StatusPill pill={topbar.secondaryPill} />
            </span>
          ) : null}
          <ThemeToggle />
          <SignupCTAButton mode={clerkMode} size="sm">
            {ctaLabel}
          </SignupCTAButton>
        </div>
      </div>
    </header>
  );
}
