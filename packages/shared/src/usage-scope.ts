import type { ApiKeyRecord } from "./types.js";

export type CounterPeriodSource = "calendar" | "lago";

export interface ParsedUsageScope {
  product: string;
  periodKey: string;
  source: CounterPeriodSource;
}

export function getMonthKey(now: Date): string {
  return now.toISOString().slice(0, 7);
}

export function getCalendarResetAt(now: Date): string {
  const nextMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return nextMonth.toISOString();
}

export function buildUsageScope(input: {
  counterPeriodSource: CounterPeriodSource;
  now: Date;
  product: string;
  record: Pick<ApiKeyRecord, "billingPeriodKey">;
}): string {
  if (input.counterPeriodSource === "lago" && input.record.billingPeriodKey) {
    return `${input.product}#period#${input.record.billingPeriodKey}`;
  }
  return `${input.product}#${getMonthKey(input.now)}`;
}

export function buildUsageResetAt(input: {
  counterPeriodSource: CounterPeriodSource;
  now: Date;
  record: Pick<ApiKeyRecord, "billingPeriodEndingAt">;
}): string {
  if (input.counterPeriodSource === "lago" && input.record.billingPeriodEndingAt) {
    const parsed = new Date(input.record.billingPeriodEndingAt);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
  }
  return getCalendarResetAt(input.now);
}

export function parseUsageScope(scope: string): ParsedUsageScope | null {
  const lago = /^([^#]+)#period#(\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2})$/.exec(scope);
  if (lago?.[1] && lago[2]) {
    return { product: lago[1], periodKey: lago[2], source: "lago" };
  }

  const calendar = /^([^#]+)#(\d{4}-\d{2})$/.exec(scope);
  if (calendar?.[1] && calendar[2]) {
    return { product: calendar[1], periodKey: calendar[2], source: "calendar" };
  }

  return null;
}
