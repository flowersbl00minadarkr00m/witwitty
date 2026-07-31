/**
 * Model-agnostic network adapter (design §1.2, §5.1, §5.4, §6.2; SA-001, SA-004).
 *
 * This is the **only** module in WitWitty permitted to perform network I/O.
 * It sends exactly one HTTP request to the reader's configured endpoint and
 * returns raw, unvalidated content for `core/proposal.validate()` to
 * interpret — this module does no per-provider response parsing (SA-004).
 *
 * Wire contract, amended 2026-07-30 after real-endpoint testing against
 * OpenRouter: the request body is the **OpenAI-compatible chat completions
 * shape** — `{ model, messages: [{role:"system", content: PROMPT}, {role:
 * "user", content: JSON.stringify(ContextPacket)}] }` — rather than a bare
 * `ContextPacket` body with the model id and prompt as custom headers. That
 * earlier design (a) crashed on every real request, because the multi-line
 * prompt is not a legal HTTP header value and the Fetch API rejects it
 * synchronously, and (b) wasn't a shape any real endpoint actually speaks.
 * Chat completions is the format the large majority of BYOK-reachable
 * endpoints implement natively (OpenRouter, Azure OpenAI, Groq, Together,
 * local OpenAI-compatible servers, and OpenAI itself) — treating it as
 * WitWitty's one committed wire contract, rather than attempting true
 * shape-agnosticism, is what design §6.4 already anticipates: "WitWitty
 * cannot guarantee any particular endpoint speaks a compatible request/
 * response shape. A shape the adapter cannot interpret surfaces as an
 * unusable-response error" — there was always going to be exactly one shape
 * this module commits to; it just wasn't specified narrowly enough the first
 * time.
 *
 * `ContextPacket` itself is still transmitted **unmodified** — it is the
 * `user` message's entire content, with no other reader-derived field added.
 */

import { AI_EXPLANATION_PROMPT } from "./prompt";
import type { ContextPacket } from "../core/explanations";

export interface AiEndpointConfig {
  /** Well-formed absolute HTTPS URL. Validate with `isAbsoluteHttpsUrl` before use. */
  endpointUrl: string;
  apiKey: string;
  modelId: string;
}

export type AiRequestErrorCode =
  | "invalid-endpoint"
  | "network"
  | "timeout"
  | "http"
  | "unusable-response"
  | "cancelled";

export interface AiRequestError {
  code: AiRequestErrorCode;
  message: string;
  httpStatus?: number;
}

export type AiRequestResult =
  | { ok: true; raw: unknown }
  | { ok: false; error: AiRequestError };

export interface AiRequestOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
}

const DEFAULT_TIMEOUT_MS = 20_000;
const VERIFY_TIMEOUT_MS = 10_000;

export const isAbsoluteHttpsUrl = (value: string): boolean => {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname.length > 0;
  } catch {
    return false;
  }
};

/** The single origin that must hold the optional host permission (SA-001). */
export const endpointOrigin = (value: string): string | undefined => {
  try {
    return new URL(value).origin;
  } catch {
    return undefined;
  }
};

const buildRequestBody = (config: AiEndpointConfig, packet: ContextPacket) => ({
  model: config.modelId,
  messages: [
    { role: "system", content: AI_EXPLANATION_PROMPT },
    { role: "user", content: JSON.stringify(packet) },
  ],
});

/**
 * Unwraps the one response shape this module commits to interpreting —
 * `choices[0].message.content`, the OpenAI-compatible convention. Anything
 * else is not this module's problem to parse further; it surfaces as
 * `unusable-response` (SA-004 — no per-provider branches).
 */
const extractMessageContent = (raw: unknown): string | undefined => {
  if (typeof raw !== "object" || raw === null) return undefined;
  const choices = (raw as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return undefined;
  const message = (choices[0] as { message?: unknown } | undefined)?.message;
  const content = (message as { content?: unknown } | undefined)?.content;
  return typeof content === "string" ? content : undefined;
};

const send = async (config: AiEndpointConfig, packet: ContextPacket, options: AiRequestOptions = {}): Promise<AiRequestResult> => {
  if (!isAbsoluteHttpsUrl(config.endpointUrl)) {
    return { ok: false, error: { code: "invalid-endpoint", message: "The configured endpoint is not a well-formed HTTPS URL." } };
  }

  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  const onExternalAbort = () => controller.abort();
  options.signal?.addEventListener("abort", onExternalAbort);
  let timedOut = false;
  const markTimedOut = () => { timedOut = true; };
  controller.signal.addEventListener("abort", markTimedOut, { once: true });

  try {
    const response = await fetch(config.endpointUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(buildRequestBody(config, packet)),
      signal: controller.signal,
    });

    if (!response.ok) {
      return { ok: false, error: { code: "http", message: `The endpoint returned an error (${response.status}).`, httpStatus: response.status } };
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return { ok: false, error: { code: "unusable-response", message: "The endpoint's response could not be parsed as JSON." } };
    }

    const content = extractMessageContent(body);
    if (content === undefined) {
      return { ok: false, error: { code: "unusable-response", message: "The endpoint's response did not match the expected chat-completions shape." } };
    }

    return { ok: true, raw: content };
  } catch {
    if (options.signal?.aborted) {
      return { ok: false, error: { code: "cancelled", message: "The request was cancelled." } };
    }
    if (timedOut) {
      return { ok: false, error: { code: "timeout", message: "The endpoint did not respond in time." } };
    }
    return { ok: false, error: { code: "network", message: "WitWitty could not reach the configured endpoint." } };
  } finally {
    clearTimeout(timeoutId);
    controller.signal.removeEventListener("abort", markTimedOut);
    options.signal?.removeEventListener("abort", onExternalAbort);
  }
};

/**
 * `raw` on success is the extracted `choices[0].message.content` string —
 * expected to be JSON matching `ProposalV1`, which `core/proposal.validate()`
 * parses and validates. The outbound `user` message content is `packet`,
 * JSON-stringified, unmodified — see module doc.
 */
export const requestExplanation = (config: AiEndpointConfig, packet: ContextPacket, options?: AiRequestOptions): Promise<AiRequestResult> =>
  send(config, packet, options);

/**
 * A minimal live check (design §6.3, FR-009): proves reachability, credential
 * validity, and model availability in one request, issued only on save/replace
 * — never in the background or on a schedule. Uses a synthetic, non-reader
 * packet so verification itself transmits no page data.
 */
export const verifyEndpoint = (config: AiEndpointConfig, options?: AiRequestOptions): Promise<AiRequestResult> => {
  const verificationPacket: ContextPacket = {
    term: "verification",
    sentenceExcerpt: "WitWitty configuration check. No reader data is included in this request.",
    pageTitle: "",
    domain: "",
    domainHints: [],
  };
  return send(config, verificationPacket, { timeoutMs: VERIFY_TIMEOUT_MS, ...options });
};
