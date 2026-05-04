import { act, render, screen, within } from "@testing-library/react";
import { expect, test, vi } from "vitest";

import type { PlaygroundResponse } from "../types.js";
import { playgroundShortcutLabels } from "../lib/shortcut-labels.js";
import { PlaygroundDarkPanel } from "./PlaygroundDarkPanel.js";

const response: PlaygroundResponse = {
  bodyText: JSON.stringify({ ok: true, credits: 1 }),
  durationMs: 42,
  headers: { "content-type": "application/json" },
  ok: true,
  status: 200,
  statusText: "OK",
};

test("renders empty state with production-shaped curl", () => {
  render(<DarkPanelHost />);

  expect(screen.getByText(/X-Api-Key: \{\{YOUR_API_KEY\}\}/i)).toBeInTheDocument();
  expect(screen.getByText(/awaiting request/i)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /send demo request/i })).toBeEnabled();
});

test("renders the run shortcut inside the run button", () => {
  render(<DarkPanelHost />);

  const runButton = screen.getByRole("button", { name: /send demo request/i });

  expect(within(runButton).getByText(playgroundShortcutLabels.runChip)).toBeInTheDocument();
  expect(
    screen.getByText((content) => content.includes(playgroundShortcutLabels.run)),
  ).toBeInTheDocument();
});

test("highlights the changed curl segment when the command updates", () => {
  const { container, rerender } = render(
    <DarkPanelHost command={"curl 'https://api.prontiq.dev/v1/address/validate?postcode=2000'"} />,
  );

  expect(container.querySelector(".playground-code-change")).not.toBeInTheDocument();

  rerender(
    <DarkPanelHost command={"curl 'https://api.prontiq.dev/v1/address/validate?postcode=3000'"} />,
  );

  expect(container.querySelector(".playground-code-change")).toHaveTextContent("3");
});

test("clears the changed curl highlight after the animation window", () => {
  vi.useFakeTimers();
  try {
    const { container, rerender } = render(
      <DarkPanelHost command={"curl 'https://api.prontiq.dev/v1/address/validate?postcode=2000'"} />,
    );

    rerender(
      <DarkPanelHost command={"curl 'https://api.prontiq.dev/v1/address/validate?postcode=3000'"} />,
    );

    expect(container.querySelector(".playground-code-change")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(400);
    });

    expect(container.querySelector(".playground-code-change")).not.toBeInTheDocument();
  } finally {
    vi.useRealTimers();
  }
});

test("renders demo-unavailable state without hiding curl", () => {
  render(<DarkPanelHost demoUnavailableMessage="demo unavailable on this deployment" />);

  expect(screen.getByText(/demo unavailable on this deployment/i)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /send demo request/i })).toBeDisabled();
  expect(screen.getByText(/X-Api-Key: \{\{YOUR_API_KEY\}\}/i)).toBeInTheDocument();
});

test("renders response metadata for successful responses", () => {
  render(<DarkPanelHost response={response} />);

  expect(screen.getByText("200")).toBeInTheDocument();
  expect(screen.getByText("42ms")).toBeInTheDocument();
  expect(screen.getByText(/request #abc123/i)).toBeInTheDocument();
});

function DarkPanelHost({
  command = "curl 'https://api.prontiq.dev/v1/address/validate' \\\n  -H 'X-Api-Key: {{YOUR_API_KEY}}'",
  demoUnavailableMessage,
  onRun = vi.fn(),
  response: renderedResponse = null,
}: {
  command?: string;
  demoUnavailableMessage?: string;
  onRun?: () => void;
  response?: PlaygroundResponse | null;
}) {
  return (
    <PlaygroundDarkPanel
      command={command}
      demoUnavailableMessage={demoUnavailableMessage}
      error={null}
      isSending={false}
      mode="demo"
      onCopyCurl={async () => undefined}
      requestDisplayId="abc123"
      response={renderedResponse}
      runAriaLabel="Send demo request"
      onRun={onRun}
    />
  );
}
