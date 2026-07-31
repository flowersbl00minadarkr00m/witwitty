import { useEffect, useRef, useState, type ReactNode } from "react";
import { clearCompactSettings, excludeDomain, EXTENSION_UPDATE_ERROR, EXTENSION_UPDATE_GUIDANCE, getPanelRuntimeErrorMessage, listenForBrowserMessages, requestPageScan, requestPanelReady, removePageTerm, scanIdMatches, setPageTextMode, updateDetectionPreference } from "../browser";
import { deleteAllData, deleteSourcesByDomain, deleteTermByCanonicalText, exportLocalData, getDueReviewItems, getPriorEncounter, getStorageSummary, persistLearningAction, recordReviewOutcome } from "../data/db";
import { demoPriorEncounter, demoReviewItem, demoTerm } from "../data/dictionary";
import type { ActiveTerm, LearningAction, PanelStatus, PriorEncounter, RecallOutcome, ReviewQueueItem, StorageSummary, TextMode } from "../types";
import {
  BanIcon,
  BookmarkIcon,
  CheckIcon,
  ClockIcon,
  CloseIcon,
  CompareIcon,
  DocumentIcon,
  LockIcon,
  PinIcon,
  RefreshIcon,
  VolumeIcon,
} from "./Icons";
import { ReviewPanel } from "./ReviewPanel";
import { AiSettings } from "./AiSettings";
import { AiDisclosure } from "./AiDisclosure";
import { AiProposal } from "./AiProposal";
import { requiresSimplificationConfirmation } from "../core/textMode";
import { requestExplanation, type AiRequestErrorCode } from "../ai/adapter";
import { createContextPacket, type ContextPacket } from "../core/explanations";
import { validate, confidenceValueForBand, type ConfidenceBand, type ProposalV1 } from "../core/proposal";
import { eligible, createRejectedSenseSignal } from "../core/aiCapability";
import { getAiEndpointConfig, getAiSettings, hasOriginPermission, toCapabilitySettings, type AiSettings as AiSettingsRecord } from "../data/aiSettings";

interface ContextLensPanelProps {
  demo?: boolean;
  selectedTerm?: ActiveTerm;
  priorEncounter?: PriorEncounter | null;
  onTextModeChange?: (term: string, mode: TextMode) => void;
  /**
   * Demo-only escape hatch: lets the public web demo render a scripted AI
   * region in the same visual slot the real one occupies, without this
   * component ever touching `data/aiSettings` or `ai/adapter` — both of
   * which assume a real `chrome` extension context and would throw on a
   * plain webpage. The real (non-demo) AI wiring below is untouched by this.
   */
  renderAiDemo?: () => ReactNode;
}

