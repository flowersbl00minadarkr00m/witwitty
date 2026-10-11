import test from 'node:test';
import http from 'node:http';
import assert from 'node:assert/strict';
import { createCompanion, livePipeline } from '../companion/server.mjs';
import { ChatCompletionGenerator, JevReviewer } from '../companion/providers.mjs';
import { Pipeline, FixtureGenerator, FixtureReviewer } from '../dist/core/pipeline.js';
import { CompanionTransport } from '../dist/browser/transport.js';
import { request, signal } from './helpers.mjs';
import { readFileSync } from 'node:fs';
const token = 'test-pairing-token-only-not-a-real-secret';
const origin = 'http://127.0.0.1:4174';
const headers = { Origin: origin, 'Content-Type': 'application/json', 'X-WitWitty-Token': token };
async function withServer(run, options = {}) {
  const { server, active } = createCompanion({ token, ...options });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = `http://127.0.0.1:${server.address().port}`;
  try {
    await run(address, active);
  }
  finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
}
test('real localhost HTTP health, schema and approved-only NDJSON', async () => withServer(async (url) => {
  const health = await (await fetch(`${url}/health`, { headers: { Origin: origin } })).json();
  assert.equal(health.schema, 1);
  assert.equal(health.mode, 'mock');
  const response = await fetch(`${url}/v1/transform`, { method: 'POST', headers, body: JSON.stringify(request()) });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('access-control-allow-origin'), origin);
  const events = (await response.text()).trim().split('\n').map(JSON.parse);
  assert.deepEqual(events.map(event => event.type), ['generating', 'reviewing', 'approved']);
  assert.ok(!JSON.stringify(health).includes(token));
}));
for (const [name, override, expected] of [
  ['foreign origin', { Origin: 'https://evil.example' }, 403], ['missing token', { 'X-WitWitty-Token': '' }, 403], ['wrong token', { 'X-WitWitty-Token': 'wrong' }, 403],
  ['null origin', { Origin: 'null' }, 403], ['form content type', { 'Content-Type': 'text/plain' }, 415],
])
  test(`companion rejects ${name}`, async () => withServer(async (url) => assert.equal((await fetch(`${url}/v1/transform`, { method: 'POST', headers: { ...headers, ...override }, body: JSON.stringify(request()) })).status, expected)));
