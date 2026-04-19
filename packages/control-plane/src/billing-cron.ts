import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { createLogger, type UsageCounterRecord } from "@prontiq/shared";
import Stripe from "stripe";
import {
  ACTIVE_REGISTRY_KEY,
  RETIRED_REGISTRY_KEY,
  type BillingLogger,
  buildUsageScopeIndex,
  discoverAttributionChain,
  discoverProductsForMonth,
  getBillingMonthKeys,
  getRetirementBlockingMonthKeys,
  hasOutstandingBillableUsage,
  loadKey,
  loadRegistryApiKeyHashes,
  loadUsageRowsForHash,
  reconcileBillingScope,
  type RegistryMembershipState,
  updateRegistryMembership,
} from "./billing-runtime.js";

export interface BillingCronDependencies {
  ddb: DynamoDBDocumentClient;
  keysTableName: string;
  logger: BillingLogger;
  stripe: Stripe;
  usageTableName: string;
}

export interface BillingCronSummary {
  keysProcessed: number;
  meterEventsSent: number;
  negativeDeltas: number;
  scopesSkipped: number;
}

let cachedDdb: DynamoDBDocumentClient | undefined;
let cachedStripe: Stripe | undefined;
const defaultLogger = createLogger("control-plane-billing-cron");

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

export function createBillingCronService(
  overrides: Partial<BillingCronDependencies> = {},
): { handleTick: (now?: Date) => Promise<BillingCronSummary> } {
  async function resolveStripe(): Promise<Stripe> {
    if (overrides.stripe) {
      return overrides.stripe;
    }
    return getDefaultStripe();
  }

  async function handleTick(now = new Date()): Promise<BillingCronSummary> {
    const dependencies: BillingCronDependencies = {
      ddb: overrides.ddb ?? getDefaultDdb(),
      keysTableName: overrides.keysTableName ?? getRequiredEnv("KEYS_TABLE_NAME"),
      logger: overrides.logger ?? defaultLogger,
      stripe: await resolveStripe(),
      usageTableName: overrides.usageTableName ?? getRequiredEnv("USAGE_TABLE_NAME"),
    };
    const summary: BillingCronSummary = {
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

    const monthKeys = getBillingMonthKeys(now);
    const retirementBlockingMonthKeys = getRetirementBlockingMonthKeys(now);

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

      for (const monthKey of monthKeys) {
        const productsToProcess = discoverProductsForMonth(key.products, usageRowsByHash, chain, monthKey);
        if (productsToProcess.length === 0) {
          summary.scopesSkipped += 1;
          continue;
        }

        for (const product of productsToProcess) {
          const result = await reconcileBillingScope({
            chain,
            currentHash: apiKeyHash,
            ddb: dependencies.ddb,
            logger: dependencies.logger,
            monthKey,
            now,
            product,
            stripe: dependencies.stripe,
            stripeCustomerId: key.stripeCustomerId,
            usageRowsByHash,
            usageTableName: dependencies.usageTableName,
          });
          summary.meterEventsSent += result.meterEventsSent;
          summary.negativeDeltas += result.negativeDeltas;
          summary.scopesSkipped += result.scopesSkipped;
        }
      }

      if (
        registryStatus.retired &&
        !hasOutstandingBillableUsage(apiKeyHash, retirementBlockingMonthKeys, usageRowsByHash, chain)
      ) {
        await updateRegistryMembership(
          dependencies.ddb,
          dependencies.keysTableName,
          RETIRED_REGISTRY_KEY,
          [apiKeyHash],
          "delete",
        );
      }
    }

    dependencies.logger.info("Billing cron completed", summary);
    return summary;
  }

  return { handleTick };
}

export async function handler(): Promise<BillingCronSummary> {
  return createBillingCronService().handleTick();
}
