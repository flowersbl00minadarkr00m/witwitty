// @vitest-environment node
import "fake-indexeddb/auto";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  UNCONFIGURED_RENDER_STATES,
  renderUnconfiguredPanel,
  unconfiguredActiveTerm,
  type UnconfiguredRenderState,
} from "./support/milestoneA";

const BASELINE_SHA256: Record<UnconfiguredRenderState, string> = {
  bundled: "fac62427935c990f45c14073594a7f44a756f7a6b58a4da0125b93de4b6cee19",
  ambiguous: "1259900578f515bf65e6b13ac9b9d458fc2e8fb98a2ec5fb6e2ca8390f65ac65",
  missing: "3a99f0bfa044afbc512574a6030667eab9ee67dac1328b138033ee64de6fb783",
};

const sha256 = (value: string): string => createHash("sha256").update(value).digest("hex");

describe("Milestone A — unconfigured render parity (FR-010, UX-011)", () => {
  it("keeps a recorded pre-feature baseline digest for every state", () => {
    expect(Object.keys(BASELINE_SHA256).sort()).toEqual([...UNCONFIGURED_RENDER_STATES].sort());
  });

  for (const state of UNCONFIGURED_RENDER_STATES) {
    it(`renders the ${state} state byte-identically to the recorded baseline`, () => {
      const markup = renderUnconfiguredPanel(state);

      expect(sha256(markup)).toBe(BASELINE_SHA256[state]);
    });
  }

  it("renders deterministically across repeated invocations", () => {
    for (const state of UNCONFIGURED_RENDER_STATES) {
      expect(renderUnconfiguredPanel(state)).toBe(renderUnconfiguredPanel(state));
    }
  });

  it("keeps the deterministic resolution of each state unchanged", () => {
    expect(unconfiguredActiveTerm("bundled").provenance).toBe("bundled");
    expect(unconfiguredActiveTerm("bundled").provenanceLabel).toBe("Reviewed local definition");

    const ambiguous = unconfiguredActiveTerm("ambiguous");
    expect(ambiguous.uncertainty).toContain("more than one plausible meaning");
    expect(ambiguous.alternatives).toHaveLength(2);

    const missing = unconfiguredActiveTerm("missing");
    expect(missing.provenance).toBe("missing");
    expect(missing.definition).toBe("No reviewed local explanation is available for this term yet.");
  });

  it("does not present the unconfigured surface as an error", () => {
    for (const state of UNCONFIGURED_RENDER_STATES) {
      const markup = renderUnconfiguredPanel(state);
      expect(markup).not.toContain('role="alert"');
      expect(markup).not.toContain("storage-error");
      expect(markup).not.toMatch(/unavailable|failed|problem/i);
    }
  });
});
