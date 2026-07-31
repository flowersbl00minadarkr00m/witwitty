// @vitest-environment node
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { deleteDatabaseForTests, getStorageSummary } from "../data/db";
import { createExistingV2Seed, seedExistingV2Database } from "../fixture/v2Seed";

const appRoot = resolve(import.meta.dirname, "../..");

describe("release stabilization fixtures", () => {
  beforeEach(deleteDatabaseForTests);
  afterEach(deleteDatabaseForTests);

  it("defines deterministic synthetic pages for every required fixture scenario", async () => {
    const pages = ["index.html", "long-form.html", "protected.html", "ambiguous-missing.html", "excluded.html", "performance.html"];
    await Promise.all(pages.map(async (page) => expect(await readFile(resolve(appRoot, "fixtures", "site", page), "utf8")).toContain("<!doctype html>")));
    expect(await readFile(resolve(appRoot, "fixtures", "site", "long-form.html"), "utf8")).toContain("idempotent");
    expect(await readFile(resolve(appRoot, "fixtures", "site", "protected.html"), "utf8")).toMatch(/textarea|<math/i);
    expect(await readFile(resolve(appRoot, "fixtures", "site", "ambiguous-missing.html"), "utf8")).toContain("SLO");
  });

  it("populates all seven existing IndexedDB v2 stores with linked records", async () => {
    const seed = createExistingV2Seed();
    expect(Object.values(seed).every((records) => records.length > 0)).toBe(true);
    expect(seed.senses[0].termId).toBe(seed.terms[0].id);
    expect(seed.encounters[0]).toMatchObject({ termId: seed.terms[0].id, senseId: seed.senses[0].id, sourceId: seed.sources[0].id });
    expect(seed.relationships[0]).toMatchObject({ fromId: seed.terms[0].id, toId: seed.senses[0].id });
    expect(await seedExistingV2Database()).toEqual({ terms: 1, senses: 1, sources: 1, encounters: 1, relationships: 1, reviewStates: 1, preferences: 1 });
    expect(await getStorageSummary()).toEqual({ terms: 1, senses: 1, sources: 1, encounters: 1, relationships: 1, reviewStates: 1, preferences: 1 });
  });

  it("keeps fixture-only paths and seeds out of the normal production manifest", async () => {
    const manifest = await readFile(resolve(appRoot, "public", "manifest.json"), "utf8");
    expect(manifest).not.toMatch(/fixture|seed/i);
  });
});
