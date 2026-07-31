const SCAN_TARGET_KEY = "witwittyScanTarget";
const PENDING_SCAN_KEY = "witwittyPendingScan";
const SCAN_PROTOCOL_VERSION = 1;

let scanTarget;
let pendingScan;
const inFlightScanIds = new Set();

const sendScanResponse = (sendResponse, response) => {
  sendResponse?.({ ...response, protocolVersion: SCAN_PROTOCOL_VERSION });
};

const hasCurrentScanProtocol = (message) => message?.protocolVersion === SCAN_PROTOCOL_VERSION;

const sendRuntimeMessage = (message) => {
  try {
    const result = chrome.runtime.sendMessage(message);
    if (result && typeof result.catch === "function") void result.catch(() => undefined);
  } catch {
    // The panel may have been invalidated by an extension reload.
  }
};

const configureActionBehavior = () => {
  try {
    const result = chrome.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: false });
    if (result && typeof result.catch === "function") void result.catch(() => undefined);
  } catch {
    // Older Chromium versions may not expose the side-panel behavior method.
  }
};

configureActionBehavior();
chrome.runtime.onInstalled?.addListener(configureActionBehavior);

const createScanId = () => {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
};

const isTarget = (value) => Number.isInteger(value?.tabId);

const isPendingScan = (value) => isTarget(value)
  && typeof value.scanId === "string"
  && (value.state === "pending" || value.state === "running");

const sessionSet = (value) => {
  try {
    const result = chrome.storage?.session?.set?.(value);
    if (result && typeof result.catch === "function") void result.catch(() => undefined);
  } catch {
    // The in-memory state remains available until the worker is suspended.
  }
};

const sessionRemove = (keys) => {
  try {
    const result = chrome.storage?.session?.remove?.(keys);
    if (result && typeof result.catch === "function") void result.catch(() => undefined);
  } catch {
    // Nothing else is required for the current worker instance.
  }
};

const readSession = async (keys) => {
  try {
    return await chrome.storage?.session?.get?.(keys);
  } catch {
    return {};
  }
};

const reportScanFailure = (phase, scanId) => {
  const details = phase === "injection"
    ? {
      reason: "access-lost",
      retryable: false,
      error: "WitWitty could not access this page. Return to the page and click the WitWitty toolbar icon again.",
    }
    : phase === "delivery"
      ? {
        reason: "delivery-failed",
        retryable: true,
        error: "WitWitty could not start scanning this page. Try again while this page is open.",
      }
      : phase === "unsupported"
        ? {
          reason: "unsupported-page",
          retryable: false,
          error: "WitWitty only scans ordinary web pages. Return to an article or documentation page and click the toolbar icon.",
        }
        : phase === "target-stale"
          ? {
            reason: "target-stale",
            retryable: false,
            error: "WitWitty lost the page it opened on. Return to the article and click the toolbar icon again.",
          }
          : phase === "panel-open"
            ? {
              reason: "panel-open-failed",
              retryable: false,
              error: "WitWitty could not open Context Lens for this page. Return to the article and click the toolbar icon again.",
            }
          : {
            reason: "target-missing",
            retryable: false,
            error: "WitWitty is ready when you are. Return to an article and click the toolbar icon.",
          };

  // Keep browser diagnostics useful without copying a URL, page content, or a
  // browser-generated error into local developer logs.
  console.warn(`WitWitty scan ${phase} failure.`);
  sendRuntimeMessage({
    type: "WITWITTY_SCAN_ERROR",
    ...details,
    ...(scanId ? { scanId } : {}),
  });
};

const rememberScanTarget = (tab) => {
  if (!Number.isInteger(tab?.id)) return undefined;
  scanTarget = { tabId: tab.id, windowId: tab.windowId };
  sessionSet({ [SCAN_TARGET_KEY]: scanTarget });
  return scanTarget;
};

const createPendingScan = (tab) => {
  const target = rememberScanTarget(tab);
  if (!target) return undefined;
  pendingScan = {
    ...target,
    scanId: createScanId(),
    state: "pending",
  };
  sessionSet({ [PENDING_SCAN_KEY]: pendingScan });
  return pendingScan;
};

