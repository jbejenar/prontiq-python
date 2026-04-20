import Link from "next/link";
import { ArrowRight, Database, MoonStar, Sparkles, Zap } from "lucide-react";

import { ThemeToggle } from "../theme-toggle.js";
import { Badge } from "../ui/badge.js";
import { Button } from "../ui/button.js";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card.js";
import { Separator } from "../ui/separator.js";
import { siteSettings } from "../../lib/content/index.js";
import { env } from "../../lib/env.js";

const featureCards = [
  {
    icon: Zap,
    title: "Fast path for address UX",
    body: "Autocomplete, validation, enrichment, and reverse geocoding live behind one typed API surface.",
  },
  {
    icon: Database,
    title: "Open-data spine",
    body: "Independent ingestion and OpenSearch indexing keep the platform grounded in real source data and clear contracts.",
  },
  {
    icon: Sparkles,
    title: "Built for shipping teams",
    body: "Typed SDKs, docs, auth, billing, and observability are designed to make this feel like product infrastructure, not a hobby endpoint.",
  },
];

export function LandingShell() {
  return (
    <main className="min-h-screen">
      <div className="mx-auto flex min-h-screen max-w-7xl flex-col px-6 py-8 sm:px-8 lg:px-12">
        <header className="flex items-center justify-between gap-4 border-b border-border/70 pb-6">
          <div className="flex items-center gap-3">
            <Badge>p1c.07</Badge>
            <span className="text-sm uppercase tracking-[0.22em] text-muted-foreground">prontiq.dev</span>
          </div>
          <div className="flex items-center gap-3">
            <Button asChild size="sm" variant="ghost">
              <Link href="https://docs.prontiq.dev">Docs</Link>
            </Button>
            <ThemeToggle />
          </div>
        </header>

        <section className="grid flex-1 items-center gap-10 py-14 lg:grid-cols-[1.15fr_0.85fr] lg:py-20">
          <div className="space-y-8">
            <div className="space-y-4">
              <Badge className="w-fit" variant="outline">
                Australian address validation
              </Badge>
              <div className="space-y-4">
                <h1 className="max-w-4xl text-5xl leading-none tracking-tight sm:text-6xl lg:text-7xl">
                  {siteSettings.heroHeadline}
                </h1>
                <p className="max-w-2xl text-base leading-7 text-muted-foreground sm:text-lg">
                  {siteSettings.heroSubheadline} The feature work comes next; this ticket establishes the real component and shell foundation those pages depend on.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap gap-3">
              <Button asChild size="lg">
                <Link href="https://docs.prontiq.dev">
                  {siteSettings.ctaPrimary}
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <Link href="https://docs.prontiq.dev">{siteSettings.ctaSecondary}</Link>
              </Button>
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              {featureCards.map(({ icon: Icon, title, body }) => (
                <Card key={title} className="bg-card/85">
                  <CardHeader>
                    <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-full border border-border bg-primary/10 text-primary">
                      <Icon className="h-4 w-4" />
                    </div>
                    <CardTitle className="text-xl">{title}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <CardDescription className="leading-6">{body}</CardDescription>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>

          <Card className="overflow-hidden bg-card/90">
            <CardHeader>
              <CardTitle className="text-3xl">Shell baseline</CardTitle>
              <CardDescription>
                `P1C.07` lands the token-aware primitive stack and theme system. `P1C.01` will replace this with the live hero demo and pricing conversion surface.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="rounded-lg border border-border bg-background/80 p-4">
                <div className="flex items-center justify-between text-xs uppercase tracking-[0.18em] text-muted-foreground">
                  <span>API host</span>
                  <MoonStar className="h-4 w-4" />
                </div>
                <Separator className="my-4" />
                <p className="break-all text-sm text-foreground">{env.NEXT_PUBLIC_API_URL}</p>
              </div>

              <div className="rounded-lg border border-dashed border-primary/30 bg-primary/5 p-4 text-sm leading-6 text-muted-foreground">
                <p>{siteSettings.featuresIntro}</p>
                <p className="mt-3">{siteSettings.pricingIntro}</p>
              </div>
            </CardContent>
          </Card>
        </section>
      </div>
    </main>
  );
}
