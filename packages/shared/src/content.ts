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

export const siteSettingsSchema = z.object({
  heroHeadline: z.string().min(1),
  heroSubheadline: z.string().min(1),
  ctaPrimary: z.string().min(1),
  ctaSecondary: z.string().min(1),
  pricingIntro: z.string().min(1),
  featuresIntro: z.string().min(1),
});

export type Post = z.infer<typeof postSchema>;
export type CaseStudyMetric = z.infer<typeof caseStudyMetricSchema>;
export type CaseStudy = z.infer<typeof caseStudySchema>;
export type SiteSettings = z.infer<typeof siteSettingsSchema>;

export interface ContentSource {
  getPost(slug: string): Promise<Post | null>;
  listPosts(opts?: { limit?: number; tag?: string }): Promise<Post[]>;
  getCaseStudy(slug: string): Promise<CaseStudy | null>;
  listCaseStudies(): Promise<CaseStudy[]>;
  getSiteSettings(): Promise<SiteSettings>;
}
