import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";

import {
  DEFAULT_SUGGESTION_LIMIT,
  MAX_SUGGESTION_LIMIT,
  MIN_QUERY_LENGTH,
  PRONTIQ_ADDRESS_ELEMENT_NAME,
  buildAutocompleteUrl,
  createSuggestionListItem,
  registerProntiqAddressElement,
} from "./index.js";

test("buildAutocompleteUrl encodes query params and clamps the limit", () => {
  const url = new URL(
    buildAutocompleteUrl(
      "https://landing.prontiq.dev/api/demo/address/autocomplete",
      "9 endeavour",
      "VIC",
      MAX_SUGGESTION_LIMIT + 10,
      "https://landing.prontiq.dev",
    ),
  );

  assert.equal(url.pathname, "/api/demo/address/autocomplete");
  assert.equal(url.searchParams.get("q"), "9 endeavour");
  assert.equal(url.searchParams.get("state"), "VIC");
  assert.equal(url.searchParams.get("limit"), String(MAX_SUGGESTION_LIMIT));
});

test("buildAutocompleteUrl omits optional params when absent", () => {
  const url = new URL(
    buildAutocompleteUrl(
      "https://landing.prontiq.dev/api/demo/address/autocomplete",
      "12 collins",
      undefined,
      undefined,
    ),
  );

  assert.equal(url.searchParams.get("q"), "12 collins");
  assert.equal(url.searchParams.get("state"), null);
  assert.equal(url.searchParams.get("limit"), String(DEFAULT_SUGGESTION_LIMIT));
});

test("buildAutocompleteUrl falls back to the default limit when the input is invalid", () => {
  const underMin = new URL(
    buildAutocompleteUrl(
      "https://landing.prontiq.dev/api/demo/address/autocomplete",
      "abc",
      undefined,
      MIN_QUERY_LENGTH - 10,
    ),
  );

  assert.equal(underMin.searchParams.get("limit"), String(DEFAULT_SUGGESTION_LIMIT));
});

class FakeElement {
  children: FakeElement[] = [];
  className = "";
  dataset: Record<string, string> = {};
  listeners = new Map<string, () => void>();
  textContent = "";
  type = "";

  addEventListener(eventName: string, listener: () => void) {
    this.listeners.set(eventName, listener);
  }

  append(...children: FakeElement[]) {
    this.children.push(...children);
  }

  set innerHTML(_value: string) {
    throw new Error("innerHTML should not be used for suggestion rows");
  }
}

class FakeDocument {
  createElement(_tagName: string) {
    return new FakeElement();
  }
}

test("createSuggestionListItem treats suggestion text as plain text, not HTML", () => {
  const fakeDocument = new FakeDocument();
  const item = createSuggestionListItem(
    fakeDocument as unknown as Document,
    {
      addressLabel: '<script>alert("xss")</script> & 9 Example St',
      id: "addr_123",
      state: 'VIC" onclick="alert(1)',
    },
    true,
    () => undefined,
  );

  assert.equal(item.dataset.active, "true");
  assert.equal(item.type, "button");
  assert.equal(item.children.length, 2);
  assert.equal(item.children[0]?.textContent, '<script>alert("xss")</script> & 9 Example St, VIC" onclick="alert(1)');
  assert.equal(item.children[1]?.textContent, 'VIC" onclick="alert(1)');
});

