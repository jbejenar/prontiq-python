# DEC-021: Lago Webhooks Use HMAC Signatures

## Status

Accepted.

## Context

Lago supports webhook signatures using JWT or HMAC. Prontiq needs a verification
path that is small enough for the webhook Lambda, does not require a live public
key fetch, and can be configured from GitHub Environment secrets.

## Decision

Use Lago webhook endpoints configured with `signature_algo = hmac`.

The platform verifies:

- `X-Lago-Signature-Algorithm: hmac`
- `X-Lago-Signature` as base64 HMAC-SHA256 of the raw request body
- `LAGO_WEBHOOK_HMAC_SECRET` as the per-environment secret source

## Considered And Rejected

- **Lago JWT signature.** Rejected for v1 because it requires public-key
  retrieval/storage behavior and keeps more JWT parsing code in the webhook
  Lambda.
- **Unsigned Lago endpoint plus network allow-list.** Rejected because API
  Gateway public endpoints need message-level authenticity; source IP controls
  are brittle and insufficient on their own.

## Consequences

- Operators must create the Lago webhook endpoint with HMAC, not the default JWT
  option.
- Rotating the HMAC token requires updating `LAGO_WEBHOOK_HMAC_SECRET` and
  redeploying before changing the Lago endpoint token.
- Invalid signatures return 400 and are never written to the idempotency ledger.
