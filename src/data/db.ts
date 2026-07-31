import type {
  ActiveTerm,
  EncounterRecord,
  LearningAction,
  PreferenceRecord,
  PriorEncounter,
  RecallOutcome,
  RelationshipRecord,
  ReviewQueueItem,
  ReviewStateRecord,
  SenseRecord,
  SourceRecord,
  StorageSummary,
  TermRecord,
  WitWittyExport,
} from "../types";
import { stableId } from "./ids";
import { formatEncounterDate, formatRelativeEncounter } from "./history";
import { initialReviewState, isReviewDue, scheduleReviewOutcome } from "../core/review";
import { sanitizeUrl } from "./url";

export const DATABASE_NAME = "witwitty";
export const DATABASE_VERSION = 2;
export const EXPORT_SCHEMA_VERSION = 1;

const STORES = {
  terms: "terms",
  senses: "senses",
  sources: "sources",
  encounters: "encounters",
  relationships: "relationships",
  reviewStates: "reviewStates",
  preferences: "preferences",
} as const;

type StoreName = (typeof STORES)[keyof typeof STORES];

const requestResult = <T>(request: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

const transactionDone = (transaction: IDBTransaction): Promise<void> =>
  new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });

const ensureIndex = (store: IDBObjectStore, name: string, keyPath: string) => {
  if (!store.indexNames.contains(name)) store.createIndex(name, keyPath, { unique: false });
};

export const openDatabase = (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("WitWitty local storage upgrade is blocked by another open tab."));
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = () => {
      const database = request.result;
      const upgrade = request.transaction;
      if (!upgrade) throw new Error("Missing IndexedDB upgrade transaction.");

      const terms = database.objectStoreNames.contains(STORES.terms)
        ? upgrade.objectStore(STORES.terms)
        : database.createObjectStore(STORES.terms, { keyPath: "id" });
      ensureIndex(terms, "canonicalText", "canonicalText");

      const senses = database.objectStoreNames.contains(STORES.senses)
        ? upgrade.objectStore(STORES.senses)
        : database.createObjectStore(STORES.senses, { keyPath: "id" });
      ensureIndex(senses, "termId", "termId");

      const sources = database.objectStoreNames.contains(STORES.sources)
        ? upgrade.objectStore(STORES.sources)
        : database.createObjectStore(STORES.sources, { keyPath: "id" });
      ensureIndex(sources, "domain", "domain");

      const encounters = database.objectStoreNames.contains(STORES.encounters)
        ? upgrade.objectStore(STORES.encounters)
        : database.createObjectStore(STORES.encounters, { keyPath: "id" });
      ensureIndex(encounters, "termId", "termId");
      ensureIndex(encounters, "sourceId", "sourceId");
      ensureIndex(encounters, "encounteredAt", "encounteredAt");

      const relationships = database.objectStoreNames.contains(STORES.relationships)
        ? upgrade.objectStore(STORES.relationships)
        : database.createObjectStore(STORES.relationships, { keyPath: "id" });
      ensureIndex(relationships, "fromId", "fromId");
      ensureIndex(relationships, "toId", "toId");

      if (!database.objectStoreNames.contains(STORES.reviewStates)) database.createObjectStore(STORES.reviewStates, { keyPath: "termId" });
      if (!database.objectStoreNames.contains(STORES.preferences)) database.createObjectStore(STORES.preferences, { keyPath: "id" });
    };
  });

const allRecords = <T>(transaction: IDBTransaction, store: StoreName): Promise<T[]> =>
  requestResult(transaction.objectStore(store).getAll()) as Promise<T[]>;

const containsSensitiveKey = (value: unknown): boolean => {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some(containsSensitiveKey);
  return Object.entries(value).some(([key, child]) => /api.?key|auth|password|secret|session|token/i.test(key) || containsSensitiveKey(child));
};

export const validateExport = (value: WitWittyExport): WitWittyExport => {
  if (value.format !== "witwitty-local-export" || value.schemaVersion !== EXPORT_SCHEMA_VERSION) throw new Error("Unsupported WitWitty export format.");
  const collections = Object.values(value.records);
  if (!collections.every(Array.isArray)) throw new Error("WitWitty export records must be arrays.");
  if (containsSensitiveKey(value)) throw new Error("WitWitty exports cannot contain secret-bearing fields.");
  return value;
};

