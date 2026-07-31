// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

interface FixtureMessage {
  type: string;
  term?: string;
  mode?: string;
}

describe("content-script DOM invariants", () => {
  let listeners: Array<(message: FixtureMessage) => void>;
  let messages: FixtureMessage[];

  beforeEach(async () => {
    vi.resetModules();
    listeners = [];
    messages = [];
    document.documentElement.innerHTML = `
      <head><title>Protected article fixture</title></head>
      <body>
        <article>
          <h1>Reliable operations</h1>
          <p>An idempotent operation can be retried safely. Keeping the handler idempotent prevents duplicate work.</p>
          <p id="protected">
            <a href="https://example.com/idempotent">idempotent link</a>
            <code>idempotentCall()</code>
            <kbd>idempotent</kbd>
            <var>idempotent</var>
            <math><mi>idempotent</mi><mo>=</mo><mi>f</mi></math>
            <span contenteditable="true">idempotent editable text</span>
            <input value="idempotent input" />
          </p>
        </article>
      </body>
    `;
    Object.defineProperty(HTMLElement.prototype, "innerText", {
      configurable: true,
      get() {
        return this.textContent || "";
      },
    });
    window.__witWittyInstalled = false;
    const chromeFixture = {
      runtime: {
        sendMessage(message: FixtureMessage) {
          messages.push(message);
        },
        onMessage: {
          addListener(listener: (message: FixtureMessage) => void) {
            listeners.push(listener);
          },
        },
      },
      storage: {
        local: {
          async get() {
            return { knownTerms: [], notJargonTerms: [], excludedDomains: [] };
          },
        },
      },
    };
    Object.assign(globalThis, { chrome: chromeFixture });
    Object.assign(window, { chrome: chromeFixture });
    await import("../content/index");
  });

  it("round-trips visible article text exactly and leaves protected descendants untouched", async () => {
    const article = document.querySelector("article");
    const originalText = article?.textContent;
    const protectedText = document.querySelector("#protected")?.textContent;
    const linkHref = document.querySelector<HTMLAnchorElement>("#protected a")?.href;

    listeners.forEach((listener) => listener({ type: "WITWITTY_SCAN_PAGE" }));
    await vi.waitFor(() => expect(messages.some((message) => message.type === "WITWITTY_SCAN_COMPLETE")).toBe(true));

    const annotated = [...document.querySelectorAll<HTMLElement>("mark[data-witwitty-term='idempotent']")];
    expect(annotated).toHaveLength(2);
    expect(document.querySelectorAll("#protected mark")).toHaveLength(0);
    expect(document.querySelector("#protected")?.textContent).toBe(protectedText);
    expect(document.querySelector<HTMLAnchorElement>("#protected a")?.href).toBe(linkHref);
    expect(document.querySelector<HTMLInputElement>("#protected input")?.value).toBe("idempotent input");

    listeners.forEach((listener) => listener({ type: "WITWITTY_SET_TEXT_MODE", term: "idempotent", mode: "simpler" }));
    expect([...document.querySelectorAll<HTMLElement>("mark[data-witwitty-term='idempotent']")].map((mark) => mark.textContent))
      .toEqual(["safe to repeat", "safe to repeat"]);

    listeners.forEach((listener) => listener({ type: "WITWITTY_SET_TEXT_MODE", term: "idempotent", mode: "original" }));
    expect(article?.textContent).toBe(originalText);

    listeners.forEach((listener) => listener({ type: "WITWITTY_REMOVE_ALL_ANNOTATIONS" }));
    expect(document.querySelectorAll("mark[data-witwitty-term]")).toHaveLength(0);
    expect(article?.textContent).toBe(originalText);
  });
});
