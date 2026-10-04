import http from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { Pipeline } from '../dist/core/pipeline.js';
import { SCHEMA, VERSION, CONTRACT_VERSION, validateRequest } from '../dist/core/contracts.js';
import { ChatCompletionGenerator, JevReviewer } from './providers.mjs';
const identity = JSON.parse(readFileSync(new URL('../extension/identity.json', import.meta.url), 'utf8'));
export const DEFAULT_ORIGINS = ['http://127.0.0.1:4174', 'http://localhost:4174', `chrome-extension://${identity.id}`];
export function livePipeline(env = process.env) {
  const required = ['WW_MODEL_KEY', 'WW_FAST_MODEL', 'WW_STRONG_MODEL', 'TYPESAFE_API_KEY'];
  if (required.some(key => !env[key]))
    throw new Error(`Live mode requires ${required.join(', ')}. No fixture fallback will be used.`);
  const endpoint = env.WW_MODEL_ENDPOINT ?? 'https://api.openai.com/v1/chat/completions';
  return new Pipeline(new ChatCompletionGenerator({ endpoint, key: env.WW_MODEL_KEY, model: env.WW_FAST_MODEL }), new ChatCompletionGenerator({ endpoint, key: env.WW_MODEL_KEY, model: env.WW_STRONG_MODEL }), new JevReviewer({ key: env.TYPESAFE_API_KEY, model: env.WW_JEV_MODEL ?? 'jev-latest' }));
}
const equalToken = (expected, actual) => typeof actual === 'string' && Buffer.byteLength(actual) === Buffer.byteLength(expected) && timingSafeEqual(Buffer.from(expected), Buffer.from(actual));
async function readJSON(request) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 100000)
      throw new Error('Request body exceeded limit');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
export function createCompanion({ pipeline = new Pipeline(), token = randomBytes(24).toString('hex'), origins = DEFAULT_ORIGINS, maxConcurrent = 4 } = {}) {
  if (token.length < 24)
    throw new Error('Pairing token must be at least 24 characters');
  if (origins.some(origin => !/^http:\/\/(?:127\.0\.0\.1|localhost):\d+$/.test(origin) && !/^chrome-extension:\/\/[a-p]{32}$/.test(origin)))
    throw new Error('Only explicit loopback or extension origins are allowed');
  const active = new Map();
  const server = http.createServer(async (request, response) => {
    const host = request.headers.host ?? '';
    if (!/^(?:127\.0\.0\.1|localhost):\d+$/.test(host) || host.split(':')[1] !== String(server.address()?.port)) {
      response.writeHead(403).end();
      return;
    }
    const origin = request.headers.origin;
    if (origin && !origins.includes(origin)) {
      response.writeHead(403).end();
      return;
    }
    const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Vary': 'Origin' };
    if (origin)
      headers['Access-Control-Allow-Origin'] = origin;
    const finish = (status, data) => { if (!response.headersSent)
      response.writeHead(status, headers); response.end(JSON.stringify(data)); };
    if (request.method === 'OPTIONS') {
      if (!origin) {
        finish(403, { error: 'Origin required' });
        return;
      }
      response.writeHead(204, { ...headers, 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, X-WitWitty-Token', 'Access-Control-Max-Age': '60' }).end();
      return;
    }
    if (request.method === 'GET' && request.url === '/health') {
      finish(200, { ...(await pipeline.health()), schema: SCHEMA, version: VERSION });
      return;
    }
    if (request.method === 'GET' && request.url === '/version') {
      finish(200, { schema: SCHEMA, version: VERSION, contract: CONTRACT_VERSION });
      return;
    }
    if (request.method !== 'POST' || !['/v1/transform', '/v1/cancel'].includes(request.url)) {
      finish(404, { error: 'Unknown endpoint' });
      return;
    }
    if (!origin || !equalToken(token, request.headers['x-witwitty-token'])) {
      finish(403, { error: 'Pairing token and approved origin required' });
      return;
    }
    if (request.headers['content-type']?.split(';')[0].trim() !== 'application/json') {
      finish(415, { error: 'JSON required' });
      return;
    }
    let raw;
    try {
      raw = await readJSON(request);
    }
    catch {
      finish(400, { error: 'Invalid or oversized request body' });
      return;
    }
    if (request.url === '/v1/cancel') {
      const key = `${raw?.sessionId}:${raw?.id}`;
      const controller = active.get(key);
      controller?.abort();
      finish(200, { cancelled: !!controller });
      return;
    }
    let input;
    try {
      input = validateRequest(raw);
    }
    catch {
      finish(400, { error: 'Request did not satisfy the transformation contract' });
      return;
    }
    // Failure injection is never accepted in live mode.
    if (!pipeline.fast.fixture && input.scenario && input.scenario !== 'pass') {
      finish(400, { error: 'Failure injection is fixture-only' });
      return;
    }
    const key = `${input.sessionId}:${input.id}`;
    if (active.size >= maxConcurrent || active.has(key)) {
      finish(429, { error: 'Concurrency limit or duplicate request' });
      return;
    }
    const controller = new AbortController();
    active.set(key, controller);
    const disconnect = () => controller.abort();
    response.on('close', disconnect);
    const deadline = setTimeout(disconnect, 65000);
    response.writeHead(200, { ...headers, 'Content-Type': 'application/x-ndjson' });
    try {
      await pipeline.transform(input, event => { if (!controller.signal.aborted && !response.destroyed)
        response.write(JSON.stringify(event) + '\n'); }, controller.signal);
    }
    catch {
      if (!controller.signal.aborted && !response.destroyed)
        response.write(JSON.stringify({ type: 'rejected', requestId: input.id, reason: 'Companion could not verify this block.' }) + '\n');
    }
    finally {
      clearTimeout(deadline);
      active.delete(key);
      response.off('close', disconnect);
      response.end();
    }
  });
  server.requestTimeout = 30000;
  server.headersTimeout = 10000;
  server.on('close', () => { for (const controller of active.values())
    controller.abort(); });
  return { server, token, active };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const mode = process.env.WW_MODE ?? 'mock';
  if (!['mock', 'live'].includes(mode))
    throw new Error('WW_MODE must be mock or live');
  const pipeline = mode === 'live' ? livePipeline() : new Pipeline();
  const companion = createCompanion({ pipeline, ...(process.env.WW_PAIRING_TOKEN ? { token: process.env.WW_PAIRING_TOKEN } : {}) });
  companion.server.listen(4317, '127.0.0.1', () => {
    console.log(`WitWitty companion ${VERSION} | ${mode} | http://127.0.0.1:4317`);
    console.log(`Local pairing token (not a model key): ${companion.token}`);
    console.log('No page text, prompts, frames or model keys are written to logs.');
  });
}
