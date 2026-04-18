import { createHash, createHmac } from "node:crypto";
import { ConditionalCheckFailedException, DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import {
  PLANS,
  PRODUCT_REGISTRY,
  getBillingEndpointsForProduct,
  type ApiKeyRecord,
  type ApiKeySubscriptionItems,
  type OrgEnvelopeRecord,
  type StripeWebhookCompletionRecord,
  type Tier,
} from "@prontiq/shared";
import Stripe from "stripe";
import { writeAudit } from "./audit.js";

type Logger = Pick<Console, "error" | "warn" | "info">;

export interface BillingEmailInput {
  billingUrl: string;
  fromEmail: string;
  region: string;
  toEmail: string;
}

export type BillingEmailSender = (input: BillingEmailInput) => Promise<boolean>;

export interface StripeBillingDependencies {
  auditTableName: string;
  ddb: DynamoDBDocumentClient;
  keysTableName: string;
  logger: Logger;
  sendPaymentFailureEmail: BillingEmailSender;
  stripe: Stripe;
  suppressionsTableName: string;
  usageTableName: string;
}

type StripeMutatingEventType =
  | "checkout.session.completed"
  | "customer.subscription.updated"
  | "customer.subscription.deleted";

export type StripeWebhookHandleResult =
  | { status: "processed"; httpStatus: number; body: Record<string, unknown> }
  | { status: "duplicate"; httpStatus: number; body: Record<string, unknown> }
  | { status: "retryable_failure"; httpStatus: number; body: Record<string, unknown> };

interface CustomerContext {
  customerId: string;
  email: string | null;
  orgId: string;
}

interface TierResolution {
  products: string[];
  subscriptionId: string;
  subscriptionItems: ApiKeySubscriptionItems;
  tier: Tier;
}

interface BillingStateSnapshot {
  products: string[];
  quotaPerProduct: number | null;
  rateLimit: number | null;
  stripeSubscriptionId: string | null;
  subscriptionItems: ApiKeySubscriptionItems;
  tier: Tier;
}

interface NormalizedOrgEnvelopeRecord extends OrgEnvelopeRecord {
  paymentOverdue: boolean;
  products: string[];
  stripeSubscriptionId: string | null;
  subscriptionItems: ApiKeySubscriptionItems;
  tier: Tier;
}

const COMPLETION_MARKER_PREFIX = "WEBHOOK#stripe#";
const COMPLETION_MARKER_TTL_SECONDS = 7 * 24 * 60 * 60;
const PROCESSING_LEASE_SECONDS = 5 * 60;
const REGISTRY_KEY = "REGISTRY#active-keys";
const RETIRED_BILLING_REGISTRY_KEY = "REGISTRY#retired-billing-keys";
const REGISTRY_ACTIVE_HASHES = "activeHashes";
const ORG_ID_INDEX = "orgId-index";
const BILLING_ACTOR_ID = "stripe-webhook";
const EMAIL_SUPPRESSION_SOFT_BOUNCE_THRESHOLD = 3;

let cachedDdb: DynamoDBDocumentClient | undefined;
let cachedStripe: Stripe | undefined;

function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function getOptionalEnv(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
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

function getCompletionMarkerKey(eventId: string): string {
  return `${COMPLETION_MARKER_PREFIX}${eventId}`;
}

function getCompletionMarkerTtl(now: Date): number {
  return Math.floor(now.getTime() / 1000) + COMPLETION_MARKER_TTL_SECONDS;
}

function getProcessingLeaseCutoff(now: Date): string {
  return new Date(now.getTime() - PROCESSING_LEASE_SECONDS * 1000).toISOString();
}

function getCurrentMonthKey(now: Date): string {
  return now.toISOString().slice(0, 7);
}

function isConditionalCheckFailure(error: unknown): boolean {
  return error instanceof ConditionalCheckFailedException ||
    (typeof error === "object" &&
      error !== null &&
      "name" in error &&
      error.name === "ConditionalCheckFailedException");
}

function getCustomerIdFromEvent(event: Stripe.Event): string | null {
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      return typeof session.customer === "string" ? session.customer : null;
    }
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const subscription = event.data.object as Stripe.Subscription;
      return typeof subscription.customer === "string" ? subscription.customer : null;
    }
    case "invoice.payment_failed": {
      const invoice = event.data.object as Stripe.Invoice;
      return typeof invoice.customer === "string" ? invoice.customer : null;
    }
    default:
      return null;
  }
}

function getSubscriptionIdFromEvent(event: Stripe.Event): string | null {
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      return typeof session.subscription === "string" ? session.subscription : null;
    }
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const subscription = event.data.object as Stripe.Subscription;
      return typeof subscription.id === "string" ? subscription.id : null;
    }
    default:
      return null;
  }
}

async function readCompletionMarker(
  ddb: DynamoDBDocumentClient,
  keysTableName: string,
  eventId: string,
): Promise<StripeWebhookCompletionRecord | undefined> {
  const result = await ddb.send(
    new GetCommand({
      TableName: keysTableName,
      Key: { apiKeyHash: getCompletionMarkerKey(eventId) },
    }),
  );
  return result.Item as StripeWebhookCompletionRecord | undefined;
}

