import { Badge } from "../../components/ui/badge.js";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui/card.js";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../components/ui/table.js";
import { env } from "../../lib/env.js";

const statCards = [
  { label: "Plan", value: "Free", detail: "Credits-based onboarding shell" },
  { label: "Usage", value: "4,200 / 10,000", detail: "Static placeholder until P1C.02" },
  { label: "Keys", value: "Manage", detail: "Key management is available on the Keys page" },
];

const tableRows = [
  { endpoint: "/v1/address/autocomplete", auth: "X-Api-Key", status: "Live" },
  { endpoint: "/v1/address/validate", auth: "X-Api-Key", status: "Live" },
  { endpoint: "/v1/account/status", auth: "Clerk JWT", status: "Live" },
];

export default function DashboardPage() {
  return (
    <>
      <section
        className="flex scroll-mt-24 flex-col gap-4 lg:flex-row lg:items-end lg:justify-between"
        id="overview"
      >
        <div className="space-y-3">
          <Badge>console</Badge>
          <div>
            <h1 className="text-5xl leading-none tracking-tight sm:text-6xl">Overview</h1>
            <p className="mt-4 max-w-2xl text-sm leading-6 text-muted-foreground">
              The console shell now has live account recovery and API key creation on the
              Keys page. Usage and billing surfaces remain planned follow-up work.
            </p>
          </div>
        </div>
        <Card className="w-full max-w-sm bg-card/80">
          <CardHeader>
            <CardDescription>API host</CardDescription>
            <CardTitle className="text-2xl">{env.NEXT_PUBLIC_API_URL}</CardTitle>
          </CardHeader>
        </Card>
      </section>

      <section className="grid gap-4 xl:grid-cols-3">
        {statCards.map((card) => (
          <Card key={card.label}>
            <CardHeader>
              <CardDescription>{card.label}</CardDescription>
              <CardTitle className="text-4xl">{card.value}</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">{card.detail}</CardContent>
          </Card>
        ))}
      </section>

      <section className="grid gap-4 xl:grid-cols-3">
        <Card className="scroll-mt-24" id="usage">
          <CardHeader>
            <CardDescription>Usage</CardDescription>
            <CardTitle className="text-3xl">Consumption snapshot</CardTitle>
          </CardHeader>
          <CardContent className="text-sm leading-6 text-muted-foreground">
            Static usage placeholders land here until P1C.04 wires real usage charts.
          </CardContent>
        </Card>

        <Card className="scroll-mt-24" id="billing">
          <CardHeader>
            <CardDescription>Billing</CardDescription>
            <CardTitle className="text-3xl">Plan + invoice posture</CardTitle>
          </CardHeader>
          <CardContent className="text-sm leading-6 text-muted-foreground">
            Billing reads and actions remain Lago-backed future work outside the AWS private
            account API.
          </CardContent>
        </Card>

        <Card className="scroll-mt-24" id="danger-zone">
          <CardHeader>
            <CardDescription>Danger Zone</CardDescription>
            <CardTitle className="text-3xl">Protected destructive actions</CardTitle>
          </CardHeader>
          <CardContent className="text-sm leading-6 text-muted-foreground">
            Account teardown and destructive org actions are intentionally deferred.
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <Card className="scroll-mt-24" id="playground">
          <CardHeader>
            <CardTitle>Quickstart shape</CardTitle>
            <CardDescription>Live and private account endpoints used by the console.</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Endpoint</TableHead>
                  <TableHead>Auth</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tableRows.map((row) => (
                  <TableRow key={row.endpoint}>
                    <TableCell className="font-medium">{row.endpoint}</TableCell>
                    <TableCell>{row.auth}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">{row.status}</Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </section>
    </>
  );
}
