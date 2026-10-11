/** Dependency-free baseline formatter: LF, no trailing whitespace, one final newline, two-space JSON.
* It intentionally does not claim to implement Prettier's stylistic rules.
*/
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { root, sourceFiles } from './source-files.mjs';
const write = process.argv.includes('--write');
let changed = 0;
for (const file of sourceFiles()) {
  const original = readFileSync(file, 'utf8');
  const normalized = file.endsWith('.json') ? JSON.stringify(JSON.parse(original), null, 2) + '\n'
    : original.replace(/\r\n?/g, '\n').replace(/[\t ]+$/gm, '').replace(/\n*$/, '\n');
  if (original !== normalized) {
    changed++;
    console.log(`${write ? 'Formatted' : 'Needs formatting'} ${path.relative(root, file)}`);
    if (write)
      writeFileSync(file, normalized);
  }
}
console.log(`Formatting ${write ? 'updated' : 'checked'} ${sourceFiles().length} authored files; ${changed} difference(s).`);
if (!write && changed)
  process.exitCode = 1;
