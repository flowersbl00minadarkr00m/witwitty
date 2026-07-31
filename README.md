# WitWitty

This directory contains the first runnable P0 Context Lens desktop-extension increment.

## What works

- Manifest V3 side-panel shell for Chromium desktop browsers.
- Explicit, user-triggered active-tab analysis; no background page scanning.
- Conservative deterministic candidate ranking with inspectable evidence.
- Reviewed local terminology with domain-aware sense selection and provenance.
- Known-term, Not jargon, and definition-present suppression.
- Unexplained acronym detection that fails closed instead of inventing a meaning.
- Accessible mint annotations that preserve the underlying article.
- Active-term panel matching the approved Context Lens visual contract.
- Got it, Save, Not jargon, Compare contexts, and Original/Simpler interactions.
- Versioned IndexedDB persistence for terms, senses, sources, encounters, relationships, review state, and preferences.
- Versioned JSON export, retention cleanup, per-term/per-site cascade deletion, and complete local reset.
- URL sanitization, excluded-domain settings, private-window safeguards, and stable deterministic record identifiers.
- A compact local-data drawer in Context Lens with record counts and two-step destructive confirmations.
- Production Last Seen lookup joined from live encounter, sense, and source records, with relative time and sanitized reopening links.
- Context comparison that keeps current and prior meanings, excerpts, domains, and provenance visibly distinct.
- Deterministic spaced-review scheduling with restart-safe due timestamps and mastery state.
- Recall-before-reveal review, three honest self-assessment outcomes, and a compact due indicator without streak mechanics.
- Exact Original/Simpler text restoration with protected links, code, formulas, controls, and editable regions.
- Explicit confirmation before applying a simpler phrase when contextual confidence is below 80%.
- Designed scanning, empty, error, first-encounter, active-term, ambiguous-sense, and missing-definition states.

The activity-dashboard event taxonomy from `witwitty-activity-dashboard-handoff.md` is not included in this increment because it remains an unapproved recommendation.

## Run the visual demo

```powershell
pnpm install
pnpm dev
```

Open `http://127.0.0.1:5173/demo.html`.

## Build and load the extension

```powershell
pnpm build
```

In a Chromium desktop browser, open its extensions page, enable developer mode, choose **Load unpacked**, and select the generated `dist` directory. Clicking the WitWitty toolbar action explicitly injects the scanner into the active page and opens Context Lens.

## Verification

```powershell
pnpm test
pnpm typecheck
pnpm build
```

Visual evidence is stored in `evidence/`. The primary comparison viewport is 1586×992, matching the approved mockup, with a separate 400-pixel panel-width check.

The bundled content script can be exercised without installing the extension at `http://127.0.0.1:5173/content-fixture.html` while the development server is running. The fixture verifies candidate evidence, DOM preservation, known-term suppression, definition-present suppression, ambiguous senses, and unsupported acronyms.

## Current limits

- The reviewed local terminology bundle is intentionally small and still needs broader domain coverage.
- The remote-explanation adapter is defined but no remote provider or consent flow is connected.
- User-authored correction is not implemented yet.
- The final rendered WIT-T09 browser pass remains open because the in-app browser was unavailable during the latest verification run; deterministic DOM coverage and the production build pass.
- Private-window behavior and migration recovery are automated, but still need a final loaded-extension check in Chromium before release.
- The visual demo uses a synthetic prior encounter; the extension panel queries real local encounter history.
- Pocket Scholar and Memory Atlas remain later P1 and P2 surfaces.
