import { createMiddleware } from "hono/factory";
import { randomUUID } from "node:crypto";

declare module "hono" {
  interface ContextVariableMap {
    requestId: string;
  }
}

export function requestId() {
  return createMiddleware(async (c, next) => {
    const id = `req_${randomUUID()}`;
    c.set("requestId", id);
    c.header("X-Request-Id", id);
    await next();
  });
}
