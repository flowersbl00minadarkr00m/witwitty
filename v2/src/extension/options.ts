import { chromeApi } from './chrome.js';
import { ExtensionLibrary } from './client.js';
import { isRecord } from '../core/contracts.js';
import { exportMarkdown } from '../core/privacy.js';
import { download } from '../browser/ui.js';
import { calibrationQuality, validateCalibration } from '../gesture/engine.js';
const chrome = chromeApi();
const library = new ExtensionLibrary();
const status = document.querySelector('#status')!;
async function renderLibrary(): Promise<void> {
  const items = await library.load();
  const container = document.querySelector('#library')!;
  container.replaceChildren();
  if (!items.length)
    container.textContent = 'No saved lenses yet. Activate an article, review a transformation, then choose Save.';
  for (const item of items) {
    const article = document.createElement('article');
    const heading = document.createElement('h2');
    heading.textContent = item.title;
    const metadata = document.createElement('p');
    metadata.textContent = `${item.mode} · ${item.scope} · ${item.depth} · ${new Date(item.timestamp).toLocaleDateString()}`;
    const original = document.createElement('details');
    const label = document.createElement('summary');
    label.textContent = 'Original';
    const source = document.createElement('pre');
    source.textContent = item.original;
    original.append(label, source);
    const result = document.createElement('p');
    result.textContent = item.transformed;
    const link = document.createElement('a');
    link.href = item.url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = 'Reopen source';
    const remove = document.createElement('button');
    remove.textContent = 'Delete';
    remove.onclick = async () => { await library.delete(item.id); await renderLibrary(); };
    const row = document.createElement('div');
    row.className = 'row';
    row.append(link, remove);
    article.append(heading, metadata, original, result, row);
    container.append(article);
  }
}
async function load(): Promise<void> {
  const settings = await chrome.runtime.sendMessage({ type: 'SETTINGS_LOAD' });
  if (isRecord(settings)) {
    document.querySelector<HTMLSelectElement>('#mode')!.value = settings.mode === 'companion' ? 'companion' : 'fixture';
    document.querySelector<HTMLInputElement>('#token')!.value = typeof settings.token === 'string' ? settings.token : '';
  }
  const profile = await chrome.runtime.sendMessage({ type: 'CALIBRATION_LOAD' });
  try {
    const quality = calibrationQuality(validateCalibration(profile));
    document.querySelector('#calibration')!.textContent = quality.ready ? 'Personal classifier ready. Frozen during use.' : quality.issues.join(' · ');
  }
  catch {
    document.querySelector('#calibration')!.textContent = 'No personal calibration. Open Camera from an activated article to set it up.';
  }
  await renderLibrary();
}
document.querySelector<HTMLButtonElement>('#save-settings')!.onclick = async () => {
  const result = await chrome.runtime.sendMessage({ type: 'SETTINGS_SAVE', mode: document.querySelector<HTMLSelectElement>('#mode')!.value, token: document.querySelector<HTMLInputElement>('#token')!.value });
  status.textContent = isRecord(result) && result.ok ? 'Settings saved locally. Reactivate the article to use the new model path.' : 'Settings could not be saved.';
};
document.querySelector<HTMLButtonElement>('#check-health')!.onclick = async () => {
  const result = await chrome.runtime.sendMessage({ type: 'HEALTH' });
  status.textContent = isRecord(result) && result.ready ? `Companion connected · ${result.mode} · schema ${result.schema}` : 'Companion unavailable. Start node v2/companion/server.mjs.';
};
document.querySelector<HTMLButtonElement>('#reset')!.onclick = async () => { await chrome.runtime.sendMessage({ type: 'CALIBRATION_RESET' }); await load(); };
for (const format of ['json', 'md'])
  document.querySelector<HTMLButtonElement>(`#export-${format}`)!.onclick = async () => {
    const items = await library.load();
    download(`witwitty-library.${format}`, format === 'json' ? JSON.stringify(items, null, 2) : exportMarkdown(items), format === 'json' ? 'application/json' : 'text/markdown');
  };
void load().catch(() => { status.textContent = 'Options could not be loaded. Reload the extension.'; });
