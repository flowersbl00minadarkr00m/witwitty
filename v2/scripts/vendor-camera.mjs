import { mkdir, writeFile, rm, rename } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const version = '0.10.21';
const base = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${version}/`;
const files = [
  ['vision_bundle.mjs', `${base}vision_bundle.mjs`],
  ...['vision_wasm_internal.js', 'vision_wasm_internal.wasm', 'vision_wasm_nosimd_internal.js', 'vision_wasm_nosimd_internal.wasm'].map(name => [`wasm/${name}`, `${base}wasm/${name}`]),
  ['hand_landmarker.task', 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task'],
  ['UPSTREAM-LICENSE.txt', 'https://raw.githubusercontent.com/google-ai-edge/mediapipe/v0.10.21/LICENSE'],
];
const temporary = path.join(root, 'assets/vendor-install');
await rm(temporary, { recursive: true, force: true });
await mkdir(path.join(temporary, 'wasm'), { recursive: true });
const manifest = { runtime: `@mediapipe/tasks-vision@${version}`, model: 'hand_landmarker/float16/1', files: [] };
try {
  for (const [name, url] of files) {
    console.log(`Downloading pinned local camera asset: ${name}`);
    const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(60000) });
    if (!response.ok || !response.body)
      throw new Error(`Camera asset request failed: ${response.status}`);
    const chunks = [];
    let size = 0;
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > 60000000)
        throw new Error('Oversized camera asset');
      chunks.push(chunk);
    }
    const data = Buffer.concat(chunks);
    if (size < 100 || data.subarray(0, 100).toString('utf8').includes('<!DOCTYPE html'))
      throw new Error('Invalid camera asset');
    const sha256 = createHash('sha256').update(data).digest('hex');
    await writeFile(path.join(temporary, name), data);
    manifest.files.push({ name, url, bytes: size, sha256 });
  }
  await writeFile(path.join(temporary, 'asset-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  await writeFile(path.join(temporary, 'UPSTREAM-NOTICE.txt'), 'MediaPipe Tasks Vision and hand-landmarker model. Upstream: https://github.com/google-ai-edge/mediapipe\nReview upstream licenses before redistribution. The application source license does not replace third-party terms.\n');
  await rm(path.join(root, 'assets/vendor'), { recursive: true, force: true });
  await rename(temporary, path.join(root, 'assets/vendor'));
  console.log('Camera assets installed locally. Rebuild the demo and extension. SHA-256 values record this installation; they are not independent upstream signatures.');
}
catch (error) {
  await rm(temporary, { recursive: true, force: true });
  throw error;
}
