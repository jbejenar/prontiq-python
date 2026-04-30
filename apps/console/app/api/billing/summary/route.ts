import { getBillingPrincipal } from "../../../../lib/billing-auth.js";
import { buildBillingSummary } from "../../../../lib/billing-service.js";

export async function GET() {
  const principal = await getBillingPrincipal();
  if (principal instanceof Response) return principal;

  try {
    const summary = await buildBillingSummary({
      orgId: principal.orgId,
      canManageBilling: principal.canManageBilling,
    });
    return Response.json(summary);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load billing.";
    return Response.json(
      { error: { code: "BILLING_LOAD_FAILED", message, status: 502 } },
      { status: 502 },
    );
  }
}
