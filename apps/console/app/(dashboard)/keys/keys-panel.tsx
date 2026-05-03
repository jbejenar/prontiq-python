"use client";

import { useEffect, useRef, useState } from "react";
import { useAuth, useReverification } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, History, KeyRound, Loader2, PlaySquare, RefreshCcw, RotateCcw, ShieldX } from "lucide-react";
import { toast } from "sonner";

import {
  accountApi,
  AccountApiError,
  type AccountAuditEvent,
  type CreatedKey,
  type ListedKey,
  type RotatedKey,
} from "../../../lib/account-api.js";
import {
  accountAuditQueryKey,
  accountKeysQueryKey,
  accountStatusQueryKey,
} from "../../../lib/account-query-keys.js";
import { Badge } from "../../../components/ui/badge.js";
import { Button } from "../../../components/ui/button.js";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../../components/ui/card.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../../components/ui/dialog.js";
import { Input } from "../../../components/ui/input.js";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../../components/ui/table.js";
import { usePlaygroundKey } from "../../../features/playground/components/playground-key-provider.js";

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-AU", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function getErrorMessage(error: unknown) {
  if (error instanceof AccountApiError) return error.message;
  if (error instanceof Error) return error.message;
  return "Something went wrong. Please try again.";
}

function isRotatedKey(value: unknown): value is RotatedKey {
  return (
    typeof value === "object" &&
    value !== null &&
    "keyId" in value &&
    "raw" in value &&
    "keyPrefix" in value &&
    "createdAt" in value &&
    "rotatedAt" in value &&
    typeof value.keyId === "string" &&
    typeof value.raw === "string" &&
    typeof value.keyPrefix === "string" &&
    typeof value.createdAt === "string" &&
    typeof value.rotatedAt === "string"
  );
}

function isRevokedKey(value: unknown) {
  return (
    typeof value === "object" &&
    value !== null &&
    "keyId" in value &&
    "revokedAt" in value &&
    typeof value.keyId === "string" &&
    typeof value.revokedAt === "string"
  );
}

