import { useEffect, useRef } from "react";
import type { ContextPacket } from "../core/explanations";
import { CloseIcon } from "./Icons";

interface AiDisclosureProps {
  packet: ContextPacket;
  destination: string;
  modelId: string;
  onCancel: () => void;
  onSend: () => void;
  /** True after the session's first send — changes the heading/copy only (§3.3 "What gets sent"). */
  isReview?: boolean;
}

/**
 * Verbatim pre-send disclosure (design §3.3, PT-002, PT-003, PT-004). Owns the
 * single most important control in the feature: transmission is impossible
 * until the reader resolves this dialog. Focus-trapped, `Cancel` is the
 * default action, `Escape` cancels.
 */
export function AiDisclosure({ packet, destination, modelId, onCancel, onSend, isReview = false }: AiDisclosureProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCancel();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = dialogRef.current.querySelectorAll<HTMLElement>("button, [href], input, [tabindex]:not([tabindex='-1'])");
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [onCancel]);

  return (
    <div className="ai-disclosure-backdrop">
      <div
        className="ai-disclosure"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ai-disclosure-heading"
        ref={dialogRef}
      >
        <div className="ai-disclosure-heading">
          <h2 id="ai-disclosure-heading">{isReview ? "What gets sent" : "Before this is sent"}</h2>
          <button type="button" className="icon-button" aria-label="Cancel" onClick={onCancel}><CloseIcon /></button>
        </div>
        <p>This is everything WitWitty will send. Nothing else leaves your device.</p>
        <dl className="ai-disclosure-fields">
          <div><dt>Destination</dt><dd>{destination} · {modelId}</dd></div>
          <div><dt>Term</dt><dd>{packet.term}</dd></div>
          <div className="ai-disclosure-scroll"><dt>Passage</dt><dd>{packet.sentenceExcerpt}</dd></div>
          <div><dt>Page title</dt><dd>{packet.pageTitle || "(none)"}</dd></div>
          <div><dt>Domain</dt><dd>{packet.domain || "(none)"}</dd></div>
          <div><dt>Domain hints</dt><dd>{packet.domainHints.length > 0 ? packet.domainHints.join(", ") : "(none)"}</dd></div>
        </dl>
        {!isReview && (
          <div className="ai-disclosure-actions">
            <button type="button" ref={cancelRef} onClick={onCancel}>Cancel</button>
            <button type="button" className="is-primary" onClick={onSend}>Send to endpoint</button>
          </div>
        )}
        {isReview && (
          <div className="ai-disclosure-actions">
            <button type="button" ref={cancelRef} className="is-primary" onClick={onCancel}>Close</button>
          </div>
        )}
      </div>
    </div>
  );
}