const speakTerm = (term: string) => {
  if (!("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(new SpeechSynthesisUtterance(term));
};

const actionLabel: Record<LearningAction, string> = {
  "got-it": "Got it",
  saved: "Save",
  "not-jargon": "Not jargon",
};

type DestructiveAction = "term" | "site" | "all";

export function ContextLensPanel({
  demo = false,
  selectedTerm,
  priorEncounter: providedPriorEncounter = demo ? demoPriorEncounter : null,
  onTextModeChange,
  renderAiDemo,
}: ContextLensPanelProps) {
  const [browserTerm, setBrowserTerm] = useState<ActiveTerm>(demoTerm);
  const [status, setStatus] = useState<PanelStatus>(demo ? "ready" : "waiting");
  const [statusMessage, setStatusMessage] = useState("");
  const [scanRetryable, setScanRetryable] = useState(false);
  const [textMode, setTextMode] = useState<TextMode>("original");
  const [selectedAction, setSelectedAction] = useState<LearningAction | null>(null);
  const [showCompare, setShowCompare] = useState(false);
  const [selectedSenseDefinition, setSelectedSenseDefinition] = useState<string | null>(null);
  const [showLocalData, setShowLocalData] = useState(false);
  const [storageSummary, setStorageSummary] = useState<StorageSummary | null>(null);
  const [pendingDelete, setPendingDelete] = useState<DestructiveAction | null>(null);
  const [privacyMessage, setPrivacyMessage] = useState("");
  const [storedPriorEncounter, setStoredPriorEncounter] = useState<PriorEncounter | null>(null);
  const [historyStatus, setHistoryStatus] = useState<"idle" | "loading" | "ready" | "error">(demo ? "ready" : "idle");
  const [dueReviews, setDueReviews] = useState<ReviewQueueItem[]>(demo ? [demoReviewItem] : []);
  const [showReview, setShowReview] = useState(false);
  const [completedReviews, setCompletedReviews] = useState(0);
  const [reviewBusy, setReviewBusy] = useState(false);
  const [reviewError, setReviewError] = useState("");
  const [pendingSimpler, setPendingSimpler] = useState(false);
  const scanIdRef = useRef<string | null>(null);

  type AiFlowState = "idle" | "disclosure" | "pending" | "result";
  type AiResult =
    | { kind: "proposal"; proposal: ProposalV1 }
    | { kind: "error"; message: string; code?: AiRequestErrorCode };
  type AcceptedProposal = { definition: string; modelId: string; band: ConfidenceBand; edited: boolean };

  const [aiSettingsRecord, setAiSettingsRecord] = useState<AiSettingsRecord | null>(null);
  const [aiFlowState, setAiFlowState] = useState<AiFlowState>("idle");
  const [aiPacket, setAiPacket] = useState<ContextPacket | null>(null);
  const [aiResult, setAiResult] = useState<AiResult | null>(null);
  const [aiHasSent, setAiHasSent] = useState(false);
  const [aiReviewOpen, setAiReviewOpen] = useState(false);
  const [aiUnconfiguredDismissed, setAiUnconfiguredDismissed] = useState(false);
  const [acceptedProposal, setAcceptedProposal] = useState<AcceptedProposal | null>(null);
  const aiAbortRef = useRef<AbortController | null>(null);
  const rejectedSensesRef = useRef(createRejectedSenseSignal());

  const activeTerm = selectedTerm ?? browserTerm;
  const priorEncounter = demo ? providedPriorEncounter : storedPriorEncounter;
  const effectiveTerm = acceptedProposal
    ? {
      ...activeTerm,
      definition: acceptedProposal.definition,
      uncertainty: undefined,
      provenance: "inferred" as const,
      provenanceLabel: `Contextual interpretation · ${acceptedProposal.modelId}${acceptedProposal.edited ? " · edited" : ""}`,
      confidence: confidenceValueForBand(acceptedProposal.band),
    }
    : selectedSenseDefinition
      ? { ...activeTerm, definition: selectedSenseDefinition, uncertainty: undefined }
      : activeTerm;
  const displayTerm = activeTerm.term.charAt(0).toLocaleUpperCase() + activeTerm.term.slice(1);
  const aiEligible = !demo && eligible(activeTerm.term, {
    settings: toCapabilitySettings(aiSettingsRecord),
    page: { domain: activeTerm.source.domain, incognito: false, excludedDomains: [] },
    provenance: effectiveTerm.provenance,
    rejectedSenses: rejectedSensesRef.current,
  });

  const handleRejectedHandshake = (reason?: string) => {
    scanIdRef.current = null;
    setScanRetryable(false);
    if (reason === EXTENSION_UPDATE_ERROR) {
      setStatus("error");
      setStatusMessage(EXTENSION_UPDATE_GUIDANCE);
      return;
    }
    setStatus("waiting");
    setStatusMessage(reason === "target-stale"
      ? "WitWitty lost the page it was opened on. Return to the article and click the toolbar icon again."
      : "Return to an article and click the WitWitty toolbar icon to start a scan.");
  };

  const handleScanRequest = async () => {
    setStatus("scanning");
    setStatusMessage("");
    setScanRetryable(false);
    // A manual retry always starts a genuinely new scan on the backend
    // (background.js mints a fresh scanId regardless of what's sent here).
    // Untrack the old id up front so whichever scan-lifecycle message for the
    // new scan arrives first — the handshake response below or a background
    // broadcast — is accepted, instead of racing to update the ref in time.
    scanIdRef.current = null;
    try {
      const response = await requestPageScan();
      if (response?.scanId) scanIdRef.current = response.scanId;
      if (response?.accepted === false) {
        handleRejectedHandshake(response.reason);
      }
    } catch (error) {
      setStatus("error");
      setScanRetryable(false);
      setStatusMessage(getPanelRuntimeErrorMessage(error));
    }
  };

  const resetAiState = () => {
    setAiFlowState("idle");
    setAiPacket(null);
    setAiResult(null);
    setAiHasSent(false);
    setAiReviewOpen(false);
    setAiUnconfiguredDismissed(false);
    setAcceptedProposal(null);
    aiAbortRef.current?.abort();
    aiAbortRef.current = null;
  };

  useEffect(() => {
    if (selectedTerm) {
      setStatus("ready");
      setSelectedAction(null);
      setShowCompare(false);
      setTextMode("original");
      setSelectedSenseDefinition(null);
      setPendingSimpler(false);
      resetAiState();
    }
  }, [selectedTerm]);

  useEffect(() => {
    if (demo) return;
    const acceptsScanMessage = (message: { scanId?: string }) => {
      const accepted = scanIdMatches(scanIdRef.current, message.scanId);
      if (accepted && message.scanId && !scanIdRef.current) scanIdRef.current = message.scanId;
      return accepted;
    };
    const notifyPanelReady = async (scanId?: string) => {
      try {
        const response = await requestPanelReady(scanId);
        if (response?.scanId) scanIdRef.current = response.scanId;
        if (response?.accepted === false) {
          handleRejectedHandshake(response.reason);
        } else if (response?.accepted === true) {
          setStatus("scanning");
          setStatusMessage("");
        }
      } catch (error) {
        setStatus("error");
        setScanRetryable(false);
        setStatusMessage(getPanelRuntimeErrorMessage(error));
      }
    };
    const stopListening = listenForBrowserMessages(
      (term, message) => {
        if (!acceptsScanMessage(message)) return;
        setBrowserTerm(term);
        setStatus("ready");
        setSelectedAction(null);
        setShowCompare(false);
        setTextMode("original");
        setSelectedSenseDefinition(null);
        setPendingSimpler(false);
        resetAiState();
      },
      (message) => {
        if (message.type === "WITWITTY_SCAN_AVAILABLE") {
          if (message.scanId) scanIdRef.current = message.scanId;
          void notifyPanelReady(message.scanId);
          return;
        }
        if (message.type === "WITWITTY_SCAN_WAITING") {
          scanIdRef.current = null;
          setStatus("waiting");
          setStatusMessage("");
          setScanRetryable(false);
          return;
        }
        if (!acceptsScanMessage(message)) return;
        if (message.type === "WITWITTY_SCAN_STARTED") {
          setStatus("scanning");
          setStatusMessage("");
        }
        if (message.type === "WITWITTY_SCAN_COMPLETE" && message.count === 0) {
          setStatus("empty");
          setScanRetryable(false);
        }
        if (message.type === "WITWITTY_SCAN_EXCLUDED") {
          setStatus("excluded");
          setStatusMessage(`${message.domain || "This site"} is excluded from WitWitty.`);
        }
        if (message.type === "WITWITTY_PRIVATE_PAGE_BLOCKED") {
          setStatus("error");
          setScanRetryable(false);
          setStatusMessage(message.error || "Private pages are not scanned or stored.");
        }
        if (message.type === "WITWITTY_SCAN_ERROR") {
          setStatus("error");
          setScanRetryable(message.retryable === true);
          setStatusMessage(message.error || "This page could not be analyzed.");
        }
      },
    );
    void notifyPanelReady();
    return stopListening;
  }, [demo]);

  useEffect(() => {
    if (demo || status !== "ready") return;
    let cancelled = false;
    setHistoryStatus("loading");
    setStoredPriorEncounter(null);
    getPriorEncounter(activeTerm.term)
      .then((encounter) => {
        if (cancelled) return;
        setStoredPriorEncounter(encounter);
        setHistoryStatus("ready");
      })
      .catch(() => {
        if (cancelled) return;
        setHistoryStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [activeTerm.source.url, activeTerm.term, demo, status]);

  useEffect(() => {
    if (demo) return;
    let cancelled = false;
    const refreshDueReviews = () => {
      getDueReviewItems()
        .then((items) => {
          if (!cancelled) setDueReviews(items);
        })
        .catch(() => {
          if (!cancelled) setReviewError("Due reviews are temporarily unavailable.");
        });
    };
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") refreshDueReviews();
    };
    refreshDueReviews();
    window.addEventListener("focus", refreshDueReviews);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", refreshDueReviews);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [demo]);

  useEffect(() => {
    if (demo) return;
    let cancelled = false;
    getAiSettings().then((settings) => {
      if (!cancelled) setAiSettingsRecord(settings);
    });
    return () => {
      cancelled = true;
    };
  }, [demo, showLocalData]);

  const handleAiInvoke = () => {
    const packet = createContextPacket(activeTerm.term, activeTerm.sentenceExcerpt, activeTerm.source, activeTerm.domainHints ?? []);
    setAiPacket(packet);
    setAiFlowState("disclosure");
  };

  const handleAiCancelDisclosure = () => {
    setAiFlowState("idle");
  };

  const handleAiSend = async () => {
    if (!aiPacket) return;
    setAiFlowState("pending");
    setAiResult(null);
    setAiHasSent(true);
    const config = await getAiEndpointConfig();
    if (!config) {
      setAiResult({ kind: "error", message: "AI is not configured. Open Your local data to set it up." });
      setAiFlowState("result");
      return;
    }
    const permitted = await hasOriginPermission(config.endpointUrl);
    if (!permitted) {
      setAiResult({ kind: "error", message: "WitWitty no longer has permission to reach the configured endpoint. Reconfigure it in Your local data." });
      setAiFlowState("result");
      return;
    }
    const controller = new AbortController();
    aiAbortRef.current = controller;
    const response = await requestExplanation(config, aiPacket, { signal: controller.signal });
    aiAbortRef.current = null;
    if (!response.ok) {
      setAiResult({ kind: "error", message: response.error.message, code: response.error.code });
      setAiFlowState("result");
      return;
    }
    const validation = validate(response.raw, { sentenceExcerpt: aiPacket.sentenceExcerpt });
    if (!validation.ok) {
      setAiResult({ kind: "error", message: "The response from the endpoint could not be used.", code: "unusable-response" });
      setAiFlowState("result");
      return;
    }
    setAiResult({ kind: "proposal", proposal: validation.proposal });
    setAiFlowState("result");
  };

  const handleAiCancelPending = () => {
    aiAbortRef.current?.abort();
    aiAbortRef.current = null;
    setAiFlowState("idle");
  };

  const handleAiDiscard = () => {
    setAiFlowState("idle");
    setAiResult(null);
  };

  const handleAiAccept = (definition: string, edited: boolean) => {
    if (aiResult?.kind !== "proposal" || !definition.trim()) return;
    setAcceptedProposal({ definition, modelId: aiResult.proposal.model.modelId, band: aiResult.proposal.confidence, edited });
    setAiFlowState("idle");
    setAiResult(null);
  };

  useEffect(() => {
    if (!showLocalData) return;
    let cancelled = false;
    getStorageSummary()
      .then((summary) => {
        if (!cancelled) setStorageSummary(summary);
      })
      .catch(() => {
        if (!cancelled) setPrivacyMessage("Local storage details are temporarily unavailable.");
      });
    return () => {
      cancelled = true;
    };
  }, [showLocalData]);

  const handleAction = async (action: LearningAction) => {
    setSelectedAction(action);
    try {
      await persistLearningAction(effectiveTerm, action);
      if (action === "not-jargon") setDueReviews((items) => items.filter((item) => item.canonicalText !== activeTerm.term.trim().toLocaleLowerCase()));
      if (!demo && (action === "got-it" || action === "not-jargon")) updateDetectionPreference(activeTerm.term, action);
      if (action === "not-jargon" && !demo) removePageTerm(activeTerm.term);
    } catch {
      setStatusMessage("The action could not be stored. Your page was not changed.");
    }
  };

  const handleReviewOutcome = async (outcome: RecallOutcome) => {
    const item = dueReviews[0];
    if (!item) return;
    setReviewBusy(true);
    setReviewError("");
    try {
      if (!demo) await recordReviewOutcome(item.termId, outcome);
      setDueReviews((items) => items.slice(1));
      setCompletedReviews((count) => count + 1);
    } catch {
      setReviewError("This review could not be saved. Try again before closing.");
    } finally {
      setReviewBusy(false);
    }
  };

  const applyTextMode = (mode: TextMode) => {
    setTextMode(mode);
    setPendingSimpler(false);
    onTextModeChange?.(activeTerm.term, mode);
    if (!demo) setPageTextMode(activeTerm.term, mode);
  };

  const handleTextMode = (mode: TextMode) => {
    if (mode === "simpler" && textMode !== "simpler" && requiresSimplificationConfirmation(activeTerm.confidence)) {
      setPendingSimpler(true);
      return;
    }
    applyTextMode(mode);
  };

  const refreshStorageSummary = async () => setStorageSummary(await getStorageSummary());

  const handleExport = async () => {
    try {
      const exported = await exportLocalData();
      const url = URL.createObjectURL(new Blob([JSON.stringify(exported, null, 2)], { type: "application/json" }));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `witwitty-export-${new Date().toISOString().slice(0, 10)}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      setPrivacyMessage("A versioned local export was created.");
    } catch {
      setPrivacyMessage("The local export could not be created.");
    }
  };

  const handleConfirmedDelete = async (action: DestructiveAction) => {
    try {
      if (action === "term") {
        await deleteTermByCanonicalText(activeTerm.term);
        setStoredPriorEncounter(null);
        setPrivacyMessage(`${displayTerm} and its learning history were deleted.`);
      }
      if (action === "site") {
        await deleteSourcesByDomain(activeTerm.source.domain);
        excludeDomain(activeTerm.source.domain);
        setStatus("excluded");
        setStatusMessage(`${activeTerm.source.domain} is excluded from WitWitty.`);
      }
      if (action === "all") {
        await deleteAllData();
        clearCompactSettings();
        setStoredPriorEncounter(null);
        setPrivacyMessage("All WitWitty history and preferences were deleted.");
      }
      setPendingDelete(null);
      await refreshStorageSummary();
    } catch {
      setPrivacyMessage("That local-data change could not be completed.");
    }
  };

  return (
    <aside className="context-lens" aria-label="WitWitty Context Lens">
      <header className="panel-header">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true">W</span>
          <span className="brand-name">WitWitty</span>
          <span className="mode-label">Context Lens</span>
        </div>
        <div className="panel-utilities">
          {dueReviews.length > 0 && <button className="due-button" type="button" onClick={() => { setCompletedReviews(0); setShowReview(true); }} aria-label={`${dueReviews.length} ${dueReviews.length === 1 ? "term" : "terms"} due for review`}>{dueReviews.length} due</button>}
          <button className="icon-button" type="button" aria-label="Pin Context Lens"><PinIcon /></button>
          <button className="icon-button" type="button" aria-label="Close Context Lens"><CloseIcon /></button>
        </div>
      </header>

      {showReview && (
        <ReviewPanel
          key={dueReviews[0]?.termId ?? "review-complete"}
          item={dueReviews[0] ?? null}
          remaining={dueReviews.length}
          completed={completedReviews}
          busy={reviewBusy}
          error={reviewError}
          onOutcome={handleReviewOutcome}
          onClose={() => setShowReview(false)}
        />
      )}

      {!showReview && status === "waiting" && (
        <section className="panel-state" aria-live="polite">
          <span className="state-icon"><DocumentIcon /></span>
          <h1>Ready when you are</h1>
          <p>Open an article or documentation page, then click the WitWitty toolbar icon to scan it.</p>
        </section>
      )}

      {!showReview && status === "scanning" && (
        <section className="panel-state" aria-live="polite">
          <span className="state-icon is-spinning"><RefreshIcon /></span>
          <h1>Reading this page</h1>
          <p>Looking for a small set of terms that may interrupt comprehension.</p>
        </section>
      )}

      {!showReview && status === "empty" && (
        <section className="panel-state" aria-live="polite">
          <span className="state-icon"><CheckIcon /></span>
          <h1>No blockers found</h1>
          <p>WitWitty kept the scan conservative. You can still select unfamiliar text manually.</p>
          <button className="state-action" type="button" onClick={handleScanRequest}>Scan again</button>
        </section>
      )}

      {!showReview && status === "error" && (
        <section className="panel-state" role="alert">
          <h1>Page unavailable</h1>
          <p>{statusMessage}</p>
          {scanRetryable && <button className="state-action" type="button" onClick={handleScanRequest}>Try again</button>}
        </section>
      )}

      {!showReview && status === "excluded" && (
        <section className="panel-state" aria-live="polite">
          <span className="state-icon"><LockIcon /></span>
          <h1>Site excluded</h1>
          <p>{statusMessage || "WitWitty will not scan or retain reading activity from this domain."}</p>
        </section>
      )}

      {!showReview && status === "ready" && (
        <div className="panel-flow">
          <section className="active-term-header" aria-live="polite">
            <p className="context-label">Term in this context</p>
            <div className="term-title-row">
              <h1>{displayTerm}</h1>
              <button className="pronounce-button" type="button" onClick={() => speakTerm(activeTerm.term)} aria-label={`Pronounce ${activeTerm.term}`}>
                <VolumeIcon />
              </button>
            </div>
            <span className="mint-rule" aria-hidden="true" />
          </section>

          <section className="meaning-section" aria-labelledby="meaning-heading">
            <h2 id="meaning-heading">Meaning here</h2>
            <div className={`meaning-card ${effectiveTerm.uncertainty ? "is-uncertain" : ""} ${effectiveTerm.provenance === "missing" ? "is-missing" : ""}`}>
              <p>{effectiveTerm.definition}</p>
              <span className="provenance">{effectiveTerm.provenanceLabel}</span>
              {effectiveTerm.uncertainty && !selectedSenseDefinition && <small className="uncertainty">{effectiveTerm.uncertainty}</small>}
            </div>
            {activeTerm.alternatives && activeTerm.alternatives.length > 1 && !selectedSenseDefinition && (
              <div className="sense-options" aria-label="Possible meanings">
                {activeTerm.alternatives.map((alternative) => (
                  <button type="button" key={`${alternative.domain}:${alternative.definition}`} onClick={() => setSelectedSenseDefinition(alternative.definition)}>
                    <span>{alternative.domain}</span>{alternative.definition}
                  </button>
                ))}
              </div>
            )}
          </section>

          {demo && renderAiDemo?.()}

          {effectiveTerm.provenance === "missing" && !demo && (
            <section className="ai-region" aria-label="AI explanation">
              {aiFlowState === "idle" && !acceptedProposal && (
                aiEligible ? (
                  <div className="ai-affordance">
                    <button type="button" onClick={handleAiInvoke}>Explain this term here</button>
                    {aiHasSent && <button type="button" className="ai-what-gets-sent" onClick={() => setAiReviewOpen(true)}>What gets sent</button>}
                  </div>
                ) : !toCapabilitySettings(aiSettingsRecord).configured && !aiUnconfiguredDismissed ? (
                  <div className="ai-unconfigured-hint">
                    <button type="button" onClick={() => setShowLocalData(true)}>Explain with AI…</button>
                    <span>needs a provider — set up in Your local data</span>
                    <button type="button" className="icon-button" aria-label="Dismiss" onClick={() => setAiUnconfiguredDismissed(true)}><CloseIcon /></button>
                  </div>
                ) : null
              )}

              {aiFlowState === "disclosure" && aiPacket && (
                <AiDisclosure
                  packet={aiPacket}
                  destination={new URL(aiSettingsRecord?.endpointUrl ?? "https://example.invalid").origin}
                  modelId={aiSettingsRecord?.modelId ?? ""}
                  onCancel={handleAiCancelDisclosure}
                  onSend={handleAiSend}
                />
              )}

              {aiFlowState === "pending" && (
                <div className="ai-pending" aria-live="polite">
                  <span>Asking the configured endpoint…</span>
                  <button type="button" onClick={handleAiCancelPending}>Cancel</button>
                </div>
              )}

              {aiFlowState === "result" && aiResult?.kind === "proposal" && (
                <AiProposal proposal={aiResult.proposal} onDiscard={handleAiDiscard} onAccept={handleAiAccept} />
              )}

              {aiFlowState === "result" && aiResult?.kind === "error" && (
                <div className="ai-error" role="alert">
                  <p>{aiResult.message}</p>
                  <div className="ai-proposal-actions">
                    <button type="button" onClick={handleAiDiscard}>Dismiss</button>
                    {aiPacket && <button type="button" onClick={handleAiSend}>Try again</button>}
                  </div>
                </div>
              )}

              {aiReviewOpen && aiPacket && (
                <AiDisclosure
                  packet={aiPacket}
                  destination={new URL(aiSettingsRecord?.endpointUrl ?? "https://example.invalid").origin}
                  modelId={aiSettingsRecord?.modelId ?? ""}
                  onCancel={() => setAiReviewOpen(false)}
                  onSend={() => setAiReviewOpen(false)}
                  isReview
                />
              )}
            </section>
          )}

          {historyStatus === "loading" && !demo ? (
            <section className="history-section no-history" aria-live="polite">
              <p className="last-seen"><ClockIcon />Checking local history</p>
            </section>
          ) : priorEncounter ? (
            <section className="history-section" aria-labelledby="seen-heading">
              <p className="last-seen"><ClockIcon />Last seen {priorEncounter.relativeLabel}</p>
              <h2 id="seen-heading">Seen in</h2>
              <div className="source-card">
                <span className="source-icon"><DocumentIcon /></span>
                <span className="source-copy">
                  <strong>{priorEncounter.title}</strong>
                  <span>{priorEncounter.domain}<i aria-hidden="true">•</i>{priorEncounter.dateLabel}</span>
                  <small>{priorEncounter.excerpt}</small>
                  {priorEncounter.sanitizedUrl && <a className="source-open" href={priorEncounter.sanitizedUrl} target="_blank" rel="noreferrer">Open prior page</a>}
                </span>
              </div>
            </section>
          ) : (
            <section className="history-section no-history" aria-label="No prior encounters">
              <p className="last-seen"><ClockIcon />First encounter</p>
              <p>{historyStatus === "error" ? "Local history is temporarily unavailable." : "This term has no earlier saved context on this device."}</p>
            </section>
          )}

          <section className="term-actions" aria-label="Learning actions">
            <button type="button" className={selectedAction === "got-it" ? "is-selected" : ""} onClick={() => handleAction("got-it")} aria-pressed={selectedAction === "got-it"}>
              <CheckIcon />{actionLabel["got-it"]}
            </button>
            <button type="button" className={selectedAction === "saved" ? "is-selected" : ""} onClick={() => handleAction("saved")} aria-pressed={selectedAction === "saved"}>
              <BookmarkIcon />{actionLabel.saved}
            </button>
            <button type="button" className={selectedAction === "not-jargon" ? "is-selected" : ""} onClick={() => handleAction("not-jargon")} aria-pressed={selectedAction === "not-jargon"}>
              <BanIcon />{actionLabel["not-jargon"]}
            </button>
            <button type="button" className={showCompare ? "is-selected" : ""} onClick={() => setShowCompare((value) => !value)} aria-expanded={showCompare} disabled={!priorEncounter}>
              <CompareIcon />Compare contexts
            </button>
          </section>

          {showCompare && priorEncounter && (
            <section className="compare-view" aria-label="Context comparison">
              <div>
                <span>Here · {activeTerm.source.domain}</span>
                <strong>{effectiveTerm.definition}</strong>
                <p>{effectiveTerm.sentenceExcerpt}</p>
              </div>
              <div>
                <span>Before · {priorEncounter.domain}</span>
                <strong>{priorEncounter.definition}</strong>
                <small>{priorEncounter.provenanceLabel}</small>
                <p>{priorEncounter.excerpt}</p>
                {priorEncounter.sanitizedUrl && <a href={priorEncounter.sanitizedUrl} target="_blank" rel="noreferrer">Open prior page</a>}
              </div>
            </section>
          )}

          <section className="text-mode" aria-label="Page wording">
            <button type="button" className={textMode === "original" ? "is-active" : ""} onClick={() => handleTextMode("original")}>Original</button>
            <button className={`mode-switch ${textMode === "simpler" ? "is-on" : ""}`} type="button" role="switch" aria-checked={textMode === "simpler"} onClick={() => handleTextMode(textMode === "original" ? "simpler" : "original")} aria-label="Use simpler wording" disabled={!activeTerm.simpler}>
              <span />
            </button>
            <button type="button" className={textMode === "simpler" ? "is-active" : ""} onClick={() => handleTextMode("simpler")} disabled={!activeTerm.simpler}>Simpler</button>
          </section>
          {pendingSimpler && (
            <div className="simpler-confirmation" aria-live="polite">
              <p>This substitution may change the term’s nuance in this context.</p>
              <div>
                <button type="button" onClick={() => setPendingSimpler(false)}>Keep original</button>
                <button type="button" className="is-primary" onClick={() => applyTextMode("simpler")}>Apply simpler wording</button>
              </div>
            </div>
          )}

          <footer className="privacy-footer">
            <span><LockIcon />Stored locally</span>
            <button type="button" onClick={() => setShowLocalData((value) => !value)} aria-expanded={showLocalData}>How it works</button>
          </footer>
          {showLocalData && (
            <section className="local-data" aria-labelledby="local-data-heading">
              <div className="local-data-heading">
                <div>
                  <p className="context-label">Privacy &amp; control</p>
                  <h2 id="local-data-heading">Your local data</h2>
                </div>
                <button type="button" className="icon-button" onClick={() => setShowLocalData(false)} aria-label="Close local data controls"><CloseIcon /></button>
              </div>
              <p>Reading history stays in this browser. WitWitty stores sanitized links and never exports credentials or page tokens.</p>
              <dl className="storage-summary" aria-label="Stored record counts">
                <div><dt>Terms</dt><dd>{storageSummary?.terms ?? "—"}</dd></div>
                <div><dt>Encounters</dt><dd>{storageSummary?.encounters ?? "—"}</dd></div>
                <div><dt>Sources</dt><dd>{storageSummary?.sources ?? "—"}</dd></div>
              </dl>
              <div className="local-data-actions">
                <button type="button" onClick={handleExport}>Export JSON</button>
                <button type="button" onClick={() => setPendingDelete("term")}>Delete this term</button>
                <button type="button" onClick={() => setPendingDelete("site")}>Exclude this site</button>
                <button type="button" className="is-danger" onClick={() => setPendingDelete("all")}>Clear all history</button>
              </div>
              {pendingDelete && (
                <div className="delete-confirmation" role="alert">
                  <p>{pendingDelete === "term" && `Delete ${displayTerm} and every linked encounter?`}{pendingDelete === "site" && `Delete saved visits from ${activeTerm.source.domain} and stop scanning it?`}{pendingDelete === "all" && "Delete every term, source, review state, and preference on this device?"}</p>
                  <div>
                    <button type="button" onClick={() => setPendingDelete(null)}>Cancel</button>
                    <button type="button" className="is-danger" onClick={() => handleConfirmedDelete(pendingDelete)}>Confirm</button>
                  </div>
                </div>
              )}
              {privacyMessage && <p className="privacy-message" role="status">{privacyMessage}</p>}
              {!demo && <AiSettings />}
            </section>
          )}
          {selectedAction && <p className="save-confirmation" role="status">{actionLabel[selectedAction]} stored on this device.</p>}
          {statusMessage && <p className="storage-error" role="alert">{statusMessage}</p>}
        </div>
      )}
    </aside>
  );
}