export const persistLearningAction = async (activeTerm: ActiveTerm, action: LearningAction, occurredAt = new Date()): Promise<void> => {
  const database = await openDatabase();
  const now = occurredAt.toISOString();
  const sanitizedUrl = sanitizeUrl(activeTerm.source.url);
  const canonicalText = activeTerm.term.trim().toLocaleLowerCase();
  const termId = stableId("term", canonicalText);
  const sourceId = stableId("source", sanitizedUrl || activeTerm.source.domain);
  const senseId = stableId("sense", `${termId}:${activeTerm.definition}:${activeTerm.source.domain}`);
  const encounterId = stableId("encounter", `${termId}:${sourceId}:${activeTerm.sentenceExcerpt}:${action}`);
  const transaction = database.transaction([STORES.terms, STORES.senses, STORES.sources, STORES.encounters, STORES.reviewStates, STORES.preferences], "readwrite");

  const [existingTerm, existingSense, existingSource, existingReviewState] = await Promise.all([
    requestResult(transaction.objectStore(STORES.terms).get(termId)) as Promise<TermRecord | undefined>,
    requestResult(transaction.objectStore(STORES.senses).get(senseId)) as Promise<SenseRecord | undefined>,
    requestResult(transaction.objectStore(STORES.sources).get(sourceId)) as Promise<SourceRecord | undefined>,
    requestResult(transaction.objectStore(STORES.reviewStates).get(termId)) as Promise<ReviewStateRecord | undefined>,
  ]);

  const term: TermRecord = {
    id: termId,
    canonicalText,
    aliases: existingTerm?.aliases ?? [],
    knownState: action === "got-it" ? "known" : action === "saved" ? "saved" : "not-jargon",
    createdAt: existingTerm?.createdAt ?? now,
    updatedAt: now,
  };
  const sense: SenseRecord = {
    id: senseId,
    termId,
    definition: activeTerm.definition,
    domain: activeTerm.source.domain,
    provenanceType: activeTerm.provenance,
    provenanceRef: activeTerm.provenance === "bundled" ? "witwitty-core-v1" : activeTerm.provenanceLabel || sanitizedUrl,
    confidence: activeTerm.confidence,
    acceptedByUser: action !== "not-jargon",
    createdAt: existingSense?.createdAt ?? now,
  };
  const source: SourceRecord = {
    id: sourceId,
    sanitizedUrl,
    title: activeTerm.source.title.slice(0, 200),
    domain: activeTerm.source.domain.slice(0, 120),
    firstSeenAt: existingSource?.firstSeenAt ?? now,
    lastSeenAt: now,
  };
  const encounter: EncounterRecord = {
    id: encounterId,
    termId,
    senseId,
    sourceId,
    sentenceExcerpt: activeTerm.sentenceExcerpt.replace(/\s+/g, " ").trim().slice(0, 280),
    encounteredAt: now,
    userAction: action,
    reviewImpact: action === "got-it" ? "known" : action === "saved" ? "review-later" : "none",
    schemaVersion: 1,
  };

  transaction.objectStore(STORES.terms).put(term);
  transaction.objectStore(STORES.senses).put(sense);
  transaction.objectStore(STORES.sources).put(source);
  transaction.objectStore(STORES.encounters).put(encounter);
  if (action === "not-jargon") {
    transaction.objectStore(STORES.reviewStates).delete(termId);
  } else if (!existingReviewState) {
    transaction.objectStore(STORES.reviewStates).put(initialReviewState(termId, action, occurredAt));
  }
  if (action === "not-jargon" || action === "got-it") {
    const preference: PreferenceRecord = { id: `${action}:${canonicalText}`, canonicalText, createdAt: now };
    transaction.objectStore(STORES.preferences).put(preference);
  }

  await transactionDone(transaction);
  database.close();
};

export const putReviewState = async (state: ReviewStateRecord): Promise<void> => {
  const database = await openDatabase();
  const transaction = database.transaction(STORES.reviewStates, "readwrite");
  transaction.objectStore(STORES.reviewStates).put(state);
  await transactionDone(transaction);
  database.close();
};

