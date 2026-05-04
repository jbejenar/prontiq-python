"use client";

import { Check, Clock3, History, Loader2, Play, Trash2, X } from "lucide-react";
import { memo, type RefObject, useEffect, useMemo, useRef, useState } from "react";
import Prism from "prismjs";
import "prismjs/components/prism-bash.js";
import "prismjs/components/prism-json.js";
import "prismjs/components/prism-javascript.js";
import "prismjs/components/prism-python.js";
import "prismjs/components/prism-go.js";
import "prismjs/components/prism-ruby.js";
import { toast } from "sonner";

import type { PlaygroundHistoryEntry, PlaygroundMode, PlaygroundResponse } from "../types.js";
import {
  displayHistoryParameterSummary,
  formatRelativeHistoryTime,
} from "../lib/history.js";
import { playgroundShortcutLabels } from "../lib/shortcut-labels.js";
import { cn } from "../../../lib/utils.js";

type PanelState = "empty" | "loading" | "success" | "error" | "demo-unavailable";

const languageTabs = ["curl", "node.js", "python", "go", "ruby"] as const;

type ChangedRange = Readonly<{ end: number; start: number }>;

function getPanelState(options: {
  demoUnavailable: boolean;
  error: string | null;
  isSending: boolean;
  response: PlaygroundResponse | null;
}): PanelState {
  if (options.demoUnavailable) return "demo-unavailable";
  if (options.isSending) return "loading";
  if (options.error || (options.response && !options.response.ok)) return "error";
  if (options.response) return "success";
  return "empty";
}

function formatBody(response: PlaygroundResponse | null, error: string | null) {
  if (error) return JSON.stringify({ error }, null, 2);
  if (!response) return "";
  try {
    return JSON.stringify(JSON.parse(response.bodyText), null, 2);
  } catch {
    return response.bodyText || "(empty response)";
  }
}

function highlight(code: string, language: string) {
  const grammar = Prism.languages[language];
  if (!grammar) return escapeHtml(code);
  return Prism.highlight(code, grammar, language);
}

