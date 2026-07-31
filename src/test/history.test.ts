import { describe, expect, it } from "vitest";
import { formatEncounterDate, formatRelativeEncounter } from "../data/history";

describe("encounter time labels", () => {
  const now = new Date("2026-07-20T12:00:00.000Z");

  it("uses compact relative labels for recent encounters", () => {
    expect(formatRelativeEncounter("2026-07-20T11:59:30.000Z", now)).toBe("Just now");
    expect(formatRelativeEncounter("2026-07-20T11:45:00.000Z", now)).toBe("15 min ago");
    expect(formatRelativeEncounter("2026-07-20T10:00:00.000Z", now)).toBe("2 hrs ago");
    expect(formatRelativeEncounter("2026-07-18T12:00:00.000Z", now)).toBe("2 days ago");
  });

  it("falls back to an absolute date for older or invalid history", () => {
    expect(formatRelativeEncounter("2026-07-01T12:00:00.000Z", now)).toBe("Jul 1, 2026");
    expect(formatEncounterDate("invalid")).toBe("Unknown date");
    expect(formatRelativeEncounter("invalid", now)).toBe("Previously seen");
  });
});
