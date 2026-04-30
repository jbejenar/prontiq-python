import { z } from "zod";

import {
  createBillingActionStore,
  type BillingActionResponseBody,
} from "../../../../lib/billing-actions.js";
import {
  getBillingPrincipal,
  requireBillingAdmin,
  requireBillingReverification,
  requireSameOrigin,
} from "../../../../lib/billing-auth.js";
import { LagoBillingError } from "../../../../lib/billing-lago.js";
import { changeBillingPlan, externalSubscriptionIdForOrg } from "../../../../lib/billing-service.js";
import { getBillingActionsServerEnv } from "../../../../lib/server-env.js";

const planChangeRequestSchema = z.object({
  targetPlanCode: z.string().min(1).max(128),
});
const idempotencyKeySchema = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9._~:-]+$/);

export const runtime = "nodejs";

function jsonError(code: string, message: string, status: number) {
  return Response.json({ error: { code, message, status } }, { status });
}

function replayResponse(action: {
  errorCode?: string;
  errorMessage?: string;
  errorStatus?: number;
  responseBody?: BillingActionResponseBody;
  status: string;
}) {
  if (action.status === "provider_accepted" && action.responseBody) {
    return Response.json(action.responseBody);
  }
  if (action.status === "provider_in_flight") {
    return jsonError(
      "LAGO_PLAN_CHANGE_OUTCOME_UNKNOWN",
      "Billing plan change outcome is unknown. Inspect Lago before retrying.",
      409,
    );
  }
  return jsonError(
    action.errorCode ?? "LAGO_PLAN_CHANGE_FAILED",
    action.errorMessage ?? "Stored billing plan change failed.",
    action.errorStatus ?? 502,
  );
}

function mapPlanChangeError(error: unknown) {
  if (error instanceof Error) {
    if (error.message === "TARGET_PLAN_NOT_AVAILABLE") {
      return { code: "TARGET_PLAN_NOT_AVAILABLE", message: "Selected plan is not available.", status: 400 };
    }
    if (error.message === "PLAN_CHANGE_ALREADY_PENDING") {
      return {
        code: "PLAN_CHANGE_ALREADY_PENDING",
        message: "A Lago plan transition is already pending for this organization.",
        status: 409,
      };
    }
    if (error.message === "SUBSCRIPTION_NOT_FOUND") {
      return {
        code: "SUBSCRIPTION_NOT_FOUND",
        message: "Lago subscription was not found for this organization.",
        status: 404,
      };
    }
  }
  if (error instanceof LagoBillingError) {
    if (error.hasDetail("no_linked_payment_provider")) {
      return {
        code: "PAYMENT_PROVIDER_NOT_LINKED",
        message:
          "Billing is not ready for plan changes yet. The Lago customer has not been linked to Stripe.",
        status: 409,
      };
    }
    if (
      error.hasDetail("payment_method_required") ||
      error.hasDetail("no_payment_method") ||
      error.hasDetail("missing_payment_method")
    ) {
      return {
        code: "PAYMENT_METHOD_REQUIRED",
        message: "Set up a payment method before changing to this plan.",
        status: 409,
      };
    }
  }
  return {
    code: "LAGO_PLAN_CHANGE_FAILED",
    message: error instanceof Error ? error.message : "Could not change billing plan.",
    status: 502,
  };
}

