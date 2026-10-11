/** Syntax plus AST-based rendering/input policy checks. Type correctness is checked by build.mjs. */
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { root, sourceFiles } from './source-files.mjs';
import { loadTypeScript } from './typescript.mjs';
const ts = loadTypeScript();
const errors = [];
let checked = 0;
for (const file of sourceFiles().filter(file => /\.(?:ts|mjs|js)$/.test(file))) {
  const text = readFileSync(file, 'utf8');
  const name = path.relative(root, file).replaceAll('\\', '/');
  checked++;
  if (!file.endsWith('.ts')) {
    const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
    if (result.status !== 0)
      errors.push(`${name}: ${result.stderr}`);
  }
  const parsed = ts.createSourceFile(file, text, ts.ScriptTarget.ESNext, true, file.endsWith('.ts') ? ts.ScriptKind.TS : ts.ScriptKind.JS);
  for (const diagnostic of parsed.parseDiagnostics)
    errors.push(`${name}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')}`);
  if (name.startsWith('src/') || name.startsWith('extension/') || name.startsWith('companion/')) {
    const visit = node => {
      if (ts.isCallExpression(node) && node.expression.getText(parsed) === 'eval')
        errors.push(`${name}: eval is forbidden`);
      if (ts.isNewExpression(node) && node.expression.getText(parsed) === 'Function')
        errors.push(`${name}: dynamic Function is forbidden`);
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && ['insertAdjacentHTML', 'write'].includes(node.expression.name.text)) {
        if (node.expression.name.text === 'insertAdjacentHTML' || node.expression.expression.getText(parsed) === 'document')
          errors.push(`${name}: dynamic HTML sink forbidden`);
      }
      if (ts.isBinaryExpression(node) && ts.isPropertyAccessExpression(node.left) && ['innerHTML', 'outerHTML'].includes(node.left.name.text) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
        if (!(ts.isStringLiteral(node.right) || ts.isNoSubstitutionTemplateLiteral(node.right)))
          errors.push(`${name}: HTML may only be a fixed, authored string literal; use textContent for data`);
      }
      ts.forEachChild(node, visit);
    };
    visit(parsed);
    if ((name.startsWith('src/browser/') || name.startsWith('src/extension/') || name.startsWith('extension/')) && /TYPESAFE_API_KEY|WW_MODEL_KEY|OPENAI_API_KEY/.test(text))
      errors.push(`${name}: provider-key configuration must remain in the companion`);
  }
}
const manifest = JSON.parse(readFileSync(path.join(root, 'extension/manifest.json'), 'utf8'));
if (JSON.stringify([...manifest.permissions].sort()) !== JSON.stringify(['activeTab', 'scripting', 'storage']))
  errors.push('Unexpected extension permissions');
if (JSON.stringify(manifest.host_permissions) !== JSON.stringify(['http://127.0.0.1:4317/*']) || manifest.content_scripts)
  errors.push('Continuous/broad page access is forbidden');
if (errors.length) {
  console.error(errors.join('\n'));
  process.exitCode = 1;
}
console.log(`Syntax/rendering/privacy lint: ${checked} source files, ${errors.length} errors.`);
