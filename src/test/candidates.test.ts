import { describe, expect, it } from "vitest";
import { inferDomainHints, rankCandidates, type ReadableTextBlock } from "../core/candidates";

const blocks = (...text: string[]): ReadableTextBlock[] => text.map((value) => ({ text: value, tagName: "P" }));

describe("rankCandidates", () => {
  it("ranks reviewed terms with inspectable evidence", () => {
    const result = rankCandidates(
      blocks("An idempotent operation supports safe retries. The idempotent handler returns one durable result."),
      { domainHints: ["software", "systems"] },
    );

    expect(result[0].term).toBe("idempotent");
    expect(result[0].occurrences).toBe(2);
    expect(result[0].evidence.map((item) => item.signal)).toEqual(expect.arrayContaining(["bundled-term", "domain-match", "repeated"]));
  });

  it("suppresses known terms and Not jargon corrections", () => {
    const article = blocks("Observability and provenance make the system easier to inspect.");
    expect(rankCandidates(article, { knownTerms: ["observability"] }).map((item) => item.term)).not.toContain("observability");
    expect(rankCandidates(article, { notJargonTerms: ["provenance"] }).map((item) => item.term)).not.toContain("provenance");
  });

  it("does not highlight a term the page directly defines", () => {
    const result = rankCandidates(blocks("Provenance means a record of where information came from and how it changed."));
    expect(result.map((item) => item.term)).not.toContain("provenance");
  });

  it("detects unexplained acronyms without inventing a definition", () => {
    const result = rankCandidates(blocks("The SLO governs this service. Missing the SLO triggers review."));
    const candidate = result.find((item) => item.term === "SLO");
    expect(candidate?.entry).toBeUndefined();
    expect(candidate?.evidence.map((item) => item.signal)).toContain("acronym");
  });

  it("keeps the candidate set deliberately small", () => {
    const result = rankCandidates(
      blocks("Idempotent observability provenance heuristic affordance ontology schema semantic drift ABC XYZ."),
      { limit: 3 },
    );
    expect(result).toHaveLength(3);
  });
});

describe("inferDomainHints", () => {
  it("derives explainable local domain signals", () => {
    expect(inferDomainHints("A distributed database service retries an API operation")).toEqual(expect.arrayContaining(["software", "systems", "data"]));
  });
});
