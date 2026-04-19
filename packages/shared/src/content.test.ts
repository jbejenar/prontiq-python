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
    heroHeadline: "Australian address validation",
    heroSubheadline: "Developer-friendly API",
    ctaPrimary: "Get Started Free",
    ctaSecondary: "Read the Docs",
    pricingIntro: "Simple usage-based plans.",
    featuresIntro: "Fast, typed, and documented.",
  });

  assert.equal(result.ctaPrimary, "Get Started Free");
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
        heroHeadline: "Australian address validation",
        heroSubheadline: "Developer-friendly API",
        ctaPrimary: "Get Started Free",
        ctaSecondary: "Read the Docs",
        pricingIntro: "Simple usage-based plans.",
        featuresIntro: "Fast, typed, and documented.",
      });
    },
  };

  assert.ok(source);
});
