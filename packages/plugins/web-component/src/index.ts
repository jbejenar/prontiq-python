export interface AddressSuggestion {
  addressLabel?: string;
  confidence?: number;
  id: string;
  localityName?: string;
  postcode?: string;
  score?: number;
  state?: string;
}

export interface AddressQueryChangeDetail {
  query: string;
}

export const PRONTIQ_ADDRESS_ELEMENT_NAME = "prontiq-address";
export const DEFAULT_SUGGESTION_LIMIT = 5;
export const MAX_SUGGESTION_LIMIT = 8;
export const MIN_QUERY_LENGTH = 3;

function clampSuggestionLimit(raw: string | number | null | undefined): number {
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) {
    return Math.min(Math.floor(raw), MAX_SUGGESTION_LIMIT);
  }

  if (typeof raw !== "string") {
    return DEFAULT_SUGGESTION_LIMIT;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_SUGGESTION_LIMIT;
  }

  return Math.min(parsed, MAX_SUGGESTION_LIMIT);
}

export function buildAutocompleteUrl(
  endpoint: string,
  q: string,
  state: string | null | undefined,
  limit: string | number | null | undefined,
  origin: string = "http://localhost",
): string {
  const url = new URL(endpoint, origin);
  url.searchParams.set("q", q);
  url.searchParams.set("limit", String(clampSuggestionLimit(limit)));
  const trimmedState = state?.trim().toUpperCase();
  if (trimmedState) {
    url.searchParams.set("state", trimmedState);
  }
  return url.toString();
}

function formatSuggestionLabel(suggestion: AddressSuggestion): string {
  const parts = [
    suggestion.addressLabel,
    suggestion.localityName,
    suggestion.state,
    suggestion.postcode,
  ].filter((part): part is string => typeof part === "string" && part.trim().length > 0);

  return parts.join(", ");
}

type SuggestionRowDocument = Pick<Document, "createElement">;

export function createSuggestionListItem(
  document: SuggestionRowDocument,
  suggestion: AddressSuggestion,
  isActive: boolean,
  onSelect: () => void,
): HTMLButtonElement {
  const item = document.createElement("button");
  item.dataset.active = String(isActive);
  item.type = "button";

  const primary = document.createElement("span");
  primary.textContent = formatSuggestionLabel(suggestion);

  const secondary = document.createElement("span");
  secondary.className = "secondary";
  secondary.textContent = suggestion.state ?? "";

  item.append(primary, secondary);
  item.addEventListener("click", onSelect);
  return item;
}

function isAddressSuggestion(value: unknown): value is AddressSuggestion {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return typeof candidate.id === "string";
}

function normalizeSuggestions(payload: unknown): AddressSuggestion[] {
  if (!payload || typeof payload !== "object") {
    return [];
  }

  const suggestions = (payload as { suggestions?: unknown }).suggestions;
  if (!Array.isArray(suggestions)) {
    return [];
  }

  return suggestions.filter(isAddressSuggestion);
}

