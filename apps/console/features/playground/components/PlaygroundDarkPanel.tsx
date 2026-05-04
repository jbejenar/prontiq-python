"use client";

import { Check, Clock3, Loader2, Play } from "lucide-react";
import { type RefObject, useState } from "react";
import Prism from "prismjs";
import "prismjs/components/prism-bash.js";
import "prismjs/components/prism-json.js";
import "prismjs/components/prism-javascript.js";
import "prismjs/components/prism-python.js";
import "prismjs/components/prism-go.js";
import "prismjs/components/prism-ruby.js";
import { toast } from "sonner";

import type { PlaygroundMode, PlaygroundResponse } from "../types.js";
import { cn } from "../../../lib/utils.js";

type PanelState = "empty" | "loading" | "success" | "error" | "demo-unavailable";

const languageTabs = ["curl", "node.js", "python", "go", "ruby"] as const;

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
  mode,
  onCopyCurl,
  onRun,
  runAriaLabel,
  tabFocusRef,
  requestDisplayId,
  response,
}: {
  command: string;
  demoUnavailableMessage?: string;
  error: string | null;
  isSending: boolean;
  mode: PlaygroundMode;
  onCopyCurl: () => Promise<void>;
  onRun: () => void;
  runAriaLabel: string;
  tabFocusRef?: RefObject<HTMLButtonElement | null>;
  requestDisplayId: string;
  response: PlaygroundResponse | null;
}) {
  const [activeLanguage, setActiveLanguage] = usePlaygroundLanguage();
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

  async function copyResponse() {
    await navigator.clipboard.writeText(bodyText || "");
    toast.success("Copied response");
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col bg-playground-panel-bg text-playground-panel-text">
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
          <span className="font-mono text-[10px] text-playground-panel-muted">⌘ ⏎</span>
          <button
            aria-label={runAriaLabel}
            className="inline-flex h-6 items-center gap-1 rounded bg-playground-panel-accent px-3 text-[11px] font-medium text-white transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
            disabled={runDisabled}
            type="button"
            onClick={onRun}
          >
            {isSending ? <Loader2 className="h-[9px] w-[9px] animate-spin" /> : <Play className="h-[9px] w-[9px] fill-current" />}
            Run
          </button>
        </div>
      </div>

      <div className="border-b border-playground-panel-border px-3.5 py-3 font-mono text-[11px] leading-[1.75]">
        <CodeBlock code={activeCode} language={codeLanguage} />
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
        <button
          className="font-mono text-[10px] text-playground-panel-muted transition hover:text-playground-panel-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-playground-panel-accent"
          type="button"
          onClick={() => void (response || error ? copyResponse() : onCopyCurl())}
        >
          copy
        </button>
      </div>

      <div
        className={cn(
          "min-h-0 flex-1 overflow-auto px-3.5 py-3 font-mono text-[11px] leading-[1.75]",
          panelState === "error" && "border-l border-playground-panel-danger-border",
        )}
      >
        {panelState === "empty" || panelState === "demo-unavailable" ? (
          <div className="flex h-full min-h-[160px] items-center justify-center text-center text-playground-panel-muted/70">
            Press Run or ⌘⏎ to send the request.
          </div>
        ) : panelState === "loading" ? (
          <div className="h-full min-h-[160px]" />
        ) : (
          <CodeBlock code={bodyText} language={response ? "json" : "json"} />
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
        <div className="flex items-center gap-1.5 font-mono text-[10px] text-playground-panel-accent-light">
          {response?.ok ? <Check className="h-[11px] w-[11px]" /> : null}
          <span>request #{requestDisplayId}</span>
        </div>
      </div>
    </section>
  );
}

function CodeBlock({ code, language }: { code: string; language: string }) {
  return (
    <pre className="whitespace-pre-wrap break-words">
      <code
        className="playground-code"
        dangerouslySetInnerHTML={{ __html: highlight(code, language) }}
      />
    </pre>
  );
}

function usePlaygroundLanguage() {
  return useState<(typeof languageTabs)[number]>("curl");
}
