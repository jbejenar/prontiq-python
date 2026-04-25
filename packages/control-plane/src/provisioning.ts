import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  TransactWriteCommand,
} from "@aws-sdk/lib-dynamodb";
import {
  DEFAULT_ACCOUNT_URL,
  PLANS,
  createLogger,
  type CustomerRecord,
  type OrgEnvelopeRecord,
} from "@prontiq/shared";
import Stripe from "stripe";
import { buildAuditTransactItem } from "./audit.js";
import { generateCustomerId as generateCustomerIdDefault } from "./customer-identity.js";
import { isSuppressedEmail, sendSignedSesEmail } from "./email.js";

// Three classes of error vocabulary surface from a DynamoDB call:
//
//   1. Top-level AWS SDK exception names — the request itself was
//      rejected before any per-item processing. Includes throttling,
//      service unavailability, AND transport-layer failures (timeouts,
//      aborts, networking errors). The bottom three names cover the
//      ambiguous-write case: the call timed out so we don't know if
//      the write committed — safe stance is "transient, retry".
const TRANSIENT_TOP_LEVEL_NAMES = new Set([
  // Throughput / throttling (AWS service-side capacity)
  "ProvisionedThroughputExceededException",
  "ThrottlingException",
  "RequestLimitExceeded",
  "RequestThrottledException",
  // Server-side availability
  "InternalServerError",
  "InternalFailure",
  "ServiceUnavailable",
  // Transport-layer (client-side / network) — these are the previously
  // missing class that turned ambiguous TransactWrite timeouts into
  // false fatals.
  "TimeoutError",
  "AbortError",
  "NetworkingError",
]);

// 2. DynamoDB cancellation-reason codes (NOT the `...Exception` suffix
//    used at the top level). These appear inside the
//    TransactionCanceledException's `CancellationReasons[].Code` array.
//    Source: AWS DynamoDB API reference for TransactWriteItems.
const TRANSIENT_REASON_CODES = new Set([
  "TransactionConflict",
  "ProvisionedThroughputExceeded",
  "ThrottlingError",
]);

// 3. Provably-fatal AWS SDK exception names — retrying these will
//    never succeed. Anything NOT in this allowlist and NOT in the
//    transient set is "ambiguous" and treated as retryable on
//    post-Stripe paths (the safe default — see classifyDdbError).
const FATAL_TOP_LEVEL_NAMES = new Set([
  "ValidationException",
  "ResourceNotFoundException",
  "AccessDeniedException",
  "UnrecognizedClientException",
  "InvalidSignatureException",
  "MissingAuthenticationTokenException",
]);

const MAX_ATTEMPTS = 3;
const BACKOFF_MS = 150;
const FREE_TIER = "free" as const;
const STRIPE_NETWORK_RETRIES = 3;

type Logger = Pick<Console, "error" | "warn" | "info">;
type Sleep = (ms: number) => Promise<void>;
type CustomerIdGenerator = (now: Date) => string;

export type ProvisioningStatus =
  | "created"
  | "already_exists"
  | "retryable_failure"
  | "fatal_failure";

export interface ProvisioningInput {
  actorId: string;
  orgId: string;
  ownerEmail: string;
  source: string;
}

export interface ProvisioningResult {
  status: ProvisioningStatus;
  emailSent: boolean;
  orgEnvelope?: OrgEnvelopeRecord;
  stripeCustomerId?: string;
}

export interface EmailInput {
  docsUrl: string;
  fromEmail: string;
  region: string;
  signInUrl: string;
  toEmail: string;
}

export type EmailSender = (input: EmailInput) => Promise<boolean>;

export interface ProvisioningDependencies {
  ddb: DynamoDBDocumentClient;
  keysTableName: string;
  customersTableName: string;
  auditTableName: string;
  stripe: Stripe;
  sendWelcomeEmail: EmailSender;
  generateCustomerId: CustomerIdGenerator;
  logger: Logger;
  sleep: Sleep;
}

let cachedDdb: DynamoDBDocumentClient | undefined;
let cachedStripe: Stripe | undefined;
const defaultLogger = createLogger("control-plane-provisioning");

function getDefaultDdb(): DynamoDBDocumentClient {
  if (!cachedDdb) {
    cachedDdb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
  }
  return cachedDdb;
}

function getDefaultStripe(): Stripe {
  if (!cachedStripe) {
    const key = getRequiredEnv("STRIPE_SECRET_KEY");
    cachedStripe = new Stripe(key, { maxNetworkRetries: STRIPE_NETWORK_RETRIES });
  }
  return cachedStripe;
}

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

