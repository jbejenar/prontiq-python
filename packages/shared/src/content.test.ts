import test from "node:test";
import assert from "node:assert/strict";

import {
  caseStudySchema,
  postSchema,
  siteSettingsSchema,
  type ContentSource,
} from "./content.js";

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
      intro: "Usage-based pricing, with Free rendered by Prontiq and paid plans handled by Stripe.",
      kicker: "Pricing",
      paidPlansFootnote: "Starter and Growth are rendered by the Stripe pricing table.",
      title: "Usage-based. No seats.",
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
          paidPlansFootnote: "Starter and Growth are rendered by Stripe.",
          title: "Usage-based. No seats.",
        },
      });
    },
  };

  assert.ok(source);
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
          paidPlansFootnote: "Starter and Growth are rendered by Stripe.",
          title: "Usage-based. No seats.",
        },
      }),
    /freeTier/i,
  );
});
