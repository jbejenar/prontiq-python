import { OpenAPIHono } from "@hono/zod-openapi";
import { handle } from "hono/aws-lambda";
import { requestId } from "./middleware/request-id.js";
import { clerkAdminOnly, clerkJwt } from "./middleware/clerk-jwt.js";
import { accountRoutes } from "./routes/account.js";

/**
 * `PqAccount` Lambda entry point — serves Clerk-JWT-authenticated
 * `/v1/account/*` routes mounted on the existing `PqApi` ApiGatewayV2.
 *
 * Why a separate Lambda from the address-API `$default` handler:
 *   - The address-API hot path (15M-doc OpenSearch search) must keep
 *     its bundle minimal — adding `@clerk/backend` (Backend SDK +
 *     `verifyToken`) and `@prontiq/control-plane` (DDB SDK + Stripe
 *     SDK + SES SigV4) to that bundle would inflate cold-start and
 *     enlarge the IAM blast radius for no benefit.
 *   - Account routes are admin / low-QPS — extra cold-start on
 *     `/v1/account/setup` is acceptable in exchange for keeping the
 *     hot path minimal and isolating the more security-sensitive
 *     dependencies.
 *
 * The two Lambdas share the same ApiGatewayV2 endpoint (`api.prontiq.dev`):
 * `api.route("ANY /v1/account/{proxy+}", accountFn.arn)` is declared
 * BEFORE `$default` so explicit-route precedence routes `/v1/account/*`
 * here, leaving everything else to the address-API handler.
 *
 * Error envelope shape mirrors `packages/api/src/index.ts:21-42` so
 * client code parses 4xx/5xx identically across both Lambdas.
 */

const app = new OpenAPIHono();

app.use("*", requestId());

app.onError((err, c) => {
  console.error("Unhandled error in PqAccount", {
    request_id: c.get("requestId"),
    path: c.req.path,
    method: c.req.method,
    error: err.message,
    stack: err.stack,
  });
  return c.json(
    {
      error: {
        code: "INTERNAL_ERROR",
        message: "Internal server error",
        status: 500,
        request_id: c.get("requestId"),
      },
    },
    500,
  );
});

// Two-layer ingress contract for /v1/account/*:
//   1. clerkJwt()        — verify the session token, populate principal
//                          (sub, org_id, org_role) on the context.
//   2. clerkAdminOnly()  — gate on org_role ∈ getAdminRoles(). Mirrors
//                          the Clerk webhook's role gate so a non-admin
//                          can't race a delayed webhook and become the
//                          recorded ownerEmail / Stripe customer.
//
// Order matters: clerkAdminOnly() reads c.get("clerkPrincipal") which is
// populated by clerkJwt(). Default-secure-by-construction — every route
// added under /v1/account/* inherits both checks without per-route opt-in.
app.use("/v1/account/*", clerkJwt());
app.use("/v1/account/*", clerkAdminOnly());
app.route("/v1/account", accountRoutes);

app.notFound((c) => {
  return c.json(
    {
      error: {
        code: "NOT_FOUND",
        message: `Route not found: ${c.req.method} ${c.req.path}`,
        status: 404,
        request_id: c.get("requestId"),
      },
    },
    404,
  );
});

export const handler = handle(app);
export default app;
