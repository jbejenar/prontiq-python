import { env } from "../lib/env";
import { siteSettings } from "../lib/content/index";

export default function LandingPage() {
  return (
    <main>
      <p>Landing scaffold</p>
      <h1>{siteSettings.heroHeadline}</h1>
      <p>{siteSettings.heroSubheadline}</p>
      <p>API host: {env.NEXT_PUBLIC_API_URL}</p>
    </main>
  );
}