export const getReviewState = async (termId: string): Promise<ReviewStateRecord | undefined> => {
  const database = await openDatabase();
  const transaction = database.transaction(STORES.reviewStates, "readonly");
  const state = await requestResult(transaction.objectStore(STORES.reviewStates).get(termId)) as ReviewStateRecord | undefined;
  await transactionDone(transaction);
  database.close();
  return state;
};

export const recordReviewOutcome = async (termId: string, outcome: RecallOutcome, now = new Date()): Promise<ReviewStateRecord> => {
  const database = await openDatabase();
  const transaction = database.transaction(STORES.reviewStates, "readwrite");
  const store = transaction.objectStore(STORES.reviewStates);
  const current = await requestResult(store.get(termId)) as ReviewStateRecord | undefined;
  if (!current) {
    transaction.abort();
    database.close();
    throw new Error("Review state was not found for this term.");
  }
  const next = scheduleReviewOutcome(current, outcome, now);
  store.put(next);
  await transactionDone(transaction);
  database.close();
  return next;
};

const provenanceLabelForSense = (sense: SenseRecord): string => {
  if (sense.provenanceType === "bundled") return "Reviewed local definition";
  if (sense.provenanceType === "source") return "Definition from source";
  if (sense.provenanceType === "inferred") return "Contextual interpretation";
  return "Definition unavailable";
};

export const getPriorEncounter = async (canonicalText: string, now = new Date()): Promise<PriorEncounter | null> => {
  const database = await openDatabase();
  const transaction = database.transaction([STORES.senses, STORES.sources, STORES.encounters], "readonly");
  const termId = stableId("term", canonicalText.trim().toLocaleLowerCase());
  const [encounters, senses, sources] = await Promise.all([
    requestResult(transaction.objectStore(STORES.encounters).index("termId").getAll(termId)) as Promise<EncounterRecord[]>,
    allRecords<SenseRecord>(transaction, STORES.senses),
    allRecords<SourceRecord>(transaction, STORES.sources),
  ]);
  await transactionDone(transaction);
  database.close();

  const senseById = new Map(senses.map((sense) => [sense.id, sense]));
  const sourceById = new Map(sources.map((source) => [source.id, source]));
  const joined = encounters
    .map((encounter) => ({ encounter, sense: senseById.get(encounter.senseId), source: sourceById.get(encounter.sourceId) }))
    .filter((record): record is { encounter: EncounterRecord; sense: SenseRecord; source: SourceRecord } => Boolean(record.sense && record.source))
    .sort((left, right) => right.encounter.encounteredAt.localeCompare(left.encounter.encounteredAt));
  const latest = joined[0];
  if (!latest) return null;

  return {
    encounterId: latest.encounter.id,
    senseId: latest.sense.id,
    title: latest.source.title,
    domain: latest.source.domain,
    dateLabel: formatEncounterDate(latest.encounter.encounteredAt),
    relativeLabel: formatRelativeEncounter(latest.encounter.encounteredAt, now),
    excerpt: latest.encounter.sentenceExcerpt,
    sanitizedUrl: latest.source.sanitizedUrl || null,
    encounteredAt: latest.encounter.encounteredAt,
    definition: latest.sense.definition,
    provenanceLabel: provenanceLabelForSense(latest.sense),
  };
};