function createProntiqAddressElementClass() {
  return class ProntiqAddressElement extends HTMLElement {
    static get observedAttributes() {
      return ["autocomplete-endpoint", "limit", "placeholder", "state"];
    }

    #abortController?: AbortController;
    #activeIndex = -1;
    #debounceTimer?: ReturnType<typeof setTimeout>;
    #input?: HTMLInputElement;
    #isInitialized = false;
    #items: AddressSuggestion[] = [];
    #list?: HTMLDivElement;
    #listenersAttached = false;
    #message?: HTMLDivElement;
    #pendingQuery?: string;

    constructor() {
      super();
      this.attachShadow({ mode: "open" });
    }

    connectedCallback() {
      if (!this.shadowRoot) {
        return;
      }

      if (!this.#isInitialized) {
        this.shadowRoot.innerHTML = `
      <style>
        :host {
          --pq-demo-accent: hsl(157 100% 45%);
          --pq-demo-bg: hsl(222 33% 7%);
          --pq-demo-border: hsl(220 15% 20%);
          --pq-demo-fg: hsl(0 0% 100%);
          --pq-demo-muted: hsl(220 10% 72%);
          display: block;
          width: 100%;
          font-family: var(--font-body, ui-monospace, SFMono-Regular, monospace);
        }

        .shell {
          border: 1px solid color-mix(in srgb, var(--pq-demo-border) 100%, transparent);
          background: color-mix(in srgb, var(--pq-demo-bg) 92%, transparent);
          border-radius: 0.9rem;
          box-shadow: 0 32px 80px hsl(222 33% 3% / 0.34);
          overflow: hidden;
        }

        .input-row {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          padding: 1rem 1rem 0.95rem;
          border-bottom: 1px solid color-mix(in srgb, var(--pq-demo-border) 100%, transparent);
        }

        .prompt {
          color: color-mix(in srgb, var(--pq-demo-accent) 85%, white 15%);
          font-size: 0.95rem;
        }

        input {
          width: 100%;
          background: transparent;
          border: 0;
          color: var(--pq-demo-fg);
          font: inherit;
          font-size: 0.95rem;
          outline: none;
        }

        input::placeholder {
          color: color-mix(in srgb, var(--pq-demo-muted) 100%, transparent);
        }

        .message {
          display: none;
          padding: 0.85rem 1rem;
          color: color-mix(in srgb, var(--pq-demo-muted) 100%, transparent);
          font-size: 0.8rem;
          border-bottom: 1px solid color-mix(in srgb, var(--pq-demo-border) 100%, transparent);
        }

        .message[data-visible="true"] {
          display: block;
        }

        .list {
          display: none;
          max-height: 18rem;
          overflow-y: auto;
        }

        .list[data-visible="true"] {
          display: block;
        }

        button {
          width: 100%;
          display: flex;
          justify-content: space-between;
          gap: 1rem;
          padding: 0.9rem 1rem;
          border: 0;
          background: transparent;
          color: var(--pq-demo-fg);
          font: inherit;
          text-align: left;
          cursor: pointer;
        }

        button:hover,
        button[data-active="true"] {
          background: hsl(157 100% 45% / 0.08);
        }

        .secondary {
          color: color-mix(in srgb, var(--pq-demo-muted) 100%, transparent);
          font-size: 0.75rem;
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }
      </style>
      <div class="shell">
        <div class="input-row">
          <span class="prompt">&gt;</span>
          <input autocomplete="off" spellcheck="false" type="text" />
        </div>
        <div class="message" data-visible="false"></div>
        <div class="list" data-visible="false" role="listbox"></div>
      </div>
    `;

        this.#input = this.shadowRoot.querySelector("input") ?? undefined;
        this.#list = this.shadowRoot.querySelector(".list") ?? undefined;
        this.#message = this.shadowRoot.querySelector(".message") ?? undefined;
        this.#isInitialized = true;
      }

      this.#syncAttributes();
      this.#attachListeners();
    }

    disconnectedCallback() {
      this.#cancelPendingRequest();
      this.#detachListeners();
    }

    attributeChangedCallback() {
      this.#syncAttributes();
    }

    #syncAttributes() {
      if (!this.#input) {
        return;
      }
      this.#input.placeholder = this.getAttribute("placeholder") ?? "Search an address";
    }

    #attachListeners() {
      if (!this.#input || this.#listenersAttached) {
        return;
      }

      this.#input.addEventListener("input", this.#handleInput);
      this.#input.addEventListener("keydown", this.#handleKeyDown);
      this.#listenersAttached = true;
    }

    #detachListeners() {
      if (!this.#input || !this.#listenersAttached) {
        return;
      }

      this.#input.removeEventListener("input", this.#handleInput);
      this.#input.removeEventListener("keydown", this.#handleKeyDown);
      this.#listenersAttached = false;
    }

    #handleInput = () => {
      if (!this.#input) {
        return;
      }

      const q = this.#input.value.trim();
      this.#cancelPendingRequest();
      this.dispatchEvent(
        new CustomEvent<AddressQueryChangeDetail>("querychange", {
          bubbles: true,
          composed: true,
          detail: { query: q },
        }),
      );

      if (q.length < MIN_QUERY_LENGTH) {
        this.#clearSuggestions();
        this.#setMessage(`Type at least ${MIN_QUERY_LENGTH} characters to search.`);
        return;
      }

      this.#clearSuggestions();
      this.#pendingQuery = q;
      this.#setMessage("Searching...");
      this.#debounceTimer = setTimeout(() => {
        void this.#loadSuggestions(q);
      }, 200);
    };

    #handleKeyDown = (event: KeyboardEvent) => {
      if (this.#items.length === 0) {
        return;
      }

      if (event.key === "ArrowDown") {
        event.preventDefault();
        this.#activeIndex = Math.min(this.#items.length - 1, this.#activeIndex + 1);
        this.#renderSuggestions();
        return;
      }

      if (event.key === "ArrowUp") {
        event.preventDefault();
        this.#activeIndex = Math.max(0, this.#activeIndex - 1);
        this.#renderSuggestions();
        return;
      }

      if (event.key === "Enter") {
        event.preventDefault();
        const suggestion = this.#items[this.#activeIndex];
        if (suggestion) {
          this.#selectSuggestion(suggestion);
        }
        return;
      }

      if (event.key === "Escape") {
        this.#clearSuggestions();
      }
    };

    async #loadSuggestions(q: string) {
      this.#abortController?.abort();
      const abortController = new AbortController();
      this.#abortController = abortController;

      try {
        const endpoint = this.getAttribute("autocomplete-endpoint") ?? "/v1/address/autocomplete";
        const url = buildAutocompleteUrl(
          endpoint,
          q,
          this.getAttribute("state"),
          this.getAttribute("limit"),
          window.location.origin,
        );

        const response = await fetch(url, {
          headers: {
            Accept: "application/json",
          },
          signal: abortController.signal,
        });

        if (!response.ok) {
          this.#clearSuggestions();
          this.#setMessage("The live demo is temporarily unavailable.");
          return;
        }

        const payload = await response.json();
        if (this.#pendingQuery !== q || this.#input?.value.trim() !== q) {
          return;
        }

        this.#items = normalizeSuggestions(payload);
        this.#activeIndex = this.#items.length > 0 ? 0 : -1;

        if (this.#items.length === 0) {
          this.#clearSuggestions();
          this.#setMessage("No matches found.");
          return;
        }

        this.#renderSuggestions();
        this.#setMessage("");
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }

        if (this.#pendingQuery !== q || this.#input?.value.trim() !== q) {
          return;
        }

        this.#clearSuggestions();
        this.#setMessage("The live demo is temporarily unavailable.");
      } finally {
        if (this.#pendingQuery === q) {
          this.#pendingQuery = undefined;
        }
        if (this.#abortController === abortController) {
          this.#abortController = undefined;
        }
      }
    }

    #renderSuggestions() {
      if (!this.#list) {
        return;
      }

      this.#list.innerHTML = "";
      this.#list.dataset.visible = this.#items.length > 0 ? "true" : "false";

      for (const [index, suggestion] of this.#items.entries()) {
        const item = createSuggestionListItem(
          document,
          suggestion,
          index === this.#activeIndex,
          () => this.#selectSuggestion(suggestion),
        );
        this.#list.append(item);
      }
    }

    #selectSuggestion(suggestion: AddressSuggestion) {
      if (this.#input) {
        this.#input.value = formatSuggestionLabel(suggestion);
      }
      this.#clearSuggestions();
      this.dispatchEvent(
        new CustomEvent<AddressSuggestion>("select", {
          bubbles: true,
          composed: true,
          detail: suggestion,
        }),
      );
    }

    #setMessage(message: string) {
      if (!this.#message) {
        return;
      }

      this.#message.dataset.visible = message.length > 0 ? "true" : "false";
      this.#message.textContent = message;
    }

    #clearSuggestions() {
      this.#items = [];
      this.#activeIndex = -1;
      if (this.#list) {
        this.#list.innerHTML = "";
        this.#list.dataset.visible = "false";
      }
    }

    #cancelPendingRequest() {
      if (this.#debounceTimer) {
        clearTimeout(this.#debounceTimer);
        this.#debounceTimer = undefined;
      }

      this.#pendingQuery = undefined;
      this.#abortController?.abort();
      this.#abortController = undefined;
    }
  };
}

export function registerProntiqAddressElement() {
  if (
    typeof globalThis.customElements === "undefined" ||
    typeof globalThis.HTMLElement === "undefined" ||
    globalThis.customElements.get(PRONTIQ_ADDRESS_ELEMENT_NAME)
  ) {
    return;
  }

  globalThis.customElements.define(PRONTIQ_ADDRESS_ELEMENT_NAME, createProntiqAddressElementClass());
}

registerProntiqAddressElement();
