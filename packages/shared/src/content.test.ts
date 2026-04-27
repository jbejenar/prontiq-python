import test from "node:test";
import assert from "node:assert/strict";

import { caseStudySchema, postSchema, siteSettingsSchema, type ContentSource } from "./content.js";

test("postSchema accepts a valid post payload", () => {
  const result = postSchema.parse({
    slug: "launching-prontiq",
    title: "Launching Prontiq",
    excerpt: "A short summary.",
    body: "Hello world",
    author: "Prontiq",
    publishedAt: "2026-04-19T00:00:00.000Z",
    tags: ["launch"],
    ogImage: "https://example.com/og.png",
  });

  assert.equal(result.slug, "launching-prontiq");
});

test("caseStudySchema rejects a missing metrics array", () => {
  assert.throws(
    () =>
      caseStudySchema.parse({
        slug: "acme",
        customerName: "Acme",
        customerLogo: "/logos/acme.svg",
        headline: "Acme ships faster",
        quote: "It works.",
        body: "Case study body",
        publishedAt: "2026-04-19T00:00:00.000Z",
      }),
    /metrics/i,
  );
});

test("siteSettingsSchema enforces required homepage copy", () => {
  const result = siteSettingsSchema.parse({
    demo: {
      heading: "Type an address. Watch it resolve.",
      inputLabel: "Live demo · AU",
      kicker: "Try it",
      limit: 5,
      placeholder: "Try: 9 endeavour",
      resultHeading: "Selected address payload",
      stateFilter: "VIC",
    },
    featuresIntro: "Fast, typed, and documented.",
    footer: {
      brandLabel: "prontiq",
      copyrightLabel: "© 2026",
      links: [
        { href: "https://docs.prontiq.dev", label: "Docs" },
        { href: "https://status.prontiq.dev", label: "Status" },
      ],
    },
    hero: {
      badge: "Australian address intelligence",
      ctaLabel: "Get Started Free",
      ctaSecondaryHref: "https://docs.prontiq.dev",
      ctaSecondaryLabel: "Read the Docs",
      headline: "One address endpoint for every checkout flow.",
      subheadline: "Autocomplete, validate, and enrich addresses through one typed API.",
    },
    nav: {
      brandLabel: "prontiq",
      ctaLabel: "Get Started Free",
      links: [
        { href: "#pricing", label: "Pricing" },
        { href: "https://docs.prontiq.dev", label: "Docs" },
      ],
    },
    pricing: {
      freeTier: {
        ctaLabel: "Start Free",
        description: "Build against the live address product with no card up front.",
        features: [
          "10,000 credits per month",
          "Autocomplete + validate + enrich",
          "Community support",
        ],
        name: "Free",
        note: "No card required",
        priceLabel: "$0",
        unitLabel: "/mo",
      },
      intro: "Usage-based pricing, with Free and PAYG rendered by Prontiq.",
      kicker: "Pricing",
      paidPlansFootnote: "Stripe is the payment rail behind Lago.",
      paygTier: {
        ctaLabel: "Create Account",
        description: "Move to usage-based billing when production traffic starts.",
        features: ["Usage-based address credits"],
        name: "PAYG",
        note: "Card managed in account",
        priceLabel: "Usage",
        unitLabel: "/credits",
      },
      title: "Usage-based. No seats.",
    },
    releases: {
      gnaf: "2026-02-07",
    },
  });

  assert.equal(result.hero.ctaLabel, "Get Started Free");
  assert.equal(result.pricing.freeTier.name, "Free");
});

