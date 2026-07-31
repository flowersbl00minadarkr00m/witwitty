# Privacy and data handling

WitWitty is local-first by design, not just by default.

## What stays on your device

- All reading history, saved terms, and review progress live in your browser's IndexedDB. Nothing is uploaded, and there is no account or sync.
- Page scanning only runs when you explicitly click the toolbar icon on the active tab (Manifest V3 `activeTab`) — never in the background, never automatically.
- Private/incognito windows and any site you exclude are never scanned or stored, before the URL is even evaluated.
- Exports are sanitized JSON: no credentials, no raw page tokens, no browsing history beyond what you explicitly saved.

## Optional AI explanations (bring your own key)

For terms WitWitty's built-in glossary can't resolve, you can optionally connect your own AI endpoint — any OpenAI-compatible chat-completions API (OpenRouter, Azure OpenAI, a self-hosted model, etc.).

- **Off by default.** With no endpoint configured, WitWitty makes zero outbound network requests, verified by an automated test suite that fails if any code path attempts one.
- **You bring everything.** WitWitty ships no provider name, no default endpoint, and no bundled key. You supply the endpoint URL, API key, and model id.
- **Nothing sent until you approve it.** Before the first request of a session, you see the exact outbound payload — verbatim — and the exact destination, with a Cancel that transmits nothing.
- **Minimal payload.** Only the selected term, one bounded excerpt of surrounding text, the page title, and the page domain are ever sent — no full page content, no browsing history, no other terms.
- **Your key never leaves your device except to authenticate that one request.** It's stored in extension-local storage, never in the same record as your reading history, and never re-rendered into any input once saved.

## Learn more

The full requirements and design documents (data flow, storage schema, threat model) live in the project's SDD history if you want the exhaustive version — this page is the honest summary.
