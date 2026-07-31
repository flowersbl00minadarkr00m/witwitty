export type LearningAction = "got-it" | "saved" | "not-jargon";
export type TextMode = "original" | "simpler";
export type KnownState = "new" | "known" | "saved" | "not-jargon";
export type ExplanationProvenance = "bundled" | "source" | "inferred" | "missing";
export type RecallOutcome = "again" | "hard" | "recalled";

export interface ExplanationAlternative {
  definition: string;
  domain: string;
}

export interface PageSource {
  url: string;
  title: string;
  domain: string;
}

export interface ActiveTerm {
  term: string;
  definition: string;
  sentenceExcerpt: string;
  source: PageSource;
  provenance: ExplanationProvenance;
  provenanceLabel: string;
  confidence: number;
  uncertainty?: string;
  simpler?: string;
  alternatives?: ExplanationAlternative[];
  /**
   * The same domain hints already computed for local resolution (design §5.1
   * — the AI context contract reuses `createContextPacket` verbatim). Carried
   * through the message pipeline so the panel can build an AI request packet
   * identical to what local resolution already saw, without re-deriving it.
   */
  domainHints?: string[];
}

export interface TermRecord {
  id: string;
  canonicalText: string;
  aliases: string[];
  knownState: KnownState;
  createdAt: string;
  updatedAt: string;
}

export interface SenseRecord {
  id: string;
  termId: string;
  definition: string;
  domain: string;
  provenanceType: ActiveTerm["provenance"];
  provenanceRef: string;
  confidence: number;
  acceptedByUser: boolean;
  createdAt: string;
}

export interface SourceRecord {
  id: string;
  sanitizedUrl: string;
  title: string;
  domain: string;
  firstSeenAt: string;
  lastSeenAt: string;
}

export interface EncounterRecord {
  id: string;
  termId: string;
  senseId: string;
  sourceId: string;
  sentenceExcerpt: string;
  encounteredAt: string;
  userAction: LearningAction;
  reviewImpact: "none" | "known" | "review-later";
  schemaVersion: 1;
}

export interface RelationshipRecord {
  id: string;
  fromId: string;
  toId: string;
  relationType: string;
  provenanceType: "deterministic" | "user" | "inferred";
  acceptedByUser: boolean;
  createdAt: string;
}

export interface ReviewStateRecord {
  termId: string;
  masteryState: "new" | "learning" | "strengthening" | "known";
  successfulRecalls: number;
  nextReviewAt: string | null;
  lastReviewedAt: string | null;
  updatedAt: string;
}

export interface ReviewQueueItem {
  termId: string;
  canonicalText: string;
  definition: string;
  provenanceLabel: string;
  sentenceExcerpt: string;
  sourceTitle: string;
  sourceDomain: string;
  sanitizedUrl: string | null;
  reviewState: ReviewStateRecord;
}

export interface PreferenceRecord {
  id: string;
  canonicalText?: string;
  domain?: string;
  createdAt: string;
}

export interface WitWittyExport {
  format: "witwitty-local-export";
  schemaVersion: 1;
  exportedAt: string;
  records: {
    terms: TermRecord[];
    senses: SenseRecord[];
    sources: SourceRecord[];
    encounters: EncounterRecord[];
    relationships: RelationshipRecord[];
    reviewStates: ReviewStateRecord[];
    preferences: PreferenceRecord[];
  };
}

export interface StorageSummary {
  terms: number;
  senses: number;
  sources: number;
  encounters: number;
  relationships: number;
  reviewStates: number;
  preferences: number;
}

export interface PriorEncounter {
  encounterId: string;
  senseId: string;
  title: string;
  domain: string;
  dateLabel: string;
  relativeLabel: string;
  excerpt: string;
  sanitizedUrl: string | null;
  encounteredAt: string;
  definition: string;
  provenanceLabel: string;
}

export type PanelStatus = "waiting" | "ready" | "scanning" | "empty" | "excluded" | "error";

export const SCAN_PROTOCOL_VERSION = 1;
export const EXTENSION_UPDATE_REASON = "extension-update-required";

export interface BrowserMessage {
  type: string;
  count?: number;
  candidateCount?: number;
  scanId?: string;
  error?: string;
  domain?: string;
  reason?: "access-lost" | "delivery-failed" | "unsupported-page" | "target-missing" | "target-stale" | "panel-open-failed" | "extension-update-required";
  retryable?: boolean;
  accepted?: boolean;
  protocolVersion?: number;
  payload?: ActiveTerm;
}

declare global {
  interface Window {
    __witWittyInstalled?: boolean;
    chrome?: {
      runtime?: {
        sendMessage: (message: unknown) => Promise<unknown> | void;
        onMessage: {
          addListener: (listener: (message: BrowserMessage) => void) => void;
          removeListener: (listener: (message: BrowserMessage) => void) => void;
        };
      };
    };
  }
}
