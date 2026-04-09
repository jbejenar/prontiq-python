import { Hono } from "hono";

export const abnRoutes = new Hono();

// Phase 2 — ABN/ASIC verification routes
// GET /v1/abn/verify?abn=51824753556
// GET /v1/abn/search?q=acme
// GET /v1/abn/directors?acn=... (Starter+)