test("custom element reconnects cleanly after disconnect and reconnect", async () => {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "https://landing.prontiq.dev",
  });
  const fetchCalls: string[] = [];
  const payload = {
    suggestions: [
      {
        addressLabel: "9 Endeavour Street",
        id: "addr_123",
        localityName: "Docklands",
        postcode: "3008",
        state: "VIC",
      },
    ],
  };

  const originalAbortController = globalThis.AbortController;
  const originalCustomElements = globalThis.customElements;
  const originalDocument = globalThis.document;
  const originalDomException = globalThis.DOMException;
  const originalFetch = globalThis.fetch;
  const originalHTMLElement = globalThis.HTMLElement;
  const originalKeyboardEvent = globalThis.KeyboardEvent;
  const originalCustomEvent = globalThis.CustomEvent;
  const originalWindow = globalThis.window;

  Object.assign(globalThis, {
    AbortController: dom.window.AbortController,
    customElements: dom.window.customElements,
    CustomEvent: dom.window.CustomEvent,
    DOMException: dom.window.DOMException,
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    KeyboardEvent: dom.window.KeyboardEvent,
    window: dom.window,
  });

  globalThis.fetch = async (input: string | URL | RequestInfo) => {
    fetchCalls.push(String(input));
    return new Response(JSON.stringify(payload), {
      headers: {
        "content-type": "application/json",
      },
      status: 200,
    });
  };

  try {
    registerProntiqAddressElement();
    const element = dom.window.document.createElement(
      PRONTIQ_ADDRESS_ELEMENT_NAME,
    ) as HTMLElement;
    element.setAttribute("autocomplete-endpoint", "/api/demo/address/autocomplete");
    dom.window.document.body.append(element);

    const input = element.shadowRoot?.querySelector("input");
    assert.ok(input instanceof dom.window.HTMLInputElement);

    input.value = "9 Endeavour";
    input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 250));
    await new Promise((resolve) => setTimeout(resolve, 0));

    let options = element.shadowRoot?.querySelectorAll("button");
    assert.equal(fetchCalls.length, 1);
    assert.equal(options?.length, 1);

    element.remove();
    dom.window.document.body.append(element);

    input.value = "12 Collins";
    input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 250));
    await new Promise((resolve) => setTimeout(resolve, 0));

    options = element.shadowRoot?.querySelectorAll("button");
    assert.equal(fetchCalls.length, 2);
    assert.equal(options?.length, 1);

    input.dispatchEvent(
      new dom.window.KeyboardEvent("keydown", {
        bubbles: true,
        key: "ArrowDown",
      }),
    );
    const activeOption = element.shadowRoot?.querySelector('button[data-active="true"]');
    assert.ok(activeOption);

    input.dispatchEvent(
      new dom.window.KeyboardEvent("keydown", {
        bubbles: true,
        key: "Enter",
      }),
    );

    assert.equal(input.value, "9 Endeavour Street, Docklands, VIC, 3008");
  } finally {
    globalThis.AbortController = originalAbortController;
    globalThis.customElements = originalCustomElements;
    globalThis.CustomEvent = originalCustomEvent;
    globalThis.DOMException = originalDomException;
    globalThis.document = originalDocument;
    globalThis.fetch = originalFetch;
    globalThis.HTMLElement = originalHTMLElement;
    globalThis.KeyboardEvent = originalKeyboardEvent;
    globalThis.window = originalWindow;
    dom.window.close();
  }
});

test("custom element does not render stale suggestions after the query is cleared", async () => {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "https://landing.prontiq.dev",
  });
  let resolveFetch: ((response: Response) => void) | undefined;

  const originalAbortController = globalThis.AbortController;
  const originalCustomElements = globalThis.customElements;
  const originalDocument = globalThis.document;
  const originalDomException = globalThis.DOMException;
  const originalFetch = globalThis.fetch;
  const originalHTMLElement = globalThis.HTMLElement;
  const originalKeyboardEvent = globalThis.KeyboardEvent;
  const originalCustomEvent = globalThis.CustomEvent;
  const originalWindow = globalThis.window;

  Object.assign(globalThis, {
    AbortController: dom.window.AbortController,
    customElements: dom.window.customElements,
    CustomEvent: dom.window.CustomEvent,
    DOMException: dom.window.DOMException,
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    KeyboardEvent: dom.window.KeyboardEvent,
    window: dom.window,
  });

  globalThis.fetch = (_input: string | URL | RequestInfo, init?: RequestInit) =>
    new Promise<Response>((resolve, reject) => {
      resolveFetch = (response) => {
        if (init?.signal instanceof AbortSignal && init.signal.aborted) {
          reject(new dom.window.DOMException("The operation was aborted.", "AbortError"));
          return;
        }
        resolve(response);
      };
      init?.signal?.addEventListener("abort", () => {
        reject(new dom.window.DOMException("The operation was aborted.", "AbortError"));
      });
    });

  try {
    registerProntiqAddressElement();
    const element = dom.window.document.createElement(
      PRONTIQ_ADDRESS_ELEMENT_NAME,
    ) as HTMLElement;
    element.setAttribute("autocomplete-endpoint", "/api/demo/address/autocomplete");
    dom.window.document.body.append(element);

    const input = element.shadowRoot?.querySelector("input");
    const list = element.shadowRoot?.querySelector(".list");
    const message = element.shadowRoot?.querySelector(".message");
    assert.ok(input instanceof dom.window.HTMLInputElement);
    assert.ok(list instanceof dom.window.HTMLDivElement);
    assert.ok(message instanceof dom.window.HTMLDivElement);

    input.value = "9 Endeavour";
    input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 250));

    input.value = "9";
    input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));

    resolveFetch?.(
      new Response(
        JSON.stringify({
          suggestions: [
            {
              addressLabel: "9 Endeavour Street",
              id: "addr_123",
              localityName: "Docklands",
              postcode: "3008",
              state: "VIC",
            },
          ],
        }),
        {
          headers: {
            "content-type": "application/json",
          },
          status: 200,
        },
      ),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.equal(list.dataset.visible, "false");
    assert.equal(list.querySelectorAll("button").length, 0);
    assert.equal(message.dataset.visible, "true");
    assert.equal(message.textContent, "Type at least 3 characters to search.");
  } finally {
    globalThis.AbortController = originalAbortController;
    globalThis.customElements = originalCustomElements;
    globalThis.CustomEvent = originalCustomEvent;
    globalThis.DOMException = originalDomException;
    globalThis.document = originalDocument;
    globalThis.fetch = originalFetch;
    globalThis.HTMLElement = originalHTMLElement;
    globalThis.KeyboardEvent = originalKeyboardEvent;
    globalThis.window = originalWindow;
    dom.window.close();
  }
});