function KeyTable({
  canManageKeys,
  keys,
  onRequestRevoke,
  onRotate,
  pendingKeyId,
}: {
  canManageKeys: boolean;
  keys: ListedKey[];
  onRequestRevoke: (key: ListedKey) => void;
  onRotate: (key: ListedKey) => void;
  pendingKeyId: string | null;
}) {
  if (keys.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-background/70 p-4 text-sm text-muted-foreground">
        No active keys yet.
      </div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Key</TableHead>
          <TableHead>Label</TableHead>
          <TableHead>Products</TableHead>
          <TableHead>Created</TableHead>
          <TableHead>Last used</TableHead>
          <TableHead className="text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {keys.map((key) => (
          <TableRow key={key.keyId}>
            <TableCell className="font-mono text-sm">{key.keyPrefix}••••</TableCell>
            <TableCell>{key.label ?? "Untitled key"}</TableCell>
            <TableCell>{key.products.join(", ")}</TableCell>
            <TableCell>{formatDate(key.createdAt)}</TableCell>
            <TableCell>{key.lastUsedAt ? formatDate(key.lastUsedAt) : "Never"}</TableCell>
            <TableCell className="text-right">
              <div className="flex justify-end gap-2">
                <Button
                  disabled={!canManageKeys || pendingKeyId !== null}
                  size="sm"
                  type="button"
                  variant="outline"
                  onClick={() => onRotate(key)}
                >
                  {pendingKeyId === key.keyId ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <RotateCcw className="h-3.5 w-3.5" />
                  )}
                  Rotate
                </Button>
                <Button
                  disabled={!canManageKeys || pendingKeyId !== null}
                  size="sm"
                  type="button"
                  variant="outline"
                  onClick={() => onRequestRevoke(key)}
                >
                  <ShieldX className="h-3.5 w-3.5" />
                  Revoke
                </Button>
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function AuditPanel({
  events,
  isError,
  isPending,
  onRetry,
  error,
}: {
  events: AccountAuditEvent[];
  isError: boolean;
  isPending: boolean;
  onRetry: () => void;
  error: unknown;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <History className="h-4 w-4" />
          Recent audit
        </CardTitle>
        <CardDescription>
          Latest key lifecycle events for this organization. Actor IDs are unresolved Clerk user
          IDs.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isPending ? (
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading audit...
          </div>
        ) : isError ? (
          <div className="space-y-4 rounded-lg border border-border bg-background/70 p-4 text-sm text-muted-foreground">
            <p>{getErrorMessage(error)}</p>
            <Button type="button" variant="outline" onClick={onRetry}>
              <RefreshCcw className="h-4 w-4" />
              Retry audit
            </Button>
          </div>
        ) : events.length === 0 ? (
          <div className="rounded-lg border border-border bg-background/70 p-4 text-sm text-muted-foreground">
            No audit events yet.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Action</TableHead>
                <TableHead>Actor</TableHead>
                <TableHead>When</TableHead>
                <TableHead>IP</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {events.map((event, index) => (
                <TableRow key={`${event.timestamp}-${event.action}-${event.actorId}-${index}`}>
                  <TableCell>
                    <Badge>{event.action.toLowerCase()}</Badge>
                  </TableCell>
                  <TableCell className="max-w-[18rem] truncate font-mono text-xs">
                    {event.actorId}
                  </TableCell>
                  <TableCell>{formatDate(event.timestamp)}</TableCell>
                  <TableCell className="font-mono text-xs">{event.ip ?? "Not captured"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

export function KeysPanel() {
  const { getToken, isLoaded, orgId } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { setHeldKey } = usePlaygroundKey();
  const [label, setLabel] = useState("");
  const [revealedKey, setRevealedKey] = useState<
    (CreatedKey & { reason: "created" }) | (RotatedKey & { reason: "rotated" }) | null
  >(null);
  const [isRevealOpen, setIsRevealOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [isSettingUp, setIsSettingUp] = useState(false);
  const [pendingKeyId, setPendingKeyId] = useState<string | null>(null);
  const [keyPendingRevoke, setKeyPendingRevoke] = useState<ListedKey | null>(null);
  const activeOrgRef = useRef<string | null>(null);
  const createRequestSeq = useRef(0);
  const setupRequestSeq = useRef(0);

  const tokenGetter = (options?: { template?: string }) => getToken(options);
  const hasActiveOrg = isLoaded && typeof orgId === "string" && orgId.length > 0;
  const activeStatusQueryKey = accountStatusQueryKey(orgId ?? "no-active-org");
  const activeKeysQueryKey = accountKeysQueryKey(orgId ?? "no-active-org");
  const activeAuditQueryKey = accountAuditQueryKey(orgId ?? "no-active-org");

  useEffect(() => {
    activeOrgRef.current = orgId ?? null;
    createRequestSeq.current += 1;
    setupRequestSeq.current += 1;
    setRevealedKey(null);
    setIsRevealOpen(false);
    setLabel("");
    setIsCreating(false);
    setIsSettingUp(false);
    setPendingKeyId(null);
    setKeyPendingRevoke(null);
  }, [orgId]);

  const rotateKeyWithReverification = useReverification((keyId: string) =>
    accountApi.rotateKey(tokenGetter, { keyId }),
  );
  const revokeKeyWithReverification = useReverification((keyId: string) =>
    accountApi.revokeKey(tokenGetter, { keyId }),
  );

  const statusQuery = useQuery({
    enabled: hasActiveOrg,
    queryKey: activeStatusQueryKey,
    queryFn: () => accountApi.getStatus(tokenGetter),
  });

  const shouldListKeys =
    statusQuery.data?.provisioned === true &&
    (statusQuery.data.hasFirstKey || statusQuery.data.activeKeyCount > 0);
  const keysQuery = useQuery({
    enabled: hasActiveOrg && shouldListKeys,
    queryKey: activeKeysQueryKey,
    queryFn: () => accountApi.listKeys(tokenGetter),
  });
  const auditQuery = useQuery({
    enabled: hasActiveOrg && statusQuery.data?.provisioned === true,
    queryKey: activeAuditQueryKey,
    queryFn: () => accountApi.listAudit(tokenGetter),
  });

  async function setupAccount() {
    const requestOrgId = orgId ?? null;
    const requestId = setupRequestSeq.current + 1;
    setupRequestSeq.current = requestId;
    setIsSettingUp(true);
    try {
      await accountApi.runSetup(tokenGetter);
      if (requestId !== setupRequestSeq.current || requestOrgId !== activeOrgRef.current) return;
      toast.success("Account setup complete");
      await queryClient.invalidateQueries({ queryKey: activeStatusQueryKey });
    } catch (error) {
      if (requestId !== setupRequestSeq.current || requestOrgId !== activeOrgRef.current) return;
      toast.error(getErrorMessage(error));
    } finally {
      if (requestId === setupRequestSeq.current && requestOrgId === activeOrgRef.current) {
        setIsSettingUp(false);
      }
    }
  }

  async function createKey() {
    const requestOrgId = orgId ?? null;
    const requestId = createRequestSeq.current + 1;
    createRequestSeq.current = requestId;
    setIsCreating(true);
    try {
      const created = await accountApi.createKey(tokenGetter, {
        ...(label.trim() ? { label: label.trim() } : {}),
      });
      if (requestId !== createRequestSeq.current || requestOrgId !== activeOrgRef.current) return;
      setRevealedKey({ ...created, reason: "created" });
      setIsRevealOpen(true);
      setLabel("");
      toast.success("API key created");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: activeStatusQueryKey }),
        queryClient.invalidateQueries({ queryKey: activeKeysQueryKey }),
        queryClient.invalidateQueries({ queryKey: activeAuditQueryKey }),
      ]);
    } catch (error) {
      if (requestId !== createRequestSeq.current || requestOrgId !== activeOrgRef.current) return;
      toast.error(getErrorMessage(error));
    } finally {
      if (requestId === createRequestSeq.current && requestOrgId === activeOrgRef.current) {
        setIsCreating(false);
      }
    }
  }

  async function rotateKey(key: ListedKey) {
    const requestOrgId = orgId ?? null;
    setPendingKeyId(key.keyId);
    try {
      const rotated = (await rotateKeyWithReverification(key.keyId)) as unknown;
      if (requestOrgId !== activeOrgRef.current) return;
      if (!isRotatedKey(rotated)) return;
      setRevealedKey({ ...rotated, reason: "rotated" });
      setIsRevealOpen(true);
      toast.success("API key rotated");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: activeStatusQueryKey }),
        queryClient.invalidateQueries({ queryKey: activeKeysQueryKey }),
        queryClient.invalidateQueries({ queryKey: activeAuditQueryKey }),
      ]);
    } catch (error) {
      if (requestOrgId !== activeOrgRef.current) return;
      toast.error(getErrorMessage(error));
    } finally {
      if (requestOrgId === activeOrgRef.current) {
        setPendingKeyId(null);
      }
    }
  }

  async function revokeKey(key: ListedKey) {
    const requestOrgId = orgId ?? null;
    setPendingKeyId(key.keyId);
    try {
      const revoked = (await revokeKeyWithReverification(key.keyId)) as unknown;
      if (requestOrgId !== activeOrgRef.current) return;
      if (!isRevokedKey(revoked)) return;
      setKeyPendingRevoke(null);
      toast.success("API key revoked");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: activeStatusQueryKey }),
        queryClient.invalidateQueries({ queryKey: activeKeysQueryKey }),
        queryClient.invalidateQueries({ queryKey: activeAuditQueryKey }),
      ]);
    } catch (error) {
      if (requestOrgId !== activeOrgRef.current) return;
      toast.error(getErrorMessage(error));
    } finally {
      if (requestOrgId === activeOrgRef.current) {
        setPendingKeyId(null);
      }
    }
  }

  async function copyRawKey() {
    if (!revealedKey) return;
    await navigator.clipboard.writeText(revealedKey.raw);
    toast.success("Copied API key");
  }

  function openInPlayground() {
    if (!revealedKey) return;
    setHeldKey(revealedKey.raw);
    setIsRevealOpen(false);
    router.push("/playground");
  }

  const status = statusQuery.data;
  const canManageKeys = status?.canManageKeys === true;
  const hasVisibleKeys =
    status?.provisioned === true && (status.hasFirstKey || status.activeKeyCount > 0);
  const isAtKeyLimit = status?.provisioned === true && status.activeKeyCount >= status.maxKeys;
  const createDisabledReason = !canManageKeys
    ? "Members can view keys, but only org admins can create new keys."
    : isAtKeyLimit
      ? `This org has reached its ${status.maxKeys}-key limit. Revoke an existing key before creating another key.`
      : "Name the key by environment or use case. The raw key appears once after creation.";

  return (
    <>
      <section className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-3">
          <Badge>p1c.03</Badge>
          <div>
            <h1 className="text-5xl leading-none tracking-tight sm:text-6xl">API keys</h1>
            <p className="mt-4 max-w-2xl text-sm leading-6 text-muted-foreground">
              Create and view API keys for the active Clerk organization. Raw keys are shown once.
            </p>
          </div>
        </div>
        {status?.provisioned ? (
          <Card className="w-full max-w-sm bg-card/80">
            <CardHeader>
              <CardDescription>Active keys</CardDescription>
              <CardTitle className="text-3xl">
                {status.activeKeyCount} / {status.maxKeys}
              </CardTitle>
            </CardHeader>
          </Card>
        ) : null}
      </section>

      {isLoaded && !hasActiveOrg ? (
        <Card>
          <CardHeader>
            <CardTitle>Select an organization</CardTitle>
            <CardDescription>
              API keys are scoped to the active Clerk organization. Select an organization from the
              switcher before managing keys.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : null}

      {statusQuery.isPending && hasActiveOrg ? (
        <Card>
          <CardContent className="flex items-center gap-3 py-8 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading account status...
          </CardContent>
        </Card>
      ) : null}

      {statusQuery.isError ? (
        <Card>
          <CardHeader>
            <CardTitle>Could not load key management</CardTitle>
            <CardDescription>{getErrorMessage(statusQuery.error)}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button type="button" onClick={() => void statusQuery.refetch()}>
              <RefreshCcw className="h-4 w-4" />
              Retry
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {status?.provisioned === false ? (
        <Card>
          <CardHeader>
            <CardTitle>
              {canManageKeys ? "Set up your account" : "Account setup required"}
            </CardTitle>
            <CardDescription>
              {canManageKeys
                ? "The Clerk webhook has not provisioned this org yet. Run recovery setup to create the org envelope."
                : "Ask an organization admin to finish account setup before keys can be created."}
            </CardDescription>
          </CardHeader>
          {canManageKeys ? (
            <CardContent>
              <Button disabled={isSettingUp} type="button" onClick={() => void setupAccount()}>
                {isSettingUp ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Set up account
              </Button>
            </CardContent>
          ) : null}
        </Card>
      ) : null}

      {status?.provisioned === true ? (
        <div className="space-y-4">
          <section className="grid gap-4 xl:grid-cols-[0.85fr_1.15fr]">
            <Card>
              <CardHeader>
                <CardTitle>
                  {hasVisibleKeys ? "Create another key" : "Create your first API key"}
                </CardTitle>
                <CardDescription>{createDisabledReason}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <Input
                  disabled={!canManageKeys || isAtKeyLimit || isCreating}
                  maxLength={64}
                  onChange={(event) => setLabel(event.target.value)}
                  placeholder="Production, CI, local dev..."
                  value={label}
                />
                <Button
                  disabled={!canManageKeys || isAtKeyLimit || isCreating}
                  type="button"
                  onClick={() => void createKey()}
                >
                  {isCreating ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <KeyRound className="h-4 w-4" />
                  )}
                  {hasVisibleKeys ? "Create key" : "Create first key"}
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Active keys</CardTitle>
                <CardDescription>
                  Only masked key metadata is returned by the API. Admins can rotate or revoke keys;
                  members can only view them.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {keysQuery.isPending && shouldListKeys ? (
                  <div className="flex items-center gap-3 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading keys...
                  </div>
                ) : keysQuery.isError ? (
                  <div className="space-y-4 rounded-lg border border-border bg-background/70 p-4 text-sm text-muted-foreground">
                    <p>{getErrorMessage(keysQuery.error)}</p>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => void keysQuery.refetch()}
                    >
                      <RefreshCcw className="h-4 w-4" />
                      Retry key list
                    </Button>
                  </div>
                ) : (
                  <KeyTable
                    canManageKeys={canManageKeys}
                    keys={keysQuery.data?.keys ?? []}
                    pendingKeyId={pendingKeyId}
                    onRequestRevoke={setKeyPendingRevoke}
                    onRotate={(key) => void rotateKey(key)}
                  />
                )}
              </CardContent>
            </Card>
          </section>

          <AuditPanel
            error={auditQuery.error}
            events={auditQuery.data?.events ?? []}
            isError={auditQuery.isError}
            isPending={auditQuery.isPending}
            onRetry={() => void auditQuery.refetch()}
          />
        </div>
      ) : null}

      <Dialog
        open={isRevealOpen}
        onOpenChange={(open) => {
          setIsRevealOpen(open);
          if (!open) setRevealedKey(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {revealedKey?.reason === "rotated"
                ? "Copy your rotated API key now"
                : "Copy your API key now"}
            </DialogTitle>
            <DialogDescription>
              This raw key is shown once. Store it in your secret manager before closing.
            </DialogDescription>
          </DialogHeader>
          {revealedKey ? (
            <div className="rounded-lg border border-border bg-background/80 p-4 font-mono text-sm break-all">
              {revealedKey.raw}
            </div>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => void copyRawKey()}>
              <Copy className="h-4 w-4" />
              Copy key
            </Button>
            <Button type="button" onClick={openInPlayground}>
              <PlaySquare className="h-4 w-4" />
              Open in Playground
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={keyPendingRevoke !== null}
        onOpenChange={(open) => !open && setKeyPendingRevoke(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Revoke API key?</DialogTitle>
            <DialogDescription>
              This marks {keyPendingRevoke?.keyPrefix ?? "the selected key"} as inactive. Existing
              clients using this raw key will receive 401 responses.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setKeyPendingRevoke(null)}>
              Cancel
            </Button>
            <Button
              disabled={pendingKeyId !== null}
              type="button"
              variant="destructive"
              onClick={() => {
                if (keyPendingRevoke) void revokeKey(keyPendingRevoke);
              }}
            >
              {pendingKeyId === keyPendingRevoke?.keyId ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : null}
              Revoke key
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
