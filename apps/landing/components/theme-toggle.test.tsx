import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";

import { ThemeToggle } from "./theme-toggle.js";
import { ThemeProvider } from "../lib/theme-provider.js";

test("theme toggle switches the document theme class", async () => {
  const user = userEvent.setup();

  render(
    <ThemeProvider>
      <ThemeToggle />
    </ThemeProvider>,
  );

  expect(document.documentElement).toHaveClass("dark");

  await user.click(screen.getByRole("button", { name: "Toggle theme" }));

  expect(document.documentElement).not.toHaveClass("dark");
});

test("theme provider keeps the initial no-class render on the light system preference path", async () => {
  vi.mocked(window.matchMedia).mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
  }));

  render(
    <ThemeProvider>
      <ThemeToggle />
    </ThemeProvider>,
  );

  await waitFor(() => {
    expect(document.documentElement).not.toHaveClass("dark");
  });
});
