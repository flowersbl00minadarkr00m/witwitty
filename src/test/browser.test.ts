import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EXTENSION_UPDATE_ERROR, EXTENSION_UPDATE_GUIDANCE, getPanelRuntimeErrorMessage, requestPageScan, requestPanelReady, scanIdMatches, SCAN_HANDSHAKE_TIMEOUT_MS } from "../browser";
import { SCAN_PROTOCOL_VERSION } from "../types";

describe("panel browser bridge", () => {
  let sendMessage: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    sendMessage = vi.fn().mockResolvedValue({ protocolVersion: SCAN_PROTOCOL_VERSION, accepted: true, scanId: "scan-1" });
    Object.assign(globalThis, {
      window: {
        chrome: {
          runtime: { sendMessage },
        },
      },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    Reflect.deleteProperty(globalThis, "window");
  });

  it("requests panel readiness through the extension runtime", async () => {
    await requestPanelReady("scan-1");

    expect(sendMessage).toHaveBeenCalledWith({ type: "WITWITTY_PANEL_READY", protocolVersion: SCAN_PROTOCOL_VERSION, scanId: "scan-1" });
  });

  it("requests a retry for the current scan through the extension runtime", async () => {
    await requestPageScan("scan-1");

    expect(sendMessage).toHaveBeenCalledWith({ type: "WITWITTY_RETRY_SCAN", protocolVersion: SCAN_PROTOCOL_VERSION, scanId: "scan-1" });
  });

  it("accepts a matching versioned handshake response", async () => {
    sendMessage.mockResolvedValueOnce({ protocolVersion: SCAN_PROTOCOL_VERSION, accepted: true, scanId: "scan-1" });

    await expect(requestPanelReady("scan-1")).resolves.toEqual({
      protocolVersion: SCAN_PROTOCOL_VERSION,
      accepted: true,
      scanId: "scan-1",
    });
  });

  it("rejects an undefined no-listener response", async () => {
    sendMessage.mockResolvedValueOnce(undefined);

    await expect(requestPanelReady("scan-1")).rejects.toThrow(EXTENSION_UPDATE_ERROR);
  });

  it("rejects a malformed handshake response", async () => {
    sendMessage.mockResolvedValueOnce({ protocolVersion: SCAN_PROTOCOL_VERSION, accepted: true });

    await expect(requestPanelReady("scan-1")).rejects.toThrow(EXTENSION_UPDATE_ERROR);
  });

  it("rejects a mismatched handshake response", async () => {
    sendMessage.mockResolvedValueOnce({ protocolVersion: SCAN_PROTOCOL_VERSION + 1, accepted: true, scanId: "scan-1" });

    await expect(requestPanelReady("scan-1")).rejects.toThrow(EXTENSION_UPDATE_ERROR);
  });

  it("turns a bounded handshake timeout into extension-update guidance", async () => {
    vi.useFakeTimers();
    sendMessage.mockReturnValueOnce(new Promise(() => undefined));

    const request = requestPanelReady("scan-1");
    const rejection = expect(request).rejects.toThrow(EXTENSION_UPDATE_ERROR);
    await vi.advanceTimersByTimeAsync(SCAN_HANDSHAKE_TIMEOUT_MS);
    await rejection;
  });

  it("maps stale or mixed worker state to visible reload and reinstall guidance", () => {
    expect(getPanelRuntimeErrorMessage(new Error(EXTENSION_UPDATE_ERROR))).toBe(EXTENSION_UPDATE_GUIDANCE);
    expect(EXTENSION_UPDATE_GUIDANCE).toContain("refresh the article");
    expect(EXTENSION_UPDATE_GUIDANCE).toContain("toolbar icon again");
  });

  it("surfaces a rejected runtime message so the panel can show reload guidance", async () => {
    sendMessage.mockRejectedValueOnce(new Error("extension context invalidated"));

    await expect(requestPanelReady()).rejects.toThrow("extension context invalidated");
  });
});

describe("scanIdMatches", () => {
  it("accepts any incoming id while no scan is tracked (S-005 regression)", () => {
    // This is what makes it safe for handleScanRequest to null out scanIdRef
    // before issuing a retry: whichever scan-lifecycle message for the new
    // scan lands first (handshake response or background broadcast) is
    // accepted, so a retry can never be silently treated as a duplicate.
    expect(scanIdMatches(null, "scan-new")).toBe(true);
  });

  it("accepts a message carrying no id regardless of what is tracked", () => {
    expect(scanIdMatches("scan-1", undefined)).toBe(true);
  });

  it("accepts a message whose id matches the tracked scan", () => {
    expect(scanIdMatches("scan-1", "scan-1")).toBe(true);
  });

  it("rejects a message for a stale, no-longer-tracked scan id", () => {
    expect(scanIdMatches("scan-2", "scan-1")).toBe(false);
  });
});
