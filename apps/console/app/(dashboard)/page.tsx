import { Badge } from "../../components/ui/badge.js";
import { Card, CardDescription, CardHeader, CardTitle } from "../../components/ui/card.js";
import { env } from "../../lib/env.js";
import { OverviewPanel } from "./overview-panel.js";

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
              Live account posture, masked key metadata, and safe quickstarts for the active
              Clerk organization.
            </p>
          </div>
        </div>
        <Card className="w-full max-w-sm bg-card/80">
          <CardHeader>
            <CardDescription>API host</CardDescription>
            <CardTitle className="break-all text-2xl">{env.NEXT_PUBLIC_API_URL}</CardTitle>
          </CardHeader>
        </Card>
      </section>

      <OverviewPanel apiUrl={env.NEXT_PUBLIC_API_URL} />
    </>
  );
}
