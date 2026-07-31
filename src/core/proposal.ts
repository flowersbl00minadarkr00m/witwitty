/**
 * Deterministic proposal contract for AI contextual explanations.
 *
 * Feature 003 design §5.2 (ProposalV1), §5.3 (validation), §3.5 (confidence
 * policy). This module performs no network I/O, handles no credential, and is
 * fully testable with no provider configured.
 */

export type ConfidenceBand = "low" | "moderate" | "high";
export type ProposalOutcome = "proposed" | "insufficient-evidence";

export interface ProposalEvidence {
  /** Verbatim quote from the excerpt that was sent. Optional; observations may stand alone. */
  quote?: string;
  observation: string;
}

export interface ProposalInference {
  statement: string;
  groundedInPassage: boolean;
}

export interface ProposalRecommendation {
  definition: string;
}

export interface ProposalAlternative {
  definition: string;
  domain: string;
  why: string;
}

export interface ProposalModel {
  providerId: string;
  modelId: string;
}

export interface ProposalV1 {
  outcome: ProposalOutcome;
  evidence: ProposalEvidence[];
  inference: ProposalInference[];
  recommendation: ProposalRecommendation | null;
  alternatives: ProposalAlternative[];
  confidence: ConfidenceBand;
  limits: string[];
  wouldImprove: string[];
  model: ProposalModel;
}

export const CONFIDENCE_BANDS: readonly ConfidenceBand[] = ["low", "moderate", "high"];

/** Sane size bound for a single response payload (design §5.3, last rejection case). */
export const MAX_PROPOSAL_PAYLOAD_CHARS = 16_000;

export type ProposalRejectionReason =
  | "unparseable"
  | "missing-recommendation"
  | "recommendation-despite-insufficient-evidence"
  | "invalid-confidence"
  | "fabricated-quote"
  | "payload-too-large";

export interface ProposalValidationContext {
  /** The excerpt that was actually transmitted, used for the fabrication check. */
  sentenceExcerpt: string;
}

export type ProposalValidation =
  | { ok: true; proposal: ProposalV1 }
  | { ok: false; reason: ProposalRejectionReason; detail: string };

const reject = (reason: ProposalRejectionReason, detail: string): ProposalValidation => ({ ok: false, reason, detail });

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isNonEmptyString = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((entry) => isNonEmptyString(entry));

/**
 * Normalization for the fabrication check only. Collapses whitespace, folds
 * typographic quotes and dashes, and lowercases, so that a faithful quote is not
 * rejected over punctuation the model re-rendered.
 */
const normalizeForQuoteMatch = (value: string): string =>
  value
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase();

