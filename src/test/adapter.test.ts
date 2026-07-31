import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { endpointOrigin, isAbsoluteHttpsUrl, requestExplanation, verifyEndpoint } from "../ai/adapter";
import type { ContextPacket } from "../core/explanations";

const packet: ContextPacket = {
  term: "observability",
  sentenceExcerpt: "Good observability makes each retry inspectable.",
  pageTitle: "Reliability notes",
  domain: "example.test",
  domainHints: ["software"],
};

const config = { endpointUrl: "https://api.example.test/v1/chat/completions", apiKey: "secret-key", modelId: "example-model" };

const chatCompletion = (content: string) => ({ choices: [{ message: { content } }] });

describe("isAbsoluteHttpsUrl / endpointOrigin", () => {
  it("accepts a well-formed absolute https URL", () => {
    expect(isAbsoluteHttpsUrl("https://api.example.test/v1/chat/completions")).toBe(true);
  });

  it("rejects http, relative, and malformed values", () => {
    expect(isAbsoluteHttpsUrl("http://api.example.test")).toBe(false);
    expect(isAbsoluteHttpsUrl("/v1/chat/completions")).toBe(false);
    expect(isAbsoluteHttpsUrl("not a url")).toBe(false);
  });

  it("derives the origin only, dropping path and query", () => {
    expect(endpointOrigin("https://api.example.test/v1/chat/completions?x=1")).toBe("https://api.example.test");
  });
});

describe("requestExplanation", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("rejects an invalid endpoint before attempting any request", async () => {
    const result = await requestExplanation({ ...config, endpointUrl: "http://insecure.test" }, packet);
    expect(result).toEqual({ ok: false, error: { code: "invalid-endpoint", message: expect.any(String) } });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends an OpenAI-compatible chat-completions body with the packet as the user message content, unmodified", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => chatCompletion(JSON.stringify({ outcome: "insufficient-evidence" })) });

    await requestExplanation(config, packet);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(config.endpointUrl);
    expect(init.method).toBe("POST");
    expect(init.headers.authorization).toBe(`Bearer ${config.apiKey}`);
    // No custom headers — the earlier header-based design crashed on the real Fetch API (multi-line header value).
    expect(Object.keys(init.headers).sort()).toEqual(["authorization", "content-type"]);

    const body = JSON.parse(init.body);
    expect(body.model).toBe(config.modelId);
    expect(body.messages).toHaveLength(2);
    expect(body.messages[0].role).toBe("system");
    expect(body.messages[1]).toEqual({ role: "user", content: JSON.stringify(packet) });
  });

  it("returns the extracted message content, unparsed, for validate() to interpret", async () => {
    const proposalJson = JSON.stringify({ outcome: "proposed", recommendation: { definition: "x" } });
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => chatCompletion(proposalJson) });

    await expect(requestExplanation(config, packet)).resolves.toEqual({ ok: true, raw: proposalJson });
  });

  it("maps a non-ok HTTP response to an http error carrying the status", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({}) });

    await expect(requestExplanation(config, packet)).resolves.toEqual({
      ok: false,
      error: { code: "http", message: expect.any(String), httpStatus: 401 },
    });
  });

  it("maps unparseable JSON to an unusable-response error", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => { throw new Error("bad json"); } });

    await expect(requestExplanation(config, packet)).resolves.toEqual({
      ok: false,
      error: { code: "unusable-response", message: expect.any(String) },
    });
  });

  it("maps a well-formed but non-chat-completions response shape to unusable-response", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ outcome: "insufficient-evidence" }) });

    await expect(requestExplanation(config, packet)).resolves.toEqual({
      ok: false,
      error: { code: "unusable-response", message: expect.any(String) },
    });
  });

  it("maps a rejected fetch to a network error", async () => {
    fetchMock.mockRejectedValueOnce(new Error("getaddrinfo failed"));

    await expect(requestExplanation(config, packet)).resolves.toEqual({
      ok: false,
      error: { code: "network", message: expect.any(String) },
    });
  });

  it("resolves to a timeout error when the endpoint never responds", async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementationOnce((_url: string, init: { signal: AbortSignal }) => new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(new Error("aborted")));
    }));

    const pending = requestExplanation(config, packet, { timeoutMs: 5000 });
    await vi.advanceTimersByTimeAsync(5000);
    await expect(pending).resolves.toEqual({
      ok: false,
      error: { code: "timeout", message: expect.any(String) },
    });
  });

  it("resolves to a cancelled error and aborts in flight when the caller's signal fires", async () => {
    const controller = new AbortController();
    fetchMock.mockImplementationOnce((_url: string, init: { signal: AbortSignal }) => new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(new Error("aborted")));
    }));

    const pending = requestExplanation(config, packet, { signal: controller.signal });
    controller.abort();
    await expect(pending).resolves.toEqual({
      ok: false,
      error: { code: "cancelled", message: expect.any(String) },
    });
  });
});

describe("verifyEndpoint", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => chatCompletion("ok") });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends a synthetic packet, never the reader's actual page data", async () => {
    await verifyEndpoint(config);

    const [, init] = fetchMock.mock.calls[0];
    const sentPacket = JSON.parse(JSON.parse(init.body).messages[1].content);
    expect(sentPacket).not.toEqual(packet);
    expect(sentPacket.pageTitle).toBe("");
    expect(sentPacket.domain).toBe("");
  });
});
