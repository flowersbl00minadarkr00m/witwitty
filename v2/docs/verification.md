# Verification record

## Windows continuation — 4 October 2026

| Check | Actual result |
| --- | --- |
| V2 baseline formatting and syntax/privacy lint | PASS |
| Strict V2 build, including both camera-enabled surfaces | PASS |
| V2 Node unit/integration tests | **235 passed, 0 failed** |
| Native localhost browser flows | **28 passed, 0 failed** |
| Native Chromium MV3 / companion / synthetic-camera checks | **22 passed, 0 failed** |
| Legacy Vitest suite | **131 passed, 0 failed** |
| Legacy type checking and extension/demo build | PASS |
| Remote publication | Branch pushed; PR #8 open against master; see its live CI checks |
| Real webcam, physical calibration, live model/Jev calls | Not verified; owner hardware/credentials required |

Environment: Windows, Node 24.17.0, TypeScript 5.8.3 for the isolated V2 build and 5.9.3 for legacy checks, Python 3.14, Playwright 1.63.0, Chromium 153.0.8010.12. The first native browser pass also succeeded with Playwright 1.57.0. Desktop/mobile screenshots were inspected.

Commands run from the full repository checkout:

```sh
node v2/scripts/format.mjs --check
node v2/scripts/lint.mjs
node v2/scripts/build.mjs
node --test v2/tests/*.node.mjs
python v2/tests/e2e.py --artifacts v2/artifacts/browser
node v2/scripts/vendor-camera.mjs
node v2/scripts/build.mjs
python v2/tests/native-platform.py --camera
pnpm install --frozen-lockfile
pnpm test
pnpm typecheck
pnpm build
```

The Windows session used an isolated compiler under .git/v2-tooling/ via NODE_PATH and an isolated Playwright environment under .git/v2-python/. These tools are excluded from Git. The regular setup commands in README remain sufficient for a fresh clone.

The 28-flow run uses actual HTTP navigation, modules, storage, WebCrypto and browser CSP. Its extension-content cases still explicitly use SDK doubles. The separate 22-check native suite loads the committed unpacked extension in a disposable persistent Chromium profile. Extensions.triggerAction invokes the native browser action and its activeTab grant. No extension host permissions or production APIs are replaced. The suite checks dormant state, all five depths, real options/storage/JSON and Markdown downloads, companion origin/pairing and reviewed port output, restore/Exit, navigation revocation, sensitive-site blocking and service-worker restart.

With optional camera assets installed, the native suite starts actual local workers, WASM and the hand-landmarker model at both localhost and extension origins. Chromium supplies synthetic video. The suite checks track release, refusal of uncalibrated control and the stale-permission cancellation regression. Synthetic frames contain no real hand; this is runtime/inference evidence, not physical gesture accuracy or user calibration.

Fixes discovered by native integration:

- MediaPipe 0.10.21 uses importScripts() to load WASM glue. A classic worker bootstrap now imports the typed detector while retaining that API.
- Startup cancellation checks prevent stale permission failures and streams from changing a new capture session.
- V2's Node tests use *.node.mjs, preventing legacy Vitest from collecting a different test runner's files.
- Browser wait predicates use functions, keeping the test helper compatible with current Chromium CSP enforcement.

