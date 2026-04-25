import { createHash } from "node:crypto";
import { z } from "zod";

export const LAGO_WEBHOOK_EVENT_TYPES = [
  "subscription.started",
  "subscription.terminated",
  "invoice.created",
  "invoice.payment_overdue",
  "invoice.payment_status_updated",
] as const;

export const lagoWebhookEventTypeSchema = z.enum(LAGO_WEBHOOK_EVENT_TYPES);

export type LagoWebhookEventType = z.infer<typeof lagoWebhookEventTypeSchema>;

export type LagoWebhookProcessingStatus =
  | "processing"
  | "completed"
  | "ignored"
  | "drift"
  | "failed_retryable";

export interface LagoWebhookLedgerRecord {
  uniqueKey: string;
  eventType: string;
  payloadHash: string;
  status: LagoWebhookProcessingStatus;
  customerId?: string;
  orgId?: string;
  firstSeenAt: string;
  lastSeenAt: string;
  completedAt?: string;
  lastError?: string;
  ttl: number;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  return `{${entries
    .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
    .join(",")}}`;
}

export function hashLagoWebhookPayload(payload: unknown): string {
  return createHash("sha256").update(stableStringify(payload)).digest("hex");
}

export function isConsumedLagoWebhookEventType(value: string): value is LagoWebhookEventType {
  return lagoWebhookEventTypeSchema.safeParse(value).success;
}
