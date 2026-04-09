import { Hono } from "hono";

export const patentsRoutes = new Hono();

// Phase 5 — Patent/trademark search routes
// GET /v1/patents/search?q=wireless+charging
// GET /v1/patents/lookup?application=2024123456
