export default function DashboardPage() {
  return (
    <section className="grid gap-4 xl:grid-cols-3">
      <div className="rounded-lg border border-border bg-card/80 p-5">
        <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Current focus</div>
        <div className="mt-4 text-3xl">P1C.07 base layer</div>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          Tailwind, shadcn primitives, dark mode, responsive nav, and Clerk auth wiring are the work this ticket is meant to land.
        </p>
      </div>
      <div className="rounded-lg border border-border bg-card/80 p-5">
        <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Next feature</div>
        <div className="mt-4 text-3xl">P1C.02 overview</div>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          Real usage, plan, and onboarding data will replace these placeholders once the shared shell exists.
        </p>
      </div>
      <div className="rounded-lg border border-border bg-card/80 p-5">
        <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Key management</div>
        <div className="mt-4 text-3xl">P1C.03</div>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          The masked-key display pattern is in place; the first-key flow, rotate, revoke, and audit table land later.
        </p>
      </div>
    </section>
  );
}
