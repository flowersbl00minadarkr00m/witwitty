# WitWitty 2.0 — language is the interface

A spatial, reversible reading interface. Select language as a **Document → Section → Paragraph → Sentence → Term**, then Explain or Rewrite it at **ELI5, Plain, General, Advanced, or Expert** depth.

The controlled demo and explicitly activated Chrome extension use **one semantic engine, one state machine, one quality gate and one reversible renderer**. Mouse/text selection, keyboard, deterministic replay and local camera recognition are input adapters, not separate products.

This is an additive V2 implementation. The original repository's application, dependencies and release commands are left unchanged. Start here rather than using the legacy root `dev` or `build` scripts.

## Start the demo — no camera, no model credentials

From the repository root, with Node 22+ and TypeScript 5.8+:

```sh
# In the existing repository, this supplies its TypeScript compiler:
pnpm install --frozen-lockfile
node v2/scripts/build.mjs
node v2/scripts/serve.mjs
```

Open **http://127.0.0.1:4174/**. Keep the exact host; localhost companion origins are intentionally restricted.

For the standalone handoff source, or to avoid installing the legacy application just to build V2, install the compiler separately instead:

```sh
npm install --global typescript@5.8.3
node v2/scripts/build.mjs
node v2/scripts/serve.mjs
```

There are **no new production npm dependencies**. The release ZIP also contains precompiled demo/extension files, so `node v2/scripts/serve.mjs` works without installing a compiler after extraction. Do not open the HTML as a `file://` page.

### First meaningful run

Click **Activate WitWitty**, then a paragraph in *The log is not the truth.* Choose **Explain** in the bottom HUD. Try all five depth buttons, zoom inward to Sentence and Term, zoom outward to Document, switch to Rewrite, and choose **Restore original**. Code, equations, headings and links remain structural rather than generated HTML.

**Replay gestures** runs the same journey through the gesture gate. It covers all five depths and scopes, then restores the source. It needs neither a webcam nor an API key. Replay is a deterministic fallback for a recorded demonstration, not a simulation pretending to be live tracking.

Fixtures are visibly labeled. The authored Meridian article has 60 paragraph transformations, 30 sentence paraphrases, contextual term entries, three section overviews and a coherent document overview across all depths. Unknown arbitrary-page text uses an explicitly labeled preview or identity rewrite, **not a fabricated model result**. Use the companion for actual generation on arbitrary articles.

## Keyboard

| Input | Action |
| --- | --- |
| Alt+W | Activate/deactivate the mounted reader; an extension must first be activated from its toolbar |
| N / P, then Enter | Next/previous target, then lock |
| E / W | Explain / Rewrite |
| Left / Right arrow | One depth shallower/deeper |
| [ / ] | One semantic level out/in |
| R / Escape | Restore original / cancel pending work |

Typing in forms and modified shortcuts is not intercepted. The HUD's **Keys** view repeats the bindings. **Release** restores the active lens and allows a new selection.

## Chrome extension

Build, open `chrome://extensions`, enable Developer mode, select **Load unpacked**, and choose `v2/dist-extension/`.

Activate on an ordinary article with the toolbar. Nothing is automatically injected across all sites. Settings default to local fixtures. The extension's options page provides companion pairing, local saved-library viewing/deletion/exports, and calibration status/reset. The reader's **Camera** action opens the local input studio associated with that article.

Native MV3 loading, action activation with the real `activeTab` grant, source restoration, options, library exports/deletion, navigation cleanup and service-worker restart pass automated acceptance in Chromium 153. The earlier SDK-boundary tests remain separate. Your everyday Chrome profile still needs installation and a check on the articles you use. See [verification](docs/verification.md).

## Local companion

In a second terminal:

```sh
node v2/companion/server.mjs
```

It binds only **127.0.0.1:4317**, defaults to mock models/reviewer, and prints a local pairing token. Copy that token into demo Settings or extension Options and choose Companion. The token is not a model API key; pairing is required even in companion mock mode. The embedded demo/extension fixture mode needs no companion at all.

For live generation, copy `v2/.env.example` to `v2/.env`, configure both generative-model IDs, the generative provider key, and the TypeSafe key, then run:

```sh
node --env-file=v2/.env v2/companion/server.mjs
```

Only the companion reads those secrets. The browser never receives model credentials or contacts the model/Jev API directly. See [companion setup](docs/companion.md) for the protocol, routing, native Jev contract, timeout behavior and configuration.

## Local camera and calibration

The runtime and model are optional local assets, not remote scripts loaded while reading:

```sh
node v2/scripts/vendor-camera.mjs
node v2/scripts/build.mjs
```

This opt-in setup downloads pinned MediaPipe 0.10.21 assets, the hand-landmarker float16/1 model and the upstream license. Assets are local and ignored by Git. Actual worker/WASM/model startup and inference pass on both browser and extension origins using a synthetic camera. Real hand recognition and personal calibration still need you. The studio reports missing assets before requesting the webcam.

In the demo, open Camera, explicitly start it, and enable gesture controls. In the extension, record at least three good repetitions of every gesture first. Only eight numeric features per repetition are saved locally. No frames, face images or video are persisted. The personal classifier is frozen during ordinary use. See [gesture architecture and calibration](docs/gestures.md).

## Verification

```sh
node v2/scripts/format.mjs --check
node v2/scripts/lint.mjs
node v2/scripts/build.mjs
node --test v2/tests/*.node.mjs
python -m pip install playwright==1.63.0
python -m playwright install chromium
python v2/tests/e2e.py
# Optional native extension + local detector verification:
node v2/scripts/vendor-camera.mjs
node v2/scripts/build.mjs
python v2/tests/native-platform.py --camera
```

The new GitHub workflow runs the V2 checks independently, including native-localhost browser tests, and uploads the built surfaces and browser evidence. Its action revisions are pinned. No credentials or camera assets are required by CI.

Current Windows results: **235 V2 Node tests, 28 native localhost browser flows, and 22 native extension/camera checks pass**. The legacy app also passes all 131 tests, type checking and its build. V2's `*.node.mjs` files keep the Node suite out of the legacy Vitest runner. Native platform acceptance uses real Chromium extension APIs and synthetic video, with no Chrome API doubles or broader extension permissions. It does not establish real-hand accuracy or live-provider quality. Historical offline-harness results are preserved in [verification](docs/verification.md).

## Design and handoff

- [Architecture, state, selection and rendering](docs/architecture.md)
- [Depth contracts and model/review behavior](docs/contracts.md)
- [Privacy, permissions and practical limits](docs/privacy.md)
- [Source authority and decisions](docs/decisions.md)
- [Test scope and actual evidence](docs/verification.md)
- [Local integration checklist](docs/handoff.md)
- [PR description](docs/PR.md) and [Codex continuation instructions](docs/CODEX-HANDOFF.md)

The source and original technical fixture use the repository's MIT license, reproduced in [LICENSE](LICENSE). Optional MediaPipe assets retain their upstream terms; the application license does not relicense them.
