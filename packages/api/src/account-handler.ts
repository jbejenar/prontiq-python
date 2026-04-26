import { OpenAPIHono } from "@hono/zod-openapi";
import { handle } from "hono/aws-lambda";
import { createMiddleware } from "hono/factory";
import { SERVICE_NAMES, wrapLambdaHandler } from "@prontiq/observability";
import { createLogger } from "@prontiq/shared";
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
 *     `verifyToken`) and `@prontiq/control-plane` (DDB SDK + Lago HTTP
 *     client + SES SigV4) to that bundle would inflate cold-start and
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
const logger = createLogger("api-account");

const requestLifecycleLogger = createMiddleware(async (c, next) => {
  const startedAt = Date.now();
  logger.info("request started", {
    method: c.req.method,
    path: c.req.path,
    request_id: c.get("requestId"),
  });
  await next();
  logger.info("request completed", {
    latency: Date.now() - startedAt,
    method: c.req.method,
    path: c.req.path,
    request_id: c.get("requestId"),
    status: c.res.status,
  });
});

app.use("*", requestId());
app.use("*", requestLifecycleLogger);

app.onError((err, c) => {
  logger.error("Unhandled error in PqAccount", {
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
//                          recorded ownerEmail / Lago customer.
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

const lambdaHandler = handle(app);

export const handler = wrapLambdaHandler({
  attributes: (event) => {
    const request = event as {
      rawPath?: string;
      requestContext?: { http?: { method?: string } };
    };
    return {
      "prontiq.method": request.requestContext?.http?.method ?? "UNKNOWN",
      "prontiq.route": request.rawPath ?? "/v1/account",
      "prontiq.stage": process.env.PRONTIQ_STAGE ?? "unknown",
    };
  },
  handler: lambdaHandler,
  serviceName: SERVICE_NAMES.api,
  spanName: "prontiq-api.account-request",
});
export default app;
