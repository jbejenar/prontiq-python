import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeEach, expect, test, vi } from "vitest";

import type { PlaygroundHistoryEntry, PlaygroundResponse } from "../types.js";
import { playgroundShortcutLabels } from "../lib/shortcut-labels.js";
import type { PlaygroundSnippetLanguage } from "../lib/snippets.js";

const telemetryMocks = vi.hoisted(() => ({
  recordPlaygroundInteractionTelemetry: vi.fn(),
}));

vi.mock("../lib/telemetry.js", () => telemetryMocks);

import { PlaygroundDarkPanel } from "./PlaygroundDarkPanel.js";

beforeEach(() => {
  vi.clearAllMocks();
});

const response: PlaygroundResponse = {
  bodyText: JSON.stringify({ ok: true, credits: 1 }),
  durationMs: 42,
  headers: { "content-type": "application/json" },
  ok: true,
  status: 200,
  statusText: "OK",
};

const historyEntry: PlaygroundHistoryEntry = {
  config: {
    bodyText: "",
    pathParams: {},
    queryParams: { q: "2000" },
  },
  id: "hist_1",
  latencyMs: 42,
  mode: "demo",
  operation: {
    method: "GET",
    operationId: "addressAutocomplete",
    path: "/v1/address/autocomplete",
    summary: "Autocomplete addresses",
    tag: "Address",
  },
  requestDisplayId: "abc123",
  status: 200,
  timestamp: new Date(Date.now() - 14_000).toISOString(),
};

test("renders empty state with production-shaped curl", () => {
  render(<DarkPanelHost />);

  expect(screen.getByText(/X-Api-Key: \{\{YOUR_API_KEY\}\}/i)).toBeInTheDocument();
  expect(screen.getByText(/awaiting request/i)).toBeInTheDocument();
  expect(screen.getByText(/request snippet — production url, substitute your key/i)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /send demo request/i })).toBeEnabled();
  for (const language of ["curl", "node.js", "python", "java", "go", "ruby"]) {
    expect(screen.getByRole("button", { name: language })).toBeInTheDocument();
  }
});

test("renders the run shortcut inside the run button", () => {
  render(<DarkPanelHost />);

  const runButton = screen.getByRole("button", { name: /send demo request/i });

  expect(within(runButton).getByText(playgroundShortcutLabels.runChip)).toBeInTheDocument();
  expect(
    screen.getAllByText((content) => content.includes(playgroundShortcutLabels.run)).length,
  ).toBeGreaterThanOrEqual(1);
});

test("renders discoverable footer shortcuts for palette and run", () => {
  render(<DarkPanelHost />);

  expect(screen.getByRole("button", { name: /open command palette/i })).toHaveTextContent(
    `palette ${playgroundShortcutLabels.commandPalette}`,
  );
  expect(screen.getByText("run")).toBeInTheDocument();
  expect(
    screen.getAllByText((content) => content.includes(playgroundShortcutLabels.run)).length,
  ).toBeGreaterThanOrEqual(2);
});

test("opens the command palette from the footer affordance", async () => {
  const onOpenCommandPalette = vi.fn();
  render(<DarkPanelHost onOpenCommandPalette={onOpenCommandPalette} />);

  await userEvent.click(screen.getByRole("button", { name: /open command palette/i }));

  expect(onOpenCommandPalette).toHaveBeenCalledTimes(1);
});

test("renders empty request history drawer", () => {
  render(<DarkPanelHost historyOpen />);

  expect(screen.getByText(/no requests yet/i)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /clear/i })).toBeDisabled();
});

test("selects and clears request history entries", async () => {
  const onClearHistory = vi.fn();
  const onHistoryEntrySelect = vi.fn();
  const onHistoryOpenChange = vi.fn();
  render(
    <DarkPanelHost
      historyEntries={[historyEntry]}
      historyOpen
      onClearHistory={onClearHistory}
      onHistoryEntrySelect={onHistoryEntrySelect}
      onHistoryOpenChange={onHistoryOpenChange}
    />,
  );

  expect(screen.getByText("autocomplete")).toBeInTheDocument();
  expect(screen.getByText("q=2000")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: /get autocomplete/i }));

  expect(onHistoryEntrySelect).toHaveBeenCalledWith(historyEntry);
  expect(onHistoryOpenChange).toHaveBeenCalledWith(false);

  await userEvent.click(screen.getByRole("button", { name: /clear/i }));

  expect(onClearHistory).toHaveBeenCalledTimes(1);
});

test("toggles and dismisses request history drawer", async () => {
  const onHistoryOpenChange = vi.fn();
  render(
    <DarkPanelHost
      historyEntries={[historyEntry]}
      historyOpen
      onHistoryOpenChange={onHistoryOpenChange}
    />,
  );

  await userEvent.click(screen.getByRole("button", { name: /open request history/i }));
  expect(onHistoryOpenChange).toHaveBeenCalledWith(false);

  onHistoryOpenChange.mockClear();
  await userEvent.pointer({ keys: "[MouseLeft]", target: screen.getByText(/awaiting request/i) });
  expect(onHistoryOpenChange).toHaveBeenCalledWith(false);
});

test("does not let outside-pointer handling reopen history when clicking the trigger closed", async () => {
  function HistoryToggleHost() {
    const [open, setOpen] = useState(true);
    return <DarkPanelHost historyOpen={open} onHistoryOpenChange={setOpen} />;
  }

  render(<HistoryToggleHost />);

  expect(screen.getByText(/no requests yet/i)).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: /open request history/i }));

  expect(screen.queryByText(/no requests yet/i)).not.toBeInTheDocument();
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