export const getDueReviewItems = async (now = new Date(), limit = 10): Promise<ReviewQueueItem[]> => {
  const database = await openDatabase();
  const transaction = database.transaction([STORES.terms, STORES.senses, STORES.sources, STORES.encounters, STORES.reviewStates], "readonly");
  const [terms, senses, sources, encounters, reviewStates] = await Promise.all([
    allRecords<TermRecord>(transaction, STORES.terms),
    allRecords<SenseRecord>(transaction, STORES.senses),
    allRecords<SourceRecord>(transaction, STORES.sources),
    allRecords<EncounterRecord>(transaction, STORES.encounters),
    allRecords<ReviewStateRecord>(transaction, STORES.reviewStates),
  ]);
  await transactionDone(transaction);
  database.close();

  const termById = new Map(terms.map((term) => [term.id, term]));
  const senseById = new Map(senses.map((sense) => [sense.id, sense]));
  const sourceById = new Map(sources.map((source) => [source.id, source]));
  const latestEncounterByTerm = new Map<string, EncounterRecord>();
  [...encounters]
    .sort((left, right) => right.encounteredAt.localeCompare(left.encounteredAt))
    .forEach((encounter) => {
      if (!latestEncounterByTerm.has(encounter.termId) && senseById.has(encounter.senseId) && sourceById.has(encounter.sourceId)) {
        latestEncounterByTerm.set(encounter.termId, encounter);
      }
    });

  return reviewStates
    .filter((state) => isReviewDue(state, now))
    .sort((left, right) => (left.nextReviewAt || "").localeCompare(right.nextReviewAt || ""))
    .slice(0, Math.max(0, limit))
    .flatMap((reviewState) => {
      const term = termById.get(reviewState.termId);
      const encounter = latestEncounterByTerm.get(reviewState.termId);
      const sense = encounter ? senseById.get(encounter.senseId) : undefined;
      const source = encounter ? sourceById.get(encounter.sourceId) : undefined;
      if (!term || term.knownState === "not-jargon" || !encounter || !sense || !source) return [];
      return [{
        termId: term.id,
        canonicalText: term.canonicalText,
        definition: sense.definition,
        provenanceLabel: provenanceLabelForSense(sense),
        sentenceExcerpt: encounter.sentenceExcerpt,
        sourceTitle: source.title,
        sourceDomain: source.domain,
        sanitizedUrl: source.sanitizedUrl || null,
        reviewState,
      }];
    });
};

export const getDueReviewCount = async (now = new Date()): Promise<number> => (await getDueReviewItems(now, Number.MAX_SAFE_INTEGER)).length;

export const getStorageSummary = async (): Promise<StorageSummary> => {
  const database = await openDatabase();
  const transaction = database.transaction(Object.values(STORES), "readonly");
  const entries = await Promise.all(Object.entries(STORES).map(async ([key, store]) => [key, await requestResult(transaction.objectStore(store).count())] as const));
  await transactionDone(transaction);
  database.close();
  return Object.fromEntries(entries) as unknown as StorageSummary;
};

export const exportLocalData = async (): Promise<WitWittyExport> => {
  const database = await openDatabase();
  const transaction = database.transaction(Object.values(STORES), "readonly");
  const [terms, senses, sources, encounters, relationships, reviewStates, preferences] = await Promise.all([
    allRecords<TermRecord>(transaction, STORES.terms),
    allRecords<SenseRecord>(transaction, STORES.senses),
    allRecords<SourceRecord>(transaction, STORES.sources),
    allRecords<EncounterRecord>(transaction, STORES.encounters),
    allRecords<RelationshipRecord>(transaction, STORES.relationships),
    allRecords<ReviewStateRecord>(transaction, STORES.reviewStates),
    allRecords<PreferenceRecord>(transaction, STORES.preferences),
  ]);
  await transactionDone(transaction);
  database.close();
  return validateExport({
    format: "witwitty-local-export",
    schemaVersion: EXPORT_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    records: { terms, senses, sources, encounters, relationships, reviewStates, preferences },
  });
};

export const deleteTerm = async (termId: string): Promise<void> => {
  const database = await openDatabase();
  const transaction = database.transaction(Object.values(STORES), "readwrite");
  const term = await requestResult(transaction.objectStore(STORES.terms).get(termId)) as TermRecord | undefined;
  const [senses, encounters, relationships] = await Promise.all([
    allRecords<SenseRecord>(transaction, STORES.senses),
    allRecords<EncounterRecord>(transaction, STORES.encounters),
    allRecords<RelationshipRecord>(transaction, STORES.relationships),
  ]);
  transaction.objectStore(STORES.terms).delete(termId);
  transaction.objectStore(STORES.reviewStates).delete(termId);
  senses.filter((sense) => sense.termId === termId).forEach((sense) => transaction.objectStore(STORES.senses).delete(sense.id));
  encounters.filter((encounter) => encounter.termId === termId).forEach((encounter) => transaction.objectStore(STORES.encounters).delete(encounter.id));
  relationships.filter((relationship) => relationship.fromId === termId || relationship.toId === termId).forEach((relationship) => transaction.objectStore(STORES.relationships).delete(relationship.id));
  if (term) {
    const preferences = await allRecords<PreferenceRecord>(transaction, STORES.preferences);
    preferences.filter((preference) => preference.canonicalText === term.canonicalText).forEach((preference) => transaction.objectStore(STORES.preferences).delete(preference.id));
  }
  await transactionDone(transaction);
  database.close();
};

