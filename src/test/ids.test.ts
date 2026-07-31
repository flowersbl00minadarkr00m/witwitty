import { describe, expect, it } from "vitest";
import { stableId } from "../data/ids";

describe("stableId", () => {
  it("is deterministic and case-insensitive", () => {
    expect(stableId("term", "Idempotent")).toBe(stableId("term", "idempotent"));
  });

  it("keeps namespaces distinct", () => {
    expect(stableId("term", "idempotent")).not.toBe(stableId("sense", "idempotent"));
  });
});
