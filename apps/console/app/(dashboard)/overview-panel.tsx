"use client";

import Link from "next/link";
import { useAuth } from "@clerk/nextjs";
import { useQuery } from "@tanstack/react-query";
import { Copy, KeyRound, Loader2, RefreshCcw, Terminal } from "lucide-react";
import { toast } from "sonner";

import { accountApi, AccountApiError, type ListedKey } from "../../lib/account-api.js";
import { accountKeysQueryKey, accountStatusQueryKey } from "../../lib/account-query-keys.js";
import { Badge } from "../../components/ui/badge.js";
import { Button } from "../../components/ui/button.js";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../components/ui/card.js";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../components/ui/table.js";

const SNIPPET_KEY_PLACEHOLDER = "<YOUR_API_KEY>";

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

function formatPlanCode(planCode: string) {
  return planCode;
}

function formatKeyLimit(maxKeys: number) {
  return maxKeys >= Number.MAX_SAFE_INTEGER ? "unlimited" : String(maxKeys);
}

function keyLabel(key: ListedKey) {
  return key.label ?? "Untitled key";
}

function buildSnippets(apiUrl: string) {
  return [
    {
      label: "curl",
      code: `curl "${apiUrl}/v1/address/autocomplete?q=2000" \\\n  -H "X-Api-Key: ${SNIPPET_KEY_PLACEHOLDER}"`,
    },
    {
      label: "TypeScript",
      code: `import { Prontiq } from "@prontiq/sdk";\n\nconst client = new Prontiq({\n  serverURL: "${apiUrl}",\n  apiKeyAuth: "${SNIPPET_KEY_PLACEHOLDER}",\n});\nconst result = await client.getV1AddressAutocomplete("2000");`,
    },
    {
      label: "Python",
      code: `import requests\n\nresponse = requests.get(\n    "${apiUrl}/v1/address/autocomplete",\n    params={"q": "2000"},\n    headers={"X-Api-Key": "${SNIPPET_KEY_PLACEHOLDER}"},\n)\nresult = response.json()`,
    },
  ];
}

