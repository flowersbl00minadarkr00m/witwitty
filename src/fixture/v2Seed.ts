import { DATABASE_NAME, DATABASE_VERSION } from "../data/db";
import type {
  EncounterRecord,
  PreferenceRecord,
  RelationshipRecord,
  ReviewStateRecord,
  SenseRecord,
  SourceRecord,
  TermRecord,
} from "../types";

export const FIXTURE_SEED_CREATED_AT = "2026-07-01T09:00:00.000Z";

export interface ExistingV2Seed {
  terms: TermRecord[];
  senses: SenseRecord[];
  sources: SourceRecord[];
  encounters: EncounterRecord[];
  relationships: RelationshipRecord[];
  reviewStates: ReviewStateRecord[];
  preferences: PreferenceRecord[];
}

export const createExistingV2Seed = (): ExistingV2Seed => ({
  terms: [{
    id: "fixture-term-idempotent",
    canonicalText: "idempotent",
    aliases: ["idempotency"],
    knownState: "saved",
    createdAt: FIXTURE_SEED_CREATED_AT,
    updatedAt: FIXTURE_SEED_CREATED_AT,
  }],
  senses: [{
    id: "fixture-sense-idempotent-systems",
    termId: "fixture-term-idempotent",
    definition: "Safe to repeat without creating another result.",
    domain: "fixtures.local",
    provenanceType: "bundled",
    provenanceRef: "witwitty-core-v1",
    confidence: 1,
    acceptedByUser: true,
    createdAt: FIXTURE_SEED_CREATED_AT,
  }],
  sources: [{
    id: "fixture-source-long-form",
    sanitizedUrl: "http://127.0.0.1:4173/long-form.html",
    title: "Reliable systems fixture",
    domain: "127.0.0.1",
    firstSeenAt: FIXTURE_SEED_CREATED_AT,
    lastSeenAt: FIXTURE_SEED_CREATED_AT,
  }],
  encounters: [{
    id: "fixture-encounter-idempotent-long-form",
    termId: "fixture-term-idempotent",
    senseId: "fixture-sense-idempotent-systems",
    sourceId: "fixture-source-long-form",
    sentenceExcerpt: "An idempotent operation supports safe retries without duplicating the result.",
    encounteredAt: FIXTURE_SEED_CREATED_AT,
    userAction: "saved",
    reviewImpact: "review-later",
    schemaVersion: 1,
  }],
  relationships: [{
    id: "fixture-relationship-idempotent-retry",
    fromId: "fixture-term-idempotent",
    toId: "fixture-sense-idempotent-systems",
    relationType: "explains",
    provenanceType: "deterministic",
    acceptedByUser: true,
    createdAt: FIXTURE_SEED_CREATED_AT,
  }],
  reviewStates: [{
    termId: "fixture-term-idempotent",
    masteryState: "learning",
    successfulRecalls: 1,
    nextReviewAt: "2026-07-02T09:00:00.000Z",
    lastReviewedAt: "2026-07-01T09:00:00.000Z",
    updatedAt: FIXTURE_SEED_CREATED_AT,
  }],
  preferences: [{
    id: "saved:idempotent",
    canonicalText: "idempotent",
    createdAt: FIXTURE_SEED_CREATED_AT,
  }],
});

const stores = ["terms", "senses", "sources", "encounters", "relationships", "reviewStates", "preferences"] as const;

const requestResult = <T>(request: IDBRequest<T>): Promise<T> => new Promise((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

const transactionDone = (transaction: IDBTransaction): Promise<void> => new Promise((resolve, reject) => {
  transaction.oncomplete = () => resolve();
  transaction.onerror = () => reject(transaction.error);
  transaction.onabort = () => reject(transaction.error);
});

const ensureIndex = (store: IDBObjectStore, name: string, keyPath: string) => {
  if (!store.indexNames.contains(name)) store.createIndex(name, keyPath, { unique: false });
};

const openFixtureDatabase = (): Promise<IDBDatabase> => new Promise((resolve, reject) => {
  const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
  request.onerror = () => reject(request.error);
  request.onblocked = () => reject(new Error("Fixture storage upgrade is blocked by another open tab."));
  request.onsuccess = () => resolve(request.result);
  request.onupgradeneeded = () => {
    const database = request.result;
    const upgrade = request.transaction;
    if (!upgrade) throw new Error("Fixture storage upgrade transaction is missing.");
    const terms = database.objectStoreNames.contains("terms") ? upgrade.objectStore("terms") : database.createObjectStore("terms", { keyPath: "id" });
    ensureIndex(terms, "canonicalText", "canonicalText");
    const senses = database.objectStoreNames.contains("senses") ? upgrade.objectStore("senses") : database.createObjectStore("senses", { keyPath: "id" });
    ensureIndex(senses, "termId", "termId");
    const sources = database.objectStoreNames.contains("sources") ? upgrade.objectStore("sources") : database.createObjectStore("sources", { keyPath: "id" });
    ensureIndex(sources, "domain", "domain");
    const encounters = database.objectStoreNames.contains("encounters") ? upgrade.objectStore("encounters") : database.createObjectStore("encounters", { keyPath: "id" });
    ensureIndex(encounters, "termId", "termId");
    ensureIndex(encounters, "sourceId", "sourceId");
    ensureIndex(encounters, "encounteredAt", "encounteredAt");
    if (!database.objectStoreNames.contains("relationships")) database.createObjectStore("relationships", { keyPath: "id" });
    if (!database.objectStoreNames.contains("reviewStates")) database.createObjectStore("reviewStates", { keyPath: "termId" });
    if (!database.objectStoreNames.contains("preferences")) database.createObjectStore("preferences", { keyPath: "id" });
  };
});

export const seedExistingV2Database = async (): Promise<Record<(typeof stores)[number], number>> => {
  const seed = createExistingV2Seed();
  const database = await openFixtureDatabase();
  const transaction = database.transaction(stores, "readwrite");
  stores.forEach((store) => seed[store].forEach((record) => transaction.objectStore(store).put(record)));
  await transactionDone(transaction);

  const read = database.transaction(stores, "readonly");
  const counts = {} as Record<(typeof stores)[number], number>;
  for (const store of stores) counts[store] = await requestResult(read.objectStore(store).count());
  await transactionDone(read);
  database.close();
  return counts;
};
