import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { SERVICE_NAMES, wrapLambdaHandler } from "@prontiq/observability";
import { createLogger, type UsageCounterRecord } from "@prontiq/shared";
import Stripe from "stripe";
import {
  ACTIVE_REGISTRY_KEY,
  RETIRED_REGISTRY_KEY,
  type BillingLogger,
  buildUsageScopeIndex,
  discoverAttributionChain,
  discoverProductsForMonth,
  getPreviousMonthKey,
  loadKey,
  loadRegistryApiKeyHashes,
  loadUsageRowsForHash,
  reconcileBillingScope,
  type RegistryMembershipState,
} from "./billing-runtime.js";

export interface MonthCloseDependencies {
  ddb: DynamoDBDocumentClient;
  keysTableName: string;
  logger: BillingLogger;
  stripe: Stripe;
  usageTableName: string;
}

export interface MonthCloseSummary {
  closedScopes: number;
  keysProcessed: number;
  meterEventsSent: number;
  negativeDeltas: number;
  scopesSkipped: number;
}

let cachedDdb: DynamoDBDocumentClient | undefined;
let cachedStripe: Stripe | undefined;
const defaultLogger = createLogger("control-plane-month-close");

function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function getDefaultDdb(): DynamoDBDocumentClient {
  if (!cachedDdb) {
    cachedDdb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
  }
  return cachedDdb;
}

function getDefaultStripe(): Stripe {
  if (!cachedStripe) {
    cachedStripe = new Stripe(getRequiredEnv("STRIPE_SECRET_KEY"), { maxNetworkRetries: 3 });
  }
  return cachedStripe;
}

export function createMonthCloseService(
  overrides: Partial<MonthCloseDependencies> = {},
): { handleTick: (now?: Date) => Promise<MonthCloseSummary> } {
  function resolveDependencies(): MonthCloseDependencies {
    return {
      ddb: overrides.ddb ?? getDefaultDdb(),
      keysTableName: overrides.keysTableName ?? getRequiredEnv("KEYS_TABLE_NAME"),
      logger: overrides.logger ?? defaultLogger,
      stripe: overrides.stripe ?? getDefaultStripe(),
      usageTableName: overrides.usageTableName ?? getRequiredEnv("USAGE_TABLE_NAME"),
    };
  }

  async function handleTick(now = new Date()): Promise<MonthCloseSummary> {
    const dependencies = resolveDependencies();
    const summary: MonthCloseSummary = {
      closedScopes: 0,
      keysProcessed: 0,
      meterEventsSent: 0,
      negativeDeltas: 0,
      scopesSkipped: 0,
    };

    const activeApiKeyHashes = await loadRegistryApiKeyHashes(
      dependencies.ddb,
      dependencies.keysTableName,
      ACTIVE_REGISTRY_KEY,
    );
    const retiredApiKeyHashes = await loadRegistryApiKeyHashes(
      dependencies.ddb,
      dependencies.keysTableName,
      RETIRED_REGISTRY_KEY,
    );
    const registryStatuses = new Map<string, RegistryMembershipState>();
    for (const hash of activeApiKeyHashes) {
      const current = registryStatuses.get(hash) ?? { active: false, retired: false };
      current.active = true;
      registryStatuses.set(hash, current);
    }
    for (const hash of retiredApiKeyHashes) {
      const current = registryStatuses.get(hash) ?? { active: false, retired: false };
      current.retired = true;
      registryStatuses.set(hash, current);
    }

    const previousMonthKey = getPreviousMonthKey(now);

    for (const [apiKeyHash, registryStatus] of registryStatuses) {
      const key = await loadKey(dependencies.ddb, dependencies.keysTableName, apiKeyHash);
      const canProcessForBilling = registryStatus.retired || key?.active === true;
      if (!key || !key.stripeCustomerId || !canProcessForBilling) {
        summary.scopesSkipped += 1;
        continue;
      }

      summary.keysProcessed += 1;
      const chain = await discoverAttributionChain(dependencies.ddb, dependencies.usageTableName, apiKeyHash);
      const usageRowsByHash = new Map<string, Map<string, UsageCounterRecord>>();
      for (const hash of chain) {
        const rows = await loadUsageRowsForHash(dependencies.ddb, dependencies.usageTableName, hash);
        usageRowsByHash.set(hash, buildUsageScopeIndex(rows));
      }

      const productsToProcess = discoverProductsForMonth(key.products, usageRowsByHash, chain, previousMonthKey);
      if (productsToProcess.length === 0) {
        summary.scopesSkipped += 1;
        continue;
      }

      for (const product of productsToProcess) {
        const result = await reconcileBillingScope({
          chain,
          closeAfterFinalize: true,
          currentHash: apiKeyHash,
          ddb: dependencies.ddb,
          logger: dependencies.logger,
          monthKey: previousMonthKey,
          now,
          product,
          stripe: dependencies.stripe,
          stripeCustomerId: key.stripeCustomerId,
          usageRowsByHash,
          usageTableName: dependencies.usageTableName,
        });
        summary.closedScopes += result.closedScopes;
        summary.meterEventsSent += result.meterEventsSent;
        summary.negativeDeltas += result.negativeDeltas;
        summary.scopesSkipped += result.scopesSkipped;
      }
    }

    dependencies.logger.info("Month-close completed", summary);
    return summary;
  }

  return { handleTick };
}

async function monthCloseHandler(): Promise<MonthCloseSummary> {
  return createMonthCloseService().handleTick();
}

export const handler = wrapLambdaHandler({
  attributes: () => ({
    "prontiq.billing.operation": "month_close",
    "prontiq.stage": process.env.PRONTIQ_STAGE ?? "unknown",
  }),
  handler: monthCloseHandler,
  serviceName: SERVICE_NAMES.billing,
  spanName: "prontiq-billing.month-close",
});
