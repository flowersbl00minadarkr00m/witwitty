import { useState } from "react";
import { presentationPolicyFor, type ProposalV1 } from "../core/proposal";

interface AiProposalProps {
  proposal: ProposalV1;
  onDiscard: () => void;
  onAccept: (definition: string, edited: boolean) => void;
}

/**
 * Renders a validated AI proposal (design §3.5, §3.6; AI-001…AI-009). Every
 * region below is a labelled `<section>` — evidence, inference, and
 * recommendation are separate navigable landmarks, never merged prose
 * (AI-001). At `low` confidence, `presentationPolicyFor` (already tested,
 * WIT-A01) reorders and de-emphasises the recommendation regardless of how
 * the model phrased it (AI-004) — this component only ever reads that
 * policy, it never overrides it with its own judgment of the wording.
 */
export function AiProposal({ proposal, onDiscard, onAccept }: AiProposalProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(proposal.recommendation?.definition ?? "");
  const [showAlternatives, setShowAlternatives] = useState(false);

  if (proposal.outcome === "insufficient-evidence") {
    return (
      <section className="ai-proposal ai-insufficient" aria-live="polite" aria-labelledby="ai-insufficient-heading">
        <h2 id="ai-insufficient-heading">Not enough in this passage</h2>
        <p>This passage doesn't say enough to determine what this term means here.</p>
        {proposal.wouldImprove.length > 0 && (
          <p className="ai-would-improve">More certain if: {proposal.wouldImprove.join("; ")}.</p>
        )}
        <div className="ai-proposal-actions">
          <button type="button" onClick={onDiscard}>Dismiss</button>
        </div>
      </section>
    );
  }

  const policy = presentationPolicyFor(proposal);
  const alternatives = proposal.alternatives;
  const showAlternativesNow = policy.alternativesExpanded || showAlternatives;

  const regionContent: Record<typeof policy.regionOrder[number], React.ReactNode> = {
    evidence: (
      <section key="evidence" aria-labelledby="ai-evidence-heading">
        <h3 id="ai-evidence-heading">From this passage</h3>
        {proposal.evidence.length === 0 && <p className="ai-empty-region">No direct evidence cited.</p>}
        {proposal.evidence.map((entry, index) => (
          <p key={index}>
            {entry.quote && <span className="ai-quote">&ldquo;{entry.quote}&rdquo; </span>}
            {entry.observation}
          </p>
        ))}
      </section>
    ),
    limits: proposal.limits.length > 0 || policy.limitsRequired ? (
      <section key="limits" aria-labelledby="ai-limits-heading">
        <h3 id="ai-limits-heading">Limits</h3>
        {proposal.limits.length > 0 ? proposal.limits.map((limit, index) => <p key={index}>{limit}</p>) : <p>The model did not state specific limits.</p>}
      </section>
    ) : null,
    inference: (
      <section key="inference" aria-labelledby="ai-inference-heading">
        <h3 id="ai-inference-heading">What the model inferred</h3>
        {proposal.inference.map((entry, index) => (
          <p key={index}>
            {entry.statement}
            {!entry.groundedInPassage && <span className="ai-ungrounded"> · Not grounded in this passage</span>}
          </p>
        ))}
      </section>
    ),
    recommendation: (
      <section key="recommendation" aria-labelledby="ai-recommendation-heading" className={policy.recommendationEmphasis === "reduced" ? "is-reduced" : ""}>
        <h3 id="ai-recommendation-heading">{policy.recommendationHeading}</h3>
        {editing ? (
          <textarea
            className="ai-edit-textarea"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            aria-label="Edit suggested meaning"
          />
        ) : (
          <p>{proposal.recommendation?.definition}</p>
        )}
      </section>
    ),
  };

  return (
    <section className="ai-proposal" aria-labelledby="ai-proposal-label">
      <p id="ai-proposal-label" className="ai-proposal-label">
        Contextual interpretation · not a verified definition · {proposal.model.modelId}
      </p>
      {policy.regionOrder.map((region) => regionContent[region])}
      <p className="ai-confidence">{policy.confidenceLabel}</p>
      {alternatives.length > 0 && (
        <div className="ai-alternatives">
          <button type="button" onClick={() => setShowAlternatives((value) => !value)} aria-expanded={showAlternativesNow}>
            Another reading fits · {alternatives.length} alternative{alternatives.length === 1 ? "" : "s"}
          </button>
          {showAlternativesNow && (
            <ul>
              {alternatives.map((alternative, index) => (
                <li key={index}><strong>{alternative.domain}</strong> {alternative.definition} — {alternative.why}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      {proposal.wouldImprove.length > 0 && (
        <p className="ai-would-improve">More certain if: {proposal.wouldImprove.join("; ")}.</p>
      )}
      <div className="ai-proposal-actions">
        <button type="button" onClick={onDiscard} autoFocus={policy.defaultFocus === "discard"}>Discard</button>
        {!editing && <button type="button" onClick={() => setEditing(true)}>Edit</button>}
        <button
          type="button"
          className="is-primary"
          autoFocus={policy.defaultFocus === "accept"}
          onClick={() => onAccept(editing ? draft : (proposal.recommendation?.definition ?? ""), editing && draft !== proposal.recommendation?.definition)}
        >
          Accept
        </button>
      </div>
    </section>
  );
}