Local evidence is in `v2/artifacts/browser/results.json`, `v2/artifacts/native-platform/results.json`, `.git/v2-node-tests.log` and `.git/legacy-tests.log`. GitHub CI runs the same native paths and uploads built surfaces and browser evidence. [PR #8](https://github.com/flowersbl00minadarkr00m/witwitty/pull/8) is published; local results never imply remote success.

## Historical implementation environment

## Actual results

| Check | Result | What this proves |
| --- | --- | --- |
| Baseline formatting | PASS | LF/final-newline/trailing-whitespace rules and normalized JSON |
| Syntax/rendering/privacy lint | PASS | JS syntax, TS parsing, fixed-literal-only HTML sinks, no browser provider-key configuration, narrow permissions |
| Strict TypeScript build | PASS | ES2022/NodeNext type checking with no-unused/no-unchecked-index guards; demo and MV3 artifacts generated |
| Node test suite | **235 passed, 0 failed** | Semantic primitives, state, routing, caches, fixtures, quality gate, cancellation, real localhost HTTP, SDK-boundary extension authorization |
| Chromium browser flows | **28 passed, 0 failed** | Real DOM/layout/events across the journeys below, in the explicit offline platform-boundary harness |
| Native-origin browser run | **Not verified** | Browser navigation rejected with `ERR_BLOCKED_BY_ADMINISTRATOR` in this environment |
| Unpacked Chrome permissions/service worker | **Not verified** | Compiled; content/background logic tested with platform doubles, not native Chrome installation |
| Real camera/MediaPipe inference | **Not verified** | Runtime, studio and synthetic fixtures built; optional assets were not downloaded and hardware was not used |
| Live model/Jev calls | **Not verified** | Adapter wire contracts and pipeline tested with deterministic API-shaped responses; no real keys used |
| Cloud GitHub Actions / pushed PR | **Not run / not published** | GitHub branch creation returned 403; local verification is not a remote CI badge |

Environment: Node **22.16.0**, TypeScript **5.8.3**, Python Playwright **1.57.0**, system Chromium, Linux container. Viewports: **1440×1000** desktop, **390×844** mobile dark/light, and **520×960** camera studio. The Browser plugin was absent; regular Python Playwright was used.

## Commands actually run

From the implementation workspace root:

```sh
node v2/scripts/format.mjs --check
node v2/scripts/lint.mjs
node v2/scripts/build.mjs
node --test v2/tests/*.test.mjs
python v2/tests/e2e.py --offline --artifacts /mnt/data/ww-browser
```

The external evidence bundle contains the complete TAP log, browser JSON results and screenshots. The source repository does not commit generated snapshots, reports, temporary bundles, `.env` files or build output. The handoff release ZIP includes prebuilt output separately for immediate use.

The Node suite includes actual loopback HTTP traffic to ephemeral test ports: health/version, NDJSON, pairing tokens, origin/Host checks, body limits, concurrency, cancellation and partial failure. Those are not faked fetch successes. A separate test copies the authored source to a fresh directory whose name contains spaces and rebuilds both licensed surfaces using the installed compiler. The compiler is launched with Node and an argument array, not a shell-interpolated source path. This test ran on Linux; Windows execution remains a local-platform check. Tests of the external Chat Completions/Jev services use injected deterministic responses and make no real provider calls.

## Browser scope

The browser suite exercises initial inactivity, meaningful article rendering, no default external requests, mouse acquisition/lock, all five depths/scopes, keyboard equivalents, repeated gesture replay, approved replacement retention, model/review timeout, malformed result, rejection, corrective retry, partial-document Rewrite, stale-work cancellation, DOM mutation/deletion, new sensitive forms, structural DOM edge cases, deterministic snapping, original link listeners, explicit save/delete, debug redaction, offline companion behavior, shared extension content integration, responsive layouts, coherent overviews, resource limits, complete extension teardown and camera missing-assets recovery.

Page identity, nonblank content, runtime exceptions, interactions and screenshots were checked. Desktop/mobile screenshots were visually inspected for clipping, contrast, wrapping, overflow and whether the compact HUD left the article primary. There is no framework overlay because the new surface is native DOM rather than a dev-framework shell. No relevant uncaught runtime errors were observed in passing cases.

## Exact offline-harness boundary

The environment denied normal page navigation. `scripts/fixture-bundle.mjs` creates a **test-only** CommonJS packaging of the compiled ES modules for an inline document. It does not rewrite application decision logic. It provides an explicit test URL, an in-memory Storage implementation, a deterministic UUID source, a Python SHA-256 bridge for WebCrypto, module-location metadata, and a channel test double. Extension integration uses a Chrome SDK double. Camera studio testing injects a missing-local-asset response; it never requests hardware.

Therefore these results do **not** prove native origin policy, CSP/module loading, cross-window BroadcastChannel delivery, extension service-worker scheduling, browser storage permissions, real webcam behavior or live API compatibility. The test bundle is ignored and excluded from shipped application artifacts. Do not use it as a production build or as a way to bypass the environment's browser restriction.

For normal verification, install Playwright/Chromium and run:

```sh
python v2/tests/e2e.py --artifacts v2/artifacts/browser
```

The new GitHub workflow uses this native path, not `--offline`. It uses pinned official action commits, an isolated TypeScript 5.8.3 compiler, read-only repository permissions, and no retained checkout credentials. The legacy application's existing workflow is unchanged.

## Failure injection and diagnosis

In demo Settings select `pass`, `retry`, `reject`, `malformed`, `model-timeout`, `review-timeout`, or `partial`. Failure injection is rejected by the companion in live mode. Use **Inspect** for state, target, snap candidates, route, review, attempt, timings and cache metadata, then export a redacted trace.

A failed output must leave original/previous approved content visible. Restore must prevent stale work from reviving the lens. Source mutation must invalidate before reindexing. Lost companion access must not disable deterministic selection and zoom. Use those observable outcomes when investigating a failed test rather than weakening assertions.
