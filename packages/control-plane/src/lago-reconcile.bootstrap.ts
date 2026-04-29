import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { SERVICE_NAMES, wrapLambdaHandler } from "@prontiq/observability";
import { HttpLagoEntitlementsClient } from "./lago-entitlements.js";
import { reconcileLagoEntitlements } from "./lago-reconcile.js";

export const handler = wrapLambdaHandler({
  attributes: () => ({
    "prontiq.billing.operation": "lago_reconcile",
    "prontiq.stage": process.env.PRONTIQ_STAGE ?? "unknown",
  }),
  handler: async () => {
    if (process.env.LAGO_RECONCILIATION_ENABLED !== "true") {
      return { status: "disabled" };
    }
    return reconcileLagoEntitlements({
      ddb: DynamoDBDocumentClient.from(new DynamoDBClient({})),
      keysTableName: process.env.KEYS_TABLE_NAME ?? "prontiq-keys",
      lagoClient: new HttpLagoEntitlementsClient({
        apiKey: process.env.LAGO_API_KEY ?? "",
        baseUrl: process.env.LAGO_API_URL ?? "",
      }),
      apply: true,
      logger: console,
      now: () => new Date(),
    });
  },
  serviceName: SERVICE_NAMES.billing,
  spanName: "prontiq-billing.lago-reconcile",
});
