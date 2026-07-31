import { EXTENSION_UPDATE_REASON, SCAN_PROTOCOL_VERSION } from "./types";
import type { ActiveTerm, BrowserMessage, TextMode } from "./types";

const extensionRuntime = () => window.chrome?.runtime;
export const SCAN_HANDSHAKE_TIMEOUT_MS = 1500;
export const EXTENSION_UPDATE_ERROR = EXTENSION_UPDATE_REASON;
export const EXTENSION_UPDATE_GUIDANCE = "WitWitty needs an extension refresh. Reload or reinstall the extension, refresh the article, and click the toolbar icon again.";
const RELOADED_EXTENSION_GUIDANCE = "WitWitty was reloaded. Close Context Lens, refresh the page, and click the toolbar icon again.";

export interface ScanRequestResponse {
  accepted: boolean;
  protocolVersion: number;
  reason?: string;
  scanId?: string;
}

const isScanRequestResponse = (value: unknown): value is ScanRequestResponse => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const response = value as Partial<ScanRequestResponse>;
  if (response.protocolVersion !== SCAN_PROTOCOL_VERSION || typeof response.accepted !== "boolean") return false;
  if (response.reason !== undefined && typeof response.reason !== "string") return false;
  if (response.scanId !== undefined && typeof response.scanId !== "string") return false;
  return response.accepted === false || typeof response.scanId === "string";
};

const requestScanHandshake = async (type: "WITWITTY_PANEL_READY" | "WITWITTY_RETRY_SCAN", scanId?: string): Promise<ScanRequestResponse> => {
  const runtime = extensionRuntime();
  if (!runtime?.sendMessage) throw new Error("extension-context-unavailable");
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error(EXTENSION_UPDATE_ERROR)), SCAN_HANDSHAKE_TIMEOUT_MS);
    });
    const response = await Promise.race([
      Promise.resolve(runtime.sendMessage({ type, protocolVersion: SCAN_PROTOCOL_VERSION, ...(scanId ? { scanId } : {}) })),
      timeout,
    ]);
    if (!isScanRequestResponse(response)) throw new Error(EXTENSION_UPDATE_ERROR);
    return response;
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
};

export const requestPanelReady = (scanId?: string): Promise<ScanRequestResponse> => requestScanHandshake("WITWITTY_PANEL_READY", scanId);

export const requestPageScan = (scanId?: string): Promise<ScanRequestResponse> => requestScanHandshake("WITWITTY_RETRY_SCAN", scanId);

/**
 * Whether a scan-lifecycle broadcast belongs to the scan the panel is currently
 * tracking. A null `trackedScanId` means "not tracking any scan yet" and accepts
 * any incoming id — this is what lets the panel adopt whichever scan message
 * (the direct handshake response or a background broadcast) happens to arrive
 * first, instead of requiring one specific message to win a race.
 */
export const scanIdMatches = (trackedScanId: string | null, incomingScanId?: string): boolean => {
  if (!incomingScanId || !trackedScanId) return true;
  return trackedScanId === incomingScanId;
};

export const getPanelRuntimeErrorMessage = (error: unknown): string => error instanceof Error && error.message === EXTENSION_UPDATE_ERROR
  ? EXTENSION_UPDATE_GUIDANCE
  : RELOADED_EXTENSION_GUIDANCE;

export const setPageTextMode = (term: string, mode: TextMode): void => {
  extensionRuntime()?.sendMessage({ type: "WITWITTY_SET_TEXT_MODE", term: term.toLocaleLowerCase(), mode });
};

export const removePageTerm = (term: string): void => {
  extensionRuntime()?.sendMessage({ type: "WITWITTY_REMOVE_TERM", term: term.toLocaleLowerCase() });
};

export const updateDetectionPreference = (term: string, action: "got-it" | "not-jargon"): void => {
  extensionRuntime()?.sendMessage({
    type: "WITWITTY_UPDATE_PREFERENCE",
    term: term.trim().toLocaleLowerCase(),
    action,
  });
};

export const excludeDomain = (domain: string): void => {
  extensionRuntime()?.sendMessage({ type: "WITWITTY_EXCLUDE_DOMAIN", domain: domain.trim().toLocaleLowerCase() });
};

export const clearCompactSettings = (): void => {
  extensionRuntime()?.sendMessage({ type: "WITWITTY_CLEAR_COMPACT_SETTINGS" });
};

export const listenForBrowserMessages = (
  onTerm: (term: ActiveTerm, message: BrowserMessage) => void,
  onStatus: (message: BrowserMessage) => void,
): (() => void) => {
  const runtime = extensionRuntime();
  if (!runtime?.onMessage) return () => undefined;

  const listener = (message: BrowserMessage) => {
    if (message.type === "WITWITTY_TERM_SELECTED" && message.payload) {
      onTerm(message.payload as ActiveTerm, message);
      return;
    }
    onStatus(message);
  };
  runtime.onMessage.addListener(listener);
  return () => runtime.onMessage.removeListener(listener);
};
