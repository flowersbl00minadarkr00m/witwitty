import { describe, expect, it } from "vitest";
import { rankCandidates, type ReadableTextBlock } from "../core/candidates";
import { createContextPacket, resolveLocalExplanation } from "../core/explanations";

const source = { url: "https://example.com/read?utm_source=test", title: "A technical article", domain: "example.com" };
const blocks = (text: string): ReadableTextBlock[] => [{ text, tagName: "P" }];

describe("local explanation resolution", () => {
  it("resolves a reviewed sense with explicit provenance", () => {
    const candidate = rankCandidates(blocks("An idempotent operation makes software retries safer."), { domainHints: ["software"] })[0];
    const packet = createContextPacket(candidate.term, "An idempotent operation makes retries safer.", source, ["software"]);
    const explanation = resolveLocalExplanation(candidate, packet, source);

    expect(explanation.definition).toContain("Safe to repeat");
    expect(explanation.provenance).toBe("bundled");
    expect(explanation.provenanceLabel).toBe("Reviewed local definition");
    expect(explanation.uncertainty).toBeUndefined();
  });

  it("exposes plausible senses instead of silently choosing when context is ambiguous", () => {
    const candidate = rankCandidates(blocks("Ontology shapes how categories relate."))[0];
    const packet = createContextPacket(candidate.term, "Ontology shapes how categories relate.", source, []);
    const explanation = resolveLocalExplanation(candidate, packet, source);

    expect(explanation.uncertainty).toContain("more than one plausible meaning");
    expect(explanation.alternatives).toHaveLength(2);
    expect(explanation.confidence).toBeLessThanOrEqual(0.7);
  });

  it("fails closed for an acronym without a reviewed definition", () => {
    const candidate = rankCandidates(blocks("The SLO applies to every service."))[0];
    const packet = createContextPacket(candidate.term, "The SLO applies to every service.", source, ["systems"]);
    const explanation = resolveLocalExplanation(candidate, packet, source);

    expect(explanation.provenance).toBe("missing");
    expect(explanation.definition).not.toMatch(/service level objective/i);
    expect(explanation.uncertainty).toContain("will not guess");
  });

  it("minimizes context packets before any future adapter receives them", () => {
    const packet = createContextPacket("x".repeat(140), " sentence ".repeat(80), { ...source, title: "title ".repeat(60) }, ["software", "systems", "data", "ai", "design", "product", "knowledge", "research", "extra"]);
    expect(packet.term.length).toBe(100);
    expect(packet.sentenceExcerpt.length).toBeLessThanOrEqual(280);
    expect(packet.pageTitle.length).toBeLessThanOrEqual(160);
    expect(packet.domainHints).toHaveLength(8);
  });
});
