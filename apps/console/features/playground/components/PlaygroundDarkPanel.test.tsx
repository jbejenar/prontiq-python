import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";

import type { PlaygroundResponse } from "../types.js";
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

test("runs with the command-enter shortcut when execution is available", () => {
  const onRun = vi.fn();
  render(<DarkPanelHost onRun={onRun} />);

  fireEvent.keyDown(window, { key: "Enter", metaKey: true });

  expect(onRun).toHaveBeenCalledTimes(1);
});

test("does not run the command-enter shortcut when demo execution is unavailable", () => {
  const onRun = vi.fn();
  render(<DarkPanelHost demoUnavailableMessage="demo unavailable" onRun={onRun} />);

  fireEvent.keyDown(window, { key: "Enter", metaKey: true });

  expect(onRun).not.toHaveBeenCalled();
});

function DarkPanelHost({
  demoUnavailableMessage,
  onRun = vi.fn(),
  response: renderedResponse = null,
}: {
  demoUnavailableMessage?: string;
  onRun?: () => void;
  response?: PlaygroundResponse | null;
}) {
  return (
    <PlaygroundDarkPanel
      command={"curl 'https://api.prontiq.dev/v1/address/validate' \\\n  -H 'X-Api-Key: {{YOUR_API_KEY}}'"}
      demoUnavailableMessage={demoUnavailableMessage}
      error={null}
      isSending={false}
      mode="demo"
      requestDisplayId="abc123"
      response={renderedResponse}
      runAriaLabel="Send demo request"
      onRun={onRun}
    />
  );
}
