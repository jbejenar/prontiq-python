import type { SiteEndpoint } from "@prontiq/shared/content";

interface EndpointsTableProps {
  endpoints: readonly SiteEndpoint[];
}

export function EndpointsTable({ endpoints }: EndpointsTableProps) {
  if (endpoints.length === 0) {
    return (
      <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
        No endpoints configured.
      </p>
    );
  }

  const maxP95 = Math.max(...endpoints.map((endpoint) => endpoint.p95), 1);

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr>
            <th className="border-b border-border px-2 py-2 text-left text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
              Endpoint
            </th>
            <th className="border-b border-border px-2 py-2 text-left text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
              Cost
            </th>
            <th className="w-[40%] border-b border-border px-2 py-2 text-left text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
              P95
            </th>
            <th className="border-b border-border px-2 py-2 text-right text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
              ms
            </th>
          </tr>
        </thead>
        <tbody>
          {endpoints.map((endpoint) => {
            const widthPct = ((endpoint.p95 / maxP95) * 100).toFixed(1);
            return (
              <tr
                className="border-t border-border first:border-t-0 hover:bg-surface-hover"
                key={`${endpoint.method}-${endpoint.path}`}
              >
                <td className="px-2 py-2 align-middle text-foreground">
                  <span className="mr-2 rounded-sm bg-accent/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-[0.06em] text-accent">
                    {endpoint.method}
                  </span>
                  <span className="break-all">{endpoint.path}</span>
                </td>
                <td className="whitespace-nowrap px-2 py-2 align-middle text-[11px] text-muted-foreground">
                  <span className="text-accent">{endpoint.cost}</span>{" "}
                  <span>credit{endpoint.cost === 1 ? "" : "s"}</span>
                </td>
                <td className="px-2 py-2 align-middle">
                  <div className="h-1 w-full overflow-hidden rounded-sm bg-border">
                    <span
                      className="block h-full bg-gradient-to-r from-accent/70 to-accent"
                      style={{ width: `${widthPct}%` }}
                    />
                  </div>
                </td>
                <td className="whitespace-nowrap px-2 py-2 text-right align-middle font-medium text-foreground">
                  {endpoint.p95}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