test("renders generated node snippet when language tab is selected", async () => {
  const onSnippetRequest = vi.fn(async (language: PlaygroundSnippetLanguage) =>
    language === "node.js" ? "fetch('https://api.prontiq.dev/v1/address/autocomplete')" : "",
  );
  const { container } = render(<DarkPanelHost onSnippetRequest={onSnippetRequest} />);

  await userEvent.click(screen.getByRole("button", { name: "node.js" }));

  await screen.findByText("fetch");
  expect(container).toHaveTextContent("https://api.prontiq.dev/v1/address/autocomplete");
  expect(onSnippetRequest).toHaveBeenCalledWith("node.js");
});

test("copy action copies the visible generated snippet before a response exists", async () => {
  const writeText = vi.fn(async () => undefined);
  Object.assign(navigator, { clipboard: { writeText } });
  const { container } = render(
    <DarkPanelHost
      onSnippetRequest={async () => "fetch('https://api.prontiq.dev/v1/address/autocomplete')"}
    />,
  );

  await userEvent.click(screen.getByRole("button", { name: "node.js" }));
  await screen.findByText("fetch");
  expect(container).toHaveTextContent("https://api.prontiq.dev/v1/address/autocomplete");
  await userEvent.click(screen.getByRole("button", { name: /copy request snippet/i }));

  expect(writeText).toHaveBeenCalledWith("fetch('https://api.prontiq.dev/v1/address/autocomplete')");
});

test("keeps request snippet visible beside a successful response", () => {
  render(<DarkPanelHost response={response} />);

  expect(screen.getByText("200")).toBeInTheDocument();
  expect(screen.getByText(/"credits"/i)).toBeInTheDocument();
  expect(screen.getByText(/X-Api-Key: \{\{YOUR_API_KEY\}\}/i)).toBeInTheDocument();
});

test("stacks response and snippet panes below the wide breakpoint", () => {
  render(<DarkPanelHost response={response} />);

  const workspace = screen.getByTestId("playground-dark-panel-workspace");

  expect(workspace).toHaveClass("grid-cols-1");
  expect(workspace).toHaveClass("xl:grid-cols-[minmax(420px,3fr)_minmax(320px,2fr)]");
});

test("response copy copies response body without snippet telemetry", async () => {
  const writeText = vi.fn(async () => undefined);
  Object.assign(navigator, { clipboard: { writeText } });
  render(<DarkPanelHost response={response} />);

  await userEvent.click(screen.getByRole("button", { name: /copy response/i }));

  expect(writeText).toHaveBeenCalledWith(JSON.stringify({ ok: true, credits: 1 }, null, 2));
  expect(telemetryMocks.recordPlaygroundInteractionTelemetry).not.toHaveBeenCalledWith(
    expect.objectContaining({ eventName: "snippet_copied" }),
  );
});

test("records allowlisted snippet telemetry only", async () => {
  const writeText = vi.fn(async () => undefined);
  Object.assign(navigator, { clipboard: { writeText } });
  render(
    <DarkPanelHost
      command="curl 'https://api.prontiq.dev/v1/address/autocomplete?q=sensitive-address' \
  -H 'X-Api-Key: {{YOUR_API_KEY}}'"
      onSnippetRequest={async () => "fetch('https://api.prontiq.dev/v1/address/autocomplete?q=sensitive-address')"}
    />,
  );

  await userEvent.click(screen.getByRole("button", { name: "node.js" }));
  await screen.findByText("fetch");
  await userEvent.click(screen.getByRole("button", { name: /copy request snippet/i }));

  expect(telemetryMocks.recordPlaygroundInteractionTelemetry).toHaveBeenCalledWith({
    eventName: "language_tab_selected",
    language: "node.js",
    mode: "demo",
    source: "console_playground",
  });
  expect(telemetryMocks.recordPlaygroundInteractionTelemetry).toHaveBeenCalledWith({
    eventName: "snippet_copied",
    language: "node.js",
    mode: "demo",
    source: "console_playground",
  });
  for (const [event] of telemetryMocks.recordPlaygroundInteractionTelemetry.mock.calls) {
    expect(JSON.stringify(event)).not.toContain("sensitive-address");
    expect(JSON.stringify(event)).not.toContain("{{YOUR_API_KEY}}");
    expect(JSON.stringify(event)).not.toContain("fetch(");
  }
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
  historyEntries = [],
  historyOpen = false,
  onClearHistory = vi.fn(),
  onHistoryEntrySelect = vi.fn(),
  onHistoryOpenChange = vi.fn(),
  onRun = vi.fn(),
  onOpenCommandPalette = vi.fn(),
  onSnippetRequest = async () => "",
  response: renderedResponse = null,
}: {
  command?: string;
  demoUnavailableMessage?: string;
  historyEntries?: readonly PlaygroundHistoryEntry[];
  historyOpen?: boolean;
  onClearHistory?: () => void;
  onHistoryEntrySelect?: (entry: PlaygroundHistoryEntry) => void;
  onHistoryOpenChange?: (open: boolean) => void;
  onOpenCommandPalette?: () => void;
  onRun?: () => void;
  onSnippetRequest?: (language: PlaygroundSnippetLanguage) => Promise<string>;
  response?: PlaygroundResponse | null;
}) {
  return (
    <PlaygroundDarkPanel
      command={command}
      demoUnavailableMessage={demoUnavailableMessage}
      error={null}
      historyEntries={historyEntries}
      historyOpen={historyOpen}
      isSending={false}
      mode="demo"
      onClearHistory={onClearHistory}
      onHistoryEntrySelect={onHistoryEntrySelect}
      onHistoryOpenChange={onHistoryOpenChange}
      onOpenCommandPalette={onOpenCommandPalette}
      requestDisplayId="abc123"
      response={renderedResponse}
      runAriaLabel="Send demo request"
      onSnippetRequest={onSnippetRequest}
      onRun={onRun}
    />
  );
}
