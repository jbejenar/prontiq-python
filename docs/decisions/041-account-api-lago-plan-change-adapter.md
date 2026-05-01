# DEC-041: Lago Plan Changes Use the Private Account API

## Status

Accepted.

## Question

Where should console-initiated Lago subscription plan changes run now that the
console needs replay-safe mutations but the browser must not hold Lago,
Stripe, AWS, or DynamoDB credentials?

## Decision

Plan changes use `POST /v1/account/billing/plan-change` in the AWS private
account API. The browser calls it with the same Clerk JWT pattern used by key
management and sends a per-click `Idempotency-Key`.

The account API:

- verifies Clerk JWT and active org context;
- requires org admin role;
- requires first-factor Clerk reverification;
- validates the target Lago plan code against the visible Lago catalog;
- writes action and org-lock evidence to `prontiq-billing-actions*`;
- fences the provider boundary as `provider_in_flight`;
- calls Lago to change `external_id = lago_sub_${orgId}`;
- returns accepted, pending, or noop state;
- never writes local API enforcement fields directly.

Lago remains the billing source of truth. Lago webhook reconciliation or the
operator reconcile job projects accepted Lago plan state into DynamoDB bouncer
fields.

Billing reads and payment-link routes remain in the Vercel BFF:

- `GET /api/billing/summary`
- `POST /api/billing/checkout`
- `POST /api/billing/invoices/payment-url`

## Considered And Rejected

- Keep plan changes in the Vercel BFF with DynamoDB credentials: rejected
  because it pushes AWS credentials and provider-boundary locking into the
  frontend hosting tier and diverges from the key-management account API
  pattern.
- Browser calls Lago directly: rejected because it would expose Lago
  credentials and provider data.
- Lago-only idempotency: rejected because Prontiq needs request-hash conflict
  detection and durable customer-action evidence before crossing the provider
  boundary.
- Let the plan-change route update local enforcement directly: rejected because
  it duplicates Lago webhook/reconcile projection and risks making the platform
  a competing billing source of truth.
- Move all billing reads to AWS: rejected for this ticket because reads and
  payment-link actions already work server-side in Vercel and do not need the
  replay ledger.

## Consequences

- `prontiq-billing-actions*` is an active AWS control-plane table, not legacy
  only.
- `PqAccount` needs `BILLING_ACTIONS_TABLE_NAME`, `LAGO_API_URL`,
  `LAGO_API_KEY`, `PRONTIQ_BILLING_PLAN_CHANGES_ENABLED`, optional
  `PRONTIQ_BILLING_PLAN_CHANGE_ALLOWED_ORG_IDS`, and optional
  `PRONTIQ_BILLING_CATALOG_ENV`.
- Vercel no longer needs billing-action AWS credentials or table names.
- The private OpenAPI spec includes the plan-change endpoint; the public data
  API spec remains unchanged.
- Operator rollback can disable plan changes with
  `PRONTIQ_BILLING_PLAN_CHANGES_ENABLED=false` without affecting billing reads,
  payment setup, invoice payment links, key management, usage charts, or the
  public address API.