async function writeCompletionMarker(
  ddb: DynamoDBDocumentClient,
  keysTableName: string,
  event: Stripe.Event,
  claimedAt: string,
  orgId: string,
): Promise<"written" | "exists"> {
  const completedAt = new Date().toISOString();
  try {
    await ddb.send(
      new UpdateCommand({
        TableName: keysTableName,
        Key: { apiKeyHash: getCompletionMarkerKey(event.id) },
        ConditionExpression: "#status = :processing AND #claimedAt = :claimedAt",
        UpdateExpression: [
          "SET #status = :completed",
          "#completedAt = :completedAt",
          "#eventType = :eventType",
          "#webhookOrgId = :orgId",
          "#ttl = :ttl",
        ].join(", "),
        ExpressionAttributeNames: {
          "#claimedAt": "claimedAt",
          "#completedAt": "completedAt",
          "#eventType": "eventType",
          "#status": "status",
          "#ttl": "ttl",
          "#webhookOrgId": "webhookOrgId",
        },
        ExpressionAttributeValues: {
          ":claimedAt": claimedAt,
          ":completed": "completed",
          ":completedAt": completedAt,
          ":eventType": event.type,
          ":orgId": orgId,
          ":processing": "processing",
          ":ttl": getCompletionMarkerTtl(new Date()),
        },
      }),
    );
    return "written";
  } catch (error) {
    if (isConditionalCheckFailure(error)) {
      return "exists";
    }
    throw error;
  }
}

type MarkerClaimResult =
  | { kind: "claimed"; claimedAt: string }
  | { kind: "completed" }
  | { kind: "in_progress" };

async function claimCompletionMarker(
  ddb: DynamoDBDocumentClient,
  keysTableName: string,
  event: Stripe.Event,
  orgId: string,
  now: Date,
): Promise<MarkerClaimResult> {
  const claimedAt = now.toISOString();
  const item: StripeWebhookCompletionRecord = {
    apiKeyHash: getCompletionMarkerKey(event.id),
    claimedAt,
    eventType: event.type,
    status: "processing",
    webhookOrgId: orgId,
    ttl: getCompletionMarkerTtl(now),
  };

  try {
    await ddb.send(
      new PutCommand({
        TableName: keysTableName,
        Item: item,
        ConditionExpression: "attribute_not_exists(apiKeyHash)",
      }),
    );
    return { kind: "claimed", claimedAt };
  } catch (error) {
    if (!isConditionalCheckFailure(error)) {
      throw error;
    }
  }

  const existingMarker = await readCompletionMarker(ddb, keysTableName, event.id);
  if (!existingMarker) {
    return claimCompletionMarker(ddb, keysTableName, event, orgId, now);
  }
  if (existingMarker.status === "completed") {
    return { kind: "completed" };
  }
  if (existingMarker.claimedAt > getProcessingLeaseCutoff(now)) {
    return { kind: "in_progress" };
  }

  try {
    await ddb.send(
      new UpdateCommand({
        TableName: keysTableName,
        Key: { apiKeyHash: getCompletionMarkerKey(event.id) },
        ConditionExpression: "#status = :processing AND #claimedAt = :previousClaimedAt",
        UpdateExpression: [
          "SET #claimedAt = :claimedAt",
          "#eventType = :eventType",
          "#webhookOrgId = :orgId",
          "#ttl = :ttl",
        ].join(", "),
        ExpressionAttributeNames: {
          "#claimedAt": "claimedAt",
          "#eventType": "eventType",
          "#status": "status",
          "#ttl": "ttl",
          "#webhookOrgId": "webhookOrgId",
        },
        ExpressionAttributeValues: {
          ":claimedAt": claimedAt,
          ":eventType": event.type,
          ":orgId": orgId,
          ":previousClaimedAt": existingMarker.claimedAt,
          ":processing": "processing",
          ":ttl": getCompletionMarkerTtl(now),
        },
      }),
    );
    return { kind: "claimed", claimedAt };
  } catch (error) {
    if (isConditionalCheckFailure(error)) {
      const refreshedMarker = await readCompletionMarker(ddb, keysTableName, event.id);
      if (refreshedMarker?.status === "completed") {
        return { kind: "completed" };
      }
      return { kind: "in_progress" };
    }
    throw error;
  }
}

async function loadCustomerContext(stripe: Stripe, event: Stripe.Event): Promise<CustomerContext> {
  const customerId = getCustomerIdFromEvent(event);
  if (!customerId) {
    throw new Error(`Stripe event ${event.type} is missing a string customer id`);
  }
  const customer = await stripe.customers.retrieve(customerId);
  if (customer.deleted) {
    throw new Error(`Stripe customer ${customerId} is deleted`);
  }
  const orgId = customer.metadata.orgId;
  if (typeof orgId !== "string" || orgId.length === 0) {
    throw new Error(`Stripe customer ${customerId} is missing metadata.orgId`);
  }
  return {
    customerId,
    email: customer.email ?? null,
    orgId,
  };
}

function isKnownTier(tier: string): tier is Tier {
  return tier in PLANS;
}

function isKnownProntiqProduct(product: string): product is string {
  return product in PRODUCT_REGISTRY;
}

function isBillableProntiqProduct(product: string): boolean {
  return getBillingEndpointsForProduct(product).length > 0;
}