const getPendingScan = async () => {
  if (isPendingScan(pendingScan)) return pendingScan;

  const stored = await readSession([PENDING_SCAN_KEY, SCAN_TARGET_KEY]);
  const storedPending = stored?.[PENDING_SCAN_KEY];
  if (isPendingScan(storedPending)) {
    pendingScan = storedPending;
    scanTarget = { tabId: storedPending.tabId, windowId: storedPending.windowId };
    return pendingScan;
  }

  const storedTarget = stored?.[SCAN_TARGET_KEY];
  if (isTarget(storedTarget)) scanTarget = storedTarget;
  return undefined;
};

const setPendingState = (scan, state) => {
  if (!scan || pendingScan?.scanId !== scan.scanId) return;
  pendingScan = { ...scan, state };
  sessionSet({ [PENDING_SCAN_KEY]: pendingScan });
};

const clearPendingScan = (scanId) => {
  if (pendingScan?.scanId !== scanId) return;
  pendingScan = undefined;
  sessionRemove([PENDING_SCAN_KEY]);
};

const getStoredScanTab = async (requestedTarget) => {
  let target = isTarget(requestedTarget) ? requestedTarget : scanTarget;
  if (!isTarget(target)) {
    const stored = await readSession([SCAN_TARGET_KEY]);
    target = stored?.[SCAN_TARGET_KEY];
  }
  if (!isTarget(target)) return undefined;

  scanTarget = { tabId: target.tabId, windowId: target.windowId };
  try {
    return await chrome.tabs.get(target.tabId);
  } catch {
    scanTarget = undefined;
    sessionRemove([SCAN_TARGET_KEY]);
    throw new Error("target-stale");
  }
};

const sendToStoredScanTab = async (message) => {
  try {
    const tab = await getStoredScanTab();
    if (tab?.id) await chrome.tabs.sendMessage(tab.id, message);
  } catch {
    // The page may have navigated or the content listener may not be present.
  }
};

const scanTab = async (tab, { rememberTarget = true, scanId } = {}) => {
  if (!tab?.id) {
    reportScanFailure("target-missing", scanId);
    return "failed";
  }

  if (tab.incognito) {
    sendRuntimeMessage({
      type: "WITWITTY_PRIVATE_PAGE_BLOCKED",
      error: "WitWitty does not scan or store reading activity in private windows.",
      ...(scanId ? { scanId } : {}),
    });
    return "blocked";
  }

  if (tab.url && !/^https?:\/\//i.test(tab.url)) {
    reportScanFailure("unsupported", scanId);
    return "failed";
  }

  if (rememberTarget) rememberScanTarget(tab);
  if (scanId) sendRuntimeMessage({ type: "WITWITTY_SCAN_STARTED", scanId });

  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
  } catch {
    reportScanFailure("injection", scanId);
    return "failed";
  }

  try {
    await chrome.tabs.sendMessage(tab.id, { type: "WITWITTY_SCAN_PAGE", ...(scanId ? { scanId } : {}) });
    return "started";
  } catch {
    reportScanFailure("delivery", scanId);
    return "failed";
  }
};

const startPendingScan = async (requestedScanId) => {
  const scan = await getPendingScan();
  if (!scan) {
    sendRuntimeMessage({ type: "WITWITTY_SCAN_WAITING" });
    return;
  }

  if (requestedScanId && requestedScanId !== scan.scanId) return;
  if (scan.state === "running") {
    sendRuntimeMessage({ type: "WITWITTY_SCAN_STARTED", scanId: scan.scanId });
    return;
  }
  if (inFlightScanIds.has(scan.scanId)) return;

  setPendingState(scan, "running");
  inFlightScanIds.add(scan.scanId);
  try {
    const tab = await getStoredScanTab(scan);
    const result = await scanTab(tab, { rememberTarget: false, scanId: scan.scanId });
    if (result !== "started") clearPendingScan(scan.scanId);
  } catch (error) {
    reportScanFailure(error?.message === "target-stale" ? "target-stale" : "target-missing", scan.scanId);
    clearPendingScan(scan.scanId);
  } finally {
    inFlightScanIds.delete(scan.scanId);
  }
};

