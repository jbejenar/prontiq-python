import { OpenAPIHono } from "@hono/zod-openapi";
import { addressRoutes } from "./routes/address.js";

/**
 * Public documentation OpenAPI app.
 *
 * This spec is consumed by Mintlify and Speakeasy, so it must contain only the
 * public customer data API. Clerk-authenticated account/console routes belong
 * in `openapi-private.ts`.
 */
const app = new OpenAPIHono();

app.doc31("/openapi.json", {
  openapi: "3.1.0",
  info: {
    title: "Prontiq API",
    version: "1.0.0",
    description: "Unified API for Australian and global open data products.",
  },
});

app.route("/v1/address", addressRoutes);

export default app;
