import { z } from "zod";

export const postSchema = z.object({
  slug: z.string().min(1),
  title: z.string().min(1),
  excerpt: z.string().min(1),
  body: z.string().min(1),
  author: z.string().min(1),
  publishedAt: z.string().datetime(),
  tags: z.array(z.string()),
  ogImage: z.string().url().optional(),
});

export const caseStudyMetricSchema = z.object({
  label: z.string().min(1),
  value: z.string().min(1),
});

export const caseStudySchema = z.object({
  slug: z.string().min(1),
  customerName: z.string().min(1),
  customerLogo: z.string().min(1),
  headline: z.string().min(1),
  quote: z.string().min(1),
  metrics: z.array(caseStudyMetricSchema),
  body: z.string().min(1),
  publishedAt: z.string().datetime(),
});

export const siteLinkSchema = z.object({
  href: z.string().min(1),
  label: z.string().min(1),
});

export const siteNavSchema = z.object({
  brandLabel: z.string().min(1),
  ctaLabel: z.string().min(1),
  links: z.array(siteLinkSchema).min(1),
});

export const siteHeroSchema = z.object({
  badge: z.string().min(1),
  ctaLabel: z.string().min(1),
  ctaSecondaryHref: z.string().min(1),
  ctaSecondaryLabel: z.string().min(1),
  headline: z.string().min(1),
  subheadline: z.string().min(1),
});

export const siteDemoSchema = z.object({
  heading: z.string().min(1),
  inputLabel: z.string().min(1),
  kicker: z.string().min(1),
  limit: z.number().int().min(1).max(8),
  placeholder: z.string().min(1),
  resultHeading: z.string().min(1),
  stateFilter: z.string().min(2).max(3).optional(),
});

export const siteFreeTierSchema = z.object({
  ctaLabel: z.string().min(1),
  description: z.string().min(1),
  features: z.array(z.string().min(1)).min(1),
  name: z.string().min(1),
  note: z.string().min(1),
  priceLabel: z.string().min(1),
  unitLabel: z.string().min(1),
});

export const sitePricingSchema = z.object({
  freeTier: siteFreeTierSchema,
  intro: z.string().min(1),
  kicker: z.string().min(1),
  paidPlansFootnote: z.string().min(1),
  paygTier: siteFreeTierSchema,
  title: z.string().min(1),
});

export const siteFooterSchema = z.object({
  brandLabel: z.string().min(1),
  copyrightLabel: z.string().min(1),
  links: z.array(siteLinkSchema).min(1),
});

export const siteSettingsSchema = z.object({
  demo: siteDemoSchema,
  featuresIntro: z.string().min(1),
  footer: siteFooterSchema,
  hero: siteHeroSchema,
  nav: siteNavSchema,
  pricing: sitePricingSchema,
});

export type Post = z.infer<typeof postSchema>;
export type CaseStudyMetric = z.infer<typeof caseStudyMetricSchema>;
export type CaseStudy = z.infer<typeof caseStudySchema>;
export type SiteLink = z.infer<typeof siteLinkSchema>;
export type SiteNav = z.infer<typeof siteNavSchema>;
export type SiteHero = z.infer<typeof siteHeroSchema>;
export type SiteDemo = z.infer<typeof siteDemoSchema>;
export type SiteFreeTier = z.infer<typeof siteFreeTierSchema>;
export type SitePricing = z.infer<typeof sitePricingSchema>;
export type SiteFooter = z.infer<typeof siteFooterSchema>;
export type SiteSettings = z.infer<typeof siteSettingsSchema>;

export interface ContentSource {
  getPost(slug: string): Promise<Post | null>;
  listPosts(opts?: { limit?: number; tag?: string }): Promise<Post[]>;
  getCaseStudy(slug: string): Promise<CaseStudy | null>;
  listCaseStudies(): Promise<CaseStudy[]>;
  getSiteSettings(): Promise<SiteSettings>;
}
