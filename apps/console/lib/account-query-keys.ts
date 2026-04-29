export const accountStatusQueryKey = (orgId: string) => ["account-status", orgId] as const;

export const accountKeysQueryKey = (orgId: string) => ["account-keys", orgId] as const;

export const accountAuditQueryKey = (orgId: string) => ["account-audit", orgId] as const;