test("custom element clears rendered suggestions immediately when the query changes", async () => {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "https://landing.prontiq.dev",
  });
  const pendingResolvers: Array<(response: Response) => void> = [];

  const originalAbortController = globalThis.AbortController;
  const originalCustomElements = globalThis.customElements;
  const originalDocument = globalThis.document;
  const originalDomException = globalThis.DOMException;
  const originalFetch = globalThis.fetch;
  const originalHTMLElement = globalThis.HTMLElement;
  const originalKeyboardEvent = globalThis.KeyboardEvent;
  const originalCustomEvent = globalThis.CustomEvent;
  const originalWindow = globalThis.window;

  Object.assign(globalThis, {
    AbortController: dom.window.AbortController,
    customElements: dom.window.customElements,
    CustomEvent: dom.window.CustomEvent,
    DOMException: dom.window.DOMException,
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    KeyboardEvent: dom.window.KeyboardEvent,
    window: dom.window,
  });

  globalThis.fetch = (_input: string | URL | RequestInfo, init?: RequestInit) =>
    new Promise<Response>((resolve, reject) => {
      pendingResolvers.push((response) => {
        if (init?.signal instanceof AbortSignal && init.signal.aborted) {
          reject(new dom.window.DOMException("The operation was aborted.", "AbortError"));
          return;
        }
        resolve(response);
      });
      init?.signal?.addEventListener("abort", () => {
        reject(new dom.window.DOMException("The operation was aborted.", "AbortError"));
      });
    });

  try {
    registerProntiqAddressElement();
    const element = dom.window.document.createElement(
      PRONTIQ_ADDRESS_ELEMENT_NAME,
    ) as HTMLElement;
    element.setAttribute("autocomplete-endpoint", "/api/demo/address/autocomplete");
    dom.window.document.body.append(element);

    const input = element.shadowRoot?.querySelector("input");
    const list = element.shadowRoot?.querySelector(".list");
    const message = element.shadowRoot?.querySelector(".message");
    assert.ok(input instanceof dom.window.HTMLInputElement);
    assert.ok(list instanceof dom.window.HTMLDivElement);
    assert.ok(message instanceof dom.window.HTMLDivElement);

    input.value = "9 Endeavour";
    input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 250));

    pendingResolvers.shift()?.(
      new Response(
        JSON.stringify({
          suggestions: [
            {
              addressLabel: "9 Endeavour Street",
              id: "addr_123",
              localityName: "Docklands",
              postcode: "3008",
              state: "VIC",
            },
          ],
        }),
        {
          headers: {
            "content-type": "application/json",
          },
          status: 200,
        },
      ),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.equal(list.dataset.visible, "true");
    assert.equal(list.querySelectorAll("button").length, 1);

    input.value = "9 Endea";
    input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));

    assert.equal(list.dataset.visible, "false");
    assert.equal(list.querySelectorAll("button").length, 0);
    assert.equal(message.dataset.visible, "true");
    assert.equal(message.textContent, "Searching...");
  } finally {
    globalThis.AbortController = originalAbortController;
    globalThis.customElements = originalCustomElements;
    globalThis.CustomEvent = originalCustomEvent;
    globalThis.DOMException = originalDomException;
    globalThis.document = originalDocument;
    globalThis.fetch = originalFetch;
    globalThis.HTMLElement = originalHTMLElement;
    globalThis.KeyboardEvent = originalKeyboardEvent;
    globalThis.window = originalWindow;
    dom.window.close();
  }
});