test("ContentSource shape is importable from the shared package surface", () => {
  const source: ContentSource = {
    async getPost() {
      return null;
    },
    async listPosts() {
      return [];
    },
    async getCaseStudy() {
      return null;
    },
    async listCaseStudies() {
      return [];
    },
    async getSiteSettings() {
      return siteSettingsSchema.parse({
        demo: {
          heading: "Type an address. Watch it resolve.",
          inputLabel: "Live demo · AU",
          kicker: "Try it",
          limit: 5,
          placeholder: "Try: 9 endeavour",
          resultHeading: "Selected address payload",
        },
        featuresIntro: "Fast, typed, and documented.",
        footer: {
          brandLabel: "prontiq",
          copyrightLabel: "© 2026",
          links: [{ href: "https://docs.prontiq.dev", label: "Docs" }],
        },
        hero: {
          badge: "Australian address intelligence",
          ctaLabel: "Get Started Free",
          ctaSecondaryHref: "https://docs.prontiq.dev",
          ctaSecondaryLabel: "Read the Docs",
          headline: "One address endpoint for every checkout flow.",
          subheadline: "Developer-friendly API",
        },
        nav: {
          brandLabel: "prontiq",
          ctaLabel: "Get Started Free",
          links: [{ href: "https://docs.prontiq.dev", label: "Docs" }],
        },
        pricing: {
          freeTier: {
            ctaLabel: "Start Free",
            description: "Build against the live address product with no card up front.",
            features: ["10,000 credits per month"],
            name: "Free",
            note: "No card required",
            priceLabel: "$0",
            unitLabel: "/mo",
          },
          intro: "Simple usage-based plans.",
          kicker: "Pricing",
          paidPlansFootnote: "Stripe is the payment rail behind Lago.",
          paygTier: {
            ctaLabel: "Create Account",
            description: "Move to usage-based billing when production traffic starts.",
            features: ["Usage-based address credits"],
            name: "PAYG",
            note: "Card managed in account",
            priceLabel: "Usage",
            unitLabel: "/credits",
          },
          title: "Usage-based. No seats.",
        },
        releases: {
          gnaf: "2026-02-07",
        },
      });
    },
  };

  assert.ok(source);
});

test("siteSettingsSchema accepts the new optional reskin sections", () => {
  const result = siteSettingsSchema.parse({
    demo: {
      heading: "Type an address. Watch it resolve.",
      inputLabel: "Live demo · AU",
      kicker: "Try it",
      limit: 5,
      placeholder: "Try: 9 endeavour",
      resultHeading: "Selected address payload",
    },
    endpoints: [
      { method: "GET", path: "/v1/address/autocomplete", cost: 1, p95: 24 },
      { method: "GET", path: "/v1/address/validate", cost: 1, p95: 31 },
    ],
    featuresIntro: "Fast, typed, and documented.",
    footer: {
      brandLabel: "prontiq",
      copyrightLabel: "© 2026",
      links: [{ href: "https://docs.prontiq.dev", label: "Docs" }],
    },
    footerStrip: {
      items: ["prontiq · v0.8.2", "region ap-southeast-2 · sydney"],
    },
    hero: {
      badge: "Australian address intelligence",
      ctaLabel: "Get Started Free",
      ctaSecondaryHref: "https://docs.prontiq.dev",
      ctaSecondaryLabel: "Read the Docs",
      headline: "One address endpoint for every checkout flow.",
      subheadline: "Developer-friendly API",
      metaItems: [
        { label: "g-naf", value: "2026-02-07" },
        { label: "records", value: "15,015,573" },
      ],
    },
    kpis: [
      {
        label: "endpoints",
        value: "6",
        unit: "live",
        delta: "+1 vs q3",
        sparkline: [21, 19, 20, 17, 15, 16, 13, 11, 9, 8, 6, 5, 4],
      },
    ],
    releases: {
      gnaf: "2026-02-07",
    },
    nav: {
      brandLabel: "prontiq",
      ctaLabel: "Get Started Free",
      links: [{ href: "https://docs.prontiq.dev", label: "Docs" }],
    },
    pricing: {
      freeTier: {
        ctaLabel: "Start Free",
        description: "Build against the live address product with no card up front.",
        features: ["10,000 credits per month"],
        name: "Free",
        note: "No card required",
        priceLabel: "$0",
        unitLabel: "/mo",
      },
      intro: "Simple usage-based plans.",
      kicker: "Pricing",
      paidPlansFootnote: "Stripe is the payment rail behind Lago.",
      paygTier: {
        ctaLabel: "Create Account",
        description: "Move to usage-based billing when production traffic starts.",
        features: ["Usage-based address credits"],
        name: "PAYG",
        note: "Card managed in account",
        priceLabel: "Usage",
        unitLabel: "/credits",
      },
      title: "Usage-based. No seats.",
    },
    topbar: {
      versionLabel: "v0.8.2",
      statusPill: { label: "live · ap-southeast-2", tone: "ok" },
      secondaryPill: { label: "p95 38ms · within sla", tone: "neutral" },
    },
  });

  assert.equal(result.topbar?.statusPill.tone, "ok");
  assert.equal(result.kpis?.[0]?.sparkline?.length, 13);
  assert.equal(result.endpoints?.length, 2);
  assert.equal(result.hero.metaItems?.[0]?.label, "g-naf");
  assert.equal(result.footerStrip?.items.length, 2);
});

