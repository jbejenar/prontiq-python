import test from "node:test";
import assert from "node:assert/strict";
import {
  assertManifestVersionProgression,
  buildAliasSwapActions,
  compareOpaqueVersions,
  evaluateBulkResponse,
  getSourceFiles,
  getSourceKeys,
  hexSha256ToBase64,
  resolveIndexSettings,
  versionFromIndexName,
} from "./lib.js";
import { manifestSchema } from "@prontiq/shared";
import type { ManifestV1, ManifestV2 } from "@prontiq/shared";

function makeAddressManifest(version = "2026-02-6"): ManifestV1 {
  return {
    manifest_version: 1,
    product: "address",
    version,
    created_at: "2026-04-11T01:15:23Z",
    pipeline: {
      repo: "jbejenar/flat-white",
      commit: "806dbad2a4caff453b8a3a34d8032d2d4d32ac00",
      run_id: "24269946484",
    },
    source: {
      name: "G-NAF",
      release: "February 2026",
      url: "https://data.gov.au/dataset/geocoded-national-address-file-g-naf",
    },
    files: [
      {
        key: `data/address/${version}/all.ndjson.gz`,
        records: 15015573,
        bytes: 1702942457,
        sha256: "2d1b97f06006644fcfeaf1208f831a5db681ac9a540f27781f785c6df9478381",
      },
    ],
    total_records: 15015573,
    index: {
      mappings_key: `data/address/${version}/mappings.json`,
      settings: {
        number_of_shards: 1,
        number_of_replicas: 0,
      },
    },
  };
}

function makeAddressManifestV2(version = "2026-02-7"): ManifestV2 {
  return {
    manifest_version: 2,
    product: "address",
    version,
    created_at: "2026-04-11T10:00:00Z",
    pipeline: {
      repo: "jbejenar/flat-white",
      commit: "abc123def456",
      run_id: "99999999",
    },
    source: {
      name: "G-NAF",
      release: "February 2026",
      url: "https://data.gov.au/dataset/geocoded-national-address-file-g-naf",
    },
    files: [
      {
        key: `data/address/${version}/nsw.ndjson.gz`,
        records: 3000000,
        bytes: 500000000,
        sha256: "aa11bb22cc33dd44ee55ff66aa11bb22cc33dd44ee55ff66aa11bb22cc33dd44",
      },
      {
        key: `data/address/${version}/vic.ndjson.gz`,
        records: 2500000,
        bytes: 400000000,
        sha256: "bb22cc33dd44ee55ff66aa11bb22cc33dd44ee55ff66aa11bb22cc33dd44ee55",
      },
      {
        key: `data/address/${version}/qld.ndjson.gz`,
        records: 2000000,
        bytes: 350000000,
        sha256: "cc33dd44ee55ff66aa11bb22cc33dd44ee55ff66aa11bb22cc33dd44ee55ff66",
      },
      {
        key: `data/address/${version}/all.ndjson.gz`,
        records: 15015573,
        bytes: 1702942457,
        sha256: "dd44ee55ff66aa11bb22cc33dd44ee55ff66aa11bb22cc33dd44ee55ff66aa11",
      },
    ],
    total_records: 15015573,
    index: {
      mappings_key: `data/address/${version}/mappings.json`,
      settings: {
        number_of_shards: 1,
        number_of_replicas: 0,
      },
      source_keys: [`data/address/${version}/all.ndjson.gz`],
    },
  };
}

// --- Schema parsing ---

test("manifestSchema parses v1 manifests correctly", () => {
  const result = manifestSchema.parse(makeAddressManifest());
  assert.equal(result.manifest_version, 1);
  assert.equal(result.product, "address");
});

test("manifestSchema parses v2 manifests correctly", () => {
  const result = manifestSchema.parse(makeAddressManifestV2());
  assert.equal(result.manifest_version, 2);
  if (result.manifest_version === 2) {
    assert.deepEqual(result.index.source_keys, ["data/address/2026-02-7/all.ndjson.gz"]);
  }
});

test("manifestSchema rejects unknown manifest_version", () => {
  const bad = { ...makeAddressManifest(), manifest_version: 3 };
  assert.throws(() => manifestSchema.parse(bad));
});

// --- Source key resolution ---

test("getSourceKeys returns source_keys for v2 manifests", () => {
  const keys = getSourceKeys(makeAddressManifestV2());
  assert.deepEqual(keys, ["data/address/2026-02-7/all.ndjson.gz"]);
});

test("getSourceKeys returns all file keys for v1 manifests", () => {
  const keys = getSourceKeys(makeAddressManifest());
  assert.deepEqual(keys, ["data/address/2026-02-6/all.ndjson.gz"]);
});

test("getSourceFiles returns single source file for v2 Address", () => {
  const files = getSourceFiles(makeAddressManifestV2());
  assert.equal(files.length, 1);
  assert.equal(files[0]!.key, "data/address/2026-02-7/all.ndjson.gz");
});

