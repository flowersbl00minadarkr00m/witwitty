# Local companion and real-provider setup

## Defaults and configuration

The default service is mock mode on `127.0.0.1:4317`. It requires no generative/Jev key but still authenticates browser POST requests using a local pairing token. The embedded browser fixture mode needs no service and no token.

Use `node v2/companion/server.mjs`. Copy the printed pairing token into the demo Settings or extension Options. Start the demo on exactly `http://127.0.0.1:4174`. Both the 127.0.0.1:4174 and localhost:4174 origins are explicitly listed; the examples consistently use 127.0.0.1. Other aliases, ports and extension IDs are rejected unless the service code is deliberately configured for them.

For live mode, create the ignored file `v2/.env`:

```dotenv
WW_MODE=live
WW_MODEL_ENDPOINT=https://api.openai.com/v1/chat/completions
WW_MODEL_KEY=REPLACE_WITH_REAL_KEY
WW_FAST_MODEL=REPLACE_WITH_SUPPORTED_FAST_MODEL_ID
WW_STRONG_MODEL=REPLACE_WITH_SUPPORTED_STRONG_MODEL_ID
TYPESAFE_API_KEY=REPLACE_WITH_REAL_TYPESAFE_KEY
WW_JEV_MODEL=jev-latest
# Optional; omit to generate a new local pairing token on startup:
# WW_PAIRING_TOKEN=REPLACE_WITH_A_RANDOM_LOCAL_TOKEN_OF_AT_LEAST_24_CHARACTERS
```

Then run `node --env-file=v2/.env v2/companion/server.mjs`. Do not put these keys into the extension, a frontend build variable, Git, a screenshot, a prompt, or the library. Real model IDs are intentionally configuration rather than assumed current provider SKUs. Live mode refuses to start without required credentials/model IDs; it never silently replaces a failed live setup with a fixture reviewer.

The concrete generation adapter supports an HTTPS OpenAI-compatible Chat Completions endpoint with JSON object output. Endpoint credentials in the URL, query strings/fragments and redirects are rejected. Refusal, truncated completion, malformed JSON, missing segments or excessive output fails closed. Other provider protocols need their own thin Generator implementation.

## Native Jev contract

The implementation follows TypeSafe's public API documentation read during this build:

- `POST https://api.typesafe.ai/v1/systemone`
- Bearer authentication using `TYPESAFE_API_KEY`
- Request fields `model`, structured `state`, and `questions`
- Three `noul` questions: meaning preservation, depth fit and unsupported additions
- Finite numeric answers consumed from `answers.<question>.noul`

The model state contains selected source/context, draft, mode, scope and the central depth contract. It contains no DOM, screenshot, raw video or camera frames. The reviewer does not generate the transformation and cannot choose semantic scope. One corrective retry is the maximum. Missing/invalid answers, timeout or rejected review retains original/previous approved content.

References: [TypeSafe API](https://docs.typesafe.ai/api), [OpenAI Chat Completions API](https://developers.openai.com/api/reference/resources/chat), [MediaPipe Hand Landmarker for Web](https://developers.google.com/edge/mediapipe/solutions/vision/hand_landmarker/web_js). These are protocol references, not evidence that this build made live calls. Only deterministic HTTP response fixtures were used for the real-provider adapters in this implementation session.

## HTTP protocol

| Endpoint | Behavior |
| --- | --- |
| `GET /health` | Schema/version, mock/live and readiness; no secrets |
| `GET /version` | Schema/version information |
| `POST /v1/transform` | Bounded validated request; NDJSON route/review/approved-or-rejected events |
| `POST /v1/cancel` | Cancel a matching session/request pair |

POSTs require an allowed Origin, JSON content type and `X-WitWitty-Token`. Request identity, source, context, segment IDs, scope, mode and depth are validated centrally. Browser clients revalidate the final result's identity, source hash, draft schema, review thresholds and contract before painting it.

No unreviewed draft is an NDJSON event. Concurrency defaults to four; duplicate active IDs are rejected. Generation/review stages have separate bounded timeouts and a maximum two generation attempts. The service has a 65-second whole-request deadline. Browser disconnects, explicit cancellation and client aborts propagate to providers. The browser transport also bounds its response size and total wait.

Debug logging intentionally excludes raw text, prompts, model responses, credentials and frames. The runtime exposes route, retry count, reviewer result, timing, cache and input metadata through the local Inspect view. There is no telemetry service.

## First credential check

Start with an innocuous short paragraph in the controlled demo. Confirm live provenance, actual configured model IDs and a Jev pass before trying a whole-document operation. Check one rejected or malformed provider response with fixtures before using real text. Assess actual meaning/depth quality across the five depths; initial Jev thresholds are a policy, not a demonstrated calibration result. Keep an eye on provider cost: only two adjacent Fast-depth predictions are permitted, and Strong work is never speculative.
