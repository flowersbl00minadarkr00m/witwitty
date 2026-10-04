# Handoff — 4 October 2026

## COMPLETE

The additive V2 implementation is in a full checkout on `feat/witwitty-2-spatial-lens`, based on `fdc2a3c24fa62aaa76b1a3a03c8af07e16dc0b94`. No legacy source, dependencies, release commands or saved database were changed. Master was not merged or modified.

The deterministic hierarchy, snapping, strict one-level zoom, state machine, mouse/text and keyboard controls, five depths, approved-only reversible lens, fixture/replay paths, progressive review, retry/fail-closed behavior, cancellation/cache, explicit saves/exports, privacy guards, local companion and gesture/classifier infrastructure pass automated verification.

Fresh Windows results: 235 V2 Node tests, 28 native localhost browser flows and 22 native MV3/companion/camera checks pass. Legacy verification passes 131 tests, type checking and the build. See [verification](verification.md) for commands, environment and exact test boundaries.

Native extension acceptance verifies loading, the real action/activeTab grant, options/storage/exports, companion pairing and reviewed streams, exact restore/Exit, navigation cleanup, sensitive-site blocking and service-worker restart. Local MediaPipe assets are installed in this checkout. Actual worker/WASM/model execution passes with synthetic video on both localhost and extension origins. Real camera permission and hand accuracy are not claimed.

Native checks found and fixed worker startup, stale camera startup cancellation and legacy/V2 test discovery. CI includes the native browser, extension and synthetic-camera paths. Publication status will be updated after the push and remote checks return.

## BUILT, NEEDS LOCAL VERIFICATION

Only your everyday browser/hardware integration remains:

1. Load `v2/dist-extension/` through Chrome's **Load unpacked** action. Check one article you actually read. Automated Chromium activation and fixture integration already pass.
2. Open Camera and approve the real webcam permission. Confirm lighting, placement, mirrored pointing, visible-window control and track release with your camera.
3. Record at least three repetitions for each of the ten gesture labels. Check the calibration report, then enable controls. Validate ambiguity, confidence loss, pinch/zoom separation and closed-fist restoration with your hand.

No user action is needed to rerun the automated reference path. `python v2/tests/native-platform.py --camera` uses a disposable browser profile and synthetic camera, without accessing real hardware. Stop other servers on ports 4174/4317 before running it.

## NEEDS CREDENTIAL

Create `v2/.env` from `v2/.env.example`. Configure the generative-model key, supported Fast/Strong model IDs and TypeSafe key there. Start the companion with `node --env-file=v2/.env v2/companion/server.mjs`, pair the browser and verify a reviewed paragraph before a large scope. Provider wire fixtures pass; real response quality and Jev score calibration require your credentials. Do not put model keys in browser settings.

## NEEDS HUMAN JUDGMENT

Judge camera placement, hand fatigue, gesture ergonomics, dwell/cooldown comfort, real review quality at each depth and final visual feel. Record the Sim You Later demonstration after those checks. Native screenshots and synthetic video do not replace physical use or model-quality judgment.

## NOT BUILT / DEFERRED SCOPE

- Legacy hosted-demo/default-release migration and saved-database migration are separate release decisions. V2 has its own run/build paths.
- Arbitrary multilingual/complex-page understanding and source-to-paraphrase token alignment remain documented limitations. The engine uses bounded English rules, skips tables/figures/widgets and uses paragraph-envelope geometry for fine selection over rewritten text. Restore for precise new selection.
- Additional bespoke provider protocols and empirical evaluation of live model/hand-recognition performance are outside the implemented adapter and fixture coverage.

Voice, speech, cloud accounts, continuous training, code/equation rewriting and knowledge-management features remain approved non-goals.

## Start now

```sh
node v2/scripts/serve.mjs
```

Open `http://127.0.0.1:4174/`. Activate, click a paragraph, Explain, change depth/scope, Rewrite and Restore. **Replay gestures** drives the same architecture without hardware or credentials. Camera assets are already built locally; a fresh clone must run `node v2/scripts/vendor-camera.mjs` and rebuild before using the camera.
