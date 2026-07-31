// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  CONFIDENCE_BAND_VALUES,
  MAX_PROPOSAL_PAYLOAD_CHARS,
  PROPOSAL_PRESENTATION_POLICY,
  confidenceValueForBand,
  presentationPolicyFor,
  validate,
  type ProposalV1,
} from "../core/proposal";

const sentenceExcerpt =
  "A foundational practice is to make operations idempotent. When an operation can be repeated without changing the result beyond the initial application, retries and recovery become significantly safer.";

const context = { sentenceExcerpt };

const validProposal = (): ProposalV1 => ({
  outcome: "proposed",
  evidence: [
    { quote: "retries and recovery become significantly safer", observation: "The passage ties the term to repeated operations." },
    { observation: "The passage frames the term as a practice, not a property of data." },
  ],
  inference: [
    { statement: "In systems writing this usually denotes an operation safe to repeat.", groundedInPassage: false },
    { statement: "The passage treats repetition as the defining concern.", groundedInPassage: true },
  ],
  recommendation: { definition: "Safe to repeat without creating another result." },
  alternatives: [
    { definition: "A mathematical operation whose repetition changes nothing.", domain: "mathematics", why: "The term originates there." },
  ],
  confidence: "moderate",
  limits: ["The passage does not define the term outright."],
  wouldImprove: ["A sentence defining the term explicitly."],
  model: { providerId: "reader-configured", modelId: "reader-configured-model" },
});

describe("proposal validation (design §5.3)", () => {
  it("accepts a conforming ProposalV1", () => {
    const result = validate(validProposal(), context);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.proposal.outcome).toBe("proposed");
    expect(result.proposal.evidence).toHaveLength(2);
    expect(result.proposal.recommendation?.definition).toContain("Safe to repeat");
  });

  it("accepts a serialized JSON response", () => {
    const result = validate(JSON.stringify(validProposal()), context);

    expect(result.ok).toBe(true);
  });

  it("rejects a response that is not parseable in the expected structure", () => {
    for (const malformed of ["not json at all", "{\"outcome\":", 42, null, [], { outcome: "verdict" }]) {
      const result = validate(malformed, context);
      expect(result.ok).toBe(false);
      if (result.ok) continue;
      expect(result.reason).toBe("unparseable");
    }
  });

  it("rejects a truncated response", () => {
    const truncated = JSON.stringify(validProposal()).slice(0, 120);

    const result = validate(truncated, context);

    expect(result).toMatchObject({ ok: false, reason: "unparseable" });
  });

  it("rejects an empty response", () => {
    expect(validate("", context)).toMatchObject({ ok: false, reason: "unparseable" });
    expect(validate({}, context)).toMatchObject({ ok: false, reason: "unparseable" });
    expect(validate(undefined, context)).toMatchObject({ ok: false, reason: "unparseable" });
  });

  it("rejects a proposed outcome with a null or empty recommendation", () => {
    expect(validate({ ...validProposal(), recommendation: null }, context))
      .toMatchObject({ ok: false, reason: "missing-recommendation" });
    expect(validate({ ...validProposal(), recommendation: { definition: "   " } }, context))
      .toMatchObject({ ok: false, reason: "missing-recommendation" });
  });

  it("rejects an insufficient-evidence outcome that carries a recommendation anyway", () => {
    const result = validate({ ...validProposal(), outcome: "insufficient-evidence" }, context);

    expect(result).toMatchObject({ ok: false, reason: "recommendation-despite-insufficient-evidence" });
  });

  it("accepts insufficient-evidence when it offers no meaning", () => {
    const result = validate({ ...validProposal(), outcome: "insufficient-evidence", recommendation: null }, context);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.proposal.recommendation).toBeNull();
  });

  it("rejects a response whose confidence is absent or outside the band set", () => {
    const { confidence: _confidence, ...withoutConfidence } = validProposal();
    expect(validate(withoutConfidence, context)).toMatchObject({ ok: false, reason: "invalid-confidence" });
    expect(validate({ ...validProposal(), confidence: "very high" }, context))
      .toMatchObject({ ok: false, reason: "invalid-confidence" });
    expect(validate({ ...validProposal(), confidence: 0.73 }, context))
      .toMatchObject({ ok: false, reason: "invalid-confidence" });
  });

  it("rejects evidence quoting text absent from the transmitted excerpt", () => {
    const fabricated = validProposal();
    fabricated.evidence = [{ quote: "the author defines idempotence as a database property", observation: "Grounded, supposedly." }];

    const result = validate(fabricated, context);

    expect(result).toMatchObject({ ok: false, reason: "fabricated-quote" });
  });

  it("accepts a faithful quote that differs only in whitespace and typographic punctuation", () => {
    const requoted = validProposal();
    requoted.evidence = [{ quote: "“…retries   and recovery become significantly safer…”", observation: "Faithful requote." }];

    expect(validate(requoted, context).ok).toBe(true);
  });

  it("rejects a payload beyond the sane size bound", () => {
    const oversized = validProposal();
    oversized.limits = [Array.from({ length: MAX_PROPOSAL_PAYLOAD_CHARS + 100 }, () => "x").join("")];

    expect(validate(oversized, context)).toMatchObject({ ok: false, reason: "payload-too-large" });
    expect(validate("x".repeat(MAX_PROPOSAL_PAYLOAD_CHARS + 1), context))
      .toMatchObject({ ok: false, reason: "payload-too-large" });
  });

  it("rejects wholesale rather than partially rendering", () => {
    const result = validate({ ...validProposal(), inference: "beyond the passage" }, context);

    expect(result.ok).toBe(false);
    expect(result).not.toHaveProperty("proposal");
  });
});

