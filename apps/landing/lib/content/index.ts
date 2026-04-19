import siteSettingsJson from "../../content/site.json";

import { siteSettingsSchema } from "@prontiq/shared/content";

export const siteSettings = siteSettingsSchema.parse(siteSettingsJson);