test("siteKpiSchema rejects a sparkline with the wrong number of points", () => {
  assert.throws(
    () =>
      siteSettingsSchema.parse({
        demo: {
          heading: "Type an address. Watch it resolve.",
          inputLabel: "Live demo · AU",
          kicker: "Try it",
          limit: 5,
          placeholder: "Try: 9 endeavour",
          resultHeading: "Selected address payload",
        },
        featuresIntro: "Fast, typed, and documented.",
        footer: {
          brandLabel: "prontiq",
          copyrightLabel: "© 2026",
          links: [{ href: "https://docs.prontiq.dev", label: "Docs" }],
        },
        hero: {
          badge: "Australian address intelligence",
          ctaLabel: "Get Started Free",
          ctaSecondaryHref: "https://docs.prontiq.dev",
          ctaSecondaryLabel: "Read the Docs",
          headline: "One address endpoint for every checkout flow.",
          subheadline: "Developer-friendly API",
        },
        kpis: [
          {
            label: "endpoints",
            value: "6",
            sparkline: [1, 2, 3],
          },
        ],
        nav: {
          brandLabel: "prontiq",
          ctaLabel: "Get Started Free",
          links: [{ href: "https://docs.prontiq.dev", label: "Docs" }],
        },
        pricing: {
          freeTier: {
            ctaLabel: "Start Free",
            description: "Build against the live address product with no card up front.",
            features: ["10,000 credits per month"],
            name: "Free",
            note: "No card required",
            priceLabel: "$0",
            unitLabel: "/mo",
          },
          intro: "Simple usage-based plans.",
          kicker: "Pricing",
          paidPlansFootnote: "Stripe is the payment rail behind Lago.",
          paygTier: {
            ctaLabel: "Create Account",
            description: "Move to usage-based billing when production traffic starts.",
            features: ["Usage-based address credits"],
            name: "PAYG",
            note: "Card managed in account",
            priceLabel: "Usage",
            unitLabel: "/credits",
          },
          title: "Usage-based. No seats.",
        },
        releases: {
          gnaf: "2026-02-07",
        },
      }),
    /sparkline/i,
  );
});

test("siteSettingsSchema rejects a missing free-tier pricing section", () => {
  assert.throws(
    () =>
      siteSettingsSchema.parse({
        demo: {
          heading: "Type an address. Watch it resolve.",
          inputLabel: "Live demo · AU",
          kicker: "Try it",
          limit: 5,
          placeholder: "Try: 9 endeavour",
          resultHeading: "Selected address payload",
        },
        featuresIntro: "Fast, typed, and documented.",
        footer: {
          brandLabel: "prontiq",
          copyrightLabel: "© 2026",
          links: [{ href: "https://docs.prontiq.dev", label: "Docs" }],
        },
        hero: {
          badge: "Australian address intelligence",
          ctaLabel: "Get Started Free",
          ctaSecondaryHref: "https://docs.prontiq.dev",
          ctaSecondaryLabel: "Read the Docs",
          headline: "One address endpoint for every checkout flow.",
          subheadline: "Developer-friendly API",
        },
        nav: {
          brandLabel: "prontiq",
          ctaLabel: "Get Started Free",
          links: [{ href: "https://docs.prontiq.dev", label: "Docs" }],
        },
        pricing: {
          intro: "Simple usage-based plans.",
          kicker: "Pricing",
          paidPlansFootnote: "Stripe is the payment rail behind Lago.",
          paygTier: {
            ctaLabel: "Create Account",
            description: "Move to usage-based billing when production traffic starts.",
            features: ["Usage-based address credits"],
            name: "PAYG",
            note: "Card managed in account",
            priceLabel: "Usage",
            unitLabel: "/credits",
          },
          title: "Usage-based. No seats.",
        },
        releases: {
          gnaf: "2026-02-07",
        },
      }),
    /freeTier/i,
  );
});

