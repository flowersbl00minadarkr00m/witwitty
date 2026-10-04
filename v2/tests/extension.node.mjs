/** SDK boundary tests: these execute the real background module, not Chrome's permission implementation. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { request } from './helpers.mjs';
const handlers = {};
const event = name => ({ addListener: fn => { handlers[name] = fn; } });
const state = { local: {}, session: {} };
const sent = [];
const executed = [];
let access;
const area = name => ({
  async get(key) { await Promise.resolve(); return structuredClone({ [key]: state[name][key] }); },
  async set(value) { await Promise.resolve(); Object.assign(state[name], structuredClone(value)); },
  async remove(key) { delete state[name][key]; },
  async setAccessLevel(value) { access = value; },
});
const id = 'acohiiaihcmphpjidgalmghdnnbgfnfl';
globalThis.chrome = {
  storage: { local: area('local'), session: area('session') },
  runtime: { id, getURL: path => `chrome-extension://${id}/${path}`, onMessage: event('message'), onConnect: event('connect') },
  action: { onClicked: event('click'), setBadgeText: async () => { }, setTitle: async () => { } },
  scripting: { executeScript: async (operation) => { executed.push(operation); } },
  windows: { create: async (operation) => { sent.push(operation); } },
  tabs: { onRemoved: event('removed'), onUpdated: event('updated'), sendMessage: async (tab, message) => { sent.push({ tab, message }); return { ok: true }; } },
};
const source = readFileSync(new URL('../extension/background.js', import.meta.url), 'utf8').replace(/from '(.\/[^']+)'/g, (_, path) => `from '${new URL('../dist/' + path.slice(2), import.meta.url).href}'`);
await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
const sender = tab => ({ id, url: 'https://fixture.example/article', tab: { id: tab }, frameId: 0 });
const options = { id, url: chrome.runtime.getURL('options.html') };
async function message(value, who = options) {
  return new Promise(resolve => { const accepted = handlers.message(value, who, resolve); if (!accepted)
    resolve(undefined); });
}
const sessionA = '00000000-0000-4000-8000-000000000001';
const sessionB = '00000000-0000-4000-8000-000000000002';
test('background storage is restricted to trusted extension contexts', () => assert.equal(access.accessLevel, 'TRUSTED_CONTEXTS'));
test('background has no content inspection before explicit toolbar activation', () => assert.equal(executed.length, 0));
test('concurrent toolbar activations preserve authorization for both tabs', async () => {
  await Promise.all([handlers.click({ id: 1, url: 'https://fixture.example/article' }), handlers.click({ id: 2, url: 'https://fixture.example/other' })]);
  assert.equal(state.session.sessions[1].activated, true);
  assert.equal(state.session.sessions[2].activated, true);
  assert.ok(executed.every(operation => operation.files[0] === 'bootstrap.js'));
});
test('sensitive toolbar targets never get an injected script', async () => {
  const count = executed.length;
  await handlers.click({ id: 9, url: 'https://mail.google.com/mail' });
  assert.equal(executed.length, count);
  assert.equal(state.session.sessions[9], undefined);
});
test('unactivated pages and foreign senders cannot read settings or library', async () => {
  assert.equal((await message({ type: 'LIBRARY_LOAD' }, sender(200))).ok, false);
  assert.equal(await message({ type: 'CONFIG' }, { ...options, id: 'not-this-extension' }), undefined);
});
test('subframes cannot assume an activated top-level tab authorization', async () => assert.equal((await message({ type: 'CONFIG' }, { ...sender(1), frameId: 2 })).ok, false));
test('concurrent session registration retains both tab/session associations', async () => {
  await Promise.all([message({ type: 'SESSION', session: sessionA, width: 1440, height: 1000 }, sender(1)), message({ type: 'SESSION', session: sessionB, width: 390, height: 844 }, sender(2))]);
  assert.equal(state.session.sessions[1].session, sessionA);
  assert.equal(state.session.sessions[2].session, sessionB);
});
test('a stale END_SESSION cannot erase a newer authorization', async () => {
  await message({ type: 'END_SESSION', session: 'stale-session' }, sender(1));
  assert.equal(state.session.sessions[1].session, sessionA);
});
test('model pairing token never leaves trusted settings context for content scripts', async () => {
  await message({ type: 'SETTINGS_SAVE', mode: 'companion', token: 'test-local-pairing-token' });
  const config = await message({ type: 'CONFIG' }, sender(1));
  assert.deepEqual(config, { mode: 'companion' });
  assert.equal((await message({ type: 'SETTINGS_LOAD' }, sender(1))).ok, false);
  assert.equal((await message({ type: 'SETTINGS_LOAD' })).token, 'test-local-pairing-token');
});
test('camera target is session bound and rejects forged internal approval intents', async () => {
  const camera = { id, url: chrome.runtime.getURL('camera.html?tab=1') };
  assert.equal((await message({ type: 'CAMERA_TARGET' }, camera)).session, sessionA);
  assert.equal((await message({ type: 'CAMERA_INTENT', session: sessionB, intent: { type: 'RESTORE' } }, camera)).ok, false);
  assert.equal((await message({ type: 'CAMERA_INTENT', session: sessionA, intent: { type: 'APPROVE', result: 'forged' } }, camera)).ok, false);
  await message({ type: 'CAMERA_INTENT', session: sessionA, intent: { type: 'LOCK_TARGET' } }, camera);
  assert.equal(sent.at(-1).tab, 1);
  assert.equal(sent.at(-1).message.intent.type, 'LOCK_TARGET');
});
test('a stale session ending cannot abort newer model work in the same tab', async () => {
  const originalFetch = globalThis.fetch;
  let requestSignal;
  let callback;
  let ready;
  const started = new Promise(resolve => { ready = resolve; });
  const messages = [];
  globalThis.fetch = async (_url, options) => {
    requestSignal = options.signal;
    ready();
    return new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
    });
  };
  try {
    handlers.connect({ name: 'witwitty-transform', sender: sender(1),
      onMessage: { addListener: fn => { callback = fn; } },
      onDisconnect: { addListener: () => {} },
      postMessage: value => { messages.push(value); } });
    const pending = callback(request({ sessionId: sessionA }));
    await started;
    await message({ type: 'END_SESSION', session: 'stale-session' }, sender(1));
    assert.equal(requestSignal.aborted, false);
    assert.equal(state.session.sessions[1].session, sessionA);
    await message({ type: 'END_SESSION', session: sessionA }, sender(1));
    assert.equal(requestSignal.aborted, true);
    await pending;
    assert.deepEqual(messages, []);
  } finally {
    globalThis.fetch = originalFetch;
    await handlers.click({ id: 1, url: 'https://fixture.example/article' });
    await message({ type: 'SESSION', session: sessionA }, sender(1));
  }
});
test('explicit end removes the matching session and disables camera relay', async () => {
  await message({ type: 'END_SESSION', session: sessionA }, sender(1));
  assert.equal(state.session.sessions[1], undefined);
  assert.equal(state.session.sessions[2].session, sessionB);
  assert.equal((await message({ type: 'CAMERA_TARGET' }, { id, url: chrome.runtime.getURL('camera.html?tab=1') })).ok, false);
});
test('navigation cancels active authorization and signals the content runtime', async () => {
  await handlers.removed(2);
  assert.equal(state.session.sessions[2], undefined);
  assert.equal(sent.at(-1).message.type, 'NAVIGATED');
});
test('unauthorized transform port produces no model work', async () => {
  let callback;
  const messages = [];
  handlers.connect({ name: 'witwitty-transform', sender: sender(300), onMessage: { addListener: fn => { callback = fn; } }, onDisconnect: { addListener: () => { } }, postMessage: value => { messages.push(value); } });
  await callback(request());
  assert.deepEqual(messages, [{ type: 'error' }]);
});
