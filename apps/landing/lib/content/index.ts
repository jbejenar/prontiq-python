import siteSettingsJson from "../../content/site.json";

import { siteSettingsSchema } from "@prontiq/shared/content";

export const siteSettings = siteSettingsSchema.parse(siteSettingsJson);

export function getLandingStats() {
  return {
    topbar: siteSettings.topbar,
    kpis: siteSettings.kpis ?? [],
    endpoints: siteSettings.endpoints ?? [],
    footerStrip: siteSettings.footerStrip,
  };
}