export async function POST(request: Request) {
  const originResponse = requireSameOrigin(request);
  if (originResponse) return originResponse;

  const principal = await getBillingPrincipal();
  if (principal instanceof Response) return principal;
  const adminResponse = requireBillingAdmin(principal);
  if (adminResponse) return adminResponse;
  const reverificationResponse = requireBillingReverification(principal);
  if (reverificationResponse) return reverificationResponse;

  const idempotencyKey = request.headers.get("idempotency-key")?.trim();
  if (!idempotencyKey) {
    return jsonError("MISSING_IDEMPOTENCY_KEY", "Idempotency-Key header is required.", 400);
  }
  if (!idempotencyKeySchema.safeParse(idempotencyKey).success) {
    return jsonError(
      "INVALID_IDEMPOTENCY_KEY",
      "Idempotency-Key must be 1-256 URL-safe characters.",
      400,
    );
  }

  const rawBody = (await request.json().catch(() => undefined)) as unknown;
  const body = planChangeRequestSchema.safeParse(rawBody);
  if (!body.success) {
    return jsonError("INVALID_BILLING_REQUEST", "Plan change request body is invalid.", 400);
  }

  let billingActionsEnv: ReturnType<typeof getBillingActionsServerEnv>;
  try {
    billingActionsEnv = getBillingActionsServerEnv();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Billing action store is not configured.";
    return jsonError("BILLING_ACTIONS_NOT_CONFIGURED", message, 500);
  }
  if (!billingActionsEnv.enabled) {
    return jsonError("FEATURE_DISABLED", "Billing plan changes are not enabled.", 403);
  }
  if (billingActionsEnv.allowedOrgIds && !billingActionsEnv.allowedOrgIds.has(principal.orgId)) {
    return jsonError("ORG_NOT_ALLOWLISTED", "Billing plan changes are not enabled for this organization.", 403);
  }

  const actionInput = {
    actorUserId: principal.userId,
    externalSubscriptionId: externalSubscriptionIdForOrg(principal.orgId),
    idempotencyKey,
    orgId: principal.orgId,
    targetPlanCode: body.data.targetPlanCode,
  };
  let store: ReturnType<typeof createBillingActionStore>;
  try {
    store = createBillingActionStore();
  } catch {
    return jsonError(
      "BILLING_ACTION_LEDGER_UNAVAILABLE",
      "Billing action ledger is unavailable. No Lago plan change was attempted.",
      503,
    );
  }
  let inspected: Awaited<ReturnType<typeof store.inspect>>;
  try {
    inspected = await store.inspect(actionInput);
  } catch {
    return jsonError(
      "BILLING_ACTION_LEDGER_UNAVAILABLE",
      "Billing action ledger is unavailable. No Lago plan change was attempted.",
      503,
    );
  }
  if (inspected.kind === "conflict") {
    return jsonError("IDEMPOTENCY_CONFLICT", "Idempotency-Key was already used for a different request.", 409);
  }
  if (inspected.kind === "replay") return replayResponse(inspected.action);

  let claim: Awaited<ReturnType<typeof store.claim>>;
  try {
    claim = await store.claim(actionInput);
  } catch {
    return jsonError(
      "BILLING_ACTION_LEDGER_UNAVAILABLE",
      "Billing action ledger is unavailable. No Lago plan change was attempted.",
      503,
    );
  }
  if (claim.kind === "conflict") {
    return jsonError("IDEMPOTENCY_CONFLICT", "Idempotency-Key was already used for a different request.", 409);
  }
  if (claim.kind === "in_progress") {
    return jsonError("ACTION_IN_PROGRESS", "A billing plan change is already in progress.", 409);
  }
  if (claim.kind === "replay") return replayResponse(claim.action);

  let providerAction: typeof claim.action;
  try {
    providerAction = await store.markProviderMutationStarted({ action: claim.action });
  } catch {
    return jsonError(
      "BILLING_ACTION_LEDGER_UNAVAILABLE",
      "Billing action ledger is unavailable. No Lago plan change was attempted.",
      503,
    );
  }

  let result: BillingActionResponseBody;
  try {
    result = await changeBillingPlan({
      orgId: principal.orgId,
      targetPlanCode: body.data.targetPlanCode,
    });
  } catch (error) {
    const mapped = mapPlanChangeError(error);
    try {
      await store.finalizeFailure({
        action: providerAction,
        errorCode: mapped.code,
        errorMessage: mapped.message,
        errorStatus: mapped.status,
        status: mapped.status >= 500 ? "outcome_unknown" : "failed_permanent",
      });
    } catch {
      return jsonError(
        "BILLING_ACTION_FINALIZE_FAILED",
        "Lago rejected the plan change, but local replay evidence could not be finalized. Retry shortly.",
        500,
      );
    }
    return jsonError(mapped.code, mapped.message, mapped.status);
  }

  try {
    await store.finalizeSuccess({ action: providerAction, responseBody: result });
  } catch {
    return jsonError(
      "BILLING_ACTION_FINALIZE_FAILED",
      "Lago accepted the plan change, but local replay evidence could not be finalized. Retry shortly.",
      500,
    );
  }
  return Response.json(result);
}
