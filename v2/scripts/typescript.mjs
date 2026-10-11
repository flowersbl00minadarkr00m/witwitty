import { createRequire } from 'node:module';
import { execFileSync, execSync } from 'node:child_process';
import path from 'node:path';
const require = createRequire(import.meta.url);
export function resolveTypeScript() {
  try {
    return require.resolve('typescript');
  }
  catch {
    try {
      // Windows .cmd launchers require a shell. This is a fixed command, never user-supplied text.
      // Run the compiler itself with node and an argument array, not through a shell.
      const options = { encoding: 'utf8', timeout: 15000, windowsHide: true };
      const prefix = process.platform === 'win32'
        ? execSync('npm root -g', options).trim()
        : execFileSync('npm', ['root', '-g'], options).trim();
      return require.resolve(path.join(prefix, 'typescript'));
    }
    catch {
      throw new Error('Install the repository dependencies (pnpm install --frozen-lockfile), or TypeScript 5.8+ globally.');
    }
  }
}
export function loadTypeScript() {
  return require(resolveTypeScript());
}
