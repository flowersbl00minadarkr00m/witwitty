// @vitest-environment node
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createRejectedSenseSignal,
  eligible,
  evaluateEligibility,
  isExcludedDomain,
  pageEligible,
  type AiEligibilityContext,
} from "../core/aiCapability";

const configuredContext = (overrides: Partial<AiEligibilityContext> = {}): AiEligibilityContext => ({
  settings: { configured: true, enabled: true },
  page: { domain: "example.com", incognito: false, excludedDomains: [] },
  provenance: "missing",
  ...overrides,
});

describe("AI eligibility (design §2.1, FR-003, D-012)", () => {
  it("is eligible only when configured, enabled, on an eligible page, and locally unresolved", () => {
    expect(eligible("SLO", configuredContext())).toBe(true);
  });

  it("is ineligible when no credential is configured", () => {
    const context = configuredContext({ settings: { configured: false, enabled: true } });

    expect(evaluateEligibility("SLO", context)).toEqual({ eligible: false, reason: "not-configured" });
  });

  it("is ineligible when the reader turned the feature off", () => {
    const context = configuredContext({ settings: { configured: true, enabled: false } });

    expect(evaluateEligibility("SLO", context)).toEqual({ eligible: false, reason: "disabled" });
  });

  it("is ineligible on a private or incognito page", () => {
    const context = configuredContext({ page: { domain: "example.com", incognito: true, excludedDomains: [] } });

    expect(evaluateEligibility("SLO", context)).toEqual({ eligible: false, reason: "private-page" });
  });

  it("is ineligible on an excluded domain, reusing the existing exclusion rule", () => {
    const context = configuredContext({ page: { domain: "Example.COM ", incognito: false, excludedDomains: [" example.com"] } });

    expect(evaluateEligibility("SLO", context)).toEqual({ eligible: false, reason: "excluded-domain" });
    expect(isExcludedDomain("Example.COM ", [" example.com"])).toBe(true);
    expect(isExcludedDomain("other.com", ["example.com"])).toBe(false);
  });

  it("is ineligible for a term whose local meaning stands", () => {
    for (const provenance of ["bundled", "source", "inferred"] as const) {
      expect(evaluateEligibility("idempotent", configuredContext({ provenance })))
        .toEqual({ eligible: false, reason: "local-meaning-stands" });
    }
  });

  it("becomes eligible when the reader explicitly rejects the local meaning", () => {
    const rejectedSenses = createRejectedSenseSignal();
    const context = configuredContext({ provenance: "bundled", rejectedSenses });

    expect(eligible("idempotent", context)).toBe(false);
    rejectedSenses.reject("Idempotent");
    expect(eligible("idempotent", context)).toBe(true);
  });

  it("keeps the page gate independent of configuration", () => {
    expect(pageEligible({ domain: "example.com", incognito: false, excludedDomains: [] })).toBe(true);
    expect(pageEligible({ domain: "example.com", incognito: true, excludedDomains: [] })).toBe(false);
    expect(pageEligible({ domain: "example.com", incognito: false, excludedDomains: ["example.com"] })).toBe(false);
  });

  it("never becomes eligible on a private page even when the local sense was rejected", () => {
    const rejectedSenses = createRejectedSenseSignal();
    rejectedSenses.reject("idempotent");
    const context = configuredContext({
      provenance: "bundled",
      page: { domain: "example.com", incognito: true, excludedDomains: [] },
      rejectedSenses,
    });

    expect(evaluateEligibility("idempotent", context)).toEqual({ eligible: false, reason: "private-page" });
  });
});

describe("rejected-sense signal (SA-003)", () => {
  const storageWrites: unknown[] = [];

  beforeEach(() => {
    storageWrites.length = 0;
    Object.assign(globalThis, {
      chrome: {
        storage: {
          local: {
            set: (value: unknown) => {
              storageWrites.push(value);
              return Promise.resolve();
            },
            get: () => Promise.resolve({}),
            remove: (value: unknown) => {
              storageWrites.push(value);
              return Promise.resolve();
            },
          },
        },
      },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    Reflect.deleteProperty(globalThis, "chrome");
  });

  it("records and clears the gesture in memory only", () => {
    const signal = createRejectedSenseSignal();

    expect(signal.isRejected("SLO")).toBe(false);
    signal.reject("  SLO  ");
    expect(signal.isRejected("slo")).toBe(true);
    signal.restore("SLO");
    expect(signal.isRejected("SLO")).toBe(false);

    signal.reject("SLO");
    signal.clear();
    expect(signal.isRejected("SLO")).toBe(false);
  });

  it("writes nothing to IndexedDB or chrome.storage", () => {
    const openSpy = vi.spyOn(indexedDB, "open");
    const signal = createRejectedSenseSignal();

    signal.reject("SLO");
    signal.isRejected("SLO");
    signal.restore("SLO");
    signal.clear();

    expect(openSpy).not.toHaveBeenCalled();
    expect(storageWrites).toEqual([]);
  });

  it("does not survive a new session", () => {
    const firstSession = createRejectedSenseSignal();
    firstSession.reject("SLO");

    const secondSession = createRejectedSenseSignal();

    expect(secondSession.isRejected("SLO")).toBe(false);
  });

  it("ignores an empty gesture", () => {
    const signal = createRejectedSenseSignal();

    signal.reject("   ");

    expect(signal.isRejected("")).toBe(false);
  });
});
