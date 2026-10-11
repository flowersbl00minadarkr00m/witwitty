import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, copyFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { root, sourceFiles } from '../scripts/source-files.mjs';
import { resolveTypeScript } from '../scripts/typescript.mjs';

test('standalone build works from a path containing spaces and produces both licensed surfaces', () => {
  const temporary = mkdtempSync(path.join(tmpdir(), 'witwitty build with spaces-'));
  try {
    const destination = path.join(temporary, 'v2');
    for (const file of sourceFiles()) {
      const copy = path.join(destination, path.relative(root, file));
      mkdirSync(path.dirname(copy), { recursive: true });
      copyFileSync(file, copy);
    }
    // Resolve the already installed compiler; no install or network access is part of this test.
    const moduleDirectory = path.dirname(path.dirname(path.dirname(resolveTypeScript())));
    const env = { ...process.env, NODE_PATH: [moduleDirectory, process.env.NODE_PATH].filter(Boolean).join(path.delimiter) };
    const result = spawnSync(process.execPath, [path.join(destination, 'scripts/build.mjs')], {
      cwd: temporary, env, encoding: 'utf8', timeout: 30000, windowsHide: true,
    });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.ok(existsSync(path.join(destination, 'dist/browser/demo.js')));
    const manifest = JSON.parse(readFileSync(path.join(destination, 'dist-extension/manifest.json'), 'utf8'));
    assert.deepEqual(manifest.permissions, ['activeTab', 'scripting', 'storage']);
    for (const surface of ['dist', 'dist-extension'])
      assert.match(readFileSync(path.join(destination, surface, 'LICENSE'), 'utf8'), /Copyright \(c\) 2026 Henry Flowers/);
  }
  finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});