function buildBaseSettings(overrides: Record<string, unknown> = {}) {
  return {
    demo: {
      heading: "Type an address. Watch it resolve.",
      inputLabel: "Live demo · AU",
      kicker: "Try it",
      limit: 5,
      placeholder: "Try: 9 endeavour",
      resultHeading: "Selected address payload",
    },
    featuresIntro: "Fast, typed, and documented.",
    footer: {
      brandLabel: "prontiq",
      copyrightLabel: "© 2026",
      links: [{ href: "https://docs.prontiq.dev", label: "Docs" }],
    },
    hero: {
      badge: "Australian address intelligence",
      ctaLabel: "Get Started Free",
      ctaSecondaryHref: "https://docs.prontiq.dev",
      ctaSecondaryLabel: "Read the Docs",
      headline: "One address endpoint for every checkout flow.",
      subheadline: "Developer-friendly API",
    },
    nav: {
      brandLabel: "prontiq",
      ctaLabel: "Get Started Free",
      links: [{ href: "https://docs.prontiq.dev", label: "Docs" }],
    },
    pricing: {
      freeTier: {
        ctaLabel: "Start Free",
        description: "Build against the live address product with no card up front.",
        features: ["10,000 credits per month"],
        name: "Free",
        note: "No card required",
        priceLabel: "$0",
        unitLabel: "/mo",
      },
      intro: "Simple usage-based plans.",
      kicker: "Pricing",
      paidPlansFootnote: "Stripe is the payment rail behind Lago.",
      paygTier: {
        ctaLabel: "Create Account",
        description: "Move to usage-based billing when production traffic starts.",
        features: ["Usage-based address credits"],
        name: "PAYG",
        note: "Card managed in account",
        priceLabel: "Usage",
        unitLabel: "/credits",
      },
      title: "Usage-based. No seats.",
    },
    releases: {
      gnaf: "2026-02-07",
    },
    ...overrides,
  };
}

test("siteSettingsSchema requires a releases section with an ISO-format gnaf date", () => {
  assert.throws(
    () =>
      siteSettingsSchema.parse(
        buildBaseSettings({
          releases: { gnaf: "2026-02-7" },
        }),
      ),
    /YYYY-MM-DD/,
  );
});

test("siteSettingsSchema rejects a hero g-naf metaItem that disagrees with releases.gnaf", () => {
  assert.throws(
    () =>
      siteSettingsSchema.parse(
        buildBaseSettings({
          hero: {
            badge: "Australian address intelligence",
            ctaLabel: "Get Started Free",
            ctaSecondaryHref: "https://docs.prontiq.dev",
            ctaSecondaryLabel: "Read the Docs",
            headline: "One address endpoint for every checkout flow.",
            subheadline: "Developer-friendly API",
            metaItems: [
              { label: "g-naf", value: "2025-12-15" },
              { label: "records", value: "15,015,573" },
            ],
          },
        }),
      ),
    /releases\.gnaf/,
  );
});

test("siteSettingsSchema rejects a kpi delta whose g-naf date disagrees with releases.gnaf", () => {
  assert.throws(
    () =>
      siteSettingsSchema.parse(
        buildBaseSettings({
          kpis: [
            {
              label: "records",
              value: "15",
              unit: "M",
              delta: "g-naf 2025-12-15",
              sparkline: [21, 19, 20, 17, 15, 16, 13, 11, 9, 8, 6, 5, 4],
            },
          ],
        }),
      ),
    /releases\.gnaf/,
  );
});

test("siteSettingsSchema accepts kpi deltas that mention g-naf without a date suffix", () => {
  const result = siteSettingsSchema.parse(
    buildBaseSettings({
      kpis: [
        {
          label: "records",
          value: "15",
          unit: "M",
          delta: "g-naf primary source",
          sparkline: [21, 19, 20, 17, 15, 16, 13, 11, 9, 8, 6, 5, 4],
        },
      ],
    }),
  );

  assert.equal(result.kpis?.[0]?.delta, "g-naf primary source");
});
