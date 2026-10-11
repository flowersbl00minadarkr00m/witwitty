import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, cpSync, rmSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { resolveTypeScript } from './typescript.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const compiler = path.join(path.dirname(resolveTypeScript()), 'tsc.js');
rmSync(path.join(root, 'dist'), { recursive: true, force: true });
const result = spawnSync(process.execPath, [compiler, '-p', path.join(root, 'tsconfig.json'), '--pretty', 'false'], { stdio: 'inherit', windowsHide: true });
if (result.error || result.status !== 0) {
  console.error('TypeScript compilation failed. Install the repository dependencies first.');
  process.exit(1);
}
for (const name of ['index.html', 'demo.css', 'favicon.svg', 'camera.html', 'camera.css', 'camera-worker-bootstrap.js', 'LICENSE'])
  if (existsSync(path.join(root, name)))
    cpSync(path.join(root, name), path.join(root, 'dist', name));
if (existsSync(path.join(root, 'assets/vendor')))
  cpSync(path.join(root, 'assets/vendor'), path.join(root, 'dist/vendor'), { recursive: true });
if (existsSync(path.join(root, 'extension/manifest.json'))) {
  const out = path.join(root, 'dist-extension');
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  for (const name of ['core', 'browser', 'gesture', 'fixtures', 'extension'])
    cpSync(path.join(root, 'dist', name), path.join(out, name), { recursive: true });
  cpSync(path.join(root, 'extension'), out, { recursive: true });
  for (const name of ['camera.html', 'camera.css', 'camera-worker-bootstrap.js', 'favicon.svg', 'demo.css', 'LICENSE'])
    if (existsSync(path.join(root, name)))
      cpSync(path.join(root, name), path.join(out, name));
  if (existsSync(path.join(root, 'assets/vendor')))
    cpSync(path.join(root, 'assets/vendor'), path.join(out, 'vendor'), { recursive: true });
  const manifest = JSON.parse(readFileSync(path.join(out, 'manifest.json'), 'utf8'));
  if (manifest.host_permissions.some(permission => permission.includes('<all_urls>') || permission.includes('*://')))
    throw new Error('Broad host permission forbidden');
}
console.log('WitWitty V2 compiled. Demo: v2/dist. Extension: v2/dist-extension (when present).');
