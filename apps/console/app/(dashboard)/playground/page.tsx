import { env } from "../../../lib/env.js";
import { PlaygroundPanel } from "../../../features/playground/components/PlaygroundPanel.js";

export default function PlaygroundPage() {
  return <PlaygroundPanel apiBaseUrl={env.NEXT_PUBLIC_API_URL} />;
}