function getChangedRange(previous: string, next: string): ChangedRange | null {
  if (previous === next) return null;

  let start = 0;
  const maxPrefix = Math.min(previous.length, next.length);
  while (start < maxPrefix && previous[start] === next[start]) {
    start += 1;
  }

  let previousEnd = previous.length;
  let nextEnd = next.length;
  while (
    previousEnd > start &&
    nextEnd > start &&
    previous[previousEnd - 1] === next[nextEnd - 1]
  ) {
    previousEnd -= 1;
    nextEnd -= 1;
  }

  if (start === nextEnd) return null;
  return { start, end: nextEnd };
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function getSdkPlaceholder(language: (typeof languageTabs)[number]) {
  switch (language) {
    case "node.js":
      return "// SDK examples coming soon";
    case "python":
      return "# SDK examples coming soon";
    case "go":
      return "// SDK examples coming soon";
    case "ruby":
      return "# SDK examples coming soon";
    case "curl":
      return "";
  }
}

function getLanguageName(language: (typeof languageTabs)[number]) {
  if (language === "curl") return "bash";
  if (language === "node.js") return "javascript";
  return language;
}

function getPayloadSize(response: PlaygroundResponse | null) {
  if (!response) return "0 b";
  return `${new Blob([response.bodyText]).size} b`;
}

export function PlaygroundDarkPanel({
  command,
  demoUnavailableMessage,
  error,
  isSending,
  historyEntries,
  historyOpen,
  mode,
  onCopyCurl,
  onClearHistory,
  onHistoryEntrySelect,
  onHistoryOpenChange,
  onOpenCommandPalette,
  onRun,
  runAriaLabel,
  tabFocusRef,
  requestDisplayId,
  response,
}: {
  command: string;
  demoUnavailableMessage?: string;
  error: string | null;
  historyEntries: readonly PlaygroundHistoryEntry[];
  historyOpen: boolean;
  isSending: boolean;
  mode: PlaygroundMode;
  onClearHistory: () => void;
  onCopyCurl: () => Promise<void>;
  onHistoryEntrySelect: (entry: PlaygroundHistoryEntry) => void;
  onHistoryOpenChange: (open: boolean) => void;
  onOpenCommandPalette: () => void;
  onRun: () => void;
  runAriaLabel: string;
  tabFocusRef?: RefObject<HTMLButtonElement | null>;
  requestDisplayId: string;
  response: PlaygroundResponse | null;
}) {
  const [activeLanguage, setActiveLanguage] = usePlaygroundLanguage();
  const previousCommandRef = useRef(command);
  const historyDrawerRef = useRef<HTMLElement | null>(null);
  const [curlChangedRange, setCurlChangedRange] = useState<ChangedRange | null>(null);
  const panelState = getPanelState({
    demoUnavailable: Boolean(demoUnavailableMessage),
    error,
    isSending,
    response,
  });
  const activeCode =
    activeLanguage === "curl" ? command : getSdkPlaceholder(activeLanguage);
  const codeLanguage = getLanguageName(activeLanguage);
  const bodyText = formatBody(response, error);
  const status = response?.status ?? (error ? "ERR" : null);
  const runDisabled = isSending || Boolean(demoUnavailableMessage);

  useEffect(() => {
    const changedRange = getChangedRange(previousCommandRef.current, command);
    previousCommandRef.current = command;
    setCurlChangedRange(changedRange);

    if (!changedRange) return undefined;

    const timeout = window.setTimeout(() => setCurlChangedRange(null), 400);
    return () => window.clearTimeout(timeout);
  }, [command]);

  useEffect(() => {
    if (!historyOpen) return undefined;

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") onHistoryOpenChange(false);
    }

    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [historyOpen, onHistoryOpenChange]);

  useEffect(() => {
    if (!historyOpen) return undefined;

    function closeOnOutsidePointer(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (historyDrawerRef.current?.contains(target)) return;
      onHistoryOpenChange(false);
    }

    window.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => window.removeEventListener("pointerdown", closeOnOutsidePointer);
  }, [historyOpen, onHistoryOpenChange]);

  async function copyResponse() {
    await navigator.clipboard.writeText(bodyText || "");
    toast.success("Copied response");
  }

  return (
    <section className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-playground-panel-bg text-playground-panel-text">
      <style>{`
        .playground-code .token.keyword,
        .playground-code .token.function,
        .playground-code .token.builtin,
        .playground-code .token.command {
          color: #ED93B1;
        }
        .playground-code .token.string,
        .playground-code .token.url {
          color: #9FE1CB;
        }
        .playground-code .token.number,
        .playground-code .token.boolean {
          color: #FAC775;
        }
        .playground-code .token.property,
        .playground-code .token.attr-name {
          color: #B5D4F4;
        }
        .playground-code .token.operator,
        .playground-code .token.punctuation,
        .playground-code .token.parameter {
          color: #888780;
        }
        .playground-code-change {
          animation: playground-code-change 400ms cubic-bezier(0.4, 0, 0.2, 1);
          border-radius: 3px;
        }
        @keyframes playground-code-change {
          0% {
            background-color: rgba(250, 199, 117, 0.28);
          }
          100% {
            background-color: transparent;
          }
        }
      `}</style>
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-playground-panel-border px-3">
        <div className="flex items-center gap-1">
          {languageTabs.map((language) => (
            <button
              className={cn(
                "rounded px-[9px] py-1 font-mono text-[11px] text-playground-panel-muted transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-playground-panel-accent",
                activeLanguage === language &&
                  "bg-playground-panel-accent-tab text-playground-panel-string",
              )}
              key={language}
              ref={language === "curl" ? tabFocusRef : undefined}
              type="button"
              onClick={() => setActiveLanguage(language)}
            >
              {language}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <button
            aria-label={runAriaLabel}
            className="inline-flex h-6 items-center gap-1 rounded bg-playground-panel-accent px-3 text-[11px] font-medium text-white transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
            disabled={runDisabled}
            type="button"
            onClick={onRun}
          >
            {isSending ? <Loader2 className="h-[9px] w-[9px] animate-spin" /> : <Play className="h-[9px] w-[9px] fill-current" />}
            <span>Run</span>
            <span className="ml-2 rounded border border-playground-panel-border bg-playground-panel-bg-footer px-1 py-px font-mono text-[10px] leading-none text-playground-panel-accent-light">
              {playgroundShortcutLabels.runChip}
            </span>
          </button>
        </div>
      </div>

      <div className="border-b border-playground-panel-border px-3.5 py-3 font-mono text-[11px] leading-[1.75]">
        <CodeBlock
          changedRange={activeLanguage === "curl" ? curlChangedRange : null}
          code={activeCode}
          language={codeLanguage}
        />
      </div>

      <div className="flex min-h-8 shrink-0 items-center justify-between border-b border-playground-panel-border px-3.5 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-playground-panel-muted">
            Response
          </span>
          {panelState === "loading" ? (
            <span className="font-mono text-[10px] text-playground-panel-muted">•••</span>
          ) : status ? (
            <span
              className={cn(
                "inline-flex items-center gap-1.5 font-mono text-[10px]",
                panelState === "error" ? "text-playground-panel-danger" : "text-playground-panel-accent-light",
              )}
            >
              <span className="h-[5px] w-[5px] rounded-full bg-current" />
              {status}
            </span>
          ) : (
            <span className="font-mono text-[10px] text-playground-panel-muted">awaiting request</span>
          )}
          {response ? (
            <>
              <span className="font-mono text-[10px] text-playground-panel-muted">
                {response.durationMs}ms
              </span>
              <span className="font-mono text-[10px] text-playground-panel-muted">
                {getPayloadSize(response)}
              </span>
            </>
          ) : null}
          {demoUnavailableMessage ? (
            <span className="truncate font-mono text-[10px] text-playground-panel-number">
              {demoUnavailableMessage}
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-3">
          <button
            aria-label="Open request history"
            className="inline-flex items-center gap-1 font-mono text-[10px] text-playground-panel-muted transition hover:text-playground-panel-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-playground-panel-accent"
            type="button"
            onClick={() => onHistoryOpenChange(!historyOpen)}
          >
            <History className="h-[11px] w-[11px]" />
            history {historyEntries.length}
          </button>
          <button
            className="font-mono text-[10px] text-playground-panel-muted transition hover:text-playground-panel-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-playground-panel-accent"
            type="button"
            onClick={() => void (response || error ? copyResponse() : onCopyCurl())}
          >
            copy
          </button>
        </div>
      </div>

      <div
        className={cn(
          "min-h-0 flex-1 overflow-auto px-3.5 py-3 font-mono text-[11px] leading-[1.75]",
          panelState === "error" && "border-l border-playground-panel-danger-border",
        )}
      >
        {panelState === "empty" || panelState === "demo-unavailable" ? (
          <div className="flex h-full min-h-[160px] items-center justify-center text-center text-playground-panel-muted/70">
            Press Run or {playgroundShortcutLabels.run} to send the request.
          </div>
        ) : panelState === "loading" ? (
          <div className="h-full min-h-[160px]" />
        ) : (
          <CodeBlock code={bodyText} language="json" />
        )}
      </div>

      <div className="flex h-8 shrink-0 items-center justify-between border-t border-playground-panel-border bg-playground-panel-bg-footer px-3.5">
        <div className="flex items-center gap-2 font-mono text-[10px] text-playground-panel-muted">
          <Clock3 className="h-[11px] w-[11px] text-playground-panel-accent-light" />
          <span>
            {mode === "demo"
              ? "demo proxy · clerk-authed · billed to demo org"
              : "your account · billed to your org"}
          </span>
        </div>
        <div className="flex items-center gap-2 font-mono text-[10px] text-playground-panel-muted">
          <button
            aria-label="Open command palette"
            className="rounded border border-playground-panel-border px-1 py-px text-playground-panel-accent-light transition hover:text-playground-panel-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-playground-panel-accent"
            type="button"
            onClick={onOpenCommandPalette}
          >
            palette {playgroundShortcutLabels.commandPalette}
          </button>
          <span className="hidden lg:inline">run</span>
          <span className="hidden rounded border border-playground-panel-border px-1 py-px text-playground-panel-accent-light lg:inline">
            {playgroundShortcutLabels.run}
          </span>
        </div>
        <div className="flex items-center gap-1.5 font-mono text-[10px] text-playground-panel-accent-light">
          {response?.ok ? <Check className="h-[11px] w-[11px]" /> : null}
          <span>request #{requestDisplayId}</span>
        </div>
      </div>
      {historyOpen ? (
        <RequestHistoryDrawer
          drawerRef={historyDrawerRef}
          entries={historyEntries}
          onClearHistory={onClearHistory}
          onClose={() => onHistoryOpenChange(false)}
          onSelectEntry={(entry) => {
            onHistoryEntrySelect(entry);
            onHistoryOpenChange(false);
          }}
        />
      ) : null}
    </section>
  );
}

const RequestHistoryDrawer = memo(function RequestHistoryDrawer({
  drawerRef,
  entries,
  onClearHistory,
  onClose,
  onSelectEntry,
}: {
  drawerRef: RefObject<HTMLElement | null>;
  entries: readonly PlaygroundHistoryEntry[];
  onClearHistory: () => void;
  onClose: () => void;
  onSelectEntry: (entry: PlaygroundHistoryEntry) => void;
}) {
  const nowMs = Date.now();

  return (
    <aside
      className="absolute bottom-8 right-0 top-10 z-20 flex w-[280px] flex-col border-l border-playground-panel-border bg-playground-panel-bg-footer shadow-lift"
      ref={drawerRef}
    >
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-playground-panel-border px-3">
        <div className="font-mono text-[11px] text-playground-panel-text">
          History <span className="text-playground-panel-muted">{entries.length}</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            className="inline-flex items-center gap-1 font-mono text-[10px] text-playground-panel-muted transition hover:text-playground-panel-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-playground-panel-accent disabled:cursor-not-allowed disabled:opacity-50"
            disabled={entries.length === 0}
            type="button"
            onClick={onClearHistory}
          >
            <Trash2 className="h-3 w-3" />
            Clear
          </button>
          <button
            aria-label="Close request history"
            className="text-playground-panel-muted transition hover:text-playground-panel-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-playground-panel-accent"
            type="button"
            onClick={onClose}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {entries.length === 0 ? (
          <div className="flex h-full items-center justify-center px-6 text-center font-mono text-[11px] text-playground-panel-muted">
            no requests yet — fire one to get started.
          </div>
        ) : (
          <div className="space-y-1">
            {entries.map((entry) => (
              <button
                className="w-full rounded-md border border-transparent px-2 py-2 text-left transition hover:border-playground-panel-border hover:bg-playground-panel-accent-tab focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-playground-panel-accent"
                key={entry.id}
                type="button"
                onClick={() => onSelectEntry(entry)}
              >
                <div className="flex items-center gap-2">
                  <span className="w-8 shrink-0 font-mono text-[9px] font-medium tracking-[0.04em] text-playground-panel-string">
                    {entry.operation.method}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-playground-panel-text">
                    {stripAddressPrefix(entry.operation.path)}
                  </span>
                  <span className={cn("font-mono text-[10px]", getHistoryStatusClass(entry.status))}>
                    {entry.status}
                  </span>
                  <span className="rounded border border-playground-panel-border px-1 font-mono text-[9px] text-playground-panel-muted">
                    {entry.mode === "demo" ? "D" : "A"}
                  </span>
                </div>
                <div className="mt-1 flex items-center justify-between gap-2 font-mono text-[10px] text-playground-panel-muted">
                  <span className="min-w-0 truncate">{displayHistoryParameterSummary(entry)}</span>
                  <span className="shrink-0">{formatRelativeHistoryTime(nowMs, entry.timestamp)}</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </aside>
  );
});

function stripAddressPrefix(path: string) {
  return path.replace(/^\/v1\/address\/?/, "") || path;
}

function getHistoryStatusClass(status: number) {
  if (status >= 200 && status < 300) return "text-playground-panel-accent-light";
  if (status >= 400) return "text-playground-panel-danger";
  return "text-playground-panel-number";
}

const CodeBlock = memo(function CodeBlock({
  changedRange = null,
  code,
  language,
}: {
  changedRange?: ChangedRange | null;
  code: string;
  language: string;
}) {
  const html = useMemo(() => {
    if (!changedRange) return highlight(code, language);

    const before = code.slice(0, changedRange.start);
    const changed = code.slice(changedRange.start, changedRange.end);
    const after = code.slice(changedRange.end);

    return [
      highlight(before, language),
      `<span class="playground-code-change">${highlight(changed, language)}</span>`,
      highlight(after, language),
    ].join("");
  }, [changedRange, code, language]);

  return (
    <pre className="whitespace-pre-wrap break-words">
      <code
        className="playground-code"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </pre>
  );
});

function usePlaygroundLanguage() {
  return useState<(typeof languageTabs)[number]>("curl");
}