function KeyPreviewTable({
  expectedActiveKeyCount,
  keys,
  onRetry,
}: {
  expectedActiveKeyCount: number;
  keys: ListedKey[];
  onRetry: () => void;
}) {
  if (keys.length === 0) {
    if (expectedActiveKeyCount > 0) {
      return (
        <div className="space-y-4 rounded-lg border border-amber-300 bg-amber-50/70 p-4 text-sm text-amber-950">
          <p>
            Key count projection says this organization has active keys, but the key list returned
            none. Retry the list before creating or rotating keys.
          </p>
          <Button type="button" variant="outline" onClick={onRetry}>
            <RefreshCcw className="h-4 w-4" />
            Retry key list
          </Button>
        </div>
      );
    }

    return (
      <div className="rounded-lg border border-border bg-background/70 p-4 text-sm text-muted-foreground">
        No active keys yet. Create your first key from the Keys page.
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
        {keys.slice(0, 3).map((key) => (
          <TableRow key={key.keyId}>
            <TableCell className="font-mono text-sm">{key.keyPrefix}••••</TableCell>
            <TableCell>{keyLabel(key)}</TableCell>
            <TableCell>{key.products.join(", ")}</TableCell>
            <TableCell>{formatDate(key.createdAt)}</TableCell>
            <TableCell>{key.lastUsedAt ? formatDate(key.lastUsedAt) : "Never"}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function OverviewPanel({ apiUrl }: { apiUrl: string }) {
  const { getToken, isLoaded, orgId } = useAuth();
  const tokenGetter = (options?: { template?: string }) => getToken(options);
  const hasActiveOrg = isLoaded && typeof orgId === "string" && orgId.length > 0;
  const activeStatusQueryKey = accountStatusQueryKey(orgId ?? "no-active-org");
  const activeKeysQueryKey = accountKeysQueryKey(orgId ?? "no-active-org");

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

  const snippets = buildSnippets(apiUrl);
  const status = statusQuery.data;
  const keys = keysQuery.data?.keys ?? [];
  const primaryHref = "/keys";
  const primaryAction =
    status?.provisioned === false
      ? "Open account setup"
      : status?.provisioned === true && !status.hasFirstKey
        ? "Create first key"
        : "Manage keys";

  async function copySnippet(code: string) {
    await navigator.clipboard.writeText(code);
    toast.success("Copied quickstart");
  }

  return (
    <>
      {!isLoaded ? (
        <Card>
          <CardContent className="flex items-center gap-3 py-8 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading console session...
          </CardContent>
        </Card>
      ) : null}

      {isLoaded && !hasActiveOrg ? (
        <Card>
          <CardHeader>
            <CardTitle>Select an organization</CardTitle>
            <CardDescription>
              Console overview data is scoped to the active Clerk organization. Select an
              organization from the switcher before viewing account posture.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : null}

      {statusQuery.isPending && hasActiveOrg ? (
        <Card>
          <CardContent className="flex items-center gap-3 py-8 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading account overview...
          </CardContent>
        </Card>
      ) : null}

      {statusQuery.isError ? (
        <Card>
          <CardHeader>
            <CardTitle>Could not load account overview</CardTitle>
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

      {status ? (
        <>
          <section className="grid gap-4 xl:grid-cols-3">
            <Card>
              <CardHeader>
                <CardDescription>Plan code</CardDescription>
                <CardTitle className="text-4xl">
                  {status.provisioned ? formatPlanCode(status.tier) : "Setup required"}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4 text-sm text-muted-foreground">
                <p>
                  {status.provisioned
                    ? "Current Lago-derived enforcement projection for the active organization."
                    : "The org envelope is missing. Setup recovery lives on the Keys page."}
                </p>
                <Button asChild>
                  <Link href={primaryHref}>{primaryAction}</Link>
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardDescription>Keys</CardDescription>
                <CardTitle className="text-4xl">
                  {status.provisioned
                    ? `${status.activeKeyCount} / ${formatKeyLimit(status.maxKeys)}`
                    : "0 / 0"}
                </CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                Existing keys are shown as masked metadata only. Raw values appear once on create or
                rotate.
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardDescription>Role</CardDescription>
                <CardTitle className="text-4xl">
                  {status.canManageKeys ? "Admin" : "Member"}
                </CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                {status.canManageKeys
                  ? "You can manage keys from the dedicated Keys page."
                  : "You can view key metadata. Ask an org admin to manage keys."}
              </CardContent>
            </Card>
          </section>

          {status.provisioned ? (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <KeyRound className="h-4 w-4" />
                  Active keys
                </CardTitle>
                <CardDescription>
                  Latest masked key metadata for this organization. Open Keys for create, rotate,
                  revoke, and audit.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
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
                  <KeyPreviewTable
                    expectedActiveKeyCount={status.activeKeyCount}
                    keys={keys}
                    onRetry={() => void keysQuery.refetch()}
                  />
                )}
                <Button asChild variant="outline">
                  <Link href="/keys">Open Keys</Link>
                </Button>
              </CardContent>
            </Card>
          ) : null}
        </>
      ) : null}

      <section className="grid gap-4 xl:grid-cols-3">
        <Card className="scroll-mt-24" id="usage">
          <CardHeader>
            <CardDescription>Usage</CardDescription>
            <CardTitle className="text-3xl">Usage charts next</CardTitle>
          </CardHeader>
          <CardContent className="text-sm leading-6 text-muted-foreground">
            Real usage charts and export belong to P1C.04. This overview intentionally avoids
            fabricated usage numbers.
          </CardContent>
        </Card>

        <Card className="scroll-mt-24" id="billing">
          <CardHeader>
            <CardDescription>Billing</CardDescription>
            <CardTitle className="text-3xl">Lago-backed billing</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm leading-6 text-muted-foreground">
            <p>
              View the active Lago subscription, plans, payment setup, and invoices on the Billing
              page.
            </p>
            <Button asChild variant="outline">
              <Link href="/billing">Open Billing</Link>
            </Button>
          </CardContent>
        </Card>

        <Card className="scroll-mt-24" id="danger-zone">
          <CardHeader>
            <CardDescription>Danger Zone</CardDescription>
            <CardTitle className="text-3xl">Protected destructive actions</CardTitle>
          </CardHeader>
          <CardContent className="text-sm leading-6 text-muted-foreground">
            Account teardown and destructive organization actions remain intentionally deferred.
          </CardContent>
        </Card>
      </section>

      <Card className="scroll-mt-24" id="playground">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Terminal className="h-4 w-4" />
            Quickstart
          </CardTitle>
          <CardDescription>
            Use a real key from the Keys page. Existing raw keys are never recoverable from the
            console.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button asChild variant="outline">
            <Link href="/playground">Open API Playground</Link>
          </Button>
          <div className="grid gap-4 xl:grid-cols-3">
            {snippets.map((snippet) => (
              <div
                className="space-y-3 rounded-lg border border-border bg-background/70 p-4"
                key={snippet.label}
              >
                <div className="flex items-center justify-between gap-3">
                  <Badge variant="secondary">{snippet.label}</Badge>
                  <Button
                    size="sm"
                    type="button"
                    variant="outline"
                    onClick={() => void copySnippet(snippet.code)}
                  >
                    <Copy className="h-3.5 w-3.5" />
                    Copy
                  </Button>
                </div>
                <pre className="overflow-x-auto whitespace-pre-wrap break-words font-mono text-xs leading-5 text-muted-foreground">
                  {snippet.code}
                </pre>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </>
  );
}
