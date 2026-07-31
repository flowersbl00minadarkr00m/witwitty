// @vitest-environment node
import "fake-indexeddb/auto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  UNCONFIGURED_RENDER_STATES,
  renderUnconfiguredPanel,
  unconfiguredActiveTerm,
  type UnconfiguredRenderState,
} from "./support/milestoneA";

const baselinePath = (state: UnconfiguredRenderState): string =>
  fileURLToPath(new URL(`../../evidence/003-ai-contextual-explanation/milestone-a/unconfigured-${state}.html`, import.meta.url));

/**
 * Captured before any test body runs. A recorded baseline must already be under
 * version control — a later phase cannot make itself pass by regenerating one.
 */
const baselinesPresentAtStartup = Object.fromEntries(
  UNCONFIGURED_RENDER_STATES.map((state) => [state, existsSync(baselinePath(state))]),
) as Record<UnconfiguredRenderState, boolean>;

const readOrSeedBaseline = (state: UnconfiguredRenderState, markup: string): string => {
  const path = baselinePath(state);
  if (!existsSync(path)) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, markup, "utf8");
  }
  return readFileSync(path, "utf8");
};

describe("Milestone A — unconfigured render parity (FR-010, UX-011)", () => {
  it("keeps a recorded pre-feature baseline for every state", () => {
    expect(baselinesPresentAtStartup).toEqual({ bundled: true, ambiguous: true, missing: true });
  });

  for (const state of UNCONFIGURED_RENDER_STATES) {
    it(`renders the ${state} state byte-identically to the recorded baseline`, () => {
      const markup = renderUnconfiguredPanel(state);

      expect(markup).toBe(readOrSeedBaseline(state, markup));
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
