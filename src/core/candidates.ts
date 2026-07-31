import { BUNDLED_TERMINOLOGY, type TerminologyEntry } from "./terminology";

export type CandidateSignal =
  | "bundled-term"
  | "domain-match"
  | "multi-word"
  | "repeated"
  | "acronym"
  | "defined-on-page";

export interface CandidateEvidence {
  signal: CandidateSignal;
  weight: number;
  detail: string;
}

export interface ReadableTextBlock {
  text: string;
  tagName: string;
}

export interface TermCandidate {
  term: string;
  aliases: string[];
  score: number;
  occurrences: number;
  evidence: CandidateEvidence[];
  entry?: TerminologyEntry;
}

export interface CandidateOptions {
  domainHints?: string[];
  knownTerms?: string[];
  notJargonTerms?: string[];
  limit?: number;
}

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const normalize = (value: string) => value.trim().toLocaleLowerCase();
const commonAcronyms = new Set(["HTML", "HTTP", "HTTPS", "URL", "CSS", "PDF", "FAQ"]);

const countMatches = (text: string, labels: string[]) => {
  const pattern = new RegExp(`\\b(?:${labels.map(escapeRegExp).join("|")})\\b`, "gi");
  return [...text.matchAll(pattern)].length;
};

const pageDefinesTerm = (text: string, labels: string[]) => labels.some((label) => {
  const escaped = escapeRegExp(label);
  return new RegExp(`\\b${escaped}\\b\\s+(?:is defined as|means|refers to|describes)\\b`, "i").test(text);
});

const addBundledCandidate = (
  entry: TerminologyEntry,
  pageText: string,
  domainHints: Set<string>,
): TermCandidate | null => {
  const labels = [entry.term, ...entry.aliases];
  const occurrences = countMatches(pageText, labels);
  if (occurrences === 0) return null;

  const evidence: CandidateEvidence[] = [{ signal: "bundled-term", weight: 5, detail: "Found in the reviewed local terminology bundle." }];
  if (labels.some((label) => label.includes(" "))) evidence.push({ signal: "multi-word", weight: 0.75, detail: "A multi-word concept is more likely to carry a specialized meaning." });
  if (occurrences > 1) evidence.push({ signal: "repeated", weight: Math.min(1.5, (occurrences - 1) * 0.5), detail: `Appears ${occurrences} times on this page.` });

  const matchingDomains = new Set(entry.senses.flatMap((sense) => sense.domains).filter((domain) => domainHints.has(domain)));
  if (matchingDomains.size > 0) evidence.push({ signal: "domain-match", weight: 2, detail: `Page signals match ${[...matchingDomains].join(", ")}.` });

  if (pageDefinesTerm(pageText, labels)) evidence.push({ signal: "defined-on-page", weight: -10, detail: "The page appears to define this term directly." });
  const score = evidence.reduce((total, item) => total + item.weight, 0);
  return { term: entry.term, aliases: entry.aliases, score, occurrences, evidence, entry };
};

const findAcronymCandidates = (pageText: string): TermCandidate[] => {
  const matches = pageText.match(/\b[A-Z][A-Z0-9]{2,7}\b/g) ?? [];
  const counts = new Map<string, number>();
  for (const match of matches) {
    if (!commonAcronyms.has(match)) counts.set(match, (counts.get(match) ?? 0) + 1);
  }
  return [...counts.entries()].map(([term, occurrences]) => ({
    term,
    aliases: [],
    occurrences,
    score: 4 + Math.min(1, Math.max(0, occurrences - 1) * 0.5),
    evidence: [
      { signal: "acronym", weight: 4, detail: "An unexplained acronym may block comprehension." },
      ...(occurrences > 1 ? [{ signal: "repeated" as const, weight: Math.min(1, (occurrences - 1) * 0.5), detail: `Appears ${occurrences} times on this page.` }] : []),
    ],
  }));
};

export const rankCandidates = (blocks: ReadableTextBlock[], options: CandidateOptions = {}): TermCandidate[] => {
  const pageText = blocks.map((block) => block.text).join("\n").replace(/\s+/g, " ").trim();
  const domainHints = new Set((options.domainHints ?? []).map(normalize));
  const knownTerms = new Set((options.knownTerms ?? []).map(normalize));
  const notJargonTerms = new Set((options.notJargonTerms ?? []).map(normalize));
  const bundled = BUNDLED_TERMINOLOGY.map((entry) => addBundledCandidate(entry, pageText, domainHints)).filter((candidate): candidate is TermCandidate => candidate !== null);
  const bundledLabels = new Set(BUNDLED_TERMINOLOGY.flatMap((entry) => [entry.term.toLocaleUpperCase(), ...entry.aliases.map((alias) => alias.toLocaleUpperCase())]));
  const acronyms = findAcronymCandidates(pageText).filter((candidate) => !bundledLabels.has(candidate.term.toLocaleUpperCase()));

  return [...bundled, ...acronyms]
    .filter((candidate) => !knownTerms.has(normalize(candidate.term)) && !notJargonTerms.has(normalize(candidate.term)))
    .filter((candidate) => candidate.score >= 4)
    .sort((left, right) => right.score - left.score || right.occurrences - left.occurrences || left.term.localeCompare(right.term))
    .slice(0, options.limit ?? 5);
};

export const inferDomainHints = (text: string): string[] => {
  const normalized = text.toLocaleLowerCase();
  const rules: Array<[string, RegExp]> = [
    ["software", /\b(?:api|code|database|distributed|operation|retry|software)\b/],
    ["systems", /\b(?:reliability|system|latency|service|trace)\b/],
    ["data", /\b(?:data|database|record|schema|query)\b/],
    ["philosophy", /\b(?:being|derrida|epistemology|philosophy|postmodern)\b/],
    ["psychology", /\b(?:cognition|mental|psychology|memory|learning)\b/],
    ["organization", /\b(?:organization|team|governance|workflow|stakeholder)\b/],
    ["design", /\b(?:design|interface|interaction|usability)\b/],
    ["ai", /\b(?:agent|artificial intelligence|language model|prompt)\b/],
  ];
  return rules.filter(([, pattern]) => pattern.test(normalized)).map(([domain]) => domain);
};
