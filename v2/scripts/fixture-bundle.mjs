/** Test-only CommonJS packaging for offline DOM validation when browser navigation is administratively blocked.
* Production files are not patched. Tests inject only platform boundaries: URL, WebCrypto bridge, storage and camera channel.
*/
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadTypeScript } from './typescript.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ts = loadTypeScript();
const camera = process.argv.includes('--camera');
const entry = camera ? 'browser/camera.js' : 'browser/demo.js';
const modules = new Map();
function visit(id) {
  if (modules.has(id))
    return;
  const source = readFileSync(path.join(root, 'dist', id), 'utf8');
  modules.set(id, '');
  for (const match of source.matchAll(/(?:from\s+|import\s*)['"]([^'"]+)['"]/g))
    if (match[1].startsWith('.'))
      visit(path.posix.normalize(path.posix.join(path.posix.dirname(id), match[1])));
  // import.meta is module-location metadata, another explicit platform boundary in this test packager.
  const locatedSource = source.replaceAll('import.meta.url', JSON.stringify(`https://fixture.example/${id}`));
  const code = ts.transpileModule(locatedSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, allowJs: true } }).outputText;
  modules.set(id, code.replace(/\/\/# sourceMappingURL=.*\n?/g, ''));
}
for (const id of [entry, 'core/semantic.js', 'core/machine.js', 'core/privacy.js', 'core/pipeline.js', 'core/contracts.js', 'gesture/engine.js', 'fixtures/gestures.js', 'browser/replay.js', 'extension/content.js'])
  visit(id);
const wrappers = [...modules].map(([id, code]) => `${JSON.stringify(id)}:function(require,module,exports,document,crypto,localStorage,BroadcastChannel){\n${code}\n}`).join(',\n');
const bundle = `(() => { const modules={${wrappers}};const cache={};
const sourceDocument=document;
const testDocument=new Proxy(sourceDocument,{get(target,key){if(key==='location')return new URL('https://fixture.example/article');const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;}});
let serial=0;
const testCrypto={randomUUID:()=> '00000000-0000-4000-8000-'+String(++serial).padStart(12,'0'),subtle:{digest:async(_algorithm,data)=>new Uint8Array(await window.__wwDigest(Array.from(new Uint8Array(data.buffer??data,data.byteOffset??0,data.byteLength)))).buffer}};
const values=new Map();const testStorage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,String(value)),removeItem:key=>values.delete(key),clear:()=>values.clear()};
class TestChannel{postMessage(){}close(){}onmessage=null;}
function resolve(base,id){const parts=(base.substring(0,base.lastIndexOf('/')+1)+id).split('/');const output=[];for(const part of parts){if(part==='..')output.pop();else if(part!=='.'&&part)output.push(part);}return output.join('/');}
function load(id){if(cache[id])return cache[id].exports;const module={exports:{}};cache[id]=module;if(!modules[id])throw Error('Missing test module '+id);modules[id](name=>load(resolve(id,name)),module,module.exports,testDocument,testCrypto,testStorage,TestChannel);return module.exports;}
window.wwModules=load;window.wwTestStorage=testStorage;load(${JSON.stringify(entry)});})();`;
mkdirSync(path.join(root, 'artifacts'), { recursive: true });
writeFileSync(path.join(root, `artifacts/offline-${camera ? 'camera' : 'fixture'}.js`), bundle);
console.log('Created test-only offline DOM bundle (not included in release artifacts).');
