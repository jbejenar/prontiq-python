import { z } from "zod";

import {
  getBillingPrincipal,
  requireBillingAdmin,
  requireSameOrigin,
} from "../../../../../lib/billing-auth.js";
import { LagoBillingError } from "../../../../../lib/billing-lago.js";
import { createInvoicePaymentUrl } from "../../../../../lib/billing-service.js";

const paymentUrlRequestSchema = z.object({
  invoiceId: z.string().min(1).max(256),
});

export async function POST(request: Request) {
  const originResponse = requireSameOrigin(request);
  if (originResponse) return originResponse;

  const principal = await getBillingPrincipal();
  if (principal instanceof Response) return principal;
  const adminResponse = requireBillingAdmin(principal);
  if (adminResponse) return adminResponse;

  const rawBody = (await request.json().catch(() => undefined)) as unknown;
  const body = paymentUrlRequestSchema.safeParse(rawBody);
  if (!body.success) {
    return Response.json(
      {
        error: {
          code: "INVALID_BILLING_REQUEST",
          message: "Invoice payment request body is invalid.",
          status: 400,
        },
      },
      { status: 400 },
    );
  }

  try {
    const paymentUrl = await createInvoicePaymentUrl({
      orgId: principal.orgId,
      invoiceId: body.data.invoiceId,
    });
    if (!paymentUrl) {
      return Response.json(
        {
          error: {
            code: "INVOICE_NOT_FOUND",
            message: "Invoice was not found for the active organization.",
            status: 404,
          },
        },
        { status: 404 },
      );
    }
    return Response.json({ paymentUrl });
  } catch (error) {
    if (
      error instanceof LagoBillingError &&
      (error.hasDetail("missing_payment_provider_customer") ||
        error.hasDetail("no_linked_payment_provider"))
    ) {
      return Response.json(
        {
          error: {
            code: "PAYMENT_PROVIDER_NOT_LINKED",
            message:
              "Billing is not ready for invoice payment links yet. Set up a payment method first.",
            status: 409,
          },
        },
        { status: 409 },
      );
    }
    const message = error instanceof Error ? error.message : "Could not create invoice payment URL.";
    return Response.json(
      { error: { code: "INVOICE_PAYMENT_URL_FAILED", message, status: 502 } },
      { status: 502 },
    );
  }
}