export const deleteTermByCanonicalText = async (canonicalText: string): Promise<boolean> => {
  const database = await openDatabase();
  const transaction = database.transaction(STORES.terms, "readonly");
  const terms = await allRecords<TermRecord>(transaction, STORES.terms);
  await transactionDone(transaction);
  database.close();
  const term = terms.find((record) => record.canonicalText === canonicalText.trim().toLocaleLowerCase());
  if (!term) return false;
  await deleteTerm(term.id);
  return true;
};

export const deleteSource = async (sourceId: string): Promise<void> => {
  const database = await openDatabase();
  const transaction = database.transaction([STORES.sources, STORES.encounters], "readwrite");
  const encounters = await allRecords<EncounterRecord>(transaction, STORES.encounters);
  encounters.filter((encounter) => encounter.sourceId === sourceId).forEach((encounter) => transaction.objectStore(STORES.encounters).delete(encounter.id));
  transaction.objectStore(STORES.sources).delete(sourceId);
  await transactionDone(transaction);
  database.close();
};

export const deleteSourcesByDomain = async (domain: string): Promise<number> => {
  const database = await openDatabase();
  const transaction = database.transaction([STORES.sources, STORES.encounters], "readwrite");
  const [sources, encounters] = await Promise.all([
    allRecords<SourceRecord>(transaction, STORES.sources),
    allRecords<EncounterRecord>(transaction, STORES.encounters),
  ]);
  const matching = sources.filter((source) => source.domain === domain);
  const sourceIds = new Set(matching.map((source) => source.id));
  matching.forEach((source) => transaction.objectStore(STORES.sources).delete(source.id));
  encounters.filter((encounter) => sourceIds.has(encounter.sourceId)).forEach((encounter) => transaction.objectStore(STORES.encounters).delete(encounter.id));
  await transactionDone(transaction);
  database.close();
  return matching.length;
};

export const applyRetentionPolicy = async (retentionDays: number, now = new Date()): Promise<{ encounters: number; sources: number }> => {
  if (!Number.isFinite(retentionDays) || retentionDays < 1) throw new Error("Retention must be at least one day.");
  const cutoff = new Date(now.getTime() - retentionDays * 86_400_000).toISOString();
  const database = await openDatabase();
  const transaction = database.transaction([STORES.sources, STORES.encounters], "readwrite");
  const [sources, encounters] = await Promise.all([
    allRecords<SourceRecord>(transaction, STORES.sources),
    allRecords<EncounterRecord>(transaction, STORES.encounters),
  ]);
  const expired = encounters.filter((encounter) => encounter.encounteredAt < cutoff);
  expired.forEach((encounter) => transaction.objectStore(STORES.encounters).delete(encounter.id));
  const retainedSourceIds = new Set(encounters.filter((encounter) => encounter.encounteredAt >= cutoff).map((encounter) => encounter.sourceId));
  const orphanedSources = sources.filter((source) => !retainedSourceIds.has(source.id));
  orphanedSources.forEach((source) => transaction.objectStore(STORES.sources).delete(source.id));
  await transactionDone(transaction);
  database.close();
  return { encounters: expired.length, sources: orphanedSources.length };
};

export const deleteAllData = async (): Promise<void> => {
  const database = await openDatabase();
  const transaction = database.transaction(Object.values(STORES), "readwrite");
  Object.values(STORES).forEach((store) => transaction.objectStore(store).clear());
  await transactionDone(transaction);
  database.close();
};

export const deleteDatabaseForTests = (): Promise<void> =>
  new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DATABASE_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("Test database deletion was blocked."));
  });