function getOrgEnvelopeKey(orgId: string): string {
  return `ORG#${orgId}`;
}

function isCompleteOrgEnvelope(
  record: unknown,
  orgId: string,
): record is OrgEnvelopeRecord {
  if (!record || typeof record !== "object") {
    return false;
  }
  const candidate = record as Partial<OrgEnvelopeRecord>;
  return (
    candidate.apiKeyHash === getOrgEnvelopeKey(orgId) &&
    typeof candidate.stripeCustomerId === "string" &&
    candidate.stripeCustomerId.length > 0 &&
    typeof candidate.ownerEmail === "string" &&
    candidate.ownerEmail.length > 0 &&
    typeof candidate.tier === "string" &&
    Array.isArray(candidate.products) &&
    typeof candidate.paymentOverdue === "boolean" &&
    (candidate.stripeSubscriptionId === null ||
      (typeof candidate.stripeSubscriptionId === "string" &&
        candidate.stripeSubscriptionId.length > 0)) &&
    candidate.subscriptionItems != null &&
    typeof candidate.subscriptionItems === "object" &&
    typeof candidate.hasFirstKey === "boolean" &&
    typeof candidate.completedAt === "string" &&
    candidate.completedAt.length > 0
  );
}

// Discriminated union surfaces every read outcome the state machine
// must distinguish, so the compiler enforces handling at every call
// site. Earlier versions returned `OrgEnvelopeRecord | undefined` and
// let SDK exceptions escape — that turned recoverable read failures
// (throttle, network blip, IAM lapse) into uncaught 500s, *especially*
// dangerous after a Stripe customer was already created or after a
// TransactWriteItems may have already committed.
type EnvelopeReadResult =
  | { kind: "found"; record: OrgEnvelopeRecord }
  | { kind: "missing" }
  | { kind: "transient_failure"; error: Error }
  | { kind: "fatal_failure"; error: Error };

// Strongly-consistent read. Eventual consistency would let three real
// scenarios slip past the state machine:
//   1. Preflight idempotency check misses a concurrent provisioner that
//      committed <1ms ago → unnecessary Stripe call (idempotency-key
//      saves us from duplicate customer, but also: ConditionalCheckFailed
//      on the next TransactWriteItems → wasted retry path).
//   2. Post-commit confirmation reads back undefined despite the
//      transaction having committed → caller sees `created` with
//      `orgEnvelope: undefined`, which is a lie about durability.
//   3. Post-failure reconciliation read misses an envelope that the
//      competing writer just committed → we report `fatal_failure` for a
//      provisioning that actually succeeded.
// Cost: 2x RCU per read. Acceptable for a webhook/admin path with
// <1 RPS; correctness > cost.
async function readOrgEnvelope(
  ddb: DynamoDBDocumentClient,
  keysTableName: string,
  orgId: string,
): Promise<EnvelopeReadResult> {
  try {
    const result = await ddb.send(
      new GetCommand({
        TableName: keysTableName,
        Key: { apiKeyHash: getOrgEnvelopeKey(orgId) },
        ConsistentRead: true,
      }),
    );
    if (isCompleteOrgEnvelope(result.Item, orgId)) {
      return { kind: "found", record: result.Item };
    }
    return { kind: "missing" };
  } catch (raw) {
    const error = raw instanceof Error ? raw : new Error(String(raw));
    // Reads share the unified classifier with writes. Reads can't
    // trigger a TransactionCanceledException, so reason walking is a
    // no-op for them — but using one classifier prevents drift.
    // For reads we treat ambiguous as transient: an unknown error
    // before any side-effect is safe to retry, and the caller's
    // exhaustive switch maps transient → retryable_failure.
    const classification = classifyDdbError(error);
    if (classification === "fatal") {
      return { kind: "fatal_failure", error };
    }
    return { kind: "transient_failure", error };
  }
}

