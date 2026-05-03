import { getBillingPrincipal } from "../../../../../lib/billing-auth.js";
import { getPlaygroundDemoStatus } from "../../../../../lib/server-env.js";

export const dynamic = "force-dynamic";

export async function GET() {
  const principal = await getBillingPrincipal();
  if (principal instanceof Response) return principal;

  return Response.json(getPlaygroundDemoStatus(), {
    headers: {
      "Cache-Control": "private, no-store",
    },
  });
}
