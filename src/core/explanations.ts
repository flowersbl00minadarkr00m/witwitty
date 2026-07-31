import type { ActiveTerm, ExplanationAlternative, ExplanationProvenance, PageSource } from "../types";
import type { TermCandidate } from "./candidates";

export interface ContextPacket {
  term: string;
  sentenceExcerpt: string;
  pageTitle: string;
  domain: string;
  domainHints: string[];
}

export interface AdapterExplanation {
  definition: string;
  confidence: number;
  provenance: "inferred";
  modelLabel: string;
}

export interface ExplanationAdapter {
  explain(packet: ContextPacket): Promise<AdapterExplanation>;
}

export const createContextPacket = (
  term: string,
  sentenceExcerpt: string,
  source: PageSource,
  domainHints: string[],
): ContextPacket => ({
  term: term.slice(0, 100),
  sentenceExcerpt: sentenceExcerpt.replace(/\s+/g, " ").trim().slice(0, 280),
  pageTitle: source.title.replace(/\s+/g, " ").trim().slice(0, 160),
  domain: source.domain.slice(0, 120),
  domainHints: domainHints.slice(0, 8),
});

const labelForProvenance = (provenance: ExplanationProvenance, reference?: string) => {
  if (provenance === "bundled") return "Reviewed local definition";
  if (provenance === "source") return "Defined by this source";
  if (provenance === "inferred") return reference ? `Model inference · ${reference}` : "Model inference";
  return "No local definition";
};

export const resolveLocalExplanation = (
  candidate: TermCandidate,
  packet: ContextPacket,
  source: PageSource,
): ActiveTerm => {
  const entry = candidate.entry;
  if (!entry) {
    return {
      term: candidate.term,
      definition: "No reviewed local explanation is available for this term yet.",
      sentenceExcerpt: packet.sentenceExcerpt,
      source,
      provenance: "missing",
      provenanceLabel: labelForProvenance("missing"),
      confidence: 0,
      uncertainty: "WitWitty detected a likely acronym but will not guess what it means.",
    };
  }

  const rankedSenses = entry.senses.map((sense) => ({
    sense,
    overlap: sense.domains.filter((domain) => packet.domainHints.includes(domain)).length,
  })).sort((left, right) => right.overlap - left.overlap || right.sense.confidence - left.sense.confidence);
  const best = rankedSenses[0];
  const next = rankedSenses[1];
  const ambiguous = Boolean(next && best.overlap === next.overlap);
  const alternatives: ExplanationAlternative[] | undefined = ambiguous
    ? rankedSenses.map(({ sense }) => ({ definition: sense.definition, domain: sense.domains[0] ?? "general" }))
    : undefined;

  return {
    term: entry.term,
    definition: best.sense.definition,
    sentenceExcerpt: packet.sentenceExcerpt,
    source,
    provenance: best.sense.provenance,
    provenanceLabel: labelForProvenance(best.sense.provenance, best.sense.provenanceRef),
    confidence: ambiguous ? Math.min(best.sense.confidence, 0.7) : best.sense.confidence,
    uncertainty: ambiguous ? "This term has more than one plausible meaning here. Choose the sense that fits." : undefined,
    simpler: entry.simpler,
    alternatives,
  };
};
