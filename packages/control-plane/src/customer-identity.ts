import { monotonicFactory } from "ulid";

const ulid = monotonicFactory();

export function generateCustomerId(now: Date = new Date()): string {
  return `pq_cust_${ulid(now.getTime())}`;
}