function getRecurringTierMetadata(price: Stripe.Price): string | undefined {
  const fromPrice = price.metadata.prontiqTier;
  if (typeof fromPrice === "string" && fromPrice.length > 0) {
    return fromPrice;
  }
  if (typeof price.product === "string") {
    return undefined;
  }
  if ("deleted" in price.product && price.product.deleted) {
    return undefined;
  }
  const fromProduct = price.product.metadata.prontiqTier;
  return typeof fromProduct === "string" && fromProduct.length > 0 ? fromProduct : undefined;
}

async function resolveTierStateForEvent(
  stripe: Stripe,
  event: Stripe.Event,
): Promise<TierResolution> {
  const subscriptionId = getSubscriptionIdFromEvent(event);
  if (!subscriptionId) {
    throw new Error(`Stripe event ${event.type} is missing a string subscription id`);
  }
  const subscription = await stripe.subscriptions.retrieve(subscriptionId, {
    expand: ["items.data.price", "items.data.price.product"],
  });
  const recurringItem = subscription.items.data.find((item) => {
    if (!item.price) return false;
    return getRecurringTierMetadata(item.price) !== undefined;
  });
  if (!recurringItem?.price) {
    throw new Error(
      `Subscription ${subscriptionId} has no recurring plan price/product with metadata.prontiqTier`,
    );
  }
  const configuredTier = getRecurringTierMetadata(recurringItem.price);
  if (typeof configuredTier !== "string" || !isKnownTier(configuredTier)) {
    throw new Error(
      `Subscription ${subscriptionId} has unknown prontiqTier ${String(configuredTier)} on recurring price ${recurringItem.price.id}`,
    );
  }
  const tier = configuredTier;
  const subscriptionItems: ApiKeySubscriptionItems = {};
  const enabledProducts = new Set<string>();
  for (const item of subscription.items.data) {
    if (!item.price?.id) continue;
    if (getRecurringTierMetadata(item.price) !== undefined) {
      continue;
    }
    if (typeof item.price.product === "string") {
      throw new Error(
        `Subscription item ${item.id} is missing expanded price.product metadata.prontiqProduct`,
      );
    }
    if ("deleted" in item.price.product && item.price.product.deleted) {
      throw new Error(`Subscription item ${item.id} references deleted Stripe product ${item.price.product.id}`);
    }
    const product = item.price.product.metadata.prontiqProduct;
    if (typeof product !== "string" || product.length === 0) {
      throw new Error(
        `Subscription item ${item.id} is missing price.product.metadata.prontiqProduct`,
      );
    }
    if (!isKnownProntiqProduct(product)) {
      throw new Error(`Stripe product ${item.price.product.id} has unknown prontiqProduct ${product}`);
    }
    if (!isBillableProntiqProduct(product)) {
      throw new Error(
        `Stripe product ${item.price.product.id} enables prontiqProduct ${product} before BILLING_ENDPOINTS are configured`,
      );
    }
    if (product in subscriptionItems) {
      throw new Error(
        `Subscription ${subscriptionId} has duplicate metered items for prontiqProduct ${product}`,
      );
    }
    subscriptionItems[product] = item.id;
    enabledProducts.add(product);
  }
  if (enabledProducts.size === 0) {
    throw new Error(`Subscription ${subscriptionId} has no metered Prontiq products enabled`);
  }
  return { products: Array.from(enabledProducts).sort(), subscriptionId, subscriptionItems, tier };
}

function getOrgEnvelopeKey(orgId: string): string {
  return `ORG#${orgId}`;
}

async function loadOrgEnvelope(
  ddb: DynamoDBDocumentClient,
  keysTableName: string,
  orgId: string,
): Promise<NormalizedOrgEnvelopeRecord> {
  const result = await ddb.send(
    new GetCommand({
      TableName: keysTableName,
      Key: { apiKeyHash: getOrgEnvelopeKey(orgId) },
    }),
  );
  const item = result.Item as OrgEnvelopeRecord | undefined;
  if (!item) {
    throw new Error(`ORG envelope ${getOrgEnvelopeKey(orgId)} is missing`);
  }
  const tier = isKnownTier(item.tier) ? item.tier : "free";
  const defaultPlan = PLANS[tier];
  return {
    ...item,
    paymentOverdue: item.paymentOverdue ?? false,
    products: Array.isArray(item.products) && item.products.length > 0 ? item.products : defaultPlan.products,
    stripeSubscriptionId: item.stripeSubscriptionId ?? null,
    subscriptionItems: item.subscriptionItems ?? {},
    tier,
  };
}

async function updateOrgEnvelopeBillingState(
  ddb: DynamoDBDocumentClient,
  keysTableName: string,
  orgId: string,
  state: {
    paymentOverdue: boolean;
    products: string[];
    stripeSubscriptionId: string | null;
    subscriptionItems: ApiKeySubscriptionItems;
    tier: Tier;
  },
): Promise<void> {
  await ddb.send(
    new UpdateCommand({
      TableName: keysTableName,
      Key: { apiKeyHash: getOrgEnvelopeKey(orgId) },
      UpdateExpression: [
        "SET #tier = :tier",
        "#products = :products",
        "#paymentOverdue = :paymentOverdue",
        "#stripeSubscriptionId = :stripeSubscriptionId",
        "#subscriptionItems = :subscriptionItems",
      ].join(", "),
      ExpressionAttributeNames: {
        "#paymentOverdue": "paymentOverdue",
        "#products": "products",
        "#stripeSubscriptionId": "stripeSubscriptionId",
        "#subscriptionItems": "subscriptionItems",
        "#tier": "tier",
      },
      ExpressionAttributeValues: {
        ":paymentOverdue": state.paymentOverdue,
        ":products": state.products,
        ":stripeSubscriptionId": state.stripeSubscriptionId,
        ":subscriptionItems": state.subscriptionItems,
        ":tier": state.tier,
      },
    }),
  );
}