function buildProvisioningTransactWrite(
  input: ProvisioningInput,
  stripeCustomerId: string,
  customerId: string,
  keysTableName: string,
  customersTableName: string,
  auditTableName: string,
  now: Date,
): TransactWriteCommand {
  const completedAt = now.toISOString();
  const freePlan = PLANS[FREE_TIER];
  if (!freePlan) {
    throw new Error(`Plan ${FREE_TIER} is not configured`);
  }
  const envelope: OrgEnvelopeRecord = {
    apiKeyHash: getOrgEnvelopeKey(input.orgId),
    completedAt,
    customerId,
    hasFirstKey: false,
    ownerEmail: input.ownerEmail,
    paymentOverdue: false,
    products: freePlan.products,
    stripeCustomerId,
    stripeSubscriptionId: null,
    subscriptionItems: {},
    tier: FREE_TIER,
  };
  const customer: CustomerRecord = {
    orgId: input.orgId,
    customerId,
    lagoExternalCustomerId: customerId,
    lagoCustomerId: null,
    stripeCustomerId,
    ownerEmail: input.ownerEmail,
    status: "active",
    createdAt: completedAt,
    updatedAt: completedAt,
  };

  const auditItem = buildAuditTransactItem({
    tableName: auditTableName,
    orgId: input.orgId,
    action: "ORG_PROVISIONED",
    actorId: input.actorId,
    metadata: {
      customerId,
      source: input.source,
      stripeCustomerId,
    },
    now,
  });

  return new TransactWriteCommand({
    TransactItems: [
      {
        Put: {
          TableName: keysTableName,
          Item: envelope,
          ConditionExpression: "attribute_not_exists(apiKeyHash)",
        },
      },
      {
        Put: {
          TableName: customersTableName,
          Item: customer,
          ConditionExpression: "attribute_not_exists(orgId)",
        },
      },
      auditItem,
    ],
  });
}

type DdbClassification = "transient" | "fatal" | "ambiguous";

function getCancellationReasons(error: Error): { Code?: string }[] | undefined {
  const reasons = (error as { CancellationReasons?: unknown }).CancellationReasons;
  return Array.isArray(reasons) ? (reasons as { Code?: string }[]) : undefined;
}

function hasSmithyRetryableTrait(error: unknown): boolean {
  // Smithy/AWS-SDK v3 sets `$retryable` on errors the SDK considered
  // retryable. By the time the error escapes to our code the SDK has
  // already retried internally, so this is mostly a *classification*
  // signal ("the kind of error this was") rather than a directive. Use
  // it as a fallback when we don't recognise the name.
  if (typeof error !== "object" || error === null) return false;
  return "$retryable" in error && (error as { $retryable: unknown }).$retryable !== undefined;
}

// Unified DynamoDB error classifier — used by both the read path
// (readOrgEnvelope) and the write path (the post-TransactWriteItems
// retry loop). Three outcomes:
//
//   transient  → name allowlist OR Smithy retryable trait OR a
//                TransactionCanceledException whose reasons are all
//                transient. Our retry loop should retry.
//   fatal      → name in FATAL_TOP_LEVEL_NAMES OR a TransactionCanceled
//                with at least one provably-terminal reason
//                (ValidationError, ItemCollectionSizeLimitExceeded, …).
//                Retrying will not succeed.
//   ambiguous  → unknown error name, no retry trait, not a recognised
//                terminal. Caller chooses policy: post-Stripe paths
//                map this to retryable_failure (Stripe idempotency-key
//                + envelope attribute_not_exists make retries safe);
//                preflight (no Stripe customer yet) can choose fatal.
//
// ConditionalCheckFailed is deliberately NOT in either set — it's the
// idempotency-success signal handled by the post-failure reconciliation
// read in `provisionOrg`, not a retry trigger.
function classifyDdbError(error: unknown): DdbClassification {
  if (!(error instanceof Error)) return "ambiguous";

  // TransactionCanceledException needs reason walking before the
  // top-level checks: the wrapper name itself is uninformative.
  if (error.name === "TransactionCanceledException") {
    const reasons = getCancellationReasons(error);
    if (reasons) {
      // Provably fatal if ANY reason is terminal (excluding the
      // race-won ConditionalCheckFailed and the no-op None).
      const hasFatalReason = reasons.some((reason) => {
        const code = reason.Code;
        if (!code || code === "None" || code === "ConditionalCheckFailed") return false;
        if (TRANSIENT_REASON_CODES.has(code)) return false;
        return true;
      });
      if (hasFatalReason) return "fatal";
      const hasTransientReason = reasons.some(
        (reason) => reason.Code != null && TRANSIENT_REASON_CODES.has(reason.Code),
      );
      if (hasTransientReason) return "transient";
      // All ConditionalCheckFailed / None — caller's reconciliation
      // read decides; classify ambiguous.
      return "ambiguous";
    }
  }

  if (FATAL_TOP_LEVEL_NAMES.has(error.name)) return "fatal";
  if (TRANSIENT_TOP_LEVEL_NAMES.has(error.name)) return "transient";
  if (hasSmithyRetryableTrait(error)) return "transient";

  return "ambiguous";
}

