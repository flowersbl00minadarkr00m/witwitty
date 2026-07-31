import type { ExplanationProvenance } from "../types";

export interface TerminologySense {
  definition: string;
  domains: string[];
  provenance: ExplanationProvenance;
  provenanceRef: string;
  confidence: number;
}

export interface TerminologyEntry {
  id: string;
  term: string;
  aliases: string[];
  simpler: string;
  senses: TerminologySense[];
}

export const BUNDLED_TERMINOLOGY: readonly TerminologyEntry[] = [
  {
    id: "term-idempotent",
    term: "idempotent",
    aliases: ["idempotency"],
    simpler: "safe to repeat",
    senses: [{
      definition: "Safe to repeat without creating another result.",
      domains: ["software", "systems", "data"],
      provenance: "bundled",
      provenanceRef: "witwitty-core-v1",
      confidence: 1,
    }],
  },
  {
    id: "term-eventual-consistency",
    term: "eventual consistency",
    aliases: [],
    simpler: "agreement after a delay",
    senses: [{
      definition: "Different parts of a system may update at different times, but are expected to agree later.",
      domains: ["software", "systems", "data"],
      provenance: "bundled",
      provenanceRef: "witwitty-core-v1",
      confidence: 1,
    }],
  },
  {
    id: "term-observability",
    term: "observability",
    aliases: [],
    simpler: "insight into how a system behaves",
    senses: [{
      definition: "The ability to understand a system from signals such as logs, metrics, and traces.",
      domains: ["software", "systems", "operations"],
      provenance: "bundled",
      provenanceRef: "witwitty-core-v1",
      confidence: 1,
    }],
  },
  {
    id: "term-provenance",
    term: "provenance",
    aliases: [],
    simpler: "where it came from",
    senses: [{
      definition: "A record of where information came from and how it changed.",
      domains: ["data", "research", "knowledge"],
      provenance: "bundled",
      provenanceRef: "witwitty-core-v1",
      confidence: 1,
    }],
  },
  {
    id: "term-semantic-drift",
    term: "semantic drift",
    aliases: [],
    simpler: "meaning changing over time",
    senses: [{
      definition: "A gradual change in what a word, label, or concept is understood to mean.",
      domains: ["language", "organization", "ai"],
      provenance: "bundled",
      provenanceRef: "witwitty-core-v1",
      confidence: 1,
    }],
  },
  {
    id: "term-affordance",
    term: "affordance",
    aliases: ["affordances"],
    simpler: "a clue about possible use",
    senses: [{
      definition: "A quality of an object or interface that suggests how it can be used.",
      domains: ["design", "product", "psychology"],
      provenance: "bundled",
      provenanceRef: "witwitty-core-v1",
      confidence: 1,
    }],
  },
  {
    id: "term-heuristic",
    term: "heuristic",
    aliases: ["heuristics"],
    simpler: "rule of thumb",
    senses: [{
      definition: "A practical rule of thumb used to reach a good-enough decision quickly.",
      domains: ["product", "design", "psychology", "computing"],
      provenance: "bundled",
      provenanceRef: "witwitty-core-v1",
      confidence: 1,
    }],
  },
  {
    id: "term-ontology",
    term: "ontology",
    aliases: ["ontologies"],
    simpler: "a model of what exists and how it relates",
    senses: [
      {
        definition: "A formal model of concepts, categories, and relationships in a knowledge domain.",
        domains: ["data", "knowledge", "ai", "computing"],
        provenance: "bundled",
        provenanceRef: "witwitty-core-v1",
        confidence: 0.98,
      },
      {
        definition: "The branch of philosophy concerned with what exists and the nature of being.",
        domains: ["philosophy"],
        provenance: "bundled",
        provenanceRef: "witwitty-core-v1",
        confidence: 0.98,
      },
    ],
  },
  {
    id: "term-schema",
    term: "schema",
    aliases: ["schemas"],
    simpler: "organizing structure",
    senses: [
      {
        definition: "A formal structure describing how data is organized and constrained.",
        domains: ["data", "software", "computing"],
        provenance: "bundled",
        provenanceRef: "witwitty-core-v1",
        confidence: 0.98,
      },
      {
        definition: "A mental framework used to organize and interpret information.",
        domains: ["psychology", "learning"],
        provenance: "bundled",
        provenanceRef: "witwitty-core-v1",
        confidence: 0.96,
      },
    ],
  },
] as const;

export const terminologyByTerm = new Map(
  BUNDLED_TERMINOLOGY.flatMap((entry) => [entry.term, ...entry.aliases].map((label) => [label, entry] as const)),
);
