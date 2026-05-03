import publicOpenApiSpec from "../../../../../../packages/docs/openapi.json";

import { getBillingPrincipal } from "../../../../lib/billing-auth.js";

export const dynamic = "force-dynamic";

export async function GET() {
  const principal = await getBillingPrincipal();
  if (principal instanceof Response) return principal;

  return Response.json(publicOpenApiSpec, {
    headers: {
      "Cache-Control": "private, max-age=300",
    },
  });
}
