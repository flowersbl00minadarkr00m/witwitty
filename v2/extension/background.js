import { privacyDecision, validateSaved } from './core/privacy.js';
import { validateRequest, isRecord } from './core/contracts.js';
import { normalizeInputIntent } from './core/machine.js';
import { CompanionTransport } from './browser/transport.js';
import { validateCalibration } from './gesture/engine.js';
const storageReady = chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
let libraryQueue = Promise.resolve();
let sessionQueue = Promise.resolve();
const jobs = new Map();
async function sessions() { return (await chrome.storage.session.get('sessions')).sessions ?? {}; }
async function changeSessions(change) {
  const operation = sessionQueue.then(async () => { const current = await sessions(); const result = change(current); await chrome.storage.session.set({ sessions: current }); return result; });
  sessionQueue = operation.catch(() => { });
  return operation;
}
async function settings() { await storageReady; return (await chrome.storage.local.get('settings')).settings ?? { mode: 'fixture', token: '' }; }
async function library() { await storageReady; const items = (await chrome.storage.local.get('library')).library ?? []; return items.slice(0, 100).flatMap(item => { try {
  return [validateSaved(item)];
}
catch {
  return [];
} }); }
async function sessionFor(sender) { return Number.isInteger(sender?.tab?.id) && (sender.frameId === undefined || sender.frameId === 0) ? (await sessions())[sender.tab.id] : undefined; }
function ownedPage(sender, file) { return sender.id === chrome.runtime.id && sender.url?.split('?')[0] === chrome.runtime.getURL(file); }
function ownOptions(sender) { return ownedPage(sender, 'options.html'); }
async function relayCamera(message, sender) {
  if (!ownedPage(sender, 'camera.html'))
    throw new Error('Untrusted camera sender');
  const tabId = Number(new URL(sender.url).searchParams.get('tab'));
  const session = (await sessions())[tabId];
  if (!session || message.session !== session.session)
    throw new Error('Camera session ended');
  if (message.type === 'CAMERA_INTENT') {
    const intent = normalizeInputIntent(message.intent);
    if (!intent)
      throw new Error('Invalid input intent');
    return chrome.tabs.sendMessage(tabId, { type: 'CAMERA_INTENT', session: session.session, intent });
  }
  if (message.type === 'CAMERA_STATUS' && ['inactive', 'starting', 'active', 'failed'].includes(message.status))
    return chrome.tabs.sendMessage(tabId, { type: message.type, session: session.session, status: message.status });
  if (message.type === 'CAMERA_GESTURE')
    return chrome.tabs.sendMessage(tabId, { type: message.type, session: session.session, gesture: String(message.gesture).slice(0, 30), confidence: Number(message.confidence) });
  throw new Error('Unknown camera operation');
}
chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id)
    return;
  const decision = privacyDecision(tab.url ?? '');
  if (!decision.allowed) {
    await chrome.action.setBadgeText({ tabId: tab.id, text: '!' });
    await chrome.action.setTitle({ tabId: tab.id, title: decision.reason });
    return;
  }
  await changeSessions(current => { current[tab.id] ??= { activated: true }; });
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['bootstrap.js'] });
    await chrome.action.setBadgeText({ tabId: tab.id, text: '' });
  }
  catch {
    await clearTab(tab.id);
    await chrome.action.setBadgeText({ tabId: tab.id, text: '!' });
    await chrome.action.setTitle({ tabId: tab.id, title: 'This page cannot be activated. Use an ordinary article page.' });
  }
});
chrome.runtime.onConnect.addListener(port => {
  const controller = new AbortController();
  const id = crypto.randomUUID();
  let received = false;
  port.onDisconnect.addListener(() => { controller.abort(); jobs.delete(id); });
  port.onMessage.addListener(async (message) => {
    if (received) {
      controller.abort();
      return;
    }
    received = true;
    try {
      const session = await sessionFor(port.sender);
      if (port.name !== 'witwitty-transform' || port.sender?.id !== chrome.runtime.id || !session?.session || !privacyDecision(port.sender?.url ?? '').allowed)
        throw new Error('Inactive sender');
      const request = validateRequest(message);
      if (request.sessionId !== session.session)
        throw new Error('Stale session');
      const config = await settings();
      jobs.set(id, { controller, tabId: port.sender.tab.id, sessionId: request.sessionId });
      await new CompanionTransport(config.token ?? '').transform(request, event => { if (!controller.signal.aborted)
        port.postMessage(event); }, controller.signal);
      if (!controller.signal.aborted)
        port.postMessage({ type: 'done' });
    }
    catch {
      if (!controller.signal.aborted) {
        try {
          port.postMessage({ type: 'error' });
        }
        catch { }
      }
    }
    finally {
      jobs.delete(id);
    }
  });
});
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || !isRecord(message))
    return false;
  (async () => {
    const session = await sessionFor(sender);
    const options = ownOptions(sender);
    const camera = ownedPage(sender, 'camera.html');
    if (!session && !options && !camera)
      throw new Error('Inactive sender');
    if (message.type === 'SESSION' && session && /^[a-f0-9-]{36}$/.test(message.session)) {
      await changeSessions(current => { if (!current[sender.tab.id])
        throw new Error('Activation expired'); current[sender.tab.id] = { activated: true, session: message.session, width: Math.max(100, Math.min(20000, Number(message.width) || 1280)), height: Math.max(100, Math.min(20000, Number(message.height) || 800)) }; });
      return { ok: true };
    }
    if (message.type === 'END_SESSION' && session) {
      const ended = await changeSessions(current => {
        if (current[sender.tab.id]?.session !== message.session)
          return false;
        delete current[sender.tab.id];
        return true;
      });
      if (ended)
        for (const job of jobs.values())
          if (job.tabId === sender.tab.id && job.sessionId === message.session)
            job.controller.abort();
      return { ok: true };
    }
    if (message.type === 'CONFIG') {
      const config = await settings();
      return { mode: config.mode === 'companion' ? 'companion' : 'fixture' };
    }
    if (message.type === 'SETTINGS_LOAD' && options)
      return settings();
    if (message.type === 'SETTINGS_SAVE' && options) {
      if (!['fixture', 'companion'].includes(message.mode) || typeof message.token !== 'string' || message.token.length > 256)
        throw new Error('Invalid settings');
      await chrome.storage.local.set({ settings: { mode: message.mode, token: message.token } });
      return { ok: true };
    }
    if (message.type === 'HEALTH')
      return new CompanionTransport().health(AbortSignal.timeout(2500));
    if (message.type === 'LIBRARY_LOAD')
      return library();
    if (message.type === 'LIBRARY_SAVE' || message.type === 'LIBRARY_DELETE') {
      const operation = libraryQueue.then(async () => {
        let items = await library();
        if (message.type === 'LIBRARY_SAVE') {
          const item = validateSaved(message.item);
          items = [item, ...items.filter(previous => previous.id !== item.id)].slice(0, 100);
        }
        else
          items = items.filter(item => item.id !== message.id);
        if (JSON.stringify(items).length > 2000000)
          throw new Error('Library full');
        await chrome.storage.local.set({ library: items });
        return { ok: true };
      });
      libraryQueue = operation.catch(() => { });
      return operation;
    }
    if (message.type === 'OPEN_CAMERA' && session?.session) {
      await chrome.windows.create({ url: chrome.runtime.getURL(`camera.html?tab=${sender.tab.id}`), type: 'popup', width: 520, height: 820 });
      return { ok: true };
    }
    if (message.type === 'CAMERA_TARGET' && camera) {
      const tabId = Number(new URL(sender.url).searchParams.get('tab'));
      const target = (await sessions())[tabId];
      if (!target?.session)
        throw new Error('Activate an article first');
      return target;
    }
    if (['CAMERA_INTENT', 'CAMERA_STATUS', 'CAMERA_GESTURE'].includes(message.type))
      return relayCamera(message, sender);
    if (message.type === 'CALIBRATION_LOAD' && (camera || options))
      return (await chrome.storage.local.get('calibration')).calibration ?? null;
    if (message.type === 'CALIBRATION_SAVE' && camera) {
      await chrome.storage.local.set({ calibration: validateCalibration(message.value) });
      return { ok: true };
    }
    if (message.type === 'CALIBRATION_RESET' && (camera || options)) {
      await chrome.storage.local.remove('calibration');
      return { ok: true };
    }
    throw new Error('Unknown operation');
  })().then(respond).catch(() => respond({ ok: false, error: 'Operation unavailable. Check activation, settings or companion.' }));
  return true;
});
async function clearTab(tabId) {
  const previous = await changeSessions(current => { const previous = current[tabId]; delete current[tabId]; return previous; });
  for (const job of jobs.values())
    if (job.tabId === tabId)
      job.controller.abort();
  if (previous?.session)
    chrome.tabs.sendMessage(tabId, { type: 'NAVIGATED', session: previous.session }).catch(() => { });
}
chrome.tabs.onRemoved.addListener(clearTab);
chrome.tabs.onUpdated.addListener((tabId, change) => { if (change.status === 'loading' || change.url)
  void clearTab(tabId); });
