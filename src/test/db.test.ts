// @vitest-environment node
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  applyRetentionPolicy,
  DATABASE_NAME,
  DATABASE_VERSION,
  deleteAllData,
  deleteDatabaseForTests,
  deleteSourcesByDomain,
  deleteTermByCanonicalText,
  exportLocalData,
  getReviewState,
  getPriorEncounter,
  getDueReviewItems,
  getStorageSummary,
  openDatabase,
  persistLearningAction,
  putReviewState,
  recordReviewOutcome,
} from "../data/db";
import { stableId } from "../data/ids";
import type { ActiveTerm } from "../types";

const activeTerm: ActiveTerm = {
  term: "affordance",
  definition: "A feature that suggests how something can be used.",
  sentenceExcerpt: "The handle provides a clear affordance for opening the panel.",
  source: {
    url: "https://example.com/read?id=42&utm_source=newsletter&token=private#section",
    title: "A practical guide to product language",
    domain: "example.com",
  },
  provenance: "bundled",
  provenanceLabel: "WitWitty core",
  confidence: 0.96,
  simpler: "usage clue",
};

const openLegacyDatabase = () => new Promise<IDBDatabase>((resolve, reject) => {
  const request = indexedDB.open(DATABASE_NAME, 1);
  request.onerror = () => reject(request.error);
  request.onupgradeneeded = () => {
    request.result.createObjectStore("terms", { keyPath: "id" });
    request.result.createObjectStore("senses", { keyPath: "id" });
    request.result.createObjectStore("sources", { keyPath: "id" });
    request.result.createObjectStore("encounters", { keyPath: "id" });
    request.result.createObjectStore("relationships", { keyPath: "id" });
  };
  request.onsuccess = () => resolve(request.result);
});

