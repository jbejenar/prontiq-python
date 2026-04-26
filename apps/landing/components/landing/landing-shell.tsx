import Link from "next/link";
import { ArrowRight, Check, ExternalLink } from "lucide-react";

import { AddressDemo } from "./address-demo.js";
import { ConsoleLinkButton } from "./console-link-button.js";
import { SignupCTAButton } from "./signup-cta-button.js";
import { ThemeToggle } from "../theme-toggle.js";
import { Badge } from "../ui/badge.js";
import { Button } from "../ui/button.js";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card.js";
import { Separator } from "../ui/separator.js";
import { getLandingClerkRuntime, getLandingClerkRuntimeMessage } from "../../lib/clerk.js";
import { siteSettings } from "../../lib/content/index.js";
import { env } from "../../lib/env.js";
import { serverEnv } from "../../lib/server-env.js";

export function LandingShell() {
  const clerkRuntime = getLandingClerkRuntime({
    allowKeyless: serverEnv.PRONTIQ_ALLOW_KEYLESS_CLERK === "1",
    publishableKey: env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
  });

  return (
    <main className="min-h-screen">
      <div className="mx-auto flex min-h-screen max-w-7xl flex-col px-6 py-8 sm:px-8 lg:px-12">
        <header className="sticky top-0 z-30 -mx-6 border-b border-border/70 bg-background/85 px-6 pb-6 pt-2 backdrop-blur sm:-mx-8 sm:px-8 lg:-mx-12 lg:px-12">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <span className="font-display text-2xl tracking-tight text-foreground">
                {siteSettings.nav.brandLabel}
              </span>
              <Badge variant="outline">prontiq.dev</Badge>
            </div>
            <div className="flex items-center gap-3">
              <nav className="hidden items-center gap-5 md:flex">
                {siteSettings.nav.links.map((link) => (
                  <Link
                    className="text-xs uppercase tracking-[0.22em] text-muted-foreground transition-colors hover:text-foreground"
                    href={link.href}
                    key={link.label}
                  >
                    {link.label}
                  </Link>
                ))}
              </nav>
              <ThemeToggle />
              <SignupCTAButton mode={clerkRuntime.mode} size="sm">
                {siteSettings.nav.ctaLabel}
              </SignupCTAButton>
            </div>
          </div>
        </header>

        <section className="grid items-start gap-12 py-16 lg:grid-cols-[1.05fr_0.95fr] lg:py-20">
          <div className="space-y-8 pt-4">
            <Badge className="w-fit" variant="outline">
              {siteSettings.hero.badge}
            </Badge>
            <div className="space-y-5">
              <h1 className="max-w-4xl text-5xl leading-none tracking-tight sm:text-6xl lg:text-7xl">
                {siteSettings.hero.headline}
              </h1>
              <p className="max-w-2xl text-base leading-7 text-muted-foreground sm:text-lg">
                {siteSettings.hero.subheadline}
              </p>
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
            <Card className="border-border/80 bg-card/80">
              <CardHeader>
                <CardTitle className="text-2xl">Built for address UX that has to ship</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4 text-sm leading-6 text-muted-foreground">
                <p>{siteSettings.featuresIntro}</p>
                <p>{siteSettings.pricing.intro}</p>
                <div className="flex flex-wrap gap-3 text-xs uppercase tracking-[0.2em]">
                  <Badge variant="secondary">Autocomplete</Badge>
                  <Badge variant="secondary">Validation</Badge>
                  <Badge variant="secondary">Proxy-guarded demo</Badge>
                </div>
              </CardContent>
            </Card>
          </div>

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
        </section>

        <section className="space-y-10 py-10" id="pricing">
          <div className="space-y-4 text-center">
            <Badge className="mx-auto w-fit" variant="outline">
              {siteSettings.pricing.kicker}
            </Badge>
            <div className="space-y-3">
              <h2 className="text-4xl tracking-tight sm:text-5xl">{siteSettings.pricing.title}</h2>
              <p className="mx-auto max-w-3xl text-base leading-7 text-muted-foreground">
                {siteSettings.pricing.intro}
              </p>
            </div>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card className="border-primary/20 bg-card/85">
              <CardHeader>
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div className="space-y-2">
                    <Badge variant="secondary">{siteSettings.pricing.freeTier.name}</Badge>
                    <CardTitle className="text-4xl">
                      {siteSettings.pricing.freeTier.priceLabel}
                      <span className="ml-2 font-sans text-sm uppercase tracking-[0.18em] text-muted-foreground">
                        {siteSettings.pricing.freeTier.unitLabel}
                      </span>
                    </CardTitle>
                  </div>
                  <Badge variant="outline">{siteSettings.pricing.freeTier.note}</Badge>
                </div>
                <CardDescription className="max-w-xl text-sm leading-6">
                  {siteSettings.pricing.freeTier.description}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <ul className="grid gap-3 text-sm text-muted-foreground">
                  {siteSettings.pricing.freeTier.features.map((feature) => (
                    <li className="flex items-start gap-3" key={feature}>
                      <Check className="mt-0.5 h-4 w-4 flex-none text-primary" />
                      <span>{feature}</span>
                    </li>
                  ))}
                </ul>
                <SignupCTAButton className="w-full" mode={clerkRuntime.mode} size="lg">
                  {siteSettings.pricing.freeTier.ctaLabel}
                </SignupCTAButton>
              </CardContent>
            </Card>

            <Card className="border-border/80 bg-card/75">
              <CardHeader>
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div className="space-y-2">
                    <Badge variant="outline">{siteSettings.pricing.paygTier.name}</Badge>
                    <CardTitle className="text-4xl">
                      {siteSettings.pricing.paygTier.priceLabel}
                      <span className="ml-2 font-sans text-sm uppercase tracking-[0.18em] text-muted-foreground">
                        {siteSettings.pricing.paygTier.unitLabel}
                      </span>
                    </CardTitle>
                  </div>
                  <Badge variant="secondary">{siteSettings.pricing.paygTier.note}</Badge>
                </div>
                <CardDescription className="max-w-xl text-sm leading-6">
                  {siteSettings.pricing.paygTier.description}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <ul className="grid gap-3 text-sm text-muted-foreground">
                  {siteSettings.pricing.paygTier.features.map((feature) => (
                    <li className="flex items-start gap-3" key={feature}>
                      <Check className="mt-0.5 h-4 w-4 flex-none text-primary" />
                      <span>{feature}</span>
                    </li>
                  ))}
                </ul>
                <SignupCTAButton className="w-full" mode={clerkRuntime.mode} size="lg">
                  {siteSettings.pricing.paygTier.ctaLabel}
                </SignupCTAButton>
                <p className="text-xs uppercase tracking-[0.22em] text-muted-foreground">
                  {siteSettings.pricing.paidPlansFootnote}
                </p>
              </CardContent>
            </Card>
          </div>
        </section>

        <section className="py-10">
          <Card className="border-border/80 bg-card/70">
            <CardHeader>
              <CardTitle className="text-2xl">Integration state</CardTitle>
              <CardDescription>
                Landing stays build-safe when external commercial configuration is absent, but it
                does not fail open.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-6 md:grid-cols-3">
              <div className="space-y-2">
                <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">API host</p>
                <p className="break-all text-sm">{env.NEXT_PUBLIC_API_URL}</p>
              </div>
              <div className="space-y-2">
                <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Clerk</p>
                <p className="text-sm text-muted-foreground">
                  {getLandingClerkRuntimeMessage(clerkRuntime.mode, clerkRuntime.missingKeys)}
                </p>
              </div>
              <div className="space-y-2">
                <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Billing</p>
                <p className="text-sm text-muted-foreground">Lago-backed account billing.</p>
              </div>
            </CardContent>
          </Card>
        </section>

        <footer className="mt-auto border-t border-border/70 py-8">
          <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
            <div className="space-y-1">
              <p className="font-display text-2xl tracking-tight">
                {siteSettings.footer.brandLabel}
              </p>
              <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                {siteSettings.footer.copyrightLabel}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-4">
              {siteSettings.footer.links.map((link) => (
                <Button asChild key={link.label} size="sm" variant="ghost">
                  <Link href={link.href}>
                    {link.label}
                    <ExternalLink className="h-3.5 w-3.5" />
                  </Link>
                </Button>
              ))}
              <Separator className="hidden h-6 md:block" orientation="vertical" />
              <ConsoleLinkButton />
            </div>
          </div>
        </footer>
      </div>
    </main>
  );
}
