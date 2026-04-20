import { headers } from "next/headers";

import { LandingShell } from "../components/landing/landing-shell.js";
import { resolveLandingAccountUrlFromHeaders } from "../lib/account-url.js";

export default async function LandingPage() {
  const accountUrl = resolveLandingAccountUrlFromHeaders(await headers());

  return <LandingShell accountUrl={accountUrl} />;
}
