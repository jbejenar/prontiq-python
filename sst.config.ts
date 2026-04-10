/// <reference path="./.sst/platform/config.d.ts" />

/**
 * Naming convention:
 * SST generates AWS names as: {app}-{stage}-{componentName}{ResourceType}-{hash}
 *
 * Component names are chosen so generated AWS names read naturally:
 *   "PqKeys"     → prontiq-dev-PqKeysTable-xxx           (DynamoDB)
 *   "PqApi"      → prontiq-dev-PqApiApi-xxx               (API Gateway)
 *   "PqPortal"   → prontiq-dev-PqPortalAssetsBucket-xxx   (Dashboard S3/CloudFront)
 *
 * App name: "prontiq" (short, clean AWS console names)
 */

const OPENSEARCH_DOMAIN_ARN = "arn:aws:es:ap-southeast-2:493712557159:domain/flat-white";
const OPENSEARCH_ENDPOINT_DEFAULT =
  "https://search-flat-white-lrsdymw7a4u56cu2lrvxa3ggve.ap-southeast-2.es.amazonaws.com";

export default $config({
  app(input) {
    return {
      name: "prontiq",
      removal: input?.stage === "prod" ? "retain" : "remove",
      protect: ["prod"].includes(input?.stage ?? ""),
      home: "aws",
      providers: {
        aws: {
          region: "ap-southeast-2",
        },
      },
    };
  },
  async run() {
    // -- DynamoDB: API key verification + usage counters --
    const keyTable = new sst.aws.Dynamo("PqKeys", {
      fields: {
        apiKey: "string",
      },
      primaryIndex: { hashKey: "apiKey" },
    });

    // -- API: Hono on Lambda (single handler for all routes) --
    const api = new sst.aws.ApiGatewayV2("PqApi", {
      cors: {
        allowOrigins: ["*"],
        allowMethods: ["GET", "OPTIONS"],
        allowHeaders: ["X-Api-Key", "Content-Type"],
      },
    });

    api.route("$default", {
      handler: "packages/api/src/index.handler",
      architecture: "arm64",
      runtime: "nodejs20.x",
      memory: "512 MB",
      timeout: "30 seconds",
      link: [keyTable],
      permissions: [
        {
          actions: ["es:ESHttpGet", "es:ESHttpPost", "es:ESHttpHead"],
          resources: [`${OPENSEARCH_DOMAIN_ARN}/*`],
        },
      ],
      environment: {
        OPENSEARCH_ENDPOINT: process.env.OPENSEARCH_ENDPOINT ?? OPENSEARCH_ENDPOINT_DEFAULT,
        API_KEY_TABLE_NAME: keyTable.name,
      },
    });

    // -- Dashboard: Next.js developer portal --
    const portal = new sst.aws.Nextjs("PqPortal", {
      path: "packages/dashboard",
      environment: {
        NEXT_PUBLIC_API_URL: api.url,
        NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ?? "",
        CLERK_SECRET_KEY: process.env.CLERK_SECRET_KEY ?? "",
        CLERK_WEBHOOK_SECRET: process.env.CLERK_WEBHOOK_SECRET ?? "",
      },
    });

    return {
      api: api.url,
      portal: portal.url,
    };
  },
});
