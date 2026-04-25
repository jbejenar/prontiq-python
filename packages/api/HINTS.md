# API Agent Hints

- Do not call Lago or Stripe from the address API hot path.
- Billing event emission is allowed only through `BillingUsageEventV1` after
  DynamoDB usage enforcement succeeds.
- Keep `BILLING_EVENTS_ENABLED` defaulted off unless the deployed stage has a
  working P1B.16 consumer.
- Never include raw API keys, query strings, headers, IP addresses, user agents,
  or response payloads in billing events.
