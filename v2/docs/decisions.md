# Source authority and material decisions

## Windows continuation — 4 October 2026

The approved WitWitty-AR Notion page and its parent were retrieved again. Search found no newer approved WitWitty-specific replacement. The child's approved design remains authoritative; later parent-page publication edits do not approve a new product scope. The supplied handoff package passed SHA-256 verification for all 207 manifest entries.

The additions were applied to a full checkout at the same upstream base, on `feat/witwitty-2-spatial-lens`. The registry now routes the separate WitWitty-AR project to its own canonical checkout. The older WitWitty project and its SDD records were not edited.

Native verification found and fixed three integration issues: MediaPipe needed a classic worker global for its WASM loader; a stale camera permission failure could stop a new capture session; and legacy Vitest discovered the V2 Node tests. The typed detector still runs in the shared local worker, stale starts now leave new sessions alone, and V2 Node tests use `*.node.mjs`. No legacy source or dependency files were changed. The native test runner uses pinned Playwright 1.63.0 for Chromium's extension action debugging command.

The constraints below describe the original implementation environment. They no longer describe the Windows continuation. See verification and the current handoff for fresh results.

## Sources read before implementation

1. **Build Witwitty 2.0.txt**, supplied with the implementation request. This is the specific V1 clarification layer, including the final parallel-input-adapter decision, deterministic reference path, approved-only reversible lens and broad autonomous build mandate.
2. **WitWitty-AR — Approved Requirements & Design Decisions**, Notion page `3e0df086-8287-81a9-a708-f31af348daeb`. The connected page was retrieved, not inferred from a prior summary. Its September 19 approved material is the design authority beneath the attached clarification.
3. **Sim You Later — Five Thinkers, Five AI Experiments**, parent page `3d3df086-8287-81ed-b31a-eb81d19d3884`, retrieved from connected Notion. Its later parent-page edit time is not treated as blanket supersession of the approved WitWitty child decisions. Search did not reveal a newer explicitly approved WitWitty-specific replacement.
4. Repository README, package metadata, architecture, file tree, branch/ref metadata and license for `flowersbl00minadarkr00m/witwitty`, default branch `master`, inspected base commit `fdc2a3c24fa62aaa76b1a3a03c8af07e16dc0b94`.

Notion references:
- https://app.notion.com/p/3e0df086828781a9a708f31af348daeb?pvs=204
- https://app.notion.com/p/3d3df086828781edb31aeb81d19d3884?pvs=204

## Material choices

**Additive V2, not a destructive legacy replacement.** The existing repository already implements a different, working V0.1 jargon reader. All new implementation files live under `v2/`, with one new workflow. The legacy root package, pnpm lockfile, source, app, README and release behavior remain untouched. Its tests were not rerun in the constrained partial checkout; no claim of a tested legacy migration is made.

**Dependency-light shared core.** The existing TypeScript compiler can build the new code. The browser UI uses native DOM/Shadow DOM, and the companion uses Node built-ins. This avoids a second dependency installation and lets demo/extension consume the same modules directly. It is the mandatory shared-package principle with fewer packaging layers, not a different semantic engine for each input or surface.

**Original technical article.** The Meridian narrative and its fixtures were written for this implementation and licensed under the repository's MIT terms. Meridian is a fictional teaching system; it is not a benchmark, a third-party article or a claim that a real product implements those guarantees. No philosophy-themed UI or copied article was substituted.

**Explicitly bounded scope.** A coherent Section/Document overview is supported for at most 12,000 selected characters; larger scopes receive block-local Explain with a visible notice. A 500-block operation cap fails explicitly. The index caps at 2,000 blocks/250,000 characters and omits oversized individual blocks visibly. These bounds preserve deterministic resource use and avoid hidden truncation.

**No invented generation on unknown text.** Curated demo fixtures are meaningful; arbitrary content in fixture mode remains a clearly labeled preview or unchanged rewrite. Real generative behavior is wired through the companion. The fixture reviewer is not marketed as Jev assurance.

**Learned classifier implementation, not an empty stub.** The extension has locally fitted prototypes, abstention, class-separation/variance checks, persistence and per-gesture reset. The live assets and physical calibration still require an unrestricted local machine. Synthetic performance is not a claim of real-hand accuracy.

**Real Jev API, no guessed generic chat endpoint.** The concrete adapter uses the documented TypeSafe `systemone`/`noul` schema. Routing is deterministic code; Jev's role is quality review. Thresholds are an explicit initial policy rather than empirically calibrated guarantees.

**Narrow browser origin.** A committed public development key stabilizes the unpacked extension origin used by the companion allowlist. No private signing key was retained. Only localhost companion access is a host permission; ordinary-page access is explicit `activeTab` activation.

## Execution constraints, not product substitutions

Direct Git network downloads and package downloads were unavailable. Connected GitHub reads succeeded, but the write operation to create `feat/witwitty-2-spatial-lens` was denied with HTTP 403, `Resource not accessible by integration`. Consequently, the implementation was built in an additive local workspace rather than represented as a successfully cloned/pushed repository. The handoff patch contains new paths only.

Chromium navigation was administratively blocked, including localhost and file navigation. No browser-policy bypass was attempted. The offline DOM harness packages compiled modules and replaces explicitly documented platform boundaries; real DOM/layout/events execute in Chromium. Real Node HTTP companion tests run separately. A normal native-origin Playwright path and pinned CI workflow are included, but their successful execution is not claimed.
