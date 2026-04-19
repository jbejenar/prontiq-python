import { OpenAPIHono } from "@hono/zod-openapi";
import { cors } from "hono/cors";
import { handle } from "hono/aws-lambda";
import { createMiddleware } from "hono/factory";
import { createLogger } from "@prontiq/shared";
import { requestId } from "./middleware/request-id.js";
import { auth } from "./middleware/auth.js";
import { addressRoutes } from "./routes/address.js";

/**
 * Address-API `$default` Lambda entry point — serves the hot path
 * (`/v1/health`, `/v1/address/*`).
 *
 * **Bundle isolation contract**: do NOT import `@prontiq/control-plane`
 * or `@clerk/backend` from this file or from any module it
 * transitively imports. SST/esbuild bundles each Lambda based on the
 * import graph rooted at its `handler` export — a stray import here
 * silently bloats the address-API bundle (slower cold-starts +
 * unrelated dep surface in the hot path).
 *
 * Account / Clerk-authenticated routes have their own Lambda entry
 * point at `account-handler.ts` (the `PqAccount` Function in
 * `sst.config.ts`). Mount new admin / control-plane endpoints there,
 * not here.
 */
const app = new OpenAPIHono();
const logger = createLogger("api");

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

// Global middleware
app.use(
  "*",
  cors({
    origin: "*",
    allowMethods: ["GET", "OPTIONS"],
    allowHeaders: ["X-Api-Key", "Content-Type"],
  }),
);
app.use("*", requestId());
app.use("*", requestLifecycleLogger);

// Global error handler — catches unhandled exceptions in all routes/middleware
app.onError((err, c) => {
  logger.error("Unhandled error", {
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

// Health check — no auth required
app.get("/v1/health", (c) => {
  return c.json({ status: "ok", timestamp: new Date().toISOString() });
});

app.doc31("/openapi.json", {
  openapi: "3.1.0",
  info: {
    title: "Prontiq API",
    version: "1.0.0",
    description: "Unified API for Australian and global open data products.",
  },
});

// Authenticated routes
app.use("/v1/*", auth());

// Product route groups
app.route("/v1/address", addressRoutes);

// 404 fallback
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
