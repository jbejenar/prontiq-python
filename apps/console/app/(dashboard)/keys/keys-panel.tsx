"use client";

import { useEffect, useRef, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, KeyRound, Loader2, RefreshCcw } from "lucide-react";
import { toast } from "sonner";

import { accountApi, AccountApiError, type CreatedKey, type ListedKey } from "../../../lib/account-api.js";
import { Badge } from "../../../components/ui/badge.js";
import { Button } from "../../../components/ui/button.js";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../components/ui/card.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../../components/ui/dialog.js";
import { Input } from "../../../components/ui/input.js";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../../components/ui/table.js";

const statusQueryKey = (orgId: string) => ["account-status", orgId] as const;
const keysQueryKey = (orgId: string) => ["account-keys", orgId] as const;

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

function KeyTable({ keys }: { keys: ListedKey[] }) {
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
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function KeysPanel() {
  const { getToken, isLoaded, orgId } = useAuth();
  const queryClient = useQueryClient();
  const [label, setLabel] = useState("");
  const [createdKey, setCreatedKey] = useState<CreatedKey | null>(null);
  const [isRevealOpen, setIsRevealOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [isSettingUp, setIsSettingUp] = useState(false);
  const activeOrgRef = useRef<string | null>(null);
  const createRequestSeq = useRef(0);
  const setupRequestSeq = useRef(0);

  const tokenGetter = (options?: { template?: string }) => getToken(options);
  const hasActiveOrg = isLoaded && typeof orgId === "string" && orgId.length > 0;
  const activeStatusQueryKey = statusQueryKey(orgId ?? "no-active-org");
  const activeKeysQueryKey = keysQueryKey(orgId ?? "no-active-org");

  useEffect(() => {
    activeOrgRef.current = orgId ?? null;
    createRequestSeq.current += 1;
    setupRequestSeq.current += 1;
    setCreatedKey(null);
    setIsRevealOpen(false);
    setLabel("");
    setIsCreating(false);
    setIsSettingUp(false);
  }, [orgId]);

  const statusQuery = useQuery({
    enabled: hasActiveOrg,
    queryKey: activeStatusQueryKey,
    queryFn: () => accountApi.getStatus(tokenGetter),
  });

  const shouldListKeys = statusQuery.data?.provisioned === true && statusQuery.data.hasFirstKey;
  const keysQuery = useQuery({
    enabled: hasActiveOrg && shouldListKeys,
    queryKey: activeKeysQueryKey,
    queryFn: () => accountApi.listKeys(tokenGetter),
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
      setCreatedKey(created);
      setIsRevealOpen(true);
      setLabel("");
      toast.success("API key created");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: activeStatusQueryKey }),
        queryClient.invalidateQueries({ queryKey: activeKeysQueryKey }),
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

  async function copyRawKey() {
    if (!createdKey) return;
    await navigator.clipboard.writeText(createdKey.raw);
    toast.success("Copied API key");
  }

  const status = statusQuery.data;
  const canManageKeys = status?.canManageKeys === true;

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
              API keys are scoped to the active Clerk organization. Select an organization from the switcher before managing keys.
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
            <CardTitle>{canManageKeys ? "Set up your account" : "Account setup required"}</CardTitle>
            <CardDescription>
              {canManageKeys
                ? "The Clerk webhook has not provisioned this org yet. Run recovery setup to create the org envelope."
                : "Ask an organization admin to finish account setup before keys can be created."}
            </CardDescription>
          </CardHeader>
          {canManageKeys ? (
            <CardContent>
              <Button
                disabled={isSettingUp}
                type="button"
                onClick={() => void setupAccount()}
              >
                {isSettingUp ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Set up account
              </Button>
            </CardContent>
          ) : null}
        </Card>
      ) : null}

      {status?.provisioned === true ? (
        <section className="grid gap-4 xl:grid-cols-[0.85fr_1.15fr]">
          <Card>
            <CardHeader>
              <CardTitle>{status.hasFirstKey ? "Create another key" : "Create your first API key"}</CardTitle>
              <CardDescription>
                {canManageKeys
                  ? "Name the key by environment or use case. The raw key appears once after creation."
                  : "Members can view keys, but only org admins can create new keys."}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Input
                disabled={!canManageKeys || isCreating}
                maxLength={64}
                onChange={(event) => setLabel(event.target.value)}
                placeholder="Production, CI, local dev..."
                value={label}
              />
              <Button disabled={!canManageKeys || isCreating} type="button" onClick={() => void createKey()}>
                {isCreating ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
                {status.hasFirstKey ? "Create key" : "Create first key"}
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Active keys</CardTitle>
              <CardDescription>Only masked key metadata is returned by the API.</CardDescription>
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
                  <Button type="button" variant="outline" onClick={() => void keysQuery.refetch()}>
                    <RefreshCcw className="h-4 w-4" />
                    Retry key list
                  </Button>
                </div>
              ) : (
                <KeyTable keys={keysQuery.data?.keys ?? []} />
              )}
            </CardContent>
          </Card>
        </section>
      ) : null}

      <Dialog
        open={isRevealOpen}
        onOpenChange={(open) => {
          setIsRevealOpen(open);
          if (!open) setCreatedKey(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Copy your API key now</DialogTitle>
            <DialogDescription>
              This raw key is shown once. Store it in your secret manager before closing.
            </DialogDescription>
          </DialogHeader>
          {createdKey ? (
            <div className="rounded-lg border border-border bg-background/80 p-4 font-mono text-sm break-all">
              {createdKey.raw}
            </div>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => void copyRawKey()}>
              <Copy className="h-4 w-4" />
              Copy key
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
