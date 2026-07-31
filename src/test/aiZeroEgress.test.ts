// @vitest-environment node
import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import {
  MILESTONE_A_CHECK,
  MILESTONE_A_INTERACTIONS,
  runMilestoneACheck,
  type MilestoneAReport,
} from "./support/milestoneA";
import { installRequestObserver } from "./support/requestObserver";

let report: MilestoneAReport | undefined;

const milestoneA = async (): Promise<MilestoneAReport> => {
  report ??= await runMilestoneACheck();
  return report;
};

describe("the request observer itself", () => {
  it("records and fails loudly on a fetch attempt", () => {
    const observer = installRequestObserver();
    try {
      expect(() => (globalThis.fetch as (input: string) => unknown)("https://example.invalid/v1"))
        .toThrow(/Zero-egress violation/);
      expect(observer.requests).toEqual([{ transport: "fetch", detail: "https://example.invalid/v1" }]);
    } finally {
      observer.restore();
    }
  });

  it("records and fails loudly on an XMLHttpRequest attempt", () => {
    const observer = installRequestObserver();
    try {
      const XhrCtor = (globalThis as unknown as { XMLHttpRequest: new () => { open: (method: string, url: string) => void } }).XMLHttpRequest;
      expect(() => new XhrCtor().open("POST", "https://example.invalid/v1")).toThrow(/Zero-egress violation/);
      expect(observer.requests).toEqual([{ transport: "XMLHttpRequest", detail: "https://example.invalid/v1" }]);
    } finally {
      observer.restore();
    }
  });

  it("records and fails loudly on a WebSocket attempt", () => {
    const observer = installRequestObserver();
    try {
      const SocketCtor = (globalThis as unknown as { WebSocket: new (url: string) => unknown }).WebSocket;
      expect(() => new SocketCtor("wss://example.invalid")).toThrow(/Zero-egress violation/);
      expect(observer.requests).toHaveLength(1);
    } finally {
      observer.restore();
    }
  });

  it("restores every global it replaced", () => {
    const originalFetch = globalThis.fetch;

    const observer = installRequestObserver();
    expect(globalThis.fetch).not.toBe(originalFetch);
    observer.restore();

    expect(globalThis.fetch).toBe(originalFetch);
  });
});

describe("Milestone A — unconfigured network silence (FR-010, SM-005)", () => {
  it("exercises every listed interaction", async () => {
    const result = await milestoneA();

    expect(result.check).toBe(MILESTONE_A_CHECK);
    expect(result.interactions).toEqual([...MILESTONE_A_INTERACTIONS]);
  });

  it("observes zero outbound requests across every interaction", async () => {
    const result = await milestoneA();

    expect(result.requests).toEqual([]);
  });

  it("renders no AI affordance anywhere while unconfigured", async () => {
    const result = await milestoneA();

    expect(result.affordanceMarkersFound).toEqual([]);
  });

  it("reports the term ineligible while unconfigured", async () => {
    const result = await milestoneA();

    expect(result.eligibleWhileUnconfigured).toBe(false);
  });

  it("is invocable as a single named check by later tickets", async () => {
    const result = await milestoneA();

    expect(MILESTONE_A_CHECK).toBe("milestone-a:zero-egress-and-unconfigured-parity");
    expect(Object.keys(result.renders).sort()).toEqual(["ambiguous", "bundled", "missing"]);
  });
});
