import Link from "next/link";
import { ArrowRight, Check, ExternalLink } from "lucide-react";

import { AddressDemo } from "./address-demo.js";
import { AppFootStrip } from "./app-foot-strip.js";
import { ConsoleLinkButton } from "./console-link-button.js";
import { EndpointsTable } from "./endpoints-table.js";
import { HealthPanel } from "./health-panel.js";
import { KpiRow } from "./kpi-row.js";
import { MetricCard } from "./metric-card.js";
import { SignupCTAButton } from "./signup-cta-button.js";
import { TerminalTopbar } from "./terminal-topbar.js";
import { Badge } from "../ui/badge.js";
import { Button } from "../ui/button.js";
import { getLandingClerkRuntime, getLandingClerkRuntimeMessage } from "../../lib/clerk.js";
import { getLandingStats, siteSettings } from "../../lib/content/index.js";
import { env } from "../../lib/env.js";
import { serverEnv } from "../../lib/server-env.js";

const SEG_CONTROL = ["24h", "7d", "30d", "90d"] as const;

export function LandingShell() {
  const clerkRuntime = getLandingClerkRuntime({
    allowKeyless: serverEnv.PRONTIQ_ALLOW_KEYLESS_CLERK === "1",
    publishableKey: env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
  });
  const stats = getLandingStats();

  return (
    <main className="relative z-[2] min-h-screen">
      <div className="mx-auto flex min-h-screen max-w-7xl flex-col px-6 py-6 sm:px-8 lg:px-12">
        <TerminalTopbar
          brandLabel={siteSettings.nav.brandLabel}
          ctaLabel={siteSettings.nav.ctaLabel}
          clerkMode={clerkRuntime.mode}
          domainLabel="prontiq.dev"
          links={siteSettings.nav.links}
          topbar={stats.topbar}
        />

        <section className="grid items-start gap-12 py-12 lg:grid-cols-[1.05fr_0.95fr] lg:py-16">
          <div className="space-y-7">
            <Badge className="w-fit" variant="outline">
              {siteSettings.hero.badge}
            </Badge>
            <div className="space-y-4">
              <h1 className="max-w-4xl font-display text-5xl leading-[0.95] tracking-tight sm:text-6xl lg:text-7xl">
                {siteSettings.hero.headline}
              </h1>
              <p className="max-w-2xl text-sm leading-7 text-muted-foreground sm:text-base">
                {siteSettings.hero.subheadline}
              </p>
              {siteSettings.hero.metaItems && siteSettings.hero.metaItems.length > 0 ? (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                  {siteSettings.hero.metaItems.map((item, index) => (
                    <span className="flex items-center gap-2" key={`${item.label}-${index}`}>
                      <span>{item.label}</span>
                      <code className="rounded-sm border border-border px-1.5 py-0.5 text-[10px] text-foreground">
                        {item.value}
                      </code>
                      {index < (siteSettings.hero.metaItems?.length ?? 0) - 1 ? (
                        <span aria-hidden="true" className="text-muted-2">
                          ·
                        </span>
                      ) : null}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-3">
              <SignupCTAButton mode={clerkRuntime.mode} size="lg">
                {siteSettings.hero.ctaLabel}
              </SignupCTAButton>
              <Button asChild size="lg" variant="outline">
                <Link href={siteSettings.hero.ctaSecondaryHref}>
                  {siteSettings.hero.ctaSecondaryLabel}
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
            </div>
            <p className="max-w-2xl text-xs leading-6 text-muted-foreground">
              {siteSettings.featuresIntro}
            </p>
          </div>

          <div
            aria-hidden="true"
            className="hidden self-start rounded-md border border-border bg-card/70 p-1 lg:inline-flex"
            role="presentation"
          >
            {SEG_CONTROL.map((label) => (
              <span
                className={`px-3 py-1 text-[11px] uppercase tracking-[0.06em] ${
                  label === "30d"
                    ? "rounded-sm bg-surface-hover text-foreground before:mr-1 before:text-accent before:content-['·']"
                    : "text-muted-foreground"
                }`}
                key={label}
              >
                {label}
              </span>
            ))}
          </div>
        </section>

        <KpiRow className="mb-12" kpis={stats.kpis} />

        <section className="mb-12 grid gap-6 lg:grid-cols-[1.05fr_0.95fr]">
          <AddressDemo
            autocompleteEndpoint="/api/demo/address/autocomplete"
            heading={siteSettings.demo.heading}
            inputLabel={siteSettings.demo.inputLabel}
            kicker={siteSettings.demo.kicker}
            limit={siteSettings.demo.limit}
            placeholder={siteSettings.demo.placeholder}
            resultHeading={siteSettings.demo.resultHeading}
            stateFilter={siteSettings.demo.stateFilter}
          />

          <MetricCard
            heading="endpoint usage"
            meta={`${stats.endpoints.length} live endpoints`}
          >
            <EndpointsTable endpoints={stats.endpoints} />
          </MetricCard>
        </section>

        <section className="mb-12 space-y-8" id="pricing">
          <div className="space-y-3 text-center">
            <Badge className="mx-auto w-fit" variant="outline">
              {siteSettings.pricing.kicker}
            </Badge>
            <h2 className="font-display text-4xl tracking-tight sm:text-5xl">
              {siteSettings.pricing.title}
            </h2>
            <p className="mx-auto max-w-3xl text-sm leading-7 text-muted-foreground">
              {siteSettings.pricing.intro}
            </p>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <MetricCard
              heading={siteSettings.pricing.freeTier.name}
              meta={siteSettings.pricing.freeTier.note}
            >
              <div className="space-y-5">
                <div className="flex items-baseline gap-2 font-display text-4xl tracking-tight">
                  <span>{siteSettings.pricing.freeTier.priceLabel}</span>
                  <span className="font-body text-xs uppercase tracking-[0.18em] text-muted-foreground">
                    {siteSettings.pricing.freeTier.unitLabel}
                  </span>
                </div>
                <p className="text-sm leading-6 text-muted-foreground">
                  {siteSettings.pricing.freeTier.description}
                </p>
                <ul className="grid gap-3 text-sm text-muted-foreground">
                  {siteSettings.pricing.freeTier.features.map((feature) => (
                    <li className="flex items-start gap-3" key={feature}>
                      <Check className="mt-0.5 h-4 w-4 flex-none text-accent" />
                      <span>{feature}</span>
                    </li>
                  ))}
                </ul>
                <SignupCTAButton className="w-full" mode={clerkRuntime.mode} size="lg">
                  {siteSettings.pricing.freeTier.ctaLabel}
                </SignupCTAButton>
              </div>
            </MetricCard>

            <MetricCard
              heading={siteSettings.pricing.paygTier.name}
              meta={siteSettings.pricing.paygTier.note}
            >
              <div className="space-y-5">
                <div className="flex items-baseline gap-2 font-display text-4xl tracking-tight">
                  <span>{siteSettings.pricing.paygTier.priceLabel}</span>
                  <span className="font-body text-xs uppercase tracking-[0.18em] text-muted-foreground">
                    {siteSettings.pricing.paygTier.unitLabel}
                  </span>
                </div>
                <p className="text-sm leading-6 text-muted-foreground">
                  {siteSettings.pricing.paygTier.description}
                </p>
                <ul className="grid gap-3 text-sm text-muted-foreground">
                  {siteSettings.pricing.paygTier.features.map((feature) => (
                    <li className="flex items-start gap-3" key={feature}>
                      <Check className="mt-0.5 h-4 w-4 flex-none text-accent" />
                      <span>{feature}</span>
                    </li>
                  ))}
                </ul>
                <SignupCTAButton className="w-full" mode={clerkRuntime.mode} size="lg">
                  {siteSettings.pricing.paygTier.ctaLabel}
                </SignupCTAButton>
                <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                  {siteSettings.pricing.paidPlansFootnote}
                </p>
              </div>
            </MetricCard>
          </div>
        </section>

        <section className="mb-12">
          <MetricCard heading="integration state" meta="prontiq does not fail open">
            <HealthPanel
              rows={[
                {
                  label: "API host",
                  value: <span className="break-all">{env.NEXT_PUBLIC_API_URL}</span>,
                },
                {
                  label: "Clerk",
                  value: (
                    <span className="text-sm font-normal text-muted-foreground">
                      {getLandingClerkRuntimeMessage(
                        clerkRuntime.mode,
                        clerkRuntime.missingKeys,
                      )}
                    </span>
                  ),
                },
                {
                  label: "Billing",
                  value: (
                    <span className="text-sm font-normal text-muted-foreground">
                      Lago-backed account billing.
                    </span>
                  ),
                },
              ]}
            />
          </MetricCard>
        </section>

        <footer className="mt-auto space-y-4 pt-6">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="space-y-1">
              <p className="font-display text-2xl tracking-tight">
                {siteSettings.footer.brandLabel}
              </p>
              <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
                {siteSettings.footer.copyrightLabel}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {siteSettings.footer.links.map((link) => (
                <Button asChild key={link.label} size="sm" variant="ghost">
                  <Link href={link.href}>
                    {link.label}
                    <ExternalLink className="h-3.5 w-3.5" />
                  </Link>
                </Button>
              ))}
              <ConsoleLinkButton />
            </div>
          </div>
          {stats.footerStrip ? <AppFootStrip items={stats.footerStrip.items} /> : null}
        </footer>
      </div>
    </main>
  );
}
