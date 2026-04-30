# Lago Customer Sync Runbook

## Current Contract

P1B.22 makes Clerk `orgId` the active commercial identity.

- Clerk org id: `org_...`
- Lago customer external id: same `org_...`
- Lago subscription external id: `lago_sub_${orgId}`
- Platform hot-path usage state: DynamoDB `prontiq-keys` and `prontiq-usage`
- Stripe: payment rail configured inside Lago only

`prontiq-customers`, `pq_cust_*`, and `pq_sub_*` are legacy migration evidence
from P1B.14-P1B.21 and must not be used for new provisioning or repair logic.

## Provisioning Flow

1. Clerk webhook or `POST /v1/account/setup` resolves the verified primary email.
2. `createProvisioningService().provisionOrg(...)` writes `ORG#{orgId}` to
   `prontiq-keys`.
3. Provisioning upserts Lago customer `external_id = orgId`.
   - The customer billing configuration sets Stripe as the Lago payment
     provider, passes `LAGO_PAYMENT_PROVIDER_CODE`, and requests Lago provider
     sync with `sync=true`, `sync_with_provider=true`, and
     `provider_payment_methods=["card","link"]`.
   - The platform does not create Stripe customers directly; Lago creates or
     links the provider customer behind its Stripe integration.
4. Provisioning ensures Lago Free subscription `external_id = lago_sub_${orgId}`.
5. API key rows carry `orgId` and `lagoSubscriptionExternalId` for hot-path
   billing-event emission.

## Repair Flow

Use the repair command for org envelopes or API key rows that predate P1B.22.
Dry run first:

```bash
KEYS_TABLE_NAME=<keys-table> \
pnpm --filter @prontiq/control-plane repair:commercial-identity
```

Apply:

```bash
KEYS_TABLE_NAME=<keys-table> \
LAGO_API_URL=<lago-url> \
LAGO_API_KEY=<lago-api-key> \
LAGO_PAYMENT_PROVIDER_CODE=<stripe-provider-code> \
pnpm --filter @prontiq/control-plane repair:commercial-identity -- --apply
```

The apply path upserts Lago customer/subscription identity and updates local
`lagoSubscriptionExternalId` fields. It also repairs customers that were created
before provider sync was enabled by re-upserting them with the Lago Stripe sync
flags. It does not create API keys.

## Verification

- Every active API key has `orgId`.
- Every active API key has `lagoSubscriptionExternalId = lago_sub_${orgId}`.
- Every `ORG#{orgId}` envelope has `orgId`.
- Lago has customer `external_id = orgId`.
- Lago customer billing configuration has `payment_provider = stripe`,
  `payment_provider_code = LAGO_PAYMENT_PROVIDER_CODE`, and a non-empty
  provider customer id after Lago provider sync completes.
- Lago has subscription `external_id = lago_sub_${orgId}` on the expected plan.
