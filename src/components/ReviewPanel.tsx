import { useState } from "react";
import type { RecallOutcome, ReviewQueueItem } from "../types";
import { CheckIcon, CloseIcon } from "./Icons";

interface ReviewPanelProps {
  item: ReviewQueueItem | null;
  remaining: number;
  completed: number;
  busy: boolean;
  error: string;
  onOutcome: (outcome: RecallOutcome) => void;
  onClose: () => void;
}

export function ReviewPanel({ item, remaining, completed, busy, error, onOutcome, onClose }: ReviewPanelProps) {
  const [revealed, setRevealed] = useState(false);

  if (!item) {
    return (
      <section className="review-panel review-complete" aria-live="polite">
        <span className="review-complete-icon"><CheckIcon /></span>
        <p className="context-label">Review complete</p>
        <h1>You’re caught up</h1>
        <p>{completed === 1 ? "One meaning strengthened." : `${completed} meanings strengthened.`} New reviews will appear when they are useful.</p>
        <button type="button" className="review-primary" onClick={onClose}>Return to reading</button>
      </section>
    );
  }

  const displayTerm = item.canonicalText.charAt(0).toLocaleUpperCase() + item.canonicalText.slice(1);

  return (
    <section className="review-panel" aria-labelledby="review-heading">
      <div className="review-header">
        <div>
          <p className="context-label">Retrieval practice · {remaining} due</p>
          <h1 id="review-heading">Recall before reveal</h1>
        </div>
        <button type="button" className="icon-button" aria-label="Close review" onClick={onClose}><CloseIcon /></button>
      </div>

      <div className="review-question">
        <span>In your own words</span>
        <h2>What does “{displayTerm}” mean here?</h2>
        <blockquote>{item.sentenceExcerpt}</blockquote>
        <small>{item.sourceTitle} · {item.sourceDomain}</small>
      </div>

      {!revealed ? (
        <button type="button" className="review-primary" onClick={() => setRevealed(true)}>Reveal meaning</button>
      ) : (
        <div className="review-reveal" aria-live="polite">
          <p>{item.definition}</p>
          <small>{item.provenanceLabel}</small>
          <fieldset disabled={busy}>
            <legend>How did recall feel?</legend>
            <button type="button" onClick={() => onOutcome("again")}><strong>Again</strong><span>I missed it</span></button>
            <button type="button" onClick={() => onOutcome("hard")}><strong>Hard</strong><span>I was close</span></button>
            <button type="button" className="is-recalled" onClick={() => onOutcome("recalled")}><strong>Recalled</strong><span>I had it</span></button>
          </fieldset>
        </div>
      )}
      {error && <p className="review-error" role="alert">{error}</p>}
    </section>
  );
}
