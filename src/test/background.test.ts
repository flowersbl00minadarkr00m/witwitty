import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SCAN_PROTOCOL_VERSION } from "../types";

interface BrowserTab {
  id?: number;
  incognito?: boolean;
  url?: string;
  windowId?: number;
}

interface RuntimeMessage {
  type: string;
  protocolVersion?: number;
  scanId?: string;
}

describe("extension scan lifecycle", () => {
  let actionClick: ((tab: BrowserTab) => void) | undefined;
  let executeScript: ReturnType<typeof vi.fn>;
  let openPanel: ReturnType<typeof vi.fn>;
  let setPanelBehavior: ReturnType<typeof vi.fn>;
  let queryTabs: ReturnType<typeof vi.fn>;
  let getTab: ReturnType<typeof vi.fn>;
  let sendMessage: ReturnType<typeof vi.fn>;
  let runtimeSendMessage: ReturnType<typeof vi.fn>;
  let sessionGet: ReturnType<typeof vi.fn>;
  let sessionSet: ReturnType<typeof vi.fn>;
  let sessionRemove: ReturnType<typeof vi.fn>;
  let runtimeOnMessageListener: ((message: RuntimeMessage, sender?: unknown, sendResponse?: (response: unknown) => void) => unknown) | undefined;
  let consoleWarn: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    vi.resetModules();
    executeScript = vi.fn().mockResolvedValue(undefined);
    openPanel = vi.fn().mockResolvedValue(undefined);
    setPanelBehavior = vi.fn().mockResolvedValue(undefined);
    queryTabs = vi.fn().mockResolvedValue([{ id: 99 }]);
    getTab = vi.fn().mockImplementation(async (tabId: number) => ({ id: tabId, url: "https://example.test/article" }));
    sendMessage = vi.fn().mockResolvedValue(undefined);
    runtimeSendMessage = vi.fn();
    sessionGet = vi.fn().mockResolvedValue({});
    sessionSet = vi.fn().mockResolvedValue(undefined);
    sessionRemove = vi.fn().mockResolvedValue(undefined);
    runtimeOnMessageListener = undefined;
    consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    Object.assign(globalThis, {
      chrome: {
        action: {
          onClicked: {
            addListener(listener: (tab: BrowserTab) => void) {
              actionClick = listener;
            },
          },
        },
        runtime: {
          sendMessage: runtimeSendMessage,
          onInstalled: {
            addListener() {
              // The migration listener is intentionally installed.
            },
          },
          onMessage: {
            addListener(listener: typeof runtimeOnMessageListener) {
              runtimeOnMessageListener = listener ?? undefined;
            },
          },
        },
        sidePanel: { open: openPanel, setPanelBehavior },
        scripting: { executeScript },
        storage: {
          session: { get: sessionGet, set: sessionSet, remove: sessionRemove },
          local: {
            get: vi.fn().mockResolvedValue({}),
            set: vi.fn().mockResolvedValue(undefined),
            remove: vi.fn().mockResolvedValue(undefined),
          },
        },
        tabs: {
          query: queryTabs,
          get: getTab,
          sendMessage,
          onRemoved: { addListener() {} },
        },
      },
    });

    // @ts-expect-error The manifest service worker is plain JavaScript and has no declaration file.
    await import("../../public/background.js");
  });

  afterEach(() => {
    consoleWarn.mockRestore();
    Reflect.deleteProperty(globalThis, "chrome");
  });

  const ready = async (scanId?: string) => {
    const response = vi.fn();
    runtimeOnMessageListener?.({ type: "WITWITTY_PANEL_READY", protocolVersion: SCAN_PROTOCOL_VERSION, ...(scanId ? { scanId } : {}) }, undefined, response);
    await vi.waitFor(() => expect(response).toHaveBeenCalled());
    return response.mock.calls[0][0] as { accepted?: boolean; protocolVersion?: number; reason?: string; scanId?: string };
  };

  it("resets the legacy panel preference so the toolbar action remains the scan entry point", () => {
    expect(setPanelBehavior).toHaveBeenCalledWith({ openPanelOnActionClick: false });
  });

  it("opens a tab-specific panel and starts one scan after the panel is ready", async () => {
    actionClick?.({ id: 42, url: "https://example.test/article", windowId: 7 });

    expect(openPanel).toHaveBeenCalledWith({ tabId: 42 });
    const available = runtimeSendMessage.mock.calls.find(([message]) => message.type === "WITWITTY_SCAN_AVAILABLE");
    expect(available?.[0].scanId).toEqual(expect.any(String));

    const response = await ready(available?.[0].scanId);
    expect(response).toMatchObject({ accepted: true, scanId: available?.[0].scanId });
    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledWith(42, {
      type: "WITWITTY_SCAN_PAGE",
      scanId: available?.[0].scanId,
    }));

    expect(executeScript).toHaveBeenCalledWith({ target: { tabId: 42 }, files: ["content.js"] });
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(queryTabs).not.toHaveBeenCalled();
  });

  it("shows an idle response when the panel opens without a toolbar target", async () => {
    const response = await ready();

    expect(response).toEqual({ accepted: false, protocolVersion: SCAN_PROTOCOL_VERSION, reason: "target-missing" });
    await vi.waitFor(() => expect(runtimeSendMessage).toHaveBeenCalledWith({ type: "WITWITTY_SCAN_WAITING" }));
    expect(executeScript).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
    expect(runtimeSendMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: "WITWITTY_SCAN_ERROR" }));
  });

  it("coalesces duplicate panel-ready messages for one toolbar invocation", async () => {
    actionClick?.({ id: 42, url: "https://example.test/article", windowId: 7 });
    const available = runtimeSendMessage.mock.calls.find(([message]) => message.type === "WITWITTY_SCAN_AVAILABLE");

    await Promise.all([ready(available?.[0].scanId), ready(available?.[0].scanId)]);
    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledWith(42, expect.objectContaining({ type: "WITWITTY_SCAN_PAGE" })));
    expect(sendMessage).toHaveBeenCalledTimes(1);
  });

  it("reports a safe, actionable error when Chrome cannot inject the scanner", async () => {
    executeScript.mockRejectedValueOnce(new Error("injection failed"));
    actionClick?.({ id: 42, url: "https://example.test/article", windowId: 7 });
    const available = runtimeSendMessage.mock.calls.find(([message]) => message.type === "WITWITTY_SCAN_AVAILABLE");

    await ready(available?.[0].scanId);
    await vi.waitFor(() => expect(runtimeSendMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "WITWITTY_SCAN_ERROR",
      scanId: available?.[0].scanId,
      reason: "access-lost",
      retryable: false,
    })));

    expect(sendMessage).not.toHaveBeenCalled();
    expect(consoleWarn).toHaveBeenCalledWith("WitWitty scan injection failure.");
  });

  it("reports a retryable delivery failure for the exact toolbar tab", async () => {
    sendMessage.mockRejectedValueOnce(new Error("no receiving end"));
    actionClick?.({ id: 42, url: "https://example.test/article", windowId: 7 });
    const available = runtimeSendMessage.mock.calls.find(([message]) => message.type === "WITWITTY_SCAN_AVAILABLE");

    await ready(available?.[0].scanId);
    await vi.waitFor(() => expect(runtimeSendMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "WITWITTY_SCAN_ERROR",
      scanId: available?.[0].scanId,
      reason: "delivery-failed",
      retryable: true,
    })));

    expect(consoleWarn).toHaveBeenCalledWith("WitWitty scan delivery failure.");
    const retryResponse = vi.fn();
    runtimeOnMessageListener?.({ type: "WITWITTY_RETRY_SCAN", protocolVersion: SCAN_PROTOCOL_VERSION, scanId: available?.[0].scanId }, undefined, retryResponse);
    await vi.waitFor(() => expect(retryResponse).toHaveBeenCalledWith(expect.objectContaining({ accepted: true })));
    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledWith(42, expect.objectContaining({ type: "WITWITTY_SCAN_PAGE" })));
    expect(getTab).toHaveBeenCalledWith(42);
    expect(queryTabs).not.toHaveBeenCalled();
  });

  it("reports unsupported browser pages before attempting script injection", async () => {
    getTab.mockResolvedValueOnce({ id: 42, url: "chrome://extensions" });
    actionClick?.({ id: 42, url: "chrome://extensions", windowId: 7 });
    const available = runtimeSendMessage.mock.calls.find(([message]) => message.type === "WITWITTY_SCAN_AVAILABLE");

    await ready(available?.[0].scanId);
    await vi.waitFor(() => expect(runtimeSendMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "WITWITTY_SCAN_ERROR",
      scanId: available?.[0].scanId,
      reason: "unsupported-page",
      retryable: false,
    })));
    expect(executeScript).not.toHaveBeenCalled();
  });

  it("reports a stale target when the recorded tab closes before the panel is ready", async () => {
    getTab.mockRejectedValueOnce(new Error("tab closed"));
    actionClick?.({ id: 42, url: "https://example.test/article", windowId: 7 });
    const available = runtimeSendMessage.mock.calls.find(([message]) => message.type === "WITWITTY_SCAN_AVAILABLE");

    await ready(available?.[0].scanId);
    await vi.waitFor(() => expect(runtimeSendMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "WITWITTY_SCAN_ERROR",
      scanId: available?.[0].scanId,
      reason: "target-stale",
      retryable: false,
    })));
    expect(executeScript).not.toHaveBeenCalled();
  });

  it("rejects a mismatched panel protocol before looking up or injecting into a tab", async () => {
    actionClick?.({ id: 42, url: "https://example.test/article", windowId: 7 });
    const available = runtimeSendMessage.mock.calls.find(([message]) => message.type === "WITWITTY_SCAN_AVAILABLE");
    const response = vi.fn();

    runtimeOnMessageListener?.({
      type: "WITWITTY_PANEL_READY",
      protocolVersion: SCAN_PROTOCOL_VERSION + 1,
      scanId: available?.[0].scanId,
    }, undefined, response);
    await vi.waitFor(() => expect(response).toHaveBeenCalledWith({
      accepted: false,
      protocolVersion: SCAN_PROTOCOL_VERSION,
      reason: "extension-update-required",
    }));

    expect(getTab).not.toHaveBeenCalled();
    expect(executeScript).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("rejects a mismatched retry protocol before looking up or injecting into the recorded tab", async () => {
    actionClick?.({ id: 42, url: "https://example.test/article", windowId: 7 });
    const available = runtimeSendMessage.mock.calls.find(([message]) => message.type === "WITWITTY_SCAN_AVAILABLE");
    const response = vi.fn();

    runtimeOnMessageListener?.({
      type: "WITWITTY_RETRY_SCAN",
      protocolVersion: SCAN_PROTOCOL_VERSION + 1,
      scanId: available?.[0].scanId,
    }, undefined, response);
    await vi.waitFor(() => expect(response).toHaveBeenCalledWith({
      accepted: false,
      protocolVersion: SCAN_PROTOCOL_VERSION,
      reason: "extension-update-required",
    }));

    expect(getTab).not.toHaveBeenCalled();
    expect(executeScript).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
  });
});