// Stripe SDK errors expose two separate signals:
//   - `error.type` is a category string like `"card_error"` /
//     `"invalid_request_error"` / `"api_error"` (NOT a class name)
//   - the constructor itself is the typed subclass on
//     `Stripe.errors.*`
// `instanceof` is the contract Stripe documents for branching, so we use
// that rather than string matching on `error.type` (which previously had
// us comparing TS class names against category strings — a silent
// no-match that defaulted everything to "not fatal").
//
// Default for unrecognised Stripe error subclasses: NOT fatal. Reason:
// every customers.create call is idempotency-keyed on
// `clerk-provision-{orgId}`, so a Svix retry of a transient blip we
// misclassified just returns the same `cus_...`. Misclassifying a real
// fatal error as retryable (the cost) is bounded by Svix's retry window
// and an eventual DLQ alarm. Misclassifying a transient as fatal (the
// alternative) silently drops a real customer.
function isFatalStripeError(error: unknown): boolean {
  if (!(error instanceof Stripe.errors.StripeError)) {
    return false;
  }
  if (
    error instanceof Stripe.errors.StripeCardError ||
    error instanceof Stripe.errors.StripeInvalidRequestError ||
    error instanceof Stripe.errors.StripeAuthenticationError ||
    error instanceof Stripe.errors.StripePermissionError ||
    error instanceof Stripe.errors.StripeIdempotencyError
  ) {
    return true;
  }
  // Connection / API / RateLimit / UnknownError → retryable.
  return false;
}