describe("confidence policy (design §3.5, AI-004)", () => {
  it("orders limits first and defaults focus to Discard at low confidence", () => {
    const policy = PROPOSAL_PRESENTATION_POLICY.low;

    expect(policy.regionOrder).toEqual(["evidence", "limits", "inference", "recommendation"]);
    expect(policy.recommendationHeading).toBe("A possible meaning — weak support");
    expect(policy.recommendationEmphasis).toBe("reduced");
    expect(policy.defaultFocus).toBe("discard");
    expect(policy.alternativesExpanded).toBe(true);
    expect(policy.limitsRequired).toBe(true);
  });

  it("keeps the ordinary treatment at moderate and high confidence", () => {
    for (const band of ["moderate", "high"] as const) {
      const policy = PROPOSAL_PRESENTATION_POLICY[band];
      expect(policy.regionOrder).toEqual(["evidence", "inference", "recommendation"]);
      expect(policy.recommendationHeading).toBe("Suggested meaning to record");
      expect(policy.defaultFocus).toBe("accept");
      expect(policy.alternativesExpanded).toBe(false);
    }
  });

  it("expresses confidence as words, never as a bare value", () => {
    expect(PROPOSAL_PRESENTATION_POLICY.low.confidenceLabel).toBe("Confidence: low");
    expect(PROPOSAL_PRESENTATION_POLICY.moderate.confidenceLabel).toBe("Confidence: moderate");
    expect(PROPOSAL_PRESENTATION_POLICY.high.confidenceLabel).toBe("Confidence: high");
  });

  it("applies the low-confidence policy even when the model's wording is definite", () => {
    const definite = validProposal();
    definite.confidence = "low";
    definite.recommendation = { definition: "This unambiguously and certainly means: safe to repeat. There is no doubt." };

    const result = validate(definite, context);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const policy = presentationPolicyFor(result.proposal);
    expect(policy.band).toBe("low");
    expect(policy.defaultFocus).toBe("discard");
    expect(policy.recommendationEmphasis).toBe("reduced");
    expect(policy.regionOrder[1]).toBe("limits");
  });

  it("maps bands to the existing numeric confidence scale for storage", () => {
    expect(confidenceValueForBand("low")).toBe(CONFIDENCE_BAND_VALUES.low);
    expect(confidenceValueForBand("high")).toBeGreaterThan(confidenceValueForBand("moderate"));
    expect(confidenceValueForBand("moderate")).toBeGreaterThan(confidenceValueForBand("low"));
    for (const band of ["low", "moderate", "high"] as const) {
      expect(confidenceValueForBand(band)).toBeGreaterThan(0);
      expect(confidenceValueForBand(band)).toBeLessThanOrEqual(1);
    }
  });

  it("keeps the policy table immutable", () => {
    expect(Object.isFrozen(PROPOSAL_PRESENTATION_POLICY)).toBe(true);
    expect(Object.isFrozen(PROPOSAL_PRESENTATION_POLICY.low)).toBe(true);
  });
});
