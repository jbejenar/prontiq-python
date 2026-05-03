import type { PlaygroundTelemetryEvent } from "../types.js";

export function recordPlaygroundTelemetry(event: PlaygroundTelemetryEvent) {
  void event;
  // Frontend telemetry is intentionally payload-free; wire to the console analytics sink when live.
}