test("custom element emits a querychange event when the input mutates", async () => {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "https://landing.prontiq.dev",
  });

  const originalAbortController = globalThis.AbortController;
  const originalCustomElements = globalThis.customElements;
  const originalDocument = globalThis.document;
  const originalDomException = globalThis.DOMException;
  const originalFetch = globalThis.fetch;
  const originalHTMLElement = globalThis.HTMLElement;
  const originalKeyboardEvent = globalThis.KeyboardEvent;
  const originalCustomEvent = globalThis.CustomEvent;
  const originalWindow = globalThis.window;

  Object.assign(globalThis, {
    AbortController: dom.window.AbortController,
    customElements: dom.window.customElements,
    CustomEvent: dom.window.CustomEvent,
    DOMException: dom.window.DOMException,
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    KeyboardEvent: dom.window.KeyboardEvent,
    window: dom.window,
  });

  globalThis.fetch = async () =>
    new Response(JSON.stringify({ suggestions: [] }), {
      headers: {
        "content-type": "application/json",
      },
      status: 200,
    });

  try {
    registerProntiqAddressElement();
    const element = dom.window.document.createElement(
      PRONTIQ_ADDRESS_ELEMENT_NAME,
    ) as HTMLElement;
    element.setAttribute("autocomplete-endpoint", "/api/demo/address/autocomplete");
    dom.window.document.body.append(element);

    const queryEvents: string[] = [];
    element.addEventListener("querychange", (event) => {
      const customEvent = event as CustomEvent<{ query: string }>;
      queryEvents.push(customEvent.detail.query);
    });

    const input = element.shadowRoot?.querySelector("input");
    assert.ok(input instanceof dom.window.HTMLInputElement);

    input.value = "9 Endeavour";
    input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));

    input.value = "";
    input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));

    assert.deepEqual(queryEvents, ["9 Endeavour", ""]);
  } finally {
    globalThis.AbortController = originalAbortController;
    globalThis.customElements = originalCustomElements;
    globalThis.CustomEvent = originalCustomEvent;
    globalThis.DOMException = originalDomException;
    globalThis.document = originalDocument;
    globalThis.fetch = originalFetch;
    globalThis.HTMLElement = originalHTMLElement;
    globalThis.KeyboardEvent = originalKeyboardEvent;
    globalThis.window = originalWindow;
    dom.window.close();
  }
});

test("custom element shadow stylesheet consumes Prontiq-namespaced widget tokens", () => {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "https://landing.prontiq.dev",
  });

  const originalCustomElements = globalThis.customElements;
  const originalDocument = globalThis.document;
  const originalHTMLElement = globalThis.HTMLElement;
  const originalWindow = globalThis.window;

  Object.assign(globalThis, {
    customElements: dom.window.customElements,
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    window: dom.window,
  });

  try {
    registerProntiqAddressElement();
    const element = dom.window.document.createElement(
      PRONTIQ_ADDRESS_ELEMENT_NAME,
    ) as HTMLElement;
    dom.window.document.body.append(element);

    const styleEl = element.shadowRoot?.querySelector("style");
    const css = styleEl?.textContent ?? "";

    assert.match(css, /var\(--prontiq-widget-accent/);
    assert.match(css, /var\(--prontiq-widget-bg/);
    assert.match(css, /var\(--prontiq-widget-border/);
    assert.match(css, /var\(--prontiq-widget-fg/);
    assert.match(css, /var\(--prontiq-widget-muted/);
    assert.match(css, /var\(--prontiq-widget-accent-soft/);
    assert.match(css, /background: var\(--pq-demo-accent-soft\);/);
    assert.doesNotMatch(css, /hsl\(157 100% 45% \/ 0\.08\)\s*;/);
  } finally {
    globalThis.customElements = originalCustomElements;
    globalThis.document = originalDocument;
    globalThis.HTMLElement = originalHTMLElement;
    globalThis.window = originalWindow;
    dom.window.close();
  }
});
