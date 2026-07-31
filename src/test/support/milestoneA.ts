/**
 * Milestone A check — the reusable zero-egress and unconfigured-parity harness
 * for Feature 003 (design §7.1, §10.1, §10.3).
 *
 * Later phases invoke `runMilestoneACheck()` as a single named check. It adds no
 * product behaviour: it exercises the existing deterministic product surface
 * while every outbound transport is observed, and renders the unconfigured panel
 * for parity comparison.
 */

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ContextLensPanel } from "../../components/ContextLensPanel";
import { rankCandidates, type ReadableTextBlock } from "../../core/candidates";
import { createContextPacket, resolveLocalExplanation } from "../../core/explanations";
import { eligible } from "../../core/aiCapability";
import {
  deleteAllData,
  deleteDatabaseForTests,
  deleteSourcesByDomain,
  deleteTermByCanonicalText,
  exportLocalData,
  getDueReviewItems,
  getPriorEncounter,
  getStorageSummary,
  persistLearningAction,
  recordReviewOutcome,
  validateExport,
} from "../../data/db";
import type { ActiveTerm, PageSource } from "../../types";
import { installRequestObserver, type ObservedRequest } from "./requestObserver";

export const MILESTONE_A_CHECK = "milestone-a:zero-egress-and-unconfigured-parity";

export type UnconfiguredRenderState = "bundled" | "ambiguous" | "missing";

export const UNCONFIGURED_RENDER_STATES: readonly UnconfiguredRenderState[] = ["bundled", "ambiguous", "missing"];

const SOURCE: PageSource = {
  url: "https://example.com/articles/designing-reliable-systems",
  title: "Designing reliable systems",
  domain: "example.com",
};

const PASSAGES: Record<UnconfiguredRenderState, { text: string; domainHints: string[] }> = {
  bundled: { text: "An idempotent operation makes software retries safer.", domainHints: ["software"] },
  ambiguous: { text: "Ontology shapes how categories relate.", domainHints: [] },
  missing: { text: "The SLO applies to every service.", domainHints: ["systems"] },
};

const blocks = (text: string): ReadableTextBlock[] => [{ text, tagName: "P" }];

/** Builds an ActiveTerm through the unchanged deterministic path. */
export const unconfiguredActiveTerm = (state: UnconfiguredRenderState): ActiveTerm => {
  const passage = PASSAGES[state];
  const candidate = rankCandidates(blocks(passage.text), { domainHints: passage.domainHints })[0];
  if (!candidate) throw new Error(`No candidate produced for the ${state} state.`);
  const packet = createContextPacket(candidate.term, passage.text, SOURCE, passage.domainHints);
  return resolveLocalExplanation(candidate, packet, SOURCE);
};

/** Renders the panel exactly as an unconfigured reader sees it. */
export const renderUnconfiguredPanel = (state: UnconfiguredRenderState): string =>
  renderToStaticMarkup(createElement(ContextLensPanel, {
    demo: true,
    selectedTerm: unconfiguredActiveTerm(state),
    priorEncounter: null,
  }));

/**
 * Text that would only appear if an AI affordance rendered. None of it may
 * appear while unconfigured (UX-011, FR-010).
 */
export const AI_AFFORDANCE_MARKERS: readonly string[] = [
  "Explain with AI",
  "Explain this term here",
  "What gets sent",
  "ai-affordance",
  "proposal-region",
  "Contextual interpretation",
  "Before this is sent",
  "Suggested meaning to record",
  "provider key",
];

export interface MilestoneAReport {
  check: string;
  interactions: string[];
  requests: ObservedRequest[];
  renders: Record<UnconfiguredRenderState, string>;
  affordanceMarkersFound: string[];
  eligibleWhileUnconfigured: boolean;
}

/**
 * The single named Milestone A check. Exercises every listed interaction with
 * every outbound transport observed, and captures the unconfigured render for
 * parity comparison.
 */
export const runMilestoneACheck = async (): Promise<MilestoneAReport> => {
  await deleteDatabaseForTests();
  const observer = installRequestObserver();
  const interactions: string[] = [];
  const renders = {} as Record<UnconfiguredRenderState, string>;
  const affordanceMarkersFound: string[] = [];
  let eligibleWhileUnconfigured = false;

  const step = async (name: string, work: () => Promise<unknown> | unknown) => {
    await work();
    interactions.push(name);
  };

  try {
    await step("scan", () => rankCandidates(blocks(PASSAGES.bundled.text), { domainHints: ["software"], limit: 5 }));
    await step("term-select", () => createContextPacket("idempotent", PASSAGES.bundled.text, SOURCE, ["software"]));

    for (const state of UNCONFIGURED_RENDER_STATES) {
      await step(`${state}-sense`, () => unconfiguredActiveTerm(state));
      await step(`${state}-render`, () => {
        const markup = renderUnconfiguredPanel(state);
        renders[state] = markup;
        for (const marker of AI_AFFORDANCE_MARKERS) {
          if (markup.includes(marker)) affordanceMarkersFound.push(`${state}:${marker}`);
        }
      });
    }

    await step("capability-gate", () => {
      const term = unconfiguredActiveTerm("missing");
      eligibleWhileUnconfigured = eligible(term.term, {
        settings: { configured: false, enabled: false },
        page: { domain: SOURCE.domain, incognito: false, excludedDomains: [] },
        provenance: term.provenance,
      });
    });

    const savedTerm = unconfiguredActiveTerm("bundled");
    await step("save", () => persistLearningAction(savedTerm, "saved"));
    await step("got-it", () => persistLearningAction(unconfiguredActiveTerm("ambiguous"), "got-it"));
    await step("not-jargon", () => persistLearningAction(unconfiguredActiveTerm("missing"), "not-jargon"));
    await step("compare", () => getPriorEncounter(savedTerm.term));
    await step("review", async () => {
      const due = await getDueReviewItems(new Date(Date.now() + 1000 * 60 * 60 * 24 * 400));
      if (due[0]) await recordReviewOutcome(due[0].termId, "recalled");
    });
    await step("export", async () => validateExport(await exportLocalData()));
    await step("settings-open", () => getStorageSummary());
    await step("delete-term", () => deleteTermByCanonicalText(savedTerm.term));
    await step("delete-site", () => deleteSourcesByDomain(SOURCE.domain));
    await step("delete-all", () => deleteAllData());
  } finally {
    observer.restore();
  }

  const report: MilestoneAReport = {
    check: MILESTONE_A_CHECK,
    interactions,
    requests: [...observer.requests],
    renders,
    affordanceMarkersFound,
    eligibleWhileUnconfigured,
  };

  await deleteDatabaseForTests();
  return report;
};

export const MILESTONE_A_INTERACTIONS: readonly string[] = [
  "scan",
  "term-select",
  "bundled-sense",
  "bundled-render",
  "ambiguous-sense",
  "ambiguous-render",
  "missing-sense",
  "missing-render",
  "capability-gate",
  "save",
  "got-it",
  "not-jargon",
  "compare",
  "review",
  "export",
  "settings-open",
  "delete-term",
  "delete-site",
  "delete-all",
];
