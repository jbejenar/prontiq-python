import { createHash } from "node:crypto";
import { z } from "zod";

export const BILLING_EVENT_VERSION = 1;

export const billingUsageEventV1Schema = z.object({
  version: z.literal(BILLING_EVENT_VERSION),
  eventId: z.string().regex(/^bevt_[a-f0-9]{32}$/),
  occurredAt: z.string().datetime(),
  customerId: z.string().regex(/^pq_cust_[0-9A-HJKMNP-TV-Z]{26}$/),
  orgId: z.string().min(1),
  apiKeyHash: z.string().min(32),
  keyPrefix: z.string().min(1),
  product: z.string().min(1),
  billingEndpointKey: z.string().min(1),
  meterEventName: z.string().min(1),
  creditDelta: z.number().int().positive(),
  usageScope: z.string().min(1),
  requestCountAfterIncrement: z.number().int().nonnegative(),
  source: z.object({
    requestId: z.string().min(1),
    method: z.string().min(1),
    path: z.string().min(1),
    stage: z.string().min(1),
  }),
});

export type BillingUsageEventV1 = z.infer<typeof billingUsageEventV1Schema>;

export interface BillingEventIdInput {
  apiKeyHash: string;
  billingEndpointKey: string;
  creditDelta: number;
  customerId: string;
  requestCountAfterIncrement: number;
  usageScope: string;
}

export function deriveBillingUsageEventId(input: BillingEventIdInput): string {
  const raw = [
    "v1",
    input.customerId,
    input.apiKeyHash,
    input.usageScope,
    String(input.requestCountAfterIncrement),
    input.billingEndpointKey,
    String(input.creditDelta),
  ].join("|");
  return `bevt_${createHash("sha256").update(raw).digest("hex").slice(0, 32)}`;
}

export function deriveLagoExternalSubscriptionId(customerId: string): string {
  const match = /^pq_cust_([0-9A-HJKMNP-TV-Z]{26})$/.exec(customerId);
  if (!match) {
    throw new Error("customerId must match pq_cust_<ulid>");
  }
  return `pq_sub_${match[1]}`;
}
