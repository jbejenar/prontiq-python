import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";

import { ThemeToggle } from "./theme-toggle.js";
import { ThemeProvider } from "../lib/theme-provider.js";

test("theme toggle defaults to dark when system preference is dark", async () => {
  render(
    <ThemeProvider>
      <ThemeToggle />
    </ThemeProvider>,
  );

  await waitFor(() => {
    expect(document.documentElement).toHaveClass("dark");
  });
});

test("theme toggle exposes System / Light / Dark radio items and applies the chosen theme", async () => {
  const user = userEvent.setup();

  render(
    <ThemeProvider>
      <ThemeToggle />
    </ThemeProvider>,
  );

  await user.click(screen.getByRole("button", { name: "Toggle theme" }));

  const lightItem = await screen.findByRole("menuitemradio", { name: "Light" });
  expect(lightItem).toBeInTheDocument();
  expect(screen.getByRole("menuitemradio", { name: "Dark" })).toBeInTheDocument();
  expect(screen.getByRole("menuitemradio", { name: "System" })).toBeInTheDocument();

  await user.click(lightItem);

  await waitFor(() => {
    expect(document.documentElement).not.toHaveClass("dark");
  });

  await user.click(screen.getByRole("button", { name: "Toggle theme" }));
  await user.click(await screen.findByRole("menuitemradio", { name: "Dark" }));

  await waitFor(() => {
    expect(document.documentElement).toHaveClass("dark");
  });
});

test("theme toggle returns to the system preference when System is selected", async () => {
  const user = userEvent.setup();

  render(
    <ThemeProvider>
      <ThemeToggle />
    </ThemeProvider>,
  );

  await user.click(screen.getByRole("button", { name: "Toggle theme" }));
  await user.click(await screen.findByRole("menuitemradio", { name: "Light" }));

  await waitFor(() => {
    expect(document.documentElement).not.toHaveClass("dark");
  });

  await user.click(screen.getByRole("button", { name: "Toggle theme" }));
  await user.click(await screen.findByRole("menuitemradio", { name: "System" }));

  // matchMedia mock in test/setup.ts returns matches=true for queries containing "dark"
  await waitFor(() => {
    expect(document.documentElement).toHaveClass("dark");
  });
});

test("theme toggle keeps no class on the light system preference path", async () => {
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
