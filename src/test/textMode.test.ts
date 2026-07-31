import { describe, expect, it } from "vitest";
import { requiresSimplificationConfirmation, SIMPLIFICATION_CONFIDENCE_THRESHOLD } from "../core/textMode";

describe("simplification confidence policy", () => {
  it("allows reviewed high-confidence substitutions directly", () => {
    expect(requiresSimplificationConfirmation(1)).toBe(false);
    expect(requiresSimplificationConfirmation(SIMPLIFICATION_CONFIDENCE_THRESHOLD)).toBe(false);
  });

  it("requires confirmation when nuance is uncertain", () => {
    expect(requiresSimplificationConfirmation(0.79)).toBe(true);
    expect(requiresSimplificationConfirmation(0)).toBe(true);
    expect(requiresSimplificationConfirmation(Number.NaN)).toBe(true);
  });
});
