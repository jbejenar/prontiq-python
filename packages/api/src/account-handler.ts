import { OpenAPIHono } from "@hono/zod-openapi";
import { handle } from "hono/aws-lambda";
import { cors } from "hono/cors";
import { createMiddleware } from "hono/factory";
import { SERVICE_NAMES, wrapLambdaHandler } from "@prontiq/observability";
import { createLogger, DEFAULT_ACCOUNT_URL } from "@prontiq/shared";
import { requestId } from "./middleware/request-id.js";
import { clerkJwt } from "./middleware/clerk-jwt.js";
import { accountRoutes } from "./routes/account.js";
import { keysRoutes } from "./routes/keys.js";
import { usageRoutes } from "./routes/usage.js";

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

export function getAccountCorsOrigin() {
  if (process.env.PRONTIQ_STAGE === "prod") {
    return process.env.PRONTIQ_ACCOUNT_URL?.trim() || DEFAULT_ACCOUNT_URL;
  }

  return "*";
}

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
app.use(
  "/v1/account/*",
  cors({
    origin: getAccountCorsOrigin,
    allowMethods: ["GET", "OPTIONS", "POST"],
    allowHeaders: ["Authorization", "Content-Type"],
  }),
);

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

// Lambda-wide ingress: identity only (`clerkJwt()` populates the
// principal — sub, org_id, org_role). Authorization is per-route:
// each route factory applies `clerkAdminOnly()` to the routes it owns
// that require admin. P1C.03 introduces the member-allowed `/keys`
// (list) route under the same `/v1/account` prefix, so the previous
// Lambda-wide `clerkAdminOnly()` was removed and pushed into the
// factories.
//
// Contract for any new route added under this prefix: the route factory
// declares its own member/admin posture internally. Admin-only routes
// apply `clerkAdminOnly()` inside the factory (not bolted on outside)
// so the default-instance export at the factory bottom stays
// default-secure for that route.
app.use("/v1/account/*", clerkJwt());
app.route("/v1/account", accountRoutes);
app.route("/v1/account", keysRoutes);
app.route("/v1/account", usageRoutes);

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
