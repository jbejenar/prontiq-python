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

export const siteHeroMetaItemSchema = z.object({
  label: z.string().min(1),
  value: z.string().min(1),
});

export const siteHeroSchema = z.object({
  badge: z.string().min(1),
  ctaLabel: z.string().min(1),
  ctaSecondaryHref: z.string().min(1),
  ctaSecondaryLabel: z.string().min(1),
  headline: z.string().min(1),
  subheadline: z.string().min(1),
  metaItems: z.array(siteHeroMetaItemSchema).optional(),
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

export const sitePillSchema = z.object({
  label: z.string().min(1),
  tone: z.enum(["ok", "warn", "neutral"]),
});

export const siteTopbarSchema = z.object({
  versionLabel: z.string().min(1),
  statusPill: sitePillSchema,
  secondaryPill: sitePillSchema.optional(),
});

export const siteKpiSchema = z.object({
  label: z.string().min(1),
  value: z.string().min(1),
  unit: z.string().optional(),
  delta: z.string().optional(),
  sparkline: z.array(z.number()).length(13).optional(),
});

export const siteEndpointSchema = z.object({
  method: z.enum(["GET", "POST"]),
  path: z.string().min(1),
  cost: z.number().int().positive(),
  p95: z.number().int().nonnegative(),
});

export const siteFooterStripSchema = z.object({
  items: z.array(z.string().min(1)).min(1),
});

export const releaseDateSchema = z
  .string()
  .regex(
    /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/,
    "release dates must be ISO-format YYYY-MM-DD (zero-padded)",
  );

export const siteReleasesSchema = z.object({
  gnaf: releaseDateSchema,
});

export const RELEASE_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
export const GNAF_DELTA_PATTERN = /^g-naf (\d{4}-\d{2}-\d{2})$/;
export const GNAF_META_LABEL = "g-naf";

export const siteSettingsSchema = z
  .object({
    demo: siteDemoSchema,
    endpoints: z.array(siteEndpointSchema).optional(),
    featuresIntro: z.string().min(1),
    footer: siteFooterSchema,
    footerStrip: siteFooterStripSchema.optional(),
    hero: siteHeroSchema,
    kpis: z.array(siteKpiSchema).optional(),
    nav: siteNavSchema,
    pricing: sitePricingSchema,
    releases: siteReleasesSchema,
    topbar: siteTopbarSchema.optional(),
  })
  .superRefine((data, ctx) => {
    const gnafDate = data.releases.gnaf;

    data.hero.metaItems?.forEach((item, index) => {
      if (item.label !== GNAF_META_LABEL) {
        return;
      }
      if (!RELEASE_DATE_PATTERN.test(item.value)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `hero.metaItems[${index}] labeled "${GNAF_META_LABEL}" must use ISO-format YYYY-MM-DD; got "${item.value}"`,
          path: ["hero", "metaItems", index, "value"],
        });
        return;
      }
      if (item.value !== gnafDate) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `hero.metaItems[${index}] labeled "${GNAF_META_LABEL}" has value "${item.value}" but releases.gnaf is "${gnafDate}"`,
          path: ["hero", "metaItems", index, "value"],
        });
      }
    });

    data.kpis?.forEach((kpi, index) => {
      const match = kpi.delta?.match(GNAF_DELTA_PATTERN);
      if (!match) {
        return;
      }
      const referencedDate = match[1];
      if (referencedDate !== gnafDate) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `kpis[${index}].delta references g-naf release "${referencedDate}" but releases.gnaf is "${gnafDate}"`,
          path: ["kpis", index, "delta"],
        });
      }
    });
  });

export type Post = z.infer<typeof postSchema>;
export type CaseStudyMetric = z.infer<typeof caseStudyMetricSchema>;
export type CaseStudy = z.infer<typeof caseStudySchema>;
export type SiteLink = z.infer<typeof siteLinkSchema>;
export type SiteNav = z.infer<typeof siteNavSchema>;
export type SiteHero = z.infer<typeof siteHeroSchema>;
export type SiteHeroMetaItem = z.infer<typeof siteHeroMetaItemSchema>;
export type SiteDemo = z.infer<typeof siteDemoSchema>;
export type SiteFreeTier = z.infer<typeof siteFreeTierSchema>;
export type SitePricing = z.infer<typeof sitePricingSchema>;
export type SiteFooter = z.infer<typeof siteFooterSchema>;
export type SitePill = z.infer<typeof sitePillSchema>;
export type SiteTopbar = z.infer<typeof siteTopbarSchema>;
export type SiteKpi = z.infer<typeof siteKpiSchema>;
export type SiteEndpoint = z.infer<typeof siteEndpointSchema>;
export type SiteFooterStrip = z.infer<typeof siteFooterStripSchema>;
export type SiteReleases = z.infer<typeof siteReleasesSchema>;
export type SiteSettings = z.infer<typeof siteSettingsSchema>;

export interface ContentSource {
  getPost(slug: string): Promise<Post | null>;
  listPosts(opts?: { limit?: number; tag?: string }): Promise<Post[]>;
  getCaseStudy(slug: string): Promise<CaseStudy | null>;
  listCaseStudies(): Promise<CaseStudy[]>;
  getSiteSettings(): Promise<SiteSettings>;
}
