# Privacy, permissions and threat boundaries

## Local by default

The default demo and extension use local fixtures and have no external model traffic. DOM parsing, semantic decisions, hand landmarks, gesture rules and the personal classifier stay local. A real model request requires explicit invocation plus a configured localhost companion. The source URL, browsing history and camera frames are not part of the transformation request.

The companion sends only the chosen block or explicitly chosen bounded scope plus a maximum 1,600 characters of immediate context where needed for a Term/Sentence. Whole-page context is not silently attached to every term request. A Document overview explicitly uses the selected document text only within the 12,000-character request bound.

API credentials live in companion environment variables. The extension stores only a separate pairing token in trusted extension-local settings; content scripts receive no token or provider secret. No telemetry, hosted account, cloud sync, automatic browsing-history log or unattended page scanning is implemented.

## Chrome permissions

The MV3 permissions are exactly `activeTab`, `scripting`, and `storage`; the sole host permission is `http://127.0.0.1:4317/*`. There are no always-on content scripts. The toolbar explicitly injects the bootstrap on the selected ordinary HTTP(S) article. Shared module assets are web-accessible for those schemes so the explicit content-script import can resolve them; asset exposure is not blanket host access.

The local camera studio uses a separate visible extension page and its explicit browser `getUserMedia` flow. No microphone is requested. Local WASM compilation is permitted in the extension CSP. No remotely hosted executable code is loaded during use. Optional asset setup happens outside the extension build through an explicit Node command.

Background authorization binds an activated top-level tab to a session UUID. Concurrent updates are serialized; a stale End Session cannot erase a newer session. Camera messages are associated with that session and restricted to user-level intents; forged internal approval/state events are rejected. Navigation/tab removal cancels jobs and removes authorization. Toolbar/keyboard/HUD deactivation unmounts listeners, observers, UI and the lens. The session store contains active tab IDs and viewport/session data, not a URL history.

## Sensitive sites

Banking, health portals, webmail, HR/payroll and authentication/account contexts are blocked using known domains, subdomain/path patterns and password/payment/sensitive-form detection. The guard runs before activation and before generation; there is no V1 override. A page that becomes sensitive cannot send a new transformation.

This is deliberately conservative but **not an exhaustive classification of the Internet**. Private information can appear on an unrecognized domain or in a normal-looking article. False positives and false negatives remain possible. The browser cannot establish whether arbitrary text is confidential. Explicit selection, preview/context bounds and local processing remain necessary boundaries; do not use this build as an enterprise data-loss-prevention control.

## Local service boundary

The companion binds loopback only; checks the literal Host against its loopback address/port; accepts only configured exact origins; requires a timing-safe pairing token for POST requests; limits request/output sizes and concurrency; rejects redirects to arbitrary provider destinations; and cancels work when the client disconnects. There is no CORS wildcard or cookie-based authentication.

The default origins are `http://127.0.0.1:4174`, `http://localhost:4174`, and the extension ID derived from its committed public development key. That key stabilizes the unpacked extension's origin; it is not a private signing key or credential. No private key is included.

A hostile local process with access to the companion's environment or browser profile is outside this prototype's protection boundary. This is not an encrypted vault, malware defense, signed assurance ledger, or adversarial-webpage sandbox. DOM text and model output are handled as data, but a host webpage still controls its own surrounding presentation.

## Reversible DOM and exports

Unreviewed text is never displayed. Source nodes/listeners survive a lens. Arbitrary model HTML, code/equation rewriting, executable clones and unsafe URL schemes are rejected or removed. The runtime does not attempt to restore an old source snapshot over legitimate changes made by the host site; it clears the lens and asks for a new target.

Default transformations are session-only. **Save** is explicit and local, with a 100-item/2 MB library bound and a 100,000-character per-original/per-transformation item limit. Each item contains original, transformed text, page title, a source URL stripped of query/fragment tokens, mode, scope, depth and timestamp. JSON/Markdown export contains those saved texts by design; treat exports as potentially sensitive. Markdown uses safe literal content fences rather than treating saved model text as formatting instructions.

No automatic cloud sync, corpus-building or continuous self-training occurs. Debug traces exclude source/model text and keys. Calibration storage contains bounded numeric features, handedness and time, not video or biometric identity claims.

## Third-party assets

`vendor-camera.mjs` downloads explicit versioned resources and records their SHA-256 digests in an installation manifest. A locally computed digest is not an independent upstream authenticity signature. Assets and upstream license notices are excluded from this source handoff until the optional setup succeeds. Review upstream licenses and your deployment policy before redistributing a camera-enabled bundle.