test('invalid, oversized and unsupported-schema requests are rejected', async () => withServer(async (url) => {
  for (const body of ['not json', JSON.stringify(request({ schema: 99 })), 'x'.repeat(100001)]) {
    try {
      assert.equal((await fetch(`${url}/v1/transform`, { method: 'POST', headers, body })).status, 400);
    }
    catch (error) {
      assert.match(error.message, /fetch failed|socket/);
    }
  }
}));
test('companion preflight only approves explicit origins and headers', async () => withServer(async (url) => {
  const response = await fetch(`${url}/v1/transform`, { method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': 'POST' } });
  assert.equal(response.status, 204);
  assert.equal(response.headers.get('access-control-allow-origin'), origin);
  assert.ok(!response.headers.get('access-control-allow-headers').includes('*'));
}));
test('HTTP cancellation stops provider work and clears active jobs', async () => withServer(async (url, active) => {
  const response = await fetch(`${url}/v1/transform`, { method: 'POST', headers, body: JSON.stringify(request({ scenario: 'model-timeout' })) });
  assert.equal(active.size, 1);
  const cancel = await (await fetch(`${url}/v1/cancel`, { method: 'POST', headers, body: JSON.stringify({ id: 'request-1', sessionId: 'session-1' }) })).json();
  assert.equal(cancel.cancelled, true);
  await response.text();
  assert.equal(active.size, 0);
}));
test('duplicate request and concurrency bounds reject extra work', async () => withServer(async (url) => {
  const controller = new AbortController();
  const first = await fetch(`${url}/v1/transform`, { method: 'POST', headers, signal: controller.signal, body: JSON.stringify(request({ scenario: 'model-timeout' })) });
  const second = await fetch(`${url}/v1/transform`, { method: 'POST', headers, body: JSON.stringify(request({ id: 'other' })) });
  assert.equal(second.status, 429);
  controller.abort();
  await first.body.cancel().catch(() => { });
}, { maxConcurrent: 1 }));
test('partial document failures stay isolated over HTTP', async () => withServer(async (url) => {
  for (const blockId of ['paragraph-0', 'paragraph-1']) {
    const response = await fetch(`${url}/v1/transform`, { method: 'POST', headers, body: JSON.stringify(request({ id: blockId, blockId, scenario: 'partial', scope: 'Document' })) });
    const events = (await response.text()).trim().split('\n').map(JSON.parse);
    assert.equal(events.at(-1).type, blockId.endsWith('0') ? 'approved' : 'rejected');
  }
}));
test('live mode never silently substitutes fixture adapters', () => assert.throws(() => livePipeline({}), /requires/));
test('generation adapter builds an explicit JSON request and strips no source qualifications', async () => {
  let sent;
  const adapter = new ChatCompletionGenerator({ endpoint: 'https://model.example/v1/chat/completions', key: 'fake-test-key', model: 'test-model', fetcher: async (url, init) => {
      sent = { url, ...init };
      return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ explanation: 'Reviewed later.' }) } }] });
    } });
  const draft = await adapter.generate(request(), undefined, signal());
  assert.equal(draft.explanation, 'Reviewed later.');
  const body = JSON.parse(sent.body);
  assert.equal(body.response_format.type, 'json_object');
  assert.match(body.messages[0].content, /untrusted DATA/);
  assert.equal(sent.redirect, 'error');
  assert.throws(() => new ChatCompletionGenerator({ endpoint: 'http://public.example', key: 'x', model: 'y' }));
});
test('truncated or refused model responses fail closed', async () => {
  const adapter = new ChatCompletionGenerator({ endpoint: 'https://model.example/v1', key: 'test', model: 'test', fetcher: async () => Response.json({ choices: [{ finish_reason: 'length', message: { content: '{}' } }] }) });
  await assert.rejects(adapter.generate(request(), undefined, signal()), /incomplete/);
});
test('native Jev noul wire contract and threshold direction are correct', async () => {
  let payload;
  const reviewer = new JevReviewer({ key: 'fake-test-key', fetcher: async (url, init) => {
      assert.equal(url, 'https://api.typesafe.ai/v1/systemone');
      payload = JSON.parse(init.body);
      return Response.json({ model: 'jev-fixture-version', answers: { meaning: { type: 'noul', noul: .99 }, depthFit: { type: 'noul', noul: .98 }, unsupported: { type: 'noul', noul: .02 } } });
    } });
  const review = await reviewer.review(request(), { explanation: 'Candidate.' }, 1, signal());
  assert.equal(review.pass, true);
  assert.equal(review.reviewer, 'typesafe:jev-fixture-version');
  assert.ok(Object.values(payload.questions).every(q => q.type === 'noul' && q.instructions.length > 30));
  assert.equal(payload.state.depth, 'General');
  assert.equal('frames' in payload.state, false);
});
test('missing Jev answers and probability above unsupported threshold cannot approve', async () => {
  for (const answers of [{}, { meaning: { type: 'noul', noul: .99 }, depthFit: { type: 'noul', noul: .98 }, unsupported: { type: 'noul', noul: .10 } }]) {
    const reviewer = new JevReviewer({ key: 'test', fetcher: async () => Response.json({ model: 'test', answers }) });
    try {
      assert.equal((await reviewer.review(request(), { explanation: 'Candidate' }, 1, signal())).pass, false);
    }
    catch (error) {
      assert.match(error.message, /Missing/);
    }
  }
});
test('wire-shaped live adapters integrate through the common generation/review pipeline', async () => {
  const generator = new ChatCompletionGenerator({ endpoint: 'https://model.example/v1', key: 'test', model: 'test', fetcher: async () => Response.json({ choices: [{ finish_reason: 'stop', message: { content: '{"explanation":"The passage distinguishes commitment from durability."}' } }] }) });
  const reviewer = new JevReviewer({ key: 'test', fetcher: async () => Response.json({ model: 'test', answers: Object.fromEntries([['meaning', .99], ['depthFit', .99], ['unsupported', .01]].map(([key, n]) => [key, { type: 'noul', noul: n }])) }) });
  const result = await new Pipeline(generator, generator, reviewer).transform(request(), () => { }, signal());
  assert.equal(result.provenance.fixture, false);
  assert.equal(result.provenance.review.pass, true);
});
test('MV3 build is explicit activation only with narrow permissions and no secrets', () => {
  const manifest = JSON.parse(readFileSync(new URL('../dist-extension/manifest.json', import.meta.url), 'utf8'));
  assert.deepEqual(manifest.permissions.sort(), ['activeTab', 'scripting', 'storage']);
  assert.deepEqual(manifest.host_permissions, ['http://127.0.0.1:4317/*']);
  assert.equal(manifest.content_scripts, undefined);
  assert.equal(manifest.background.type, 'module');
  assert.ok(manifest.key.length > 100);
});
test('raw HTTP Host rejects DNS rebinding', async () => withServer(async (url) => { const status = await new Promise((resolve, reject) => { const req = http.request(url + '/health', { headers: { Host: 'evil.example:4317' } }, res => { res.resume(); resolve(res.statusCode); }); req.on('error', reject); req.end(); }); assert.equal(status, 403); }));

test('version endpoint exposes schema and contract without credentials or source text', async () => withServer(async url => {
  const response = await fetch(`${url}/version`, { headers: { Origin: origin } });
  const version = await response.json();
  assert.equal(response.status, 200); assert.equal(version.schema, 1); assert.equal(typeof version.contract, 'string');
  assert.deepEqual(Object.keys(version).sort(), ['contract', 'schema', 'version']);
}));
