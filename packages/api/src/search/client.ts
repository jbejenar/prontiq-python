import { Client } from "@opensearch-project/opensearch";
import { AwsSigv4Signer } from "@opensearch-project/opensearch/aws";

let _client: Client | undefined;

/**
 * Lazy-initialized OpenSearch client. Persists across warm Lambda invocations
 * but doesn't crash Lambda init if OPENSEARCH_ENDPOINT is not set.
 */
export function getOpenSearchClient(): Client {
  if (!_client) {
    const endpoint = process.env.OPENSEARCH_ENDPOINT;
    if (!endpoint) {
      throw new Error("OPENSEARCH_ENDPOINT environment variable is not set");
    }
    _client = new Client({
      ...AwsSigv4Signer({
        region: process.env.AWS_REGION ?? "ap-southeast-2",
        service: "es",
      }),
      node: endpoint,
      maxRetries: 2,
      requestTimeout: 10_000,
    });
  }
  return _client;
}

/**
 * Test-only: inject a mock client. Pass `undefined` to reset.
 * Do not call from production code.
 */
export function __setClientForTesting(client: Client | undefined): void {
  _client = client;
}