test("getSourceFiles enforces single_file policy on v1 Address", () => {
  const manifest = makeAddressManifest();
  const files = getSourceFiles(manifest);
  assert.equal(files.length, 1);
  assert.equal(files[0]!.key, "data/address/2026-02-6/all.ndjson.gz");
});

test("getSourceFiles rejects v2 source_keys referencing non-existent file", () => {
  const manifest = makeAddressManifestV2();
  manifest.index.source_keys = ["data/address/2026-02-7/nonexistent.ndjson.gz"];
  assert.throws(() => getSourceFiles(manifest), /not found in manifest files/);
});

test("getSourceFiles rejects v1 multi-file manifest for single_file Address policy", () => {
  const manifest = makeAddressManifest();
  manifest.files.push({
    key: "data/address/2026-02-6/extra.ndjson.gz",
    records: 1,
    bytes: 1,
    sha256: "ee55ff66aa11bb22cc33dd44ee55ff66aa11bb22cc33dd44ee55ff66aa11bb22",
  });
  assert.throws(() => getSourceFiles(manifest), /exactly one source file/);
});

test("getSourceFiles rejects duplicate source_keys", () => {
  const manifest = makeAddressManifestV2();
  manifest.index.source_keys = [
    "data/address/2026-02-7/all.ndjson.gz",
    "data/address/2026-02-7/all.ndjson.gz",
  ];
  assert.throws(() => getSourceFiles(manifest), /Duplicate source_keys/);
});

test("manifestSchema rejects v2 manifests without source_keys", () => {
  const bad = { ...makeAddressManifest(), manifest_version: 2 } as unknown;
  assert.throws(() => manifestSchema.parse(bad));
});

// --- Checksum ---

test("hexSha256ToBase64 normalizes manifest checksum to S3 format", () => {
  assert.equal(
    hexSha256ToBase64("2d1b97f06006644fcfeaf1208f831a5db681ac9a540f27781f785c6df9478381"),
    "LRuX8GAGZE/P6vEgj4MaXbaBrJpUDyd4H3hcbflHg4E=",
  );
});

// --- Version ordering ---

test("compareOpaqueVersions orders patch-style versions correctly", () => {
  assert.equal(compareOpaqueVersions("2026-02-6", "2026-02-5"), 1);
  assert.equal(compareOpaqueVersions("2026-02-6", "2026-02-6"), 0);
  assert.equal(compareOpaqueVersions("2026-02-5", "2026-02-6"), -1);
});

test("versionFromIndexName extracts the opaque version from an index name", () => {
  assert.equal(versionFromIndexName("address", "address-2026-02-6"), "2026-02-6");
  assert.equal(versionFromIndexName("address", "abn-2026-02-6"), null);
});

test("assertManifestVersionProgression rejects stale versions unless forced", () => {
  assert.throws(
    () =>
      assertManifestVersionProgression({
        product: "address",
        manifestVersion: "2026-02-5",
        currentLiveIndex: "address-2026-02-6",
      }),
    /older than live version/,
  );

  assert.throws(
    () =>
      assertManifestVersionProgression({
        product: "address",
        manifestVersion: "2026-02-6",
        currentLiveIndex: "address-2026-02-6",
      }),
    /already matches the live alias target/,
  );

  assert.doesNotThrow(() =>
    assertManifestVersionProgression({
      product: "address",
      manifestVersion: "2026-02-5",
      currentLiveIndex: "address-2026-02-6",
      force: true,
    }),
  );
});

// --- Index settings ---

test("resolveIndexSettings applies Phase 1 Address shard and replica defaults", () => {
  const settings = resolveIndexSettings(makeAddressManifest());
  assert.deepEqual(settings, {
    number_of_shards: 1,
    number_of_replicas: 0,
    refresh_interval: "-1",
    codec: "best_compression",
  });
});

// --- Bulk response ---

test("evaluateBulkResponse returns success counts when there are no bulk errors", () => {
  assert.deepEqual(evaluateBulkResponse(3, { errors: false }), {
    ingested: 3,
    failed: 0,
  });
});

test("evaluateBulkResponse throws when failure rate exceeds the threshold", () => {
  assert.throws(
    () =>
      evaluateBulkResponse(2, {
        errors: true,
        items: [
          { index: { status: 201 } },
          { index: { status: 400, error: { type: "mapper_parsing_exception" } } },
        ],
      }),
    /failure rate/,
  );
});

// --- Alias swap actions ---

test("buildAliasSwapActions keeps dry-run safe and constructs atomic swap actions", () => {
  assert.deepEqual(
    buildAliasSwapActions({
      alias: "addresses",
      indexName: "address-2026-02-7",
      previousIndex: null,
    }),
    [{ add: { index: "address-2026-02-7", alias: "addresses" } }],
  );

  assert.deepEqual(
    buildAliasSwapActions({
      alias: "addresses",
      indexName: "address-2026-02-7",
      previousIndex: "address-2026-02-6",
    }),
    [
      { remove: { index: "address-2026-02-6", alias: "addresses" } },
      { add: { index: "address-2026-02-7", alias: "addresses" } },
    ],
  );
});
