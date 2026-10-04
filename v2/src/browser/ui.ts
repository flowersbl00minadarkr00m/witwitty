import { DEPTHS, LIMITS, type Depth } from '../core/contracts.js';
import { exportMarkdown, validateSaved, type SavedItem } from '../core/privacy.js';
import type { Runtime } from './runtime.js';
import { KEY_BINDINGS } from './inputs.js';
export interface LibraryStore {
  load(): Promise<SavedItem[]>;
  save(item: SavedItem): Promise<void>;
  delete(id: string): Promise<void>;
}
export class BrowserLibrary implements LibraryStore {
  constructor(private storage: Storage, private key = 'witwitty-v2-explicit-saves') { }
  async load(): Promise<SavedItem[]> {
    try {
      const items: unknown = JSON.parse(this.storage.getItem(this.key) ?? '[]');
      return Array.isArray(items) ? items.slice(0, 100).flatMap(item => { try {
        return [validateSaved(item)];
      }
      catch {
        return [];
      } }) : [];
    }
    catch {
      return [];
    }
  }
  async save(item: SavedItem): Promise<void> {
    const items = [validateSaved(item), ...(await this.load()).filter(previous => previous.id !== item.id)].slice(0, 100);
    const json = JSON.stringify(items);
    if (json.length > 2000000)
      throw new Error('Local library limit reached. Export and delete older items.');
    this.storage.setItem(this.key, json);
  }
  async delete(id: string): Promise<void> { this.storage.setItem(this.key, JSON.stringify((await this.load()).filter(item => item.id !== id))); }
}
export function download(name: string, text: string, mime = 'text/plain'): void {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const STYLE = `
:host{all:initial;color-scheme:dark;font-family:Inter,ui-sans-serif,system-ui,sans-serif;font-size:13px;color:#e5eeec;line-height:1.45}
*{box-sizing:border-box}button,select,input{font:inherit;color:inherit}button,select{background:#17211f;border:1px solid #35453f;border-radius:8px;padding:9px 12px;cursor:pointer}button:hover{background:#273b34;border-color:#67c7a9}button:focus-visible,select:focus-visible,input:focus-visible,summary:focus-visible{outline:2px solid #96f0d1;outline-offset:3px}button:disabled{opacity:.4;cursor:not-allowed}button[aria-pressed=true]{background:#c6f5d9;color:#09251a;border-color:#c6f5d9}
.dock{position:fixed;z-index:2147483645;bottom:24px;left:50%;transform:translateX(-50%);width:max-content;max-width:calc(100vw - 24px);border:1px solid #55766588;background:#101a17f5;border-radius:18px;box-shadow:0 16px 70px #0008;backdrop-filter:blur(16px)}.pill{display:flex;align-items:center;gap:16px;padding:13px 18px;list-style:none;cursor:pointer;user-select:none}.pill::-webkit-details-marker{display:none}.brand{font-weight:650;letter-spacing:-.4px}.dot{width:7px;height:7px;border-radius:50%;background:#86e7bf;box-shadow:0 0 14px #86e7bf55}.triplet{font:11px ui-monospace,monospace;letter-spacing:1px}.caret{color:#8daca0}.controls{padding:0 15px 15px;max-width:570px}.row{display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin:8px 0}.row.spread{justify-content:space-between}.row .small{font-size:11px;color:#a9bdb3}.status{font-size:11px;color:#b8c9c0;max-width:520px;margin:10px 0 0;min-height:16px}.error{color:#ffcaac}.depths{display:flex;gap:4px;margin:12px 0}.depths button{flex:1;padding:8px;font-size:11px}.scope{font:11px ui-monospace,monospace;color:#c3d9cf;min-width:110px;text-align:center}.divider{height:1px;background:#31473c;margin:12px 0}.link{border:0;background:none;padding:5px 7px;color:#b6d3c4;font-size:11px}.hint{color:#94a99e;font-size:11px}.mini{font-size:11px;padding:6px 9px}
dialog{position:fixed;background:#111c17;color:#d8e7df;border:1px solid #466651;border-radius:16px;padding:26px;width:min(680px,calc(100vw - 32px));max-height:80vh;overflow:auto;box-shadow:0 20px 100px #0009}dialog::backdrop{background:#020b08b3}h2{font-size:24px;letter-spacing:-.7px;font-weight:500;margin:0 0 8px}h3{font-size:15px;font-weight:550}p{line-height:1.6;color:#a9c0b3}pre{white-space:pre-wrap;word-break:break-word;font:11px/1.6 ui-monospace,monospace;max-height:350px;overflow:auto;padding:12px;background:#09120d;border-radius:8px}article{padding:18px 0;border-top:1px solid #31473c}a{color:#a5e8c2}footer{display:flex;gap:8px;justify-content:flex-end;margin-top:20px}.empty{padding:24px 0}.badge{font-size:10px;letter-spacing:1px;color:#9bc7af}kbd{font:11px ui-monospace,monospace;background:#23372b;border-radius:3px;padding:2px 5px}.keyrow{display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid #263c2e}progress{width:100%;height:3px;accent-color:#9ae6bd}
@media(max-width:600px){.dock{bottom:12px;width:calc(100vw - 24px)}.pill{gap:10px;padding:14px}.brand{display:none}.triplet{font-size:10px;letter-spacing:.7px}.controls{max-width:100%;padding:0 12px 12px}.depths button{font-size:10px;padding:8px 4px}.row button{font-size:11px}dialog{padding:20px}.status{max-width:85vw}}
@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto!important;transition:none!important}}
`;
export function installLensStyle(document: Document): () => void {
  const style = document.createElement('style');
  style.dataset.wwOwned = 'style';
  style.textContent = '[hidden]:has(+[data-ww-owned="lens"][data-mode="Rewrite"]){display:none!important}.ww-approved-lens[data-ww-owned="lens"]{box-sizing:border-box;border-left:2px solid #57b593!important;padding:14px 20px!important;background:light-dark(#eaf7f0,#153126)!important;color:light-dark(#163a2b,#ddf1e6)!important;border-radius:0 8px 8px 0;white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.7}.ww-approved-lens[data-mode="Explain"]{margin:12px 0 24px;font-size:.95em}.ww-lens-caption{display:block;font:10px/1.5 ui-monospace,monospace;letter-spacing:1.4px;color:light-dark(#356c52,#86c6a4);margin-bottom:10px}';
  document.head.append(style);
  return () => style.remove();
}
export function mountHUD(runtime: Runtime, library: LibraryStore, onCamera?: () => void, onExit?: () => void): () => void {
  const document = runtime.document;
  const host = document.createElement('div');
  host.dataset.wwOwned = 'hud';
  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = STYLE;
  shadow.append(style);
  const dock = document.createElement('details');
  dock.className = 'dock';
  dock.open = true;
  // This fixed, application-authored markup contains no source or model text.
  dock.innerHTML = `<summary class="pill" aria-label="WitWitty controls"><span class="dot"></span><span class="brand">WitWitty</span><span class="triplet" data-state-label>EXPLAIN · PARAGRAPH · GENERAL</span><span class="caret">⌃</span></summary><div class="controls"><div class="row spread"><div class="row"><button data-action="Explain">Explain</button><button data-action="Rewrite">Rewrite</button></div><div class="row"><button class="mini" data-action="ZOOM_OUT" aria-label="Zoom out one semantic level">−</button><span class="scope" data-scope>Paragraph</span><button class="mini" data-action="ZOOM_IN" aria-label="Zoom in one semantic level">+</button></div></div><div class="depths" role="group" aria-label="Explanatory depth"></div><div class="row spread"><div class="row"><button class="mini" data-action="LOCK_TARGET">Lock target</button><button class="mini" data-action="UNLOCK_TARGET">Release</button></div><button class="mini" data-action="RESTORE">Restore original</button></div><progress value="0" max="1" hidden></progress><div class="status" role="status" aria-live="polite"></div><div class="divider"></div><div class="row spread"><span class="hint" data-connection>Local fixtures · camera inactive</span><div><button class="link" data-action="SAVE">Save</button><button class="link" data-action="LIBRARY">Library</button><button class="link" data-action="HELP">Keys</button><button class="link" data-action="DEBUG">Inspect</button><button class="link" data-action="CAMERA">Camera</button><button class="link" data-action="DEACTIVATE">Exit</button></div></div></div>`;
  for (const depth of DEPTHS) {
    const button = document.createElement('button');
    button.textContent = depth;
    button.dataset.depth = depth;
    dock.querySelector('.depths')!.append(button);
  }
  const dialog = document.createElement('dialog');
  dialog.setAttribute('aria-label', 'WitWitty details');
  shadow.append(dock, dialog);
  document.body.append(host);
  let collapse: ReturnType<typeof setTimeout> | undefined;
  let expandedByUser = false;
  let dimensions = '';
  dock.querySelector('summary')!.addEventListener('click', () => { expandedByUser = !dock.open; if (collapse)
    clearTimeout(collapse); });
  const message = (text: string) => { dock.querySelector('.status')!.textContent = text; };
  const openDialog = (title: string): HTMLElement => {
    dialog.replaceChildren();
    const heading = document.createElement('h2');
    heading.textContent = title;
    dialog.append(heading);
    const body = document.createElement('div');
    dialog.append(body);
    const footer = document.createElement('footer');
    const close = document.createElement('button');
    close.textContent = 'Close';
    close.onclick = () => dialog.close();
    footer.append(close);
    dialog.append(footer);
    if (!dialog.open)
      dialog.showModal();
    return body;
  };
  const showLibrary = async () => {
    const body = openDialog('Saved, only here.');
    const items = await library.load();
    const introduction = document.createElement('p');
    introduction.textContent = 'Explicit saves stay in this browser. No account, cloud sync, or browsing-history collection.';
    body.append(introduction);
    const actions = document.createElement('div');
    actions.className = 'row';
    for (const format of ['JSON', 'Markdown']) {
      const button = document.createElement('button');
      button.textContent = `Export ${format}`;
      button.onclick = () => download(`witwitty-library.${format === 'JSON' ? 'json' : 'md'}`, format === 'JSON' ? JSON.stringify(items, null, 2) : exportMarkdown(items), format === 'JSON' ? 'application/json' : 'text/markdown');
      actions.append(button);
    }
    body.append(actions);
    if (!items.length) {
      const empty = document.createElement('p');
      empty.className = 'empty';
      empty.textContent = 'Nothing saved yet. Approve a lens, then choose Save.';
      body.append(empty);
    }
    for (const item of items) {
      const entry = document.createElement('article');
      const title = document.createElement('h3');
      title.textContent = item.title;
      const detail = document.createElement('p');
      detail.textContent = `${item.mode} · ${item.scope} · ${item.depth} · ${new Date(item.timestamp).toLocaleDateString()}`;
      const text = document.createElement('p');
      text.textContent = item.transformed;
      const link = document.createElement('a');
      link.href = item.url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = 'Reopen source';
      const remove = document.createElement('button');
      remove.textContent = 'Delete';
      remove.className = 'link';
      remove.onclick = async () => { await library.delete(item.id); await showLibrary(); };
      entry.append(title, detail, text, link, remove);
      body.append(entry);
    }
  };
  dock.addEventListener('click', event => {
    const button = (event.target as Element).closest<HTMLButtonElement>('button');
    if (!button)
      return;
    if (button.dataset.depth) {
      runtime.dispatch({ type: 'CHANGE_DEPTH', depth: button.dataset.depth as Depth });
      return;
    }
    const action = button.dataset.action;
    if (action === 'Explain' || action === 'Rewrite')
      runtime.dispatch({ type: 'SET_MODE', mode: action });
    else if (action === 'DEACTIVATE' && onExit)
      onExit();
    else if (['ZOOM_IN', 'ZOOM_OUT', 'LOCK_TARGET', 'UNLOCK_TARGET', 'RESTORE', 'DEACTIVATE'].includes(action ?? ''))
      runtime.dispatch({ type: action } as Parameters<Runtime['dispatch']>[0]);
    else if (action === 'SAVE') {
      const item = runtime.savedItem();
      if (item)
        void library.save(item).then(() => message('Saved in this browser.')).catch(() => message('Save failed. Export or delete older saved items.'));
    }
    else if (action === 'LIBRARY')
      void showLibrary();
    else if (action === 'CAMERA')
      onCamera?.();
    else if (action === 'HELP') {
      const body = openDialog('Your reference controls');
      for (const [key, description] of Object.entries(KEY_BINDINGS)) {
        const row = document.createElement('div');
        row.className = 'keyrow';
        const label = document.createElement('span');
        label.textContent = description;
        const binding = document.createElement('kbd');
        binding.textContent = key;
        row.append(label, binding);
        body.append(row);
      }
      const hint = document.createElement('p');
      hint.textContent = 'Point and click a passage to lock it. Selecting text snaps to the smallest semantic object that contains it. + and − change semantic scope, not browser magnification. All controls use the same engine as gestures.';
      body.append(hint);
    }
    else if (action === 'DEBUG') {
      const body = openDialog('Inspect the interaction');
      const report = { state: runtime.state.phase, mode: runtime.state.mode, scope: runtime.state.scope, depth: runtime.state.depth,
        target: runtime.state.targetId, progress: runtime.state.progress, camera: runtime.state.camera, companion: runtime.state.companion,
        index: { nodes: runtime.index.nodes.size, rebuilds: runtime.index.rebuilds, incremental: runtime.index.incrementalUpdates, capped: runtime.index.limited },
        snapping: runtime.index.history.slice(-3), trace: runtime.traces.slice(-30) };
      const pre = document.createElement('pre');
      pre.textContent = JSON.stringify(report, null, 2);
      body.append(pre);
      const exportButton = document.createElement('button');
      exportButton.textContent = 'Export redacted trace';
      exportButton.onclick = () => download('witwitty-trace.json', JSON.stringify(report, null, 2), 'application/json');
      body.append(exportButton);
    }
  });
  const unsubscribe = runtime.subscribe(state => {
    dock.hidden = state.phase === 'inactive';
    const next = `${state.mode.toUpperCase()} · ${state.scope.toUpperCase()} · ${state.depth.toUpperCase()}`;
    dock.querySelector('[data-state-label]')!.textContent = next + (state.requestId ? ` · ${state.progress.completed}/${state.progress.total}` : '');
    dock.querySelector('[data-scope]')!.textContent = state.scope;
    if (dimensions !== next && state.phase !== 'inactive') {
      dock.open = true;
      if (collapse)
        clearTimeout(collapse);
      collapse = setTimeout(() => { if (!expandedByUser && !state.requestId)
        dock.open = false; }, 6500);
      dimensions = next;
    }
    const status = dock.querySelector('.status')!;
    status.classList.toggle('error', !!state.failure);
    message(state.failure ?? (state.requestId ? `${state.phase.includes('review') ? 'Reviewing' : 'Generating'} · ${state.progress.completed}/${state.progress.total} blocks approved or retained` :
      state.activeLens ? `${state.progress.approved} reviewed block${state.progress.approved === 1 ? '' : 's'} · original recoverable` : state.targetId ? 'Target locked. Choose Explain or Rewrite.' : state.hoveredId ? 'Semantic target found. Click or press Enter to lock.' : 'Point at a passage. Language is the interface.'));
    if (state.activeLens && (state.activeLens.mode !== state.mode || state.activeLens.depth !== state.depth || state.activeLens.targetId !== state.targetId))
      status.append(` · Still displaying approved ${state.activeLens.mode} · ${state.activeLens.scope} · ${state.activeLens.depth}.`);
    if (runtime.index.limited)
      status.append(' · Index bounded: oversized blocks or excess content omitted.');
    if (state.mode === 'Explain' && ['Document', 'Section'].includes(state.scope) && (runtime.index.get(state.targetId)?.text.length ?? 0) > LIMITS.sourceChars)
      status.append(' · Scope exceeds overview limit; reviewed block explanations only.');
    const progress = dock.querySelector('progress')!;
    progress.hidden = !state.requestId;
    progress.max = state.progress.total || 1;
    progress.value = state.progress.completed;
    dock.querySelector('[data-connection]')!.textContent = `${state.companion === 'fixture' ? 'Reviewed fixtures' : state.companion === 'online' ? 'Companion connected' : 'Companion offline'} · camera ${state.camera}`;
    dock.querySelectorAll<HTMLButtonElement>('[data-depth]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.depth === state.depth)));
    for (const mode of ['Explain', 'Rewrite']) {
      const button = dock.querySelector<HTMLButtonElement>(`[data-action="${mode}"]`)!;
      button.disabled = !state.targetId || state.companion === 'offline';
      button.setAttribute('aria-pressed', String(mode === state.mode));
    }
    dock.querySelector<HTMLButtonElement>('[data-action="SAVE"]')!.disabled = !state.activeLens;
    dock.querySelector<HTMLButtonElement>('[data-action="LOCK_TARGET"]')!.disabled = !state.hoveredId;
    dock.querySelector<HTMLButtonElement>('[data-action="CAMERA"]')!.disabled = !onCamera;
  });
  return () => { unsubscribe(); if (collapse)
    clearTimeout(collapse); host.remove(); };
}
