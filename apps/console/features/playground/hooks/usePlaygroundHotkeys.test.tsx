import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef } from "react";
import { expect, test, vi } from "vitest";

import { usePlaygroundHotkeys } from "./usePlaygroundHotkeys.js";

test("runs with command-enter from playground request inputs", async () => {
  const onRun = vi.fn();
  render(<HotkeysHost onRun={onRun} />);

  await userEvent.click(screen.getByLabelText(/postcode/i));
  await userEvent.keyboard("{Meta>}{Enter}{/Meta}");

  expect(onRun).toHaveBeenCalledTimes(1);
});

test("does not run command-enter while composing text", () => {
  const onRun = vi.fn();
  render(<HotkeysHost onRun={onRun} />);

  fireEvent.keyDown(screen.getByLabelText(/postcode/i), {
    isComposing: true,
    key: "Enter",
    metaKey: true,
  });

  expect(onRun).not.toHaveBeenCalled();
});

test("opens the palette from playground chrome but not text inputs", async () => {
  const onOpenPalette = vi.fn();
  render(<HotkeysHost onOpenPalette={onOpenPalette} />);

  await userEvent.click(screen.getByLabelText(/postcode/i));
  await userEvent.keyboard("{Meta>}k{/Meta}");
  await userEvent.click(screen.getByRole("button", { name: /chrome action/i }));
  await userEvent.keyboard("{Meta>}k{/Meta}");

  expect(onOpenPalette).toHaveBeenCalledTimes(1);
});

test("opens the palette when the page body has focus", async () => {
  const onOpenPalette = vi.fn();
  render(<HotkeysHost onOpenPalette={onOpenPalette} />);

  document.body.focus();
  await userEvent.keyboard("{Meta>}k{/Meta}");

  expect(onOpenPalette).toHaveBeenCalledTimes(1);
});

test("focuses the filter with slash outside text-entry fields", () => {
  const onFocusFilter = vi.fn();
  render(<HotkeysHost onFocusFilter={onFocusFilter} />);

  fireEvent.keyDown(screen.getByLabelText(/postcode/i), { key: "/" });
  fireEvent.keyDown(screen.getByRole("button", { name: /chrome action/i }), { key: "/" });

  expect(onFocusFilter).toHaveBeenCalledTimes(1);
});

function HotkeysHost({
  onFocusFilter = vi.fn(),
  onOpenPalette = vi.fn(),
  onRun = vi.fn(),
}: {
  onFocusFilter?: () => void;
  onOpenPalette?: () => void;
  onRun?: () => void;
}) {
  const rootRef = useRef<HTMLElement | null>(null);
  usePlaygroundHotkeys({
    onFocusFilter,
    onOpenPalette,
    onRun,
    paletteOpen: false,
    rootRef,
  });

  return (
    <section ref={rootRef}>
      <input aria-label="Postcode" />
      <button type="button">Chrome action</button>
    </section>
  );
}
