import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ignored = new Set(['dist', 'dist-extension', 'artifacts', 'assets', 'node_modules', '__pycache__', '.git']);
export function sourceFiles(directory = root) {
  return readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'en')).flatMap(entry => {
    if (ignored.has(entry.name) || (entry.name.startsWith('.env') && entry.name !== '.env.example'))
      return [];
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(file) : entry.isFile() ? [file] : [];
  });
}
