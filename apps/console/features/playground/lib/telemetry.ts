import type { PlaygroundInteractionTelemetryEvent, PlaygroundTelemetryEvent } from "../types.js";

export function recordPlaygroundTelemetry(event: PlaygroundTelemetryEvent) {
  void event;
  // Frontend telemetry is intentionally payload-free; wire to the console analytics sink when live.
}

export function recordPlaygroundInteractionTelemetry(event: PlaygroundInteractionTelemetryEvent) {
  void event;
  // Allowlisted UI telemetry only; never include params, bodies, query strings, snippets, or keys.
}
