export const accountStatusQueryKey = (orgId: string) => ["account-status", orgId] as const;

export const accountKeysQueryKey = (orgId: string) => ["account-keys", orgId] as const;

export const accountAuditQueryKey = (orgId: string) => ["account-audit", orgId] as const;

export const accountUsageQueryKey = (orgId: string, granularity: string) =>
  ["account-usage", orgId, granularity] as const;

export const accountBillingQueryKey = (orgId: string) => ["account-billing", orgId] as const;