async function sleepDefault(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function getDefaultEmailSender(logger: Logger): EmailSender {
  return async (input) => {
    try {
      return await sendSignedSesEmail({
        bodyText: `Welcome to Prontiq.\n\nYour account is ready. Sign in to create your first API key:\n${input.signInUrl}\n\nDocs: ${input.docsUrl}\n`,
        configurationSetName: process.env.SES_CONFIGURATION_SET_NAME,
        fromEmail: input.fromEmail,
        region: input.region,
        subject: "Welcome to Prontiq.",
        toEmail: input.toEmail,
      });
    } catch (error) {
      logger.warn("Welcome email send failed", {
        error: error instanceof Error ? error.message : String(error),
        toEmail: input.toEmail,
      });
      return false;
    }
  };
}

// Boundary guard: invoked only after the org envelope is durably
// committed. Any throw from an injected `sendWelcomeEmail` (rejecting
// promise, sync throw before the await, anything) is logged and
// translated to `false` so it cannot escape `provisionOrg`. The
// envelope is durable; the email is genuinely best-effort.
//
// Skips when WELCOME_EMAIL_FROM is unset (returns false without
// invoking the sender), preserving the prior contract.
async function sendWelcomeEmailSafely(
  ddb: DynamoDBDocumentClient,
  send: EmailSender,
  logger: Logger,
  input: ProvisioningInput,
): Promise<boolean> {
  const emailFrom = process.env.WELCOME_EMAIL_FROM;
  if (typeof emailFrom !== "string" || emailFrom.length === 0) {
    return false;
  }
  try {
    const suppressionsTableName = process.env.SUPPRESSIONS_TABLE_NAME;
    if (typeof suppressionsTableName === "string" && suppressionsTableName.length > 0) {
      if (await isSuppressedEmail(ddb, suppressionsTableName, input.ownerEmail)) {
        logger.info("Skipping welcome email due to SES suppression", {
          orgId: input.orgId,
          toEmail: input.ownerEmail,
        });
        return false;
      }
    }
    return await send({
      docsUrl: getOptionalEnv("PRONTIQ_DOCS_URL", "https://docs.prontiq.dev"),
      fromEmail: emailFrom,
      region: getOptionalEnv("AWS_REGION", "ap-southeast-2"),
      signInUrl: getOptionalEnv("PRONTIQ_ACCOUNT_URL", DEFAULT_ACCOUNT_URL),
      toEmail: input.ownerEmail,
    });
  } catch (error) {
    logger.warn("Welcome email send threw after envelope commit (treating as best-effort failure)", {
      error: error instanceof Error ? error.message : String(error),
      orgId: input.orgId,
      toEmail: input.ownerEmail,
    });
    return false;
  }
}

export function createProvisioningService(
  overrides: Partial<ProvisioningDependencies> = {},
): { provisionOrg: (input: ProvisioningInput) => Promise<ProvisioningResult> } {
  const logger = overrides.logger ?? defaultLogger;
  const dependencies: ProvisioningDependencies = {
    auditTableName: overrides.auditTableName ?? getRequiredEnv("AUDIT_TABLE_NAME"),
    customersTableName: overrides.customersTableName ?? getRequiredEnv("CUSTOMERS_TABLE_NAME"),
    ddb: overrides.ddb ?? getDefaultDdb(),
    generateCustomerId: overrides.generateCustomerId ?? generateCustomerIdDefault,
    keysTableName: overrides.keysTableName ?? getRequiredEnv("KEYS_TABLE_NAME"),
    logger,
    sendWelcomeEmail: overrides.sendWelcomeEmail ?? getDefaultEmailSender(logger),
    sleep: overrides.sleep ?? sleepDefault,
    stripe: overrides.stripe ?? getDefaultStripe(),
  };

  async function provisionOrg(input: ProvisioningInput): Promise<ProvisioningResult> {
    const preflight = await readOrgEnvelope(
      dependencies.ddb,
      dependencies.keysTableName,
      input.orgId,
    );
    switch (preflight.kind) {
      case "found":
        return {
          status: "already_exists",
          emailSent: false,
          orgEnvelope: preflight.record,
          stripeCustomerId: preflight.record.stripeCustomerId ?? undefined,
        };
      case "transient_failure":
        dependencies.logger.error("Preflight ORG envelope read failed (transient)", {
          error: preflight.error.message,
          orgId: input.orgId,
        });
        return { status: "retryable_failure", emailSent: false };
      case "fatal_failure":
        dependencies.logger.error("Preflight ORG envelope read failed (fatal)", {
          error: preflight.error.message,
          orgId: input.orgId,
        });
        return { status: "fatal_failure", emailSent: false };
      case "missing":
        break;
    }

    let stripeCustomerId: string;
    try {
      const customer = await dependencies.stripe.customers.create(
        {
          email: input.ownerEmail,
          metadata: {
            orgId: input.orgId,
            source: input.source,
          },
        },
        {
          idempotencyKey: `clerk-provision-${input.orgId}`,
        },
      );
      stripeCustomerId = customer.id;
    } catch (error) {
      const fatal = isFatalStripeError(error);
      dependencies.logger.error("Stripe customer creation failed", {
        error: error instanceof Error ? error.message : String(error),
        fatal,
        orgId: input.orgId,
      });
      return { status: fatal ? "fatal_failure" : "retryable_failure", emailSent: false };
    }

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      try {
        const now = new Date();
        const customerId = dependencies.generateCustomerId(now);
        await dependencies.ddb.send(
          buildProvisioningTransactWrite(
            input,
            stripeCustomerId,
            customerId,
            dependencies.keysTableName,
            dependencies.customersTableName,
            dependencies.auditTableName,
            now,
          ),
        );
        // Strong-read confirmation: a successful TransactWriteItems
        // commit followed by a strongly-consistent GetItem MUST return
        // the envelope. Three failure shapes to handle, all preserving
        // stripeCustomerId so retries reuse it via the idempotency-key:
        //  - transient_failure: temporary read issue → caller should
        //    retry (Svix redelivery for webhook, client retry for API)
        //  - fatal_failure: schema/IAM drift → page someone
        //  - missing: impossible under strong reads after a successful
        //    commit; treat as fatal infra fault
        const confirm = await readOrgEnvelope(
          dependencies.ddb,
          dependencies.keysTableName,
          input.orgId,
        );
        switch (confirm.kind) {
          case "found": {
            // The org is durably committed at this point. The welcome
            // email is genuinely best-effort — ANY failure here (a
            // rejecting injected sender, a misconfigured SES identity,
            // a network blip mid-call) MUST be translated to
            // emailSent: false rather than allowed to escape. The
            // default `getDefaultEmailSender` already wraps SigV4 in
            // try/catch, but `EmailSender` is a public interface and
            // injected implementations are not contractually required
            // to be exception-free. This is the boundary that enforces
            // it. Without this guard, a throw here would turn a
            // durable provisioning success into a 500, the caller would
            // observe failure for an org that was actually provisioned,
            // and the next Svix retry would self-recover via the
            // preflight `already_exists` path — but the initial
            // response would be wrong. Belt-and-braces.
            const emailSent = await sendWelcomeEmailSafely(
              dependencies.ddb,
              dependencies.sendWelcomeEmail,
              dependencies.logger,
              input,
            );
            return {
              status: "created",
              emailSent,
              orgEnvelope: confirm.record,
              stripeCustomerId,
            };
          }
          case "transient_failure":
            dependencies.logger.error(
              "Post-commit confirmation read failed (transient) — envelope likely committed; caller should retry to confirm",
              { attempt, orgId: input.orgId, stripeCustomerId, error: confirm.error.message },
            );
            return { status: "retryable_failure", emailSent: false, stripeCustomerId };
          case "fatal_failure":
            dependencies.logger.error(
              "Post-commit confirmation read failed (fatal) — envelope likely committed but cannot be verified",
              { attempt, orgId: input.orgId, stripeCustomerId, error: confirm.error.message },
            );
            return { status: "fatal_failure", emailSent: false, stripeCustomerId };
          case "missing":
            dependencies.logger.error(
              "Post-commit confirmation read returned no envelope despite successful TransactWriteItems",
              { attempt, orgId: input.orgId, stripeCustomerId },
            );
            return { status: "fatal_failure", emailSent: false, stripeCustomerId };
        }
      } catch (error) {
        // After a write failure, we must read to distinguish "competing
        // writer won the race" (already_exists) from "real failure"
        // (retryable / fatal). If the read itself fails, we cannot
        // distinguish — preserve stripeCustomerId and return retryable
        // (Svix redelivery is safe: the customer-create idempotency-key
        // means no duplicate Stripe customer; the envelope's
        // attribute_not_exists means no duplicate envelope).
        const reconcile = await readOrgEnvelope(
          dependencies.ddb,
          dependencies.keysTableName,
          input.orgId,
        );
        if (reconcile.kind === "found") {
          return {
            status: "already_exists",
            emailSent: false,
            orgEnvelope: reconcile.record,
            stripeCustomerId: reconcile.record.stripeCustomerId ?? undefined,
          };
        }
        if (
          reconcile.kind === "transient_failure" ||
          reconcile.kind === "fatal_failure"
        ) {
          dependencies.logger.error("Reconciliation read after write failure also failed", {
            attempt,
            orgId: input.orgId,
            stripeCustomerId,
            writeError: error instanceof Error ? error.message : String(error),
            readError: reconcile.error.message,
            readKind: reconcile.kind,
          });
          return {
            status: reconcile.kind === "transient_failure" ? "retryable_failure" : "fatal_failure",
            emailSent: false,
            stripeCustomerId,
          };
        }
        // reconcile.kind === "missing" → no competing writer visible.
        // Classify the original write error using the unified DDB
        // classifier. We treat AMBIGUOUS as transient on this path —
        // the write may have committed but its response was lost
        // (TimeoutError, AbortError, generic SDK error). Two safety
        // properties make a retry safe even in the truly-committed
        // case:
        //   - The Stripe customer is already created with the
        //     deterministic idempotency-key, so a Svix retry's
        //     customers.create returns the same `cus_...`.
        //   - The envelope's `attribute_not_exists(apiKeyHash)` and
        //     audit's conditional write reject duplicates.
        // The cost of misclassifying transient as fatal is much worse
        // (operator alarm + user-visible failure for a successful
        // provisioning) than the cost of misclassifying fatal as
        // transient (Svix retries for 5d, then DLQ alarm — same
        // operator visibility, just delayed).
        const writeClassification = classifyDdbError(error);
        if (writeClassification === "transient" && attempt < MAX_ATTEMPTS) {
          await dependencies.sleep(BACKOFF_MS * attempt);
          continue;
        }
        if (writeClassification === "ambiguous" && attempt < MAX_ATTEMPTS) {
          await dependencies.sleep(BACKOFF_MS * attempt);
          continue;
        }
        const isFatal = writeClassification === "fatal";
        dependencies.logger.error("Org provisioning failed", {
          attempt,
          classification: writeClassification,
          error: error instanceof Error ? error.message : String(error),
          orgId: input.orgId,
        });
        return {
          status: isFatal ? "fatal_failure" : "retryable_failure",
          emailSent: false,
          stripeCustomerId,
        };
      }
    }

    return {
      status: "retryable_failure",
      emailSent: false,
      stripeCustomerId,
    };
  }

  return { provisionOrg };
}
