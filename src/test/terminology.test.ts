import { describe, expect, it } from "vitest";
import { BUNDLED_TERMINOLOGY, terminologyByTerm } from "../core/terminology";

/**
 * The panel's Original -> Simpler toggle is a literal text swap (see
 * content/index.ts setTextMode): the term's on-page text is replaced
 * verbatim with `entry.simpler`, with no grammatical adjustment for the
 * surrounding sentence. So `simpler` must always be safe to drop into the
 * exact grammatical slot the term itself occupies.
 */
describe("bundled terminology simpler substitutions", () => {
  it("keeps the observability substitution grammatical when adjective-modified (S-006 regression)", () => {
    const entry = terminologyByTerm.get("observability");
    expect(entry?.simpler).toBe("insight into how a system behaves");

    const original = "Good observability makes each retry inspectable.";
    const simplified = original.replace(entry!.term, entry!.simpler);
    expect(simplified).toBe("Good insight into how a system behaves makes each retry inspectable.");
  });

  it("never substitutes a bare gerund clause, which reads as ungrammatical after an adjective", () => {
    // "Good seeing how a system behaves" (the original CHR-007 defect) is the
    // shape to guard against: a gerund clause dropped into a noun's slot.
    const bareGerund = /^(?:seeing|doing|being|having|making|running|working)\b/i;
    for (const entry of BUNDLED_TERMINOLOGY) {
      expect(entry.simpler).not.toMatch(bareGerund);
    }
  });
});
