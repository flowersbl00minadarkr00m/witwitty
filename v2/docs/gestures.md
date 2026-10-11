# Input studio and gesture architecture

## One vocabulary, one safety gate

| Physical input | Domain action |
| --- | --- |
| Open palm + vertical movement | Scroll |
| Point/hover | Move semantic focus |
| Pinch held briefly | Lock target |
| Point + swipe up/down | Explain / Rewrite |
| Horizontal hand pan | Shallower / deeper depth |
| Pinch spreading/closing | Semantic zoom inward/outward |
| Closed fist held | Restore original |

Scrolling and pointing are continuous; other actions are latched. The shared gate uses a 0.86 confidence threshold, 0.93 for Rewrite/Restore, 160 ms dwell, 450 ms Restore dwell, 650 ms cooldown and 250 ms dropout boundary. Ambiguous axes, low confidence, invalid geometry, stale timestamps and multiple hands abstain. A release/neutral transition is required to retrigger a latched action. These are initial deterministic policy values, not measured ergonomic optima.

## Local landmarks

The camera is never started on article activation. The user opens the studio and presses Start. A worker loads the local MediaPipe bundle, local WASM and local hand-landmarker task. Only then is webcam permission requested. There is no audio capture. ImageBitmaps stay between the local studio and its worker; only numeric landmarks leave the worker. Bitmaps are closed after use, capture is one-frame-in-flight at approximately 15 FPS, and Stop/navigation/visibility loss releases tracks and worker resources.

MediaPipe's handedness score is not repurposed as confidence in a gesture. A single tracked hand produces 21 bounded landmarks; geometric rules or the frozen classifier produce a separate gesture score. Scores are explicitly labeled, not represented as empirically calibrated probabilities.

The module and model assets are pinned in `scripts/vendor-camera.mjs`; setup is optional and network-dependent. Native acceptance now runs the downloaded model with synthetic camera frames on both localhost and extension origins. No real webcam or hand is used in that test.

MediaPipe 0.10.21 loads its WASM glue with `importScripts()`, which a module worker cannot use. `camera-worker-bootstrap.js` keeps a classic worker global and imports the typed detector module. The first initialization message waits for that import. Camera startup also checks the session generation after each asynchronous step, so an old permission failure cannot stop a newer session. Native tests cover both startup and that cancellation regression.

## Demo rules and extension learning

The demo computes translation/scale-normalized pose and short-sequence motion features, then applies inspectable rules. Diagonal motion or competing categories fail closed. The extension instead fits a lightweight nearest-prototype classifier from calibration sequences, with class radius/separation checks and confidence based on distance and runner-up margin. It abstains on unfamiliar inputs.

The feature vector has eight dimensions: four finger extension ratios, pinch distance, horizontal/vertical hand velocity and pinch-change velocity. The classifier is trained from labeled examples locally and frozen during normal use. It is not an online self-training neural model and its fixture performance is not evidence of population-wide hand recognition quality.

The classifier treats the measured spread of recorded repetitions as the learned variation for that class. Distance beyond that spread reduces its score. The outer rejection radius and competing-class margin remain in force. This corrects a bug found on 11 October 2026 where a ready profile could reject its own recorded examples: repetitions 0.06 from the class center scored 0.67 against the 0.86 action threshold. Tests now check all ten classes with varying repetitions through the shared action gate, and retain unfamiliar-pose and ambiguity rejection. Existing saved profiles need no migration or reset. Physical accuracy still requires verification with the user's hand.

## Calibration workflow

1. Activate an article through the extension, open Camera, and run optional asset setup/rebuild first when required.
2. Start camera. Choose the correct handedness. Keep the studio window visible and position the hand in its mirrored view.
3. Choose a gesture and record at least three consistent repetitions. Each repetition captures numeric sequence features over about 650 ms, with a minimum stable-frame count.
4. Repeat for all ten gesture labels. The UI reports missing examples, excessive within-gesture spread and insufficient class separation.
5. Enable controls only after the profile passes quality checks. Extension mode never silently substitutes the demo rule recognizer for missing personal calibration.
6. Recalibrate one gesture or reset the whole profile as needed. Changing handedness clears the old profile. Controls are disabled while recording/changing calibration.

Use **Download calibration data** to inspect the saved profile without changing it. The local JSON contains only the validated handedness, timestamp, version and eight-number gesture summaries; it excludes camera images, article content and provider credentials. Individual frame counts, capture duration and motion trajectories are not retained, so they cannot be reconstructed from this export. Recordings use a 650 ms interval while live recognition uses a rolling 350 ms window. The current readiness report is a count/spread/separation check, not a held-out recognition test; a profile can be marked ready while its examples remain below the classifier's action threshold. Diagnose the saved examples and new gestures before claiming reliable physical control.

The extension's Options page can view readiness or reset the calibration. Profile persistence uses trusted local extension storage; the demo's optional numeric profile stays in its own local storage. Neither is synchronized to a cloud account.

Physical verification must assess lighting, camera placement, hand occlusion, swipe/dwell duration, mirrored pan direction, pinch-versus-zoom confusion, multi-window ergonomics and fatigue. Adjust the versioned policy or features with new regression traces, not hidden ad hoc UI callbacks.

The camera's control status distinguishes an uncertain/ambiguous match, insufficient dwell, cooldown and a held gesture that has already triggered. Its last-action line remains visible after a prediction changes back to `none`. Extension actions require acknowledgment from the active article; a missing receiver or ended session disables controls and shows instructions to reopen Camera from the article. Explain, Rewrite and semantic changes require a locked passage, so the acknowledgment also reports whether a target is locked. Receipt means the article dispatched the input, not that a model review passed or that content changed. A gesture label alone does not prove that an action reached the page. A wrong-hand diagnostic does not reset calibration; use the calibrated hand rather than changing the Hand setting.

Verification on 11 October 2026: 239 Node tests, 28 localhost browser checks and 27 native extension/camera checks pass. Native checks cover actual article scrolling and acknowledgment, a saved controlled profile, controlled landmarks through recognition/dwell/receipt, and persistent recovery feedback after the article session ends. Controlled landmarks and synthetic video isolate the software path; they do not prove recognition accuracy with a real hand. Late action receipts cannot overwrite connection-loss feedback after controls are disabled.

## Replay

`fixtures/gestures.ts` supplies deterministic classification traces, low-confidence/ambiguity examples and synthetic 21-landmark sequences. `canonicalReplay` feeds the same gate and state machine, visits all five depths/scopes, and restores. It waits for each transformation to settle and supports interruption. Replay is explicitly identified as replay; it is not evidence of physical camera performance.
