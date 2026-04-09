import { Hono } from "hono";

export const cveRoutes = new Hono();

// Phase 5 — CVE/NVD vulnerability intel routes
// GET /v1/cve/lookup?cve=CVE-2024-1234
// GET /v1/cve/search?product=apache&version=2.4
