export default function DashboardPage() {
  return (
    <div>
      <header style={{ display: "flex", justifyContent: "space-between", padding: "1rem" }}>
        <h1>Dashboard</h1>
      </header>
      <main style={{ padding: "1rem" }}>
        <section>
          <h2>API Key</h2>
          <p>Your API key will appear here once provisioned.</p>
        </section>
        <section>
          <h2>Usage</h2>
          <p>Usage charts will appear here.</p>
        </section>
        <section>
          <h2>Quick Start</h2>
          <pre>{`import { Prontiq } from "@prontiq/sdk";

const prontiq = new Prontiq({ apiKey: "pq_live_..." });
const { suggestions } = await prontiq.address.autocomplete({ q: "16 heath cres" });`}</pre>
        </section>
      </main>
    </div>
  );
}