const handlePanelReady = async (message, sendResponse) => {
  const scan = await getPendingScan();
  if (!scan) {
    sendScanResponse(sendResponse, { accepted: false, reason: "target-missing" });
    sendRuntimeMessage({ type: "WITWITTY_SCAN_WAITING" });
    return;
  }

  sendScanResponse(sendResponse, { accepted: true, scanId: scan.scanId });
  void startPendingScan(message?.scanId);
};

const handleRetryScan = async (message, sendResponse) => {
  try {
    const tab = await getStoredScanTab();
    const next = createPendingScan(tab);
    if (!next) {
      sendScanResponse(sendResponse, { accepted: false, reason: "target-missing" });
      return;
    }
    sendScanResponse(sendResponse, { accepted: true, scanId: next.scanId });
    void startPendingScan(next.scanId);
  } catch {
    sendScanResponse(sendResponse, { accepted: false, reason: "target-stale" });
    reportScanFailure("target-stale", message?.scanId);
  }
};

chrome.action.onClicked.addListener((tab) => {
  const scan = createPendingScan(tab);
  if (!scan) {
    reportScanFailure("target-missing");
    return;
  }

  // Calling open directly from the action handler preserves the user gesture
  // that grants activeTab access to the clicked page.
  if (tab?.id) {
    void chrome.sidePanel.open({ tabId: tab.id }).catch(() => {
      reportScanFailure("panel-open", scan.scanId);
    });
  }
  sendRuntimeMessage({ type: "WITWITTY_SCAN_AVAILABLE", scanId: scan.scanId });
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "WITWITTY_PANEL_READY") {
    if (!hasCurrentScanProtocol(message)) {
      sendScanResponse(sendResponse, { accepted: false, reason: "extension-update-required" });
      return true;
    }
    void handlePanelReady(message, sendResponse);
    return true;
  }

  if (message?.type === "WITWITTY_RETRY_SCAN") {
    if (!hasCurrentScanProtocol(message)) {
      sendScanResponse(sendResponse, { accepted: false, reason: "extension-update-required" });
      return true;
    }
    void handleRetryScan(message, sendResponse);
    return true;
  }

  if (message?.type === "WITWITTY_SCAN_COMPLETE" || message?.type === "WITWITTY_SCAN_EXCLUDED") {
    if (typeof message.scanId === "string") clearPendingScan(message.scanId);
  }

  if (message?.type === "WITWITTY_SET_TEXT_MODE" || message?.type === "WITWITTY_REMOVE_TERM" || message?.type === "WITWITTY_REMOVE_ALL_ANNOTATIONS") {
    void sendToStoredScanTab(message);
  }

  if (message?.type === "WITWITTY_UPDATE_PREFERENCE" && typeof message.term === "string") {
    const storageKey = message.action === "not-jargon" ? "notJargonTerms" : "knownTerms";
    chrome.storage.local.get([storageKey]).then((stored) => {
      const values = Array.isArray(stored[storageKey]) ? stored[storageKey] : [];
      const next = [...new Set([...values, message.term.trim().toLowerCase()])].sort();
      return chrome.storage.local.set({ [storageKey]: next });
    });
  }

  if (message?.type === "WITWITTY_EXCLUDE_DOMAIN" && typeof message.domain === "string") {
    const domain = message.domain.trim().toLowerCase();
    if (!domain) return;
    chrome.storage.local.get(["excludedDomains"]).then((stored) => {
      const values = Array.isArray(stored.excludedDomains) ? stored.excludedDomains : [];
      const next = [...new Set([...values, domain])].sort();
      return chrome.storage.local.set({ excludedDomains: next });
    }).then(() => {
      void sendToStoredScanTab({ type: "WITWITTY_REMOVE_ALL_ANNOTATIONS" });
    });
  }

  if (message?.type === "WITWITTY_CLEAR_COMPACT_SETTINGS") {
    chrome.storage.local.remove(["knownTerms", "notJargonTerms", "excludedDomains", "retentionDays"]);
  }
});
