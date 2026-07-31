# How it works

WitWitty is a Manifest V3 Chrome extension with three pieces:

1. **Content script** (`src/content/`) — runs only after you click the toolbar icon on the active tab. It reads the page's visible text, ranks candidate jargon/acronym terms against a small reviewed local glossary plus an acronym heuristic, and highlights the top matches inline without altering the rest of the page.
2. **Side panel** (`src/components/ContextLensPanel.tsx`) — a React app showing the meaning of whichever highlighted term you select, its prior encounters (via IndexedDB), spaced-review scheduling, and the reversible Original/Simpler text toggle.
3. **Local storage** (`src/data/db.ts`) — versioned IndexedDB schema for terms, senses, sources, encounters, and review state, with per-term/per-site/full deletion and a sanitized JSON export.

## Optional AI path

When a term has no local match, and only if you've configured your own endpoint (`src/data/aiSettings.ts`), the panel can ask a model you chose to propose a contextual explanation (`src/ai/adapter.ts`). The response is validated against a strict schema (`src/core/proposal.ts`) that separates what the passage actually supports from what the model inferred, and rejects anything that doesn't conform — nothing renders from a response WitWitty can't verify structurally. Low-confidence responses are visually and structurally de-emphasized regardless of how the model phrases them. Nothing is written to local storage until you explicitly accept a proposal.

## Detection

Detection is intentionally conservative: a small reviewed glossary (`src/core/terminology.ts`) plus a pattern for unexplained acronyms, capped at a handful of highlights per page. It fails closed — an acronym WitWitty doesn't recognize is flagged as unexplained rather than guessed at.