/** Strips leading/trailing quotation marks and elision markers a model may add around a quote. */
const trimQuoteDecoration = (value: string): string =>
  value.replace(/^[\s"'.]+/, "").replace(/[\s"'.]+$/, "");

const isEvidenceEntry = (value: unknown): value is ProposalEvidence => {
  if (!isRecord(value)) return false;
  if (!isNonEmptyString(value.observation)) return false;
  if (value.quote !== undefined && !isNonEmptyString(value.quote)) return false;
  return true;
};

const isInferenceEntry = (value: unknown): value is ProposalInference =>
  isRecord(value) && isNonEmptyString(value.statement) && typeof value.groundedInPassage === "boolean";

const isAlternativeEntry = (value: unknown): value is ProposalAlternative =>
  isRecord(value) && isNonEmptyString(value.definition) && isNonEmptyString(value.domain) && isNonEmptyString(value.why);

const isModel = (value: unknown): value is ProposalModel =>
  isRecord(value) && isNonEmptyString(value.providerId) && isNonEmptyString(value.modelId);

const isRecommendationShape = (value: unknown): boolean =>
  value === null || value === undefined || (isRecord(value) && (value.definition === undefined || typeof value.definition === "string"));

const hasRecommendation = (value: unknown): boolean => isRecord(value) && isNonEmptyString(value.definition);

/**
 * Validates a raw adapter response wholesale (AI-010). A response is either
 * fully renderable or rejected with a reason; it is never partially salvaged.
 */
export const validate = (raw: unknown, context: ProposalValidationContext): ProposalValidation => {
  let candidate: unknown = raw;

  if (typeof candidate === "string") {
    if (candidate.length > MAX_PROPOSAL_PAYLOAD_CHARS) {
      return reject("payload-too-large", `Response exceeded ${MAX_PROPOSAL_PAYLOAD_CHARS} characters.`);
    }
    try {
      candidate = JSON.parse(candidate) as unknown;
    } catch {
      return reject("unparseable", "Response was not parseable JSON.");
    }
  }

  if (!isRecord(candidate)) return reject("unparseable", "Response was not an object.");

  let serializedLength: number;
  try {
    serializedLength = JSON.stringify(candidate)?.length ?? 0;
  } catch {
    return reject("unparseable", "Response could not be serialized for size checking.");
  }
  if (serializedLength > MAX_PROPOSAL_PAYLOAD_CHARS) {
    return reject("payload-too-large", `Response exceeded ${MAX_PROPOSAL_PAYLOAD_CHARS} characters.`);
  }

  if (candidate.outcome !== "proposed" && candidate.outcome !== "insufficient-evidence") {
    return reject("unparseable", "Response outcome was absent or unrecognized.");
  }
  if (!Array.isArray(candidate.evidence) || !candidate.evidence.every(isEvidenceEntry)) {
    return reject("unparseable", "Response evidence was absent or malformed.");
  }
  if (!Array.isArray(candidate.inference) || !candidate.inference.every(isInferenceEntry)) {
    return reject("unparseable", "Response inference was absent or malformed.");
  }
  if (!Array.isArray(candidate.alternatives) || !candidate.alternatives.every(isAlternativeEntry)) {
    return reject("unparseable", "Response alternatives were absent or malformed.");
  }
  if (!isStringArray(candidate.limits)) return reject("unparseable", "Response limits were absent or malformed.");
  if (!isStringArray(candidate.wouldImprove)) return reject("unparseable", "Response wouldImprove was absent or malformed.");
  if (!isModel(candidate.model)) return reject("unparseable", "Response model attribution was absent or malformed.");
  if (!isRecommendationShape(candidate.recommendation)) {
    return reject("unparseable", "Response recommendation was malformed.");
  }

  if (typeof candidate.confidence !== "string" || !CONFIDENCE_BANDS.includes(candidate.confidence as ConfidenceBand)) {
    return reject("invalid-confidence", "Response confidence was absent or outside the band set.");
  }

  const recommendationPresent = hasRecommendation(candidate.recommendation);
  if (candidate.outcome === "proposed" && !recommendationPresent) {
    return reject("missing-recommendation", "A proposed outcome carried no recommendation.");
  }
  if (candidate.outcome === "insufficient-evidence" && recommendationPresent) {
    return reject(
      "recommendation-despite-insufficient-evidence",
      "An insufficient-evidence outcome carried a recommendation.",
    );
  }

  const excerpt = normalizeForQuoteMatch(context.sentenceExcerpt);
  for (const entry of candidate.evidence as ProposalEvidence[]) {
    if (entry.quote === undefined) continue;
    const quote = trimQuoteDecoration(normalizeForQuoteMatch(entry.quote));
    if (quote.length === 0 || !excerpt.includes(quote)) {
      return reject("fabricated-quote", "An evidence entry quoted text absent from the transmitted excerpt.");
    }
  }

  const evidence = candidate.evidence as ProposalEvidence[];
  const proposal: ProposalV1 = {
    outcome: candidate.outcome,
    evidence: evidence.map((entry) => (entry.quote === undefined
      ? { observation: entry.observation }
      : { quote: entry.quote, observation: entry.observation })),
    inference: (candidate.inference as ProposalInference[]).map((entry) => ({
      statement: entry.statement,
      groundedInPassage: entry.groundedInPassage,
    })),
    recommendation: recommendationPresent
      ? { definition: (candidate.recommendation as ProposalRecommendation).definition }
      : null,
    alternatives: (candidate.alternatives as ProposalAlternative[]).map((entry) => ({
      definition: entry.definition,
      domain: entry.domain,
      why: entry.why,
    })),
    confidence: candidate.confidence as ConfidenceBand,
    limits: [...(candidate.limits as string[])],
    wouldImprove: [...(candidate.wouldImprove as string[])],
    model: { providerId: (candidate.model as ProposalModel).providerId, modelId: (candidate.model as ProposalModel).modelId },
  };

  return { ok: true, proposal };
};

export type ProposalRegion = "evidence" | "limits" | "inference" | "recommendation";

export interface ProposalPresentationPolicy {
  band: ConfidenceBand;
  /** Order the regions are rendered in (design §3.5). */
  regionOrder: readonly ProposalRegion[];
  recommendationHeading: string;
  recommendationEmphasis: "normal" | "reduced";
  /** Which action receives default focus when the proposal arrives. */
  defaultFocus: "accept" | "discard";
  alternativesExpanded: boolean;
  limitsRequired: boolean;
  /** Textual confidence statement (AI-003 — never colour or glyph alone). */
  confidenceLabel: string;
}

/**
 * The confidence-band → presentation policy as pure data (AI-004). The model's
 * own wording cannot change any of these values; only the band selects a row.
 */
export const PROPOSAL_PRESENTATION_POLICY: Readonly<Record<ConfidenceBand, ProposalPresentationPolicy>> = Object.freeze({
  high: Object.freeze({
    band: "high",
    regionOrder: Object.freeze(["evidence", "inference", "recommendation"] as const),
    recommendationHeading: "Suggested meaning to record",
    recommendationEmphasis: "normal",
    defaultFocus: "accept",
    alternativesExpanded: false,
    limitsRequired: false,
    confidenceLabel: "Confidence: high",
  }) as ProposalPresentationPolicy,
  moderate: Object.freeze({
    band: "moderate",
    regionOrder: Object.freeze(["evidence", "inference", "recommendation"] as const),
    recommendationHeading: "Suggested meaning to record",
    recommendationEmphasis: "normal",
    defaultFocus: "accept",
    alternativesExpanded: false,
    limitsRequired: false,
    confidenceLabel: "Confidence: moderate",
  }) as ProposalPresentationPolicy,
  low: Object.freeze({
    band: "low",
    regionOrder: Object.freeze(["evidence", "limits", "inference", "recommendation"] as const),
    recommendationHeading: "A possible meaning — weak support",
    recommendationEmphasis: "reduced",
    defaultFocus: "discard",
    alternativesExpanded: true,
    limitsRequired: true,
    confidenceLabel: "Confidence: low",
  }) as ProposalPresentationPolicy,
});

/** Selects the presentation policy from the band alone (AI-004). */
export const presentationPolicyFor = (proposal: Pick<ProposalV1, "confidence">): ProposalPresentationPolicy =>
  PROPOSAL_PRESENTATION_POLICY[proposal.confidence];

/**
 * Band → the existing numeric `confidence` field on `SenseRecord`, used only
 * when a reader accepts a proposal. Bands stay authoritative for presentation;
 * this mapping exists for storage compatibility (design §5.2).
 */
export const CONFIDENCE_BAND_VALUES: Readonly<Record<ConfidenceBand, number>> = Object.freeze({
  low: 0.3,
  moderate: 0.6,
  high: 0.75,
});

export const confidenceValueForBand = (band: ConfidenceBand): number => CONFIDENCE_BAND_VALUES[band];
