import type { ActiveTerm, PriorEncounter, ReviewQueueItem } from "../types";

export const demoTerm: ActiveTerm = {
  term: "Idempotent",
  definition: "Safe to repeat without creating another result.",
  sentenceExcerpt:
    "A foundational practice is to make operations idempotent. When an operation can be repeated without changing the result beyond the initial application, retries and recovery become significantly safer.",
  source: {
    url: "https://example.com/articles/designing-reliable-systems",
    title: "Designing reliable systems",
    domain: "example.com",
  },
  provenance: "bundled",
  provenanceLabel: "Reviewed local definition",
  confidence: 1,
  simpler: "safe to repeat",
};

export const demoPriorEncounter: PriorEncounter = {
  encounterId: "encounter-demo-idempotent",
  senseId: "sense-demo-idempotent",
  title: "When idempotency saves the day",
  domain: "blog.systems.dev",
  dateLabel: "May 9, 2024",
  relativeLabel: "3 days ago",
  excerpt: "Idempotency is key for safe retries in unreliable environments…",
  sanitizedUrl: "https://blog.systems.dev/idempotency-saves-the-day",
  encounteredAt: "2024-05-09T12:00:00.000Z",
  definition: "An operation that can be repeated without changing the result after the first application.",
  provenanceLabel: "Reviewed local definition",
};

export const demoReviewItem: ReviewQueueItem = {
  termId: "term-demo-idempotent",
  canonicalText: "idempotent",
  definition: "Safe to repeat without creating another result.",
  provenanceLabel: "Reviewed local definition",
  sentenceExcerpt: "A foundational practice is to make operations idempotent so retries and recovery remain safe.",
  sourceTitle: "Designing reliable systems",
  sourceDomain: "example.com",
  sanitizedUrl: "https://example.com/articles/designing-reliable-systems",
  reviewState: {
    termId: "term-demo-idempotent",
    masteryState: "learning",
    successfulRecalls: 0,
    nextReviewAt: "2026-07-20T12:00:00.000Z",
    lastReviewedAt: null,
    updatedAt: "2026-07-19T12:00:00.000Z",
  },
};

export const demoAmbiguousTerm: ActiveTerm = {
  term: "Ontology",
  definition: "A formal model of concepts, categories, and relationships in a knowledge domain.",
  sentenceExcerpt: "Ontology shapes how categories relate, but the surrounding passage mixes data modeling with philosophy.",
  source: demoTerm.source,
  provenance: "bundled",
  provenanceLabel: "Reviewed local definition",
  confidence: 0.7,
  uncertainty: "This term has more than one plausible meaning here. Choose the sense that fits.",
  simpler: "a model of what exists and how it relates",
  alternatives: [
    { definition: "A formal model of concepts, categories, and relationships in a knowledge domain.", domain: "data" },
    { definition: "The branch of philosophy concerned with what exists and the nature of being.", domain: "philosophy" },
  ],
};

export const demoMissingTerm: ActiveTerm = {
  term: "SLO",
  definition: "No reviewed local explanation is available for this term yet.",
  sentenceExcerpt: "The SLO governs availability and is reviewed every quarter.",
  source: demoTerm.source,
  provenance: "missing",
  provenanceLabel: "No local definition",
  confidence: 0,
  uncertainty: "WitWitty detected a likely acronym but will not guess what it means.",
};