async function loadOrgKeys(
  ddb: DynamoDBDocumentClient,
  keysTableName: string,
  orgId: string,
): Promise<ApiKeyRecord[]> {
  const result = await ddb.send(
    new QueryCommand({
      TableName: keysTableName,
      IndexName: ORG_ID_INDEX,
      KeyConditionExpression: "orgId = :orgId",
      ExpressionAttributeValues: {
        ":orgId": orgId,
      },
    }),
  );
  return ((result.Items as ApiKeyRecord[] | undefined) ?? []).filter((item) =>
    typeof item.apiKeyHash === "string" &&
    !item.apiKeyHash.startsWith("ORG#") &&
    !item.apiKeyHash.startsWith(COMPLETION_MARKER_PREFIX) &&
    item.apiKeyHash !== REGISTRY_KEY
  );
}

async function updateKeyPlanState(
  ddb: DynamoDBDocumentClient,
  keysTableName: string,
  key: ApiKeyRecord,
  state: {
    paymentOverdue: boolean;
    products: string[];
    stripeSubscriptionId: string | null;
    subscriptionItems: ApiKeySubscriptionItems;
    tier: Tier;
  },
): Promise<void> {
  const plan = PLANS[state.tier];
  await ddb.send(
    new UpdateCommand({
      TableName: keysTableName,
      Key: { apiKeyHash: key.apiKeyHash },
      UpdateExpression: [
        "SET #tier = :tier",
        "#products = :products",
        "#quotaPerProduct = :quotaPerProduct",
        "#rateLimit = :rateLimit",
        "#stripeSubscriptionId = :stripeSubscriptionId",
        "#subscriptionItems = :subscriptionItems",
        "#paymentOverdue = :paymentOverdue",
      ].join(", "),
      ExpressionAttributeNames: {
        "#paymentOverdue": "paymentOverdue",
        "#products": "products",
        "#quotaPerProduct": "quotaPerProduct",
        "#rateLimit": "rateLimit",
        "#stripeSubscriptionId": "stripeSubscriptionId",
        "#subscriptionItems": "subscriptionItems",
        "#tier": "tier",
      },
      ExpressionAttributeValues: {
        ":paymentOverdue": state.paymentOverdue,
        ":products": state.products,
        ":quotaPerProduct": plan.quotaPerProduct,
        ":rateLimit": plan.rateLimit,
        ":stripeSubscriptionId": state.stripeSubscriptionId,
        ":subscriptionItems": state.subscriptionItems,
        ":tier": state.tier,
      },
    }),
  );
}

async function setPaymentOverdueState(
  ddb: DynamoDBDocumentClient,
  keysTableName: string,
  key: ApiKeyRecord,
  paymentOverdue: boolean,
): Promise<void> {
  await ddb.send(
    new UpdateCommand({
      TableName: keysTableName,
      Key: { apiKeyHash: key.apiKeyHash },
      UpdateExpression: "SET #paymentOverdue = :paymentOverdue",
      ExpressionAttributeNames: {
        "#paymentOverdue": "paymentOverdue",
      },
      ExpressionAttributeValues: {
        ":paymentOverdue": paymentOverdue,
      },
    }),
  );
}

async function updateRegistryMembership(
  ddb: DynamoDBDocumentClient,
  keysTableName: string,
  registryKey: string,
  apiKeyHashes: string[],
  mode: "add" | "delete",
): Promise<void> {
  if (apiKeyHashes.length === 0) return;
  const updateExpression =
    mode === "add"
      ? `ADD #activeHashes :hashes`
      : `DELETE #activeHashes :hashes`;
  await ddb.send(
    new UpdateCommand({
      TableName: keysTableName,
      Key: { apiKeyHash: registryKey },
      UpdateExpression: updateExpression,
      ExpressionAttributeNames: {
        "#activeHashes": REGISTRY_ACTIVE_HASHES,
      },
      ExpressionAttributeValues: {
        ":hashes": new Set(apiKeyHashes),
      },
    }),
  );
}

async function resetUsageFlagsForCurrentMonth(
  ddb: DynamoDBDocumentClient,
  usageTableName: string,
  keys: ApiKeyRecord[],
  products: string[],
  now: Date,
): Promise<void> {
  const monthKey = getCurrentMonthKey(now);
  for (const key of keys) {
    for (const product of products) {
      const scope = `${product}#${monthKey}`;
      try {
        await ddb.send(
          new UpdateCommand({
            TableName: usageTableName,
            Key: {
              apiKeyHash: key.apiKeyHash,
              scope,
            },
            ConditionExpression: "attribute_exists(apiKeyHash) AND attribute_exists(#scope)",
            UpdateExpression: "SET #warningEmailSent = :false, #limitEmailSent = :false",
            ExpressionAttributeNames: {
              "#limitEmailSent": "limitEmailSent",
              "#scope": "scope",
              "#warningEmailSent": "warningEmailSent",
            },
            ExpressionAttributeValues: {
              ":false": false,
            },
          }),
        );
      } catch (error) {
        if (isConditionalCheckFailure(error)) {
          continue;
        }
        throw error;
      }
    }
  }
}

