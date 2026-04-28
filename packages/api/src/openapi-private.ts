import { OpenAPIHono } from "@hono/zod-openapi";
import { accountRoutes } from "./routes/account.js";
import { keysRoutes } from "./routes/keys.js";

/**
 * Private documentation OpenAPI app.
 *
 * This spec documents Clerk-authenticated console/account routes for internal
 * frontend and operator use. It is intentionally not consumed by Mintlify's
 * public docs or Speakeasy SDK generation.
 */
const app = new OpenAPIHono();

app.doc31("/openapi.json", {
  openapi: "3.1.0",
  info: {
    title: "Prontiq Private Account API",
    version: "1.0.0",
    description: "Private Clerk-authenticated account and console API contracts.",
  },
});

app.route("/v1/account", accountRoutes);
app.route("/v1/account", keysRoutes);

export default app;
