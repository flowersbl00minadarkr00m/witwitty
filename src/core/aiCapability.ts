/**
 * Deterministic capability gate for AI contextual explanations.
 *
 * Feature 003 design §2.1 (eligibility), §7.1 (capability gate), §7.2 (private,
 * incognito, excluded). This module performs no network I/O, reads no
 * credential, and persists nothing.
 */

import type { ExplanationProvenance } from "../types";

/** Configuration state, supplied by the settings surface. The secret itself never reaches here. */
export interface AiCapabilitySettings {
  /** A credential exists and a live verification succeeded (FR-009). */
  configured: boolean;
  /** The reader has not turned the feature off (FR-008). */
  enabled: boolean;
}

/**
 * Page-context signals. These are the signals WitWitty already computes:
 * `tab.incognito` from the background service worker and the `excludedDomains`
 * preference list the content script already reads. AI adds no new privacy
 * predicate — it inherits these (design §7.2).
 */
export interface AiPageContext {
  domain: string;
  /** True for private/incognito windows, as already detected at the extension boundary. */
  incognito: boolean;
  /** The existing `excludedDomains` preference list. */
  excludedDomains: string[];
}

export interface AiEligibilityContext {
  settings: AiCapabilitySettings;
  page: AiPageContext;
  /** Provenance produced by the unchanged deterministic resolution (FR-002). */
  provenance: ExplanationProvenance;
  /** Session-scoped signal that the reader rejected the local meaning for this term. */
  rejectedSenses?: RejectedSenseSignal;
}

export type AiIneligibilityReason =
  | "not-configured"
  | "disabled"
  | "private-page"
  | "excluded-domain"
  | "local-meaning-stands";

export type AiEligibilityDecision =
  | { eligible: true }
  | { eligible: false; reason: AiIneligibilityReason };

/** Same normalization the content script already applies to domains and terms. */
const normalize = (value: string): string => value.trim().toLocaleLowerCase();

/** Reuses the existing exclusion rule; adds no new privacy predicate (FR-013). */
export const isExcludedDomain = (domain: string, excludedDomains: string[]): boolean =>
  excludedDomains.map(normalize).includes(normalize(domain));

/**
 * The reader's in-session "this local meaning doesn't fit here" gesture (SA-003).
 *
 * It is held in memory for the life of the panel and persists **nothing** — no
 * sense, no correction, no preference record. It deliberately does not pre-empt
 * Feature 002's correction contract (F03).
 */
export interface RejectedSenseSignal {
  reject: (term: string) => void;
  restore: (term: string) => void;
  isRejected: (term: string) => boolean;
  clear: () => void;
}

export const createRejectedSenseSignal = (): RejectedSenseSignal => {
  const rejected = new Set<string>();
  return {
    reject: (term) => {
      const key = normalize(term);
      if (key.length > 0) rejected.add(key);
    },
    restore: (term) => {
      rejected.delete(normalize(term));
    },
    isRejected: (term) => rejected.has(normalize(term)),
    clear: () => rejected.clear(),
  };
};

/** Page-level gate, evaluated before any affordance renders (design §7.2). */
export const pageEligible = (page: AiPageContext): boolean =>
  !page.incognito && !isExcludedDomain(page.domain, page.excludedDomains);

/**
 * Full eligibility decision (design §2.1). Returns the first failing branch so
 * each branch is independently testable.
 */
export const evaluateEligibility = (term: string, context: AiEligibilityContext): AiEligibilityDecision => {
  if (!context.settings.configured) return { eligible: false, reason: "not-configured" };
  if (!context.settings.enabled) return { eligible: false, reason: "disabled" };
  if (context.page.incognito) return { eligible: false, reason: "private-page" };
  if (isExcludedDomain(context.page.domain, context.page.excludedDomains)) {
    return { eligible: false, reason: "excluded-domain" };
  }

  const rejectedLocalSense = context.rejectedSenses?.isRejected(term) ?? false;
  if (context.provenance !== "missing" && !rejectedLocalSense) {
    return { eligible: false, reason: "local-meaning-stands" };
  }

  return { eligible: true };
};

/**
 * `eligible(term, context)` — the predicate that decides whether the AI
 * affordance may appear at all (FR-003, D-012).
 */
export const eligible = (term: string, context: AiEligibilityContext): boolean =>
  evaluateEligibility(term, context).eligible;
