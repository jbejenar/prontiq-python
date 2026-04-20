const MAX_ATTRIBUTE_STRING_LENGTH = 256;

const ALLOWED_KEYS = new Set([
  "prontiq.billing.month",
  "prontiq.billing.operation",
  "prontiq.ingestion.step",
  "prontiq.ingestion.version",
  "prontiq.method",
  "prontiq.org_id",
  "prontiq.product",
  "prontiq.request_id",
  "prontiq.route",
  "prontiq.stage",
  "prontiq.webhook.event_id",
  "prontiq.webhook.provider",
  "prontiq.webhook.type",
]);

const FORBIDDEN_SUBSTRINGS = [
  "api_key",
  "authorization",
  "body",
  "cookie",
  "email",
  "hash",
  "jwt",
  "query",
  "secret",
  "token",
];

export type SpanAttributeValue = boolean | number | string;
export type SpanAttributesInput = Record<string, unknown>;

function isForbiddenKey(key: string): boolean {
  const normalized = key.toLowerCase();
  return FORBIDDEN_SUBSTRINGS.some((fragment) => normalized.includes(fragment));
}

function sanitizeValue(value: unknown): SpanAttributeValue | undefined {
  if (typeof value === "string") {
    return value.length <= MAX_ATTRIBUTE_STRING_LENGTH
      ? value
      : value.slice(0, MAX_ATTRIBUTE_STRING_LENGTH);
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }

  if (typeof value === "boolean") {
    return value;
  }

  return undefined;
}

export function sanitizeSpanAttributes(
  input: SpanAttributesInput,
): Record<string, SpanAttributeValue> {
  const out: Record<string, SpanAttributeValue> = {};

  for (const [key, value] of Object.entries(input)) {
    if (!ALLOWED_KEYS.has(key) || isForbiddenKey(key)) {
      continue;
    }

    const sanitizedValue = sanitizeValue(value);
    if (sanitizedValue === undefined) {
      continue;
    }

    out[key] = sanitizedValue;
  }

  return out;
}

export function setActiveSpanAttributes(
  target: { setAttributes: (attributes: Record<string, SpanAttributeValue>) => void } | undefined,
  input: SpanAttributesInput,
): void {
  if (!target) {
    return;
  }

  const attributes = sanitizeSpanAttributes(input);
  if (Object.keys(attributes).length === 0) {
    return;
  }

  target.setAttributes(attributes);
}
