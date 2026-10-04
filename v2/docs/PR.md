# WitWitty 2.0: shared spatial reading engine, demo, extension and companion

## What changes

Readers can select a Document, Section, Paragraph, Sentence or Term, then Explain or Rewrite it at ELI5, Plain, General, Advanced or Expert depth. Transformations appear in place after review, and Restore recovers the untouched source DOM. Mouse/text selection, keyboard, recorded gestures and local webcam recognition emit intents into one shared state machine and semantic engine. Models never choose semantic scope.

This adds `v2/` and one isolated workflow. Legacy application files, dependencies, lockfile and release commands remain intact. The PR targets `master` from `feat/witwitty-2-spatial-lens`, based on `fdc2a3c24fa62aaa76b1a3a03c8af07e16dc0b94`. Default hosted-release migration is deferred.

## Built

- Deterministic hierarchy, snapping, anchor-based zoom, mouse/text and keyboard controls.
- Five central depth contracts, reviewed-only reversible lens, retained approved replacements, progressive block work and exact restoration.
- Authored technical fixtures and repeatable canonical gesture replay.
- Localhost companion with mock mode, deterministic Fast/Strong routing, cache/cancellation, OpenAI-compatible generation and native TypeSafe Jev review adapters.
- MV3 extension with explicit action/activeTab activation, narrow localhost access, privacy guards, session cleanup, local library and JSON/Markdown exports.
- Local hand-landmarker pipeline, deterministic demo recognition, frozen personal classifier, calibration/reset UI and numeric-only persistence.
- Redacted debug traces, failure injection, setup/docs and native CI acceptance.

All ten vertical slices are built. Real-hand calibration, physical ergonomics and live model/Jev quality remain unverified. Camera assets are optional local downloads with upstream license and installation hashes.

## Native integration fixes

MediaPipe 0.10.21's WASM loader needs `importScripts()`. A classic worker bootstrap imports the typed detector while retaining that API. Camera startup rejects stale permission results without stopping a newer session. V2 Node tests use `*.node.mjs` so legacy Vitest does not collect them. Browser wait predicates use functions for current Chromium CSP enforcement.

## Verification

Fresh Windows verification passes formatting, syntax/privacy lint, strict V2 build, **235 V2 Node tests**, **28 native localhost browser flows**, **22 native MV3 / real companion / synthetic-camera checks**, **131 legacy Vitest tests**, legacy type checking and legacy build.

```sh
node v2/scripts/format.mjs --check
node v2/scripts/lint.mjs
node v2/scripts/build.mjs
node --test v2/tests/*.node.mjs
python v2/tests/e2e.py
node v2/scripts/vendor-camera.mjs
node v2/scripts/build.mjs
python v2/tests/native-platform.py --camera
pnpm install --frozen-lockfile
pnpm test
pnpm typecheck
pnpm build
```

The native platform suite loads the committed extension in Chromium 153 with real browser APIs and unchanged permissions. The native action grants `activeTab`. It verifies storage/options/downloads, companion origin and reviewed streams, source restore, navigation/sensitive-site handling and service-worker restart. Actual local WASM/model inference runs with synthetic video at both localhost and extension origins. These results do not establish real-hand accuracy, everyday-profile behavior or live-provider quality. Historical offline-harness evidence remains separate in `v2/docs/verification.md`.

## Mock demo

```sh
node v2/scripts/serve.mjs
```

Open `http://127.0.0.1:4174/`. Activate, select a paragraph, Explain, change depth, zoom to Term and back to Document, Rewrite and Restore. Replay uses the same architecture without keys or webcam. Unknown arbitrary-page fixture output is labeled as a preview or identity rewrite.

## Owner integration

Install the unpacked extension in your everyday Chrome profile. Approve webcam permission, position the camera, calibrate gestures and judge physical/visual quality. Configure model/Jev credentials only in `v2/.env`, then verify real reviewed transformations. Record the demonstration after those steps.

## Limits

English-oriented ordinary-article rules; tables/figures/widgets and code/equation rewriting excluded. Index/work/context bounds are explicit. Fine selection over a rewritten clone uses paragraph geometry; restore for precise new selection. One generative wire protocol and one native Jev protocol are implemented. Privacy classification is conservative, and the quantity guard can reject spelling differences. Neither fixtures nor model review prove semantic quality.

Remote CI results are reported by the PR checks. Local results above do not imply a remote CI pass.
