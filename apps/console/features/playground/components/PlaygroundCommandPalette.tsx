"use client";

import { Command } from "cmdk";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import type { ComponentType } from "react";
import {
  BookOpen,
  Copy,
  Eraser,
  History,
  KeyRound,
  Play,
  RotateCcw,
  Search,
  TerminalSquare,
} from "lucide-react";

import type {
  PlaygroundCommandActionId,
  PlaygroundMode,
  PlaygroundOperation,
} from "../types.js";
import { playgroundShortcutLabels } from "../lib/shortcut-labels.js";
import { cn } from "../../../lib/utils.js";

type PaletteAction = {
  disabled?: boolean;
  icon: ComponentType<{ className?: string }>;
  id: PlaygroundCommandActionId;
  label: string;
  shortcut?: string;
  subtitle: string;
  onSelect: () => void;
};

function verbClass(method: string) {
  switch (method) {
    case "GET":
      return "text-teal-300";
    case "POST":
      return "text-blue-300";
    case "PUT":
    case "PATCH":
      return "text-amber-300";
    case "DELETE":
      return "text-red-300";
    default:
      return "text-playground-panel-muted";
  }
}

function strippedPath(path: string) {
  return path.replace(/^\/v1\/address\/?/, "") || path;
}

export function PlaygroundCommandPalette({
  canCopyCurl,
  canRun,
  mode,
  onActionSelected,
  onOpenChange,
  onOperationSelected,
  open,
  operations,
}: {
  canCopyCurl: boolean;
  canRun: boolean;
  mode: PlaygroundMode;
  onActionSelected: (actionId: PlaygroundCommandActionId) => void;
  onOpenChange: (open: boolean) => void;
  onOperationSelected: (operation: PlaygroundOperation) => void;
  open: boolean;
  operations: PlaygroundOperation[];
}) {
  const actions: PaletteAction[] = [
    {
      icon: mode === "demo" ? KeyRound : TerminalSquare,
      id: mode === "demo" ? "switch_to_account" : "switch_to_demo",
      label: mode === "demo" ? "Switch to Your account mode" : "Switch to Demo mode",
      subtitle: "Change how the next request authenticates",
      onSelect: () => onActionSelected(mode === "demo" ? "switch_to_account" : "switch_to_demo"),
    },
    {
      disabled: !canRun,
      icon: Play,
      id: "run_request",
      label: "Run request",
      shortcut: playgroundShortcutLabels.runChip,
      subtitle: "Send the selected operation with current inputs",
      onSelect: () => onActionSelected("run_request"),
    },
    {
      disabled: !canCopyCurl,
      icon: Copy,
      id: "copy_curl",
      label: "Copy curl",
      subtitle: "Copy the production-shaped curl command",
      onSelect: () => onActionSelected("copy_curl"),
    },
    {
      icon: History,
      id: "open_history",
      label: "Open request history",
      subtitle: "Show requests fired in this tab session",
      onSelect: () => onActionSelected("open_history"),
    },
    {
      icon: Eraser,
      id: "clear_api_key",
      label: "Clear API key",
      subtitle: "Remove the memory-held account key",
      onSelect: () => onActionSelected("clear_api_key"),
    },
    {
      icon: BookOpen,
      id: "open_docs",
      label: "Open docs",
      subtitle: "Open docs.prontiq.dev in a new tab",
      onSelect: () => onActionSelected("open_docs"),
    },
    {
      icon: RotateCcw,
      id: "reset_playground",
      label: "Reset playground",
      subtitle: "Restore examples for the selected operation",
      onSelect: () => onActionSelected("reset_playground"),
    },
    {
      icon: Search,
      id: "focus_filter",
      label: "Focus operation filter",
      shortcut: playgroundShortcutLabels.focusFilter,
      subtitle: "Jump to the operation rail filter",
      onSelect: () => onActionSelected("focus_filter"),
    },
    {
      icon: TerminalSquare,
      id: "focus_language_tabs",
      label: "Focus language tabs",
      subtitle: "Move focus to the snippet language selector",
      onSelect: () => onActionSelected("focus_language_tabs"),
    },
  ];

  return (
    <Command.Dialog
      className="fixed left-1/2 top-[18vh] z-50 flex max-h-[80vh] w-[min(600px,calc(100vw-2rem))] -translate-x-1/2 flex-col overflow-hidden rounded-lg border border-playground-panel-border bg-playground-panel-bg shadow-lift"
      label="Playground command palette"
      open={open}
      shouldFilter
      onOpenChange={onOpenChange}
    >
      <DialogPrimitive.Title className="sr-only">Playground command palette</DialogPrimitive.Title>
      <DialogPrimitive.Description className="sr-only">
        Search public API operations and playground actions.
      </DialogPrimitive.Description>
      <div className="border-b border-playground-panel-border px-3 py-2">
        <Command.Input
          autoFocus
          className="h-9 w-full bg-transparent font-mono text-[12px] text-playground-panel-text outline-none placeholder:text-playground-panel-muted"
          placeholder="Search operations and actions..."
        />
      </div>
      <Command.List className="max-h-[60vh] overflow-y-auto p-2">
        <Command.Empty className="px-3 py-8 text-center font-mono text-[11px] text-playground-panel-muted">
          no matches — press esc to close
        </Command.Empty>

        <Command.Group
          className="pb-2 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:font-mono [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.06em] [&_[cmdk-group-heading]]:text-playground-panel-muted"
          heading="Operations"
        >
          {operations.map((operation) => (
            <Command.Item
              className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 text-playground-panel-text aria-selected:bg-playground-panel-accent-tab aria-selected:text-playground-panel-string"
              key={operation.operationId}
              value={`${operation.method} ${operation.path} ${operation.tag} ${operation.summary} ${operation.description ?? ""} ${operation.operationId}`}
              onSelect={() => onOperationSelected(operation)}
            >
              <span className={cn("w-9 shrink-0 font-mono text-[9px] font-medium tracking-[0.04em]", verbClass(operation.method))}>
                {operation.method}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium">{operation.summary}</span>
                <span className="block truncate font-mono text-[11px] text-playground-panel-muted">
                  {strippedPath(operation.path)}
                </span>
              </span>
              <span className="font-mono text-[10px] text-playground-panel-muted">{operation.tag}</span>
            </Command.Item>
          ))}
        </Command.Group>

        <Command.Group
          className="pt-1 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:font-mono [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.06em] [&_[cmdk-group-heading]]:text-playground-panel-muted"
          heading="Actions"
        >
          {actions.map((action) => {
            const Icon = action.icon;
            return (
              <Command.Item
                className={cn(
                  "flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 text-playground-panel-text aria-selected:bg-playground-panel-accent-tab aria-selected:text-playground-panel-string",
                  action.disabled && "cursor-not-allowed opacity-50",
                )}
                disabled={action.disabled}
                key={action.id}
                value={`${action.label} ${action.subtitle} ${action.id}`}
                onSelect={action.onSelect}
              >
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded border border-playground-panel-border text-playground-panel-string">
                  <Icon className="h-3.5 w-3.5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium">{action.label}</span>
                  <span className="block truncate font-mono text-[11px] text-playground-panel-muted">
                    {action.subtitle}
                  </span>
                </span>
                {action.shortcut ? (
                  <span className="rounded border border-playground-panel-border px-1.5 py-0.5 font-mono text-[10px] text-playground-panel-muted">
                    {action.shortcut}
                  </span>
                ) : null}
              </Command.Item>
            );
          })}
        </Command.Group>
      </Command.List>
    </Command.Dialog>
  );
}
