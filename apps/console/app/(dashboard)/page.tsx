import { env } from "../../lib/env";

export default function DashboardPage() {
  return (
    <main>
      <p>Console scaffold</p>
      <h1>Overview</h1>
      <p>API host: {env.NEXT_PUBLIC_API_URL}</p>
    </main>
  );
}
