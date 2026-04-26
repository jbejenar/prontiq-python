import { OpenAPIHono } from "@hono/zod-openapi";
import { addressRoutes } from "./routes/address.js";
import { accountRoutes } from "./routes/account.js";

/**
 * Documentation-only OpenAPI app.
 *
 * Production keeps address and account routes in separate Lambda entrypoints
 * for bundle/IAM isolation. The docs generator needs both contracts in one
 * spec without importing control-plane code into the address hot path.
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
app.route("/v1/account", accountRoutes);

export default app;