describe("local data boundary", () => {
  beforeEach(deleteDatabaseForTests);
  afterEach(deleteDatabaseForTests);

  it("migrates the original stores without deleting them", async () => {
    const legacy = await openLegacyDatabase();
    legacy.close();

    const database = await openDatabase();
    expect(database.version).toBe(DATABASE_VERSION);
    expect([...database.objectStoreNames]).toEqual([
      "encounters", "preferences", "relationships", "reviewStates", "senses", "sources", "terms",
    ]);
    const transaction = database.transaction(["terms", "encounters"], "readonly");
    expect([...transaction.objectStore("terms").indexNames]).toContain("canonicalText");
    expect([...transaction.objectStore("encounters").indexNames]).toEqual(expect.arrayContaining(["termId", "sourceId", "encounteredAt"]));
    database.close();
  });

  it("persists idempotently and exports only sanitized source URLs", async () => {
    await persistLearningAction(activeTerm, "saved");
    await persistLearningAction(activeTerm, "saved");

    const summary = await getStorageSummary();
    expect(summary).toMatchObject({ terms: 1, senses: 1, sources: 1, encounters: 1 });
    const exported = await exportLocalData();
    expect(exported.format).toBe("witwitty-local-export");
    expect(exported.schemaVersion).toBe(1);
    expect(exported.records.sources[0].sanitizedUrl).toBe("https://example.com/read?id=42");
    expect(JSON.stringify(exported)).not.toMatch(/utm_source|private|\"token\"/i);
  });

  it("recovers review state after closing and reopening storage", async () => {
    const termId = stableId("term", activeTerm.term);
    await putReviewState({
      termId,
      masteryState: "learning",
      successfulRecalls: 2,
      nextReviewAt: "2026-07-22T12:00:00.000Z",
      lastReviewedAt: "2026-07-20T12:00:00.000Z",
      updatedAt: "2026-07-20T12:00:00.000Z",
    });

    await expect(getReviewState(termId)).resolves.toMatchObject({ masteryState: "learning", successfulRecalls: 2 });
  });

  it("persists due reviews, catches missed reviews, and advances recall", async () => {
    await persistLearningAction(activeTerm, "saved", new Date("2026-07-18T12:00:00.000Z"));
    expect(await getDueReviewItems(new Date("2026-07-18T18:00:00.000Z"))).toHaveLength(0);

    const overdue = await getDueReviewItems(new Date("2026-07-20T12:00:00.000Z"));
    expect(overdue).toHaveLength(1);
    expect(overdue[0]).toMatchObject({ canonicalText: "affordance", definition: activeTerm.definition, sourceDomain: "example.com" });

    const advanced = await recordReviewOutcome(overdue[0].termId, "recalled", new Date("2026-07-20T12:00:00.000Z"));
    expect(advanced).toMatchObject({ successfulRecalls: 1, nextReviewAt: "2026-07-23T12:00:00.000Z" });
    await expect(getReviewState(overdue[0].termId)).resolves.toEqual(advanced);
    expect(await getDueReviewItems(new Date("2026-07-22T12:00:00.000Z"))).toHaveLength(0);
    expect(await getDueReviewItems(new Date("2026-07-24T12:00:00.000Z"))).toHaveLength(1);
  });

  it("removes a term from review when it is marked Not jargon", async () => {
    await persistLearningAction(activeTerm, "saved", new Date("2026-07-18T12:00:00.000Z"));
    await persistLearningAction(activeTerm, "not-jargon", new Date("2026-07-19T12:00:00.000Z"));
    const termId = stableId("term", activeTerm.term);
    await expect(getReviewState(termId)).resolves.toBeUndefined();
    expect(await getDueReviewItems(new Date("2026-07-30T12:00:00.000Z"))).toHaveLength(0);
  });

  it("returns no history for a first encounter", async () => {
    await expect(getPriorEncounter("affordance")).resolves.toBeNull();
  });

  it("returns the latest joined encounter while keeping its sense distinct", async () => {
    const older = {
      ...activeTerm,
      definition: "A possibility for action suggested by an object.",
      source: { url: "https://older.example/article", title: "Designing visible actions", domain: "older.example" },
      sentenceExcerpt: "The shape suggests what action is possible.",
    };
    const newer = {
      ...activeTerm,
      definition: "A relationship between an actor and an environment that enables an action.",
      source: { url: "https://newer.example/field-notes?utm_source=mail", title: "Field notes on ecological psychology", domain: "newer.example" },
      sentenceExcerpt: "An affordance exists relative to an actor's capabilities.",
    };
    await persistLearningAction(older, "saved", new Date("2026-07-10T12:00:00.000Z"));
    await persistLearningAction(newer, "got-it", new Date("2026-07-15T12:00:00.000Z"));

    const prior = await getPriorEncounter("Affordance", new Date("2026-07-20T12:00:00.000Z"));
    expect(prior).toMatchObject({
      title: "Field notes on ecological psychology",
      domain: "newer.example",
      relativeLabel: "5 days ago",
      definition: newer.definition,
      sanitizedUrl: "https://newer.example/field-notes",
    });

    await deleteSourcesByDomain("newer.example");
    await expect(getPriorEncounter("affordance", new Date("2026-07-20T12:00:00.000Z"))).resolves.toMatchObject({
      title: "Designing visible actions",
      definition: older.definition,
    });
  });

  it("cascades term deletion through learning records and preferences", async () => {
    await persistLearningAction(activeTerm, "got-it");
    const termId = stableId("term", activeTerm.term);
    await putReviewState({
      termId,
      masteryState: "known",
      successfulRecalls: 3,
      nextReviewAt: null,
      lastReviewedAt: "2026-07-20T12:00:00.000Z",
      updatedAt: "2026-07-20T12:00:00.000Z",
    });

    await expect(deleteTermByCanonicalText("Affordance")).resolves.toBe(true);
    expect(await getStorageSummary()).toMatchObject({ terms: 0, senses: 0, encounters: 0, reviewStates: 0, preferences: 0, sources: 1 });
  });

  it("deletes site encounters while retaining learned terms", async () => {
    await persistLearningAction(activeTerm, "saved");
    await expect(deleteSourcesByDomain("example.com")).resolves.toBe(1);
    expect(await getStorageSummary()).toMatchObject({ terms: 1, senses: 1, sources: 0, encounters: 0 });
  });

  it("expires old encounters and supports a complete reset", async () => {
    await persistLearningAction(activeTerm, "saved");
    const future = new Date(Date.now() + 2 * 86_400_000);
    await expect(applyRetentionPolicy(1, future)).resolves.toEqual({ encounters: 1, sources: 1 });
    expect(await getStorageSummary()).toMatchObject({ terms: 1, sources: 0, encounters: 0 });

    await deleteAllData();
    expect(Object.values(await getStorageSummary()).every((count) => count === 0)).toBe(true);
  });
});
