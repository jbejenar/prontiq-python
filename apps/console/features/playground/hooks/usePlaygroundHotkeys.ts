"use client";

import { type RefObject } from "react";
import { useHotkeys } from "react-hotkeys-hook";

function eventTargetElement(event: KeyboardEvent) {
  return event.target instanceof Element ? event.target : null;
}

function isTextEntryTarget(target: Element | null) {
  if (!target) return false;
  const tagName = target.tagName.toLowerCase();
  return (
    tagName === "input" ||
    tagName === "textarea" ||
    tagName === "select" ||
    target.getAttribute("contenteditable") === "true" ||
    target.getAttribute("role") === "textbox" ||
    target.getAttribute("role") === "searchbox"
  );
}

function isInsideRoot(rootRef: RefObject<HTMLElement | null>, event: KeyboardEvent) {
  const target = eventTargetElement(event);
  if (target === document.body || target === document.documentElement) {
    return Boolean(rootRef.current);
  }
  return Boolean(target && rootRef.current?.contains(target));
}

function isComposing(event: KeyboardEvent) {
  return event.isComposing || event.key === "Process";
}

export function usePlaygroundHotkeys({
  historyOpen = false,
  onFocusFilter,
  onOpenPalette,
  onRun,
  paletteOpen,
  rootRef,
}: {
  historyOpen?: boolean;
  onFocusFilter: () => void;
  onOpenPalette: () => void;
  onRun: () => void;
  paletteOpen: boolean;
  rootRef: RefObject<HTMLElement | null>;
}) {
  useHotkeys(
    ["meta+k", "ctrl+k"],
    (event) => {
      if (!isInsideRoot(rootRef, event) || isComposing(event)) return;
      event.preventDefault();
      onOpenPalette();
    },
    {
      enableOnFormTags: false,
      preventDefault: true,
    },
    [onOpenPalette, rootRef],
  );

  useHotkeys(
    ["meta+enter", "ctrl+enter"],
    (event) => {
      if (!isInsideRoot(rootRef, event) || isComposing(event) || paletteOpen || historyOpen) return;
      event.preventDefault();
      onRun();
    },
    {
      enableOnContentEditable: true,
      enableOnFormTags: ["input", "textarea"],
      preventDefault: true,
    },
    [historyOpen, onRun, paletteOpen, rootRef],
  );

  useHotkeys(
    "/",
    (event) => {
      const target = eventTargetElement(event);
      if (!isInsideRoot(rootRef, event) || isComposing(event) || paletteOpen || historyOpen) return;
      if (isTextEntryTarget(target)) return;
      event.preventDefault();
      onFocusFilter();
    },
    {
      enableOnFormTags: false,
      preventDefault: true,
      useKey: true,
    },
    [historyOpen, onFocusFilter, paletteOpen, rootRef],
  );
}
