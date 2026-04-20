import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

afterEach(() => {
  cleanup();
  document.documentElement.className = "";
  document.documentElement.removeAttribute("data-theme");
  document.head.querySelectorAll('script[data-prontiq-stripe-pricing-table="true"]').forEach((script) => {
    script.remove();
  });
  delete (window as typeof window & { __prontiqStripePricingTableScript?: Promise<void> })
    .__prontiqStripePricingTableScript;
  if (typeof window.localStorage?.clear === "function") {
    window.localStorage.clear();
  }
});

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: query.includes("dark"),
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
  })),
});
