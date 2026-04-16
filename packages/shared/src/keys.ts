import { createHash, randomBytes } from "node:crypto";

export const KEY_PREFIX = "pq_live_";
export const KEY_SUFFIX_BYTES = 24;
export const KEY_RAW_LENGTH = KEY_PREFIX.length + KEY_SUFFIX_BYTES * 2;
export const KEY_HASH_LENGTH = 64;
export const KEY_PREFIX_SAMPLE_LENGTH = KEY_PREFIX.length + 4;

export interface GeneratedKey {
  raw: string;
  hash: string;
  prefix: string;
}

export function generateKey(): GeneratedKey {
  const suffix = randomBytes(KEY_SUFFIX_BYTES).toString("hex");
  const raw = `${KEY_PREFIX}${suffix}`;
  return {
    raw,
    hash: hashKey(raw),
    prefix: raw.slice(0, KEY_PREFIX_SAMPLE_LENGTH),
  };
}

export function hashKey(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}
