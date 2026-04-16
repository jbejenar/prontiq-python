import test from "node:test";
import assert from "node:assert/strict";
import {
  KEY_HASH_LENGTH,
  KEY_PREFIX,
  KEY_PREFIX_SAMPLE_LENGTH,
  KEY_RAW_LENGTH,
  generateKey,
  hashKey,
} from "./keys.js";

test("generateKey returns { raw, hash, prefix }", () => {
  const key = generateKey();
  assert.equal(typeof key.raw, "string");
  assert.equal(typeof key.hash, "string");
  assert.equal(typeof key.prefix, "string");
});

test("generateKey raw starts with pq_live_ and is 56 chars", () => {
  const { raw } = generateKey();
  assert.equal(raw.startsWith(KEY_PREFIX), true);
  assert.equal(raw.length, KEY_RAW_LENGTH);
  assert.equal(raw.length, 56);
});

test("generateKey raw suffix is 48 lowercase hex chars", () => {
  const { raw } = generateKey();
  const suffix = raw.slice(KEY_PREFIX.length);
  assert.equal(suffix.length, 48);
  assert.match(suffix, /^[a-f0-9]{48}$/);
});

test("generateKey hash is 64 lowercase hex chars (SHA-256)", () => {
  const { hash } = generateKey();
  assert.equal(hash.length, KEY_HASH_LENGTH);
  assert.match(hash, /^[a-f0-9]{64}$/);
});

test("generateKey prefix equals raw.slice(0, 12)", () => {
  const { raw, prefix } = generateKey();
  assert.equal(prefix, raw.slice(0, KEY_PREFIX_SAMPLE_LENGTH));
  assert.equal(prefix.length, 12);
  assert.equal(prefix.startsWith(KEY_PREFIX), true);
});

test("hashKey matches generateKey().hash for the same raw", () => {
  const key = generateKey();
  assert.equal(hashKey(key.raw), key.hash);
});

test("hashKey is deterministic — same input yields same output across calls", () => {
  const raw = "pq_live_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  assert.equal(hashKey(raw), hashKey(raw));
});

test("hashKey produces distinct outputs for distinct inputs", () => {
  const a = hashKey("pq_live_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  const b = hashKey("pq_live_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
  assert.notEqual(a, b);
});

test("hashKey matches a known SHA-256 vector", () => {
  // echo -n "pq_live_test" | shasum -a 256
  assert.equal(
    hashKey("pq_live_test"),
    "8058c7ce87c958a8e2fa3e71438fdace77227389338d02dd0d100d8dcb67349a",
  );
});

test("1000 successive generateKey() calls produce no duplicate raw or hash values", () => {
  const raws = new Set<string>();
  const hashes = new Set<string>();
  for (let i = 0; i < 1000; i++) {
    const { raw, hash } = generateKey();
    raws.add(raw);
    hashes.add(hash);
  }
  assert.equal(raws.size, 1000);
  assert.equal(hashes.size, 1000);
});
