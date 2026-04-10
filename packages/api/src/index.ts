import { OpenAPIHono } from "@hono/zod-openapi";
import { cors } from "hono/cors";
import { handle } from "hono/aws-lambda";
import { requestId } from "./middleware/request-id.js";
import { auth } from "./middleware/auth.js";
import { usage } from "./middleware/usage.js";
import { addressRoutes } from "./routes/address.js";
import { getOpenSearchClient } from "./search/client.js";

const app = new OpenAPIHono();

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

// Global error handler — catches unhandled exceptions in all routes/middleware
app.onError((err, c) => {
  console.error("Unhandled error", {
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

// OpenSearch diagnostic — no auth (remove before prod)
app.get("/v1/health/opensearch", async (c) => {
  const client = getOpenSearchClient();
  const health = await client.cluster.health();
  const aliases = await client.cat.aliases({ format: "json" });
  const indices = await client.cat.indices({ format: "json" });
  return c.json({
    cluster: health.body,
    aliases: aliases.body,
    indices: indices.body,
  });
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
app.use("/v1/*", usage());

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
