import { z } from "zod";

import {
  getBillingPrincipal,
  requireBillingAdmin,
  requireSameOrigin,
} from "../../../../lib/billing-auth.js";
import { createCheckoutUrl } from "../../../../lib/billing-service.js";

const checkoutRequestSchema = z
  .object({
    intendedPlanCode: z.string().min(1).max(128).optional(),
  })
  .optional();

export async function POST(request: Request) {
  const originResponse = requireSameOrigin(request);
  if (originResponse) return originResponse;

  const principal = await getBillingPrincipal();
  if (principal instanceof Response) return principal;
  const adminResponse = requireBillingAdmin(principal);
  if (adminResponse) return adminResponse;

  const rawBody = (await request.json().catch(() => undefined)) as unknown;
  const body = checkoutRequestSchema.safeParse(rawBody);
  if (!body.success) {
    return Response.json(
      {
        error: {
          code: "INVALID_BILLING_REQUEST",
          message: "Checkout request body is invalid.",
          status: 400,
        },
      },
      { status: 400 },
    );
  }

  try {
    const checkoutUrl = await createCheckoutUrl({ orgId: principal.orgId });
    return Response.json({
      checkoutUrl,
      intendedPlanCode: body.data?.intendedPlanCode ?? null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not create checkout URL.";
    return Response.json(
      { error: { code: "BILLING_CHECKOUT_FAILED", message, status: 502 } },
      { status: 502 },
    );
  }
}