async function isSuppressed(
  ddb: DynamoDBDocumentClient,
  suppressionsTableName: string,
  email: string,
): Promise<boolean> {
  const result = await ddb.send(
    new GetCommand({
      TableName: suppressionsTableName,
      Key: { email },
    }),
  );
  const item = result.Item as { reason?: string; bounceCount?: number } | undefined;
  if (!item) return false;
  if (item.reason === "complaint" || item.reason === "hard_bounce") {
    return true;
  }
  return item.reason === "soft_bounce" && (item.bounceCount ?? 0) >= EMAIL_SUPPRESSION_SOFT_BOUNCE_THRESHOLD;
}

async function sendSignedSesEmail(input: {
  bodyText: string;
  fromEmail: string;
  region: string;
  subject: string;
  toEmail: string;
}): Promise<boolean> {
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
  if (!accessKeyId || !secretAccessKey) {
    return false;
  }
  const sessionToken = process.env.AWS_SESSION_TOKEN;
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const service = "ses";
  const host = `email.${input.region}.amazonaws.com`;
  const path = "/v2/email/outbound-emails";
  const endpoint = `https://${host}${path}`;
  const body = JSON.stringify({
    Content: {
      Simple: {
        Body: {
          Text: {
            Data: input.bodyText,
          },
        },
        Subject: { Data: input.subject },
      },
    },
    Destination: { ToAddresses: [input.toEmail] },
    FromEmailAddress: input.fromEmail,
  });
  const payloadHash = createHash("sha256").update(body).digest("hex");
  const canonicalHeaders = [
    "content-type:application/json",
    `host:${host}`,
    `x-amz-date:${amzDate}`,
    ...(sessionToken ? [`x-amz-security-token:${sessionToken}`] : []),
  ].join("\n");
  const signedHeaders = [
    "content-type",
    "host",
    "x-amz-date",
    ...(sessionToken ? ["x-amz-security-token"] : []),
  ].join(";");
  const canonicalRequest = ["POST", path, "", `${canonicalHeaders}\n`, signedHeaders, payloadHash].join("\n");
  const credentialScope = `${dateStamp}/${input.region}/${service}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    createHash("sha256").update(canonicalRequest).digest("hex"),
  ].join("\n");
  const dateKey = createHmac("sha256", `AWS4${secretAccessKey}`).update(dateStamp).digest();
  const regionKey = createHmac("sha256", dateKey).update(input.region).digest();
  const serviceKey = createHmac("sha256", regionKey).update(service).digest();
  const signingKey = createHmac("sha256", serviceKey).update("aws4_request").digest();
  const signature = createHmac("sha256", signingKey).update(stringToSign).digest("hex");
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
      "Content-Type": "application/json",
      Host: host,
      "X-Amz-Date": amzDate,
      ...(sessionToken ? { "X-Amz-Security-Token": sessionToken } : {}),
    },
    body,
  });
  return response.ok;
}

function getDefaultPaymentFailureEmailSender(logger: Logger): BillingEmailSender {
  return async (input) => {
    try {
      return await sendSignedSesEmail({
        bodyText:
          `Your payment failed.\n\n` +
          `Update your card at ${input.billingUrl}\n\n` +
          `Service continues for 7 more days while Stripe retries your renewal.\n`,
        fromEmail: input.fromEmail,
        region: input.region,
        subject: "Your Prontiq payment failed",
        toEmail: input.toEmail,
      });
    } catch (error) {
      logger.warn("Payment failure email send failed", {
        error: error instanceof Error ? error.message : String(error),
        toEmail: input.toEmail,
      });
      return false;
    }
  };
}

async function sendPastDueEmailSafely(
  dependencies: StripeBillingDependencies,
  ownerEmail: string | null,
  orgId: string,
): Promise<boolean> {
  const emailFrom = process.env.WELCOME_EMAIL_FROM;
  if (!ownerEmail || typeof emailFrom !== "string" || emailFrom.length === 0) {
    return false;
  }
  try {
    if (await isSuppressed(dependencies.ddb, dependencies.suppressionsTableName, ownerEmail)) {
      dependencies.logger.info("Skipping past_due email due to SES suppression", {
        orgId,
        toEmail: ownerEmail,
      });
      return false;
    }
    return await dependencies.sendPaymentFailureEmail({
      billingUrl: getOptionalEnv("PRONTIQ_BILLING_URL", "https://prontiq.dev/account"),
      fromEmail: emailFrom,
      region: getOptionalEnv("AWS_REGION", "ap-southeast-2"),
      toEmail: ownerEmail,
    });
  } catch (error) {
    dependencies.logger.warn("Past-due email send threw (best-effort only)", {
      error: error instanceof Error ? error.message : String(error),
      orgId,
      toEmail: ownerEmail,
    });
    return false;
  }
}

function getAuditTimestamp(event: Stripe.Event): Date {
  return new Date(event.created * 1000);
}

function getTargetBillingState(tierState: TierResolution): BillingStateSnapshot {
  const plan = PLANS[tierState.tier];
  return {
    products: [...tierState.products].sort(),
    quotaPerProduct: plan.quotaPerProduct,
    rateLimit: plan.rateLimit,
    stripeSubscriptionId: tierState.subscriptionId,
    subscriptionItems: tierState.subscriptionItems,
    tier: tierState.tier,
  };
}

function normaliseSubscriptionItems(items: ApiKeySubscriptionItems): [string, string][] {
  return Object.entries(items).sort(([a], [b]) => a.localeCompare(b));
}

function hasBillingStateDrift(
  envelope: OrgEnvelopeRecord,
  keys: ApiKeyRecord[],
  tierState: TierResolution,
): boolean {
  const target = getTargetBillingState(tierState);
  const envelopeProducts = [...envelope.products].sort();
  if (envelope.tier !== target.tier) return true;
  if (envelope.stripeSubscriptionId !== target.stripeSubscriptionId) return true;
  if (JSON.stringify(envelopeProducts) !== JSON.stringify(target.products)) return true;
  if (
    JSON.stringify(normaliseSubscriptionItems(envelope.subscriptionItems)) !==
      JSON.stringify(normaliseSubscriptionItems(target.subscriptionItems))
  ) {
    return true;
  }

  return keys.some((key) =>
    key.tier !== target.tier ||
    key.quotaPerProduct !== target.quotaPerProduct ||
    key.rateLimit !== target.rateLimit ||
    key.stripeSubscriptionId !== target.stripeSubscriptionId ||
    JSON.stringify([...key.products].sort()) !== JSON.stringify(target.products) ||
    JSON.stringify(normaliseSubscriptionItems(key.subscriptionItems)) !==
      JSON.stringify(normaliseSubscriptionItems(target.subscriptionItems))
  );
}

async function processPlanTransition(
  dependencies: StripeBillingDependencies,
  customer: CustomerContext,
  event: Stripe.Event,
  now: Date,
  tierStateOverride?: TierResolution,
  shouldWriteAudit = true,
): Promise<"UPGRADE" | "DOWNGRADE"> {
  const tierState = tierStateOverride ?? await resolveTierStateForEvent(dependencies.stripe, event);
  const envelope = await loadOrgEnvelope(dependencies.ddb, dependencies.keysTableName, customer.orgId);
  await updateOrgEnvelopeBillingState(dependencies.ddb, dependencies.keysTableName, customer.orgId, {
    paymentOverdue: false,
    products: tierState.products,
    stripeSubscriptionId: tierState.subscriptionId,
    subscriptionItems: tierState.subscriptionItems,
    tier: tierState.tier,
  });
  const keys = await loadOrgKeys(dependencies.ddb, dependencies.keysTableName, customer.orgId);
  for (const key of keys) {
    await updateKeyPlanState(dependencies.ddb, dependencies.keysTableName, key, {
      paymentOverdue: false,
      products: tierState.products,
      stripeSubscriptionId: tierState.subscriptionId,
      subscriptionItems: tierState.subscriptionItems,
      tier: tierState.tier,
    });
  }
  await updateRegistryMembership(
    dependencies.ddb,
    dependencies.keysTableName,
    REGISTRY_KEY,
    keys.map((key) => key.apiKeyHash),
    "add",
  );
  await updateRegistryMembership(
    dependencies.ddb,
    dependencies.keysTableName,
    RETIRED_BILLING_REGISTRY_KEY,
    keys.map((key) => key.apiKeyHash),
    "delete",
  );
  await resetUsageFlagsForCurrentMonth(
    dependencies.ddb,
    dependencies.usageTableName,
    keys,
    tierState.products,
    now,
  );
  const oldTier = keys[0]?.tier ?? envelope.tier;
  const action = oldTier === undefined || oldTier === "free" || oldTier === tierState.tier
    ? "UPGRADE"
    : oldTier === "growth" && tierState.tier === "starter"
      ? "DOWNGRADE"
      : "UPGRADE";
  if (shouldWriteAudit === false) {
    return action;
  }
  await writeAudit({
    ddb: dependencies.ddb,
    tableName: dependencies.auditTableName,
    orgId: customer.orgId,
    action,
    actorId: BILLING_ACTOR_ID,
    metadata: {
      eventType: event.type,
      newTier: tierState.tier,
      oldTier,
      stripeCustomerId: customer.customerId,
      stripeSubscriptionId: tierState.subscriptionId,
    },
    now: getAuditTimestamp(event),
    eventId: event.id,
  });
  return action;
}

async function processPastDue(
  dependencies: StripeBillingDependencies,
  customer: CustomerContext,
  event: Stripe.Event,
  shouldWriteAudit = true,
): Promise<boolean> {
  const envelope = await loadOrgEnvelope(dependencies.ddb, dependencies.keysTableName, customer.orgId);
  const keys = await loadOrgKeys(dependencies.ddb, dependencies.keysTableName, customer.orgId);
  const transitioned = !envelope.paymentOverdue || keys.some((key) => !key.paymentOverdue);
  await updateOrgEnvelopeBillingState(dependencies.ddb, dependencies.keysTableName, customer.orgId, {
    paymentOverdue: true,
    products: envelope.products,
    stripeSubscriptionId: envelope.stripeSubscriptionId,
    subscriptionItems: envelope.subscriptionItems,
    tier: envelope.tier,
  });
  for (const key of keys) {
    await setPaymentOverdueState(dependencies.ddb, dependencies.keysTableName, key, true);
  }
  if (transitioned) {
    await sendPastDueEmailSafely(dependencies, customer.email, customer.orgId);
  }
  if (shouldWriteAudit === false) {
    return transitioned;
  }
  await writeAudit({
    ddb: dependencies.ddb,
    tableName: dependencies.auditTableName,
    orgId: customer.orgId,
    action: "DOWNGRADE",
    actorId: BILLING_ACTOR_ID,
    metadata: {
      eventType: event.type,
      paymentOverdue: true,
      stripeCustomerId: customer.customerId,
    },
    now: getAuditTimestamp(event),
    eventId: event.id,
  });
  return transitioned;
}

async function processRecoveryToActive(
  dependencies: StripeBillingDependencies,
  customer: CustomerContext,
  event: Stripe.Event,
  shouldWriteAudit = true,
): Promise<boolean> {
  const envelope = await loadOrgEnvelope(dependencies.ddb, dependencies.keysTableName, customer.orgId);
  const keys = await loadOrgKeys(dependencies.ddb, dependencies.keysTableName, customer.orgId);
  if (!envelope.paymentOverdue && !keys.some((key) => key.paymentOverdue)) {
    return false;
  }
  await updateOrgEnvelopeBillingState(dependencies.ddb, dependencies.keysTableName, customer.orgId, {
    paymentOverdue: false,
    products: envelope.products,
    stripeSubscriptionId: envelope.stripeSubscriptionId,
    subscriptionItems: envelope.subscriptionItems,
    tier: envelope.tier,
  });
  for (const key of keys) {
    await setPaymentOverdueState(dependencies.ddb, dependencies.keysTableName, key, false);
  }
  if (shouldWriteAudit === false) {
    return true;
  }
  await writeAudit({
    ddb: dependencies.ddb,
    tableName: dependencies.auditTableName,
    orgId: customer.orgId,
    action: "UPGRADE",
    actorId: BILLING_ACTOR_ID,
    metadata: {
      eventType: event.type,
      paymentOverdue: false,
      stripeCustomerId: customer.customerId,
    },
    now: getAuditTimestamp(event),
    eventId: event.id,
  });
  return true;
}

async function processSubscriptionDeleted(
  dependencies: StripeBillingDependencies,
  customer: CustomerContext,
  event: Stripe.Event,
): Promise<void> {
  await updateOrgEnvelopeBillingState(dependencies.ddb, dependencies.keysTableName, customer.orgId, {
    paymentOverdue: false,
    products: PLANS.free.products,
    stripeSubscriptionId: null,
    subscriptionItems: {},
    tier: "free",
  });
  const keys = await loadOrgKeys(dependencies.ddb, dependencies.keysTableName, customer.orgId);
  for (const key of keys) {
    await updateKeyPlanState(dependencies.ddb, dependencies.keysTableName, key, {
      paymentOverdue: false,
      products: PLANS.free.products,
      stripeSubscriptionId: null,
      subscriptionItems: {},
      tier: "free",
    });
  }
  await updateRegistryMembership(
    dependencies.ddb,
    dependencies.keysTableName,
    REGISTRY_KEY,
    keys.map((key) => key.apiKeyHash),
    "delete",
  );
  await updateRegistryMembership(
    dependencies.ddb,
    dependencies.keysTableName,
    RETIRED_BILLING_REGISTRY_KEY,
    keys.map((key) => key.apiKeyHash),
    "add",
  );
  await writeAudit({
    ddb: dependencies.ddb,
    tableName: dependencies.auditTableName,
    orgId: customer.orgId,
    action: "DOWNGRADE",
    actorId: BILLING_ACTOR_ID,
    metadata: {
      eventType: event.type,
      stripeCustomerId: customer.customerId,
    },
    now: getAuditTimestamp(event),
    eventId: event.id,
  });
}

export function createStripeBillingService(
  overrides: Partial<StripeBillingDependencies> = {},
): { handleEvent: (event: Stripe.Event) => Promise<StripeWebhookHandleResult> } {
  const logger = overrides.logger ?? console;
  const dependencies: StripeBillingDependencies = {
    auditTableName: overrides.auditTableName ?? getRequiredEnv("AUDIT_TABLE_NAME"),
    ddb: overrides.ddb ?? getDefaultDdb(),
    keysTableName: overrides.keysTableName ?? getRequiredEnv("KEYS_TABLE_NAME"),
    logger,
    sendPaymentFailureEmail: overrides.sendPaymentFailureEmail ?? getDefaultPaymentFailureEmailSender(logger),
    stripe: overrides.stripe ?? getDefaultStripe(),
    suppressionsTableName: overrides.suppressionsTableName ?? getRequiredEnv("SUPPRESSIONS_TABLE_NAME"),
    usageTableName: overrides.usageTableName ?? getRequiredEnv("USAGE_TABLE_NAME"),
  };

  async function handleEvent(event: Stripe.Event): Promise<StripeWebhookHandleResult> {
    if (event.type === "invoice.payment_failed") {
      logger.info("Stripe invoice.payment_failed received", {
        customerId: getCustomerIdFromEvent(event),
        eventId: event.id,
      });
      return { status: "processed", httpStatus: 200, body: { ok: true, skipped: true, type: event.type } };
    }

    if (
      event.type !== "checkout.session.completed" &&
      event.type !== "customer.subscription.updated" &&
      event.type !== "customer.subscription.deleted"
    ) {
      return { status: "processed", httpStatus: 200, body: { ok: true, skipped: true, type: event.type } };
    }

    let claimedAt: string | null = null;

    try {
      const now = new Date();
      const customer = await loadCustomerContext(dependencies.stripe, event);
      const claim = await claimCompletionMarker(
        dependencies.ddb,
        dependencies.keysTableName,
        event,
        customer.orgId,
        now,
      );
      if (claim.kind === "completed") {
        return {
          status: "duplicate",
          httpStatus: 200,
          body: { ok: true, status: "duplicate", type: event.type },
        };
      }
      if (claim.kind === "in_progress") {
        return {
          status: "retryable_failure",
          httpStatus: 500,
          body: { error: "retryable_failure", reason: "event_already_processing", type: event.type },
        };
      }
      claimedAt = claim.claimedAt;
      const leaseClaimedAt = claim.claimedAt;
      const mutatingEvent = event.type as StripeMutatingEventType;
      if (mutatingEvent === "checkout.session.completed") {
        await processPlanTransition(dependencies, customer, event, now);
      } else if (mutatingEvent === "customer.subscription.deleted") {
        await processSubscriptionDeleted(dependencies, customer, event);
      } else {
        const subscription = event.data.object as Stripe.Subscription;
        const envelope = await loadOrgEnvelope(
          dependencies.ddb,
          dependencies.keysTableName,
          customer.orgId,
        );
        const keys = await loadOrgKeys(dependencies.ddb, dependencies.keysTableName, customer.orgId);
        const tierState = await resolveTierStateForEvent(dependencies.stripe, event);
        const billingStateDrifted = hasBillingStateDrift(envelope, keys, tierState);
        let auditAction: "UPGRADE" | "DOWNGRADE" | null = null;
        const auditMetadata: Record<string, unknown> = {
          eventType: event.type,
          stripeCustomerId: customer.customerId,
          stripeSubscriptionId: tierState.subscriptionId,
        };
        if (billingStateDrifted) {
          auditAction = await processPlanTransition(dependencies, customer, event, now, tierState, false);
          auditMetadata.billingStateReconciled = true;
          auditMetadata.newTier = tierState.tier;
          auditMetadata.oldTier = envelope.tier;
          auditMetadata.products = tierState.products;
          auditMetadata.subscriptionItems = tierState.subscriptionItems;
        }
        if (subscription.status === "past_due") {
          const transitioned = await processPastDue(dependencies, customer, event, false);
          if (transitioned || billingStateDrifted) {
            auditAction = "DOWNGRADE";
            auditMetadata.paymentOverdue = true;
            auditMetadata.paymentOverdueTransition = transitioned ? "set" : "unchanged";
          }
        } else if (subscription.status === "active") {
          const recovered = await processRecoveryToActive(dependencies, customer, event, false);
          if (recovered || billingStateDrifted) {
            auditAction = recovered ? "UPGRADE" : (auditAction ?? "UPGRADE");
            if (recovered) {
              auditMetadata.paymentOverdue = false;
              auditMetadata.paymentOverdueTransition = "cleared";
            }
          }
        } else if (billingStateDrifted) {
          auditAction = auditAction ?? "UPGRADE";
        }

        if (auditAction) {
          await writeAudit({
            ddb: dependencies.ddb,
            tableName: dependencies.auditTableName,
            orgId: customer.orgId,
            action: auditAction,
            actorId: BILLING_ACTOR_ID,
            metadata: auditMetadata,
            now: getAuditTimestamp(event),
            eventId: event.id,
          });
        }
      }

      const completionWrite = await writeCompletionMarker(
        dependencies.ddb,
        dependencies.keysTableName,
        event,
        leaseClaimedAt,
        customer.orgId,
      );
      if (completionWrite === "exists") {
        const marker = await readCompletionMarker(dependencies.ddb, dependencies.keysTableName, event.id);
        if (marker?.status === "completed") {
          return {
            status: "duplicate",
            httpStatus: 200,
            body: { ok: true, status: "duplicate", type: event.type },
          };
        }
        return {
          status: "retryable_failure",
          httpStatus: 500,
          body: { error: "retryable_failure", reason: "event_processing_claim_lost", type: event.type },
        };
      }
      return {
        status: "processed",
        httpStatus: 200,
        body: { ok: true, status: "processed", type: event.type },
      };
    } catch (error) {
      logger.error("Stripe webhook processing failed", {
        error: error instanceof Error ? error.message : String(error),
        claimedAt,
        eventId: event.id,
        eventType: event.type,
      });
      return {
        status: "retryable_failure",
        httpStatus: 500,
        body: { error: "retryable_failure", type: event.type },
      };
    }
  }

  return { handleEvent };
}
