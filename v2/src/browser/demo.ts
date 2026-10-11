import { Pipeline, FixtureGenerator, FixtureReviewer } from '../core/pipeline.js';
import { ARTICLE } from '../fixtures/article.js';
import { normalizeInputIntent } from '../core/machine.js';
import { Runtime } from './runtime.js';
import { referenceInputs } from './inputs.js';
import { BrowserLibrary, mountHUD, installLensStyle } from './ui.js';
import { canonicalReplay } from './replay.js';
import { CompanionTransport } from './transport.js';
import type { FailureScenario } from '../core/contracts.js';
const root = document.querySelector<HTMLElement>('#reading')!;
let section: HTMLElement | null = null;
let previous = '';
for (const block of ARTICLE) {
  if (block.section !== previous) {
    section = document.createElement('section');
    const heading = document.createElement('h2');
    heading.textContent = block.section;
    section.append(heading);
    root.append(section);
    previous = block.section;
  }
  const paragraph = document.createElement('p');
  paragraph.id = `source-${block.id}`;
  paragraph.textContent = block.source;
  section!.append(paragraph);
}
// Original technical fixture; code/equation remain immutable during Rewrite.
const appendix = document.createElement('section');
appendix.innerHTML = '<h2>Implementation notes</h2><p>The <code>commitIndex</code> marker tracks the applied boundary. A <a href="#source-quorum">quorum</a> is useful only in the context of the protocol that interprets it.</p><ul><li>Keep request identity stable across retries.</li><li>Preserve the distinction between a timeout and a failed operation.</li></ul><pre><code>if (entry.index &lt;= commitIndex) apply(entry);</code></pre><p data-equation="true">R + W &gt; N</p><blockquote><p>A durable observation is not automatically a complete explanation.</p></blockquote>';
root.append(appendix);
const fixture = new Pipeline(new FixtureGenerator('fixture-fast-v1'), new FixtureGenerator('fixture-strong-v1'), new FixtureReviewer(), 350);
const runtime = new Runtime(document, fixture, root);
const disposeStyle = installLensStyle(document);
const disposeInputs = referenceInputs(runtime);
const disposeHUD = mountHUD(runtime, new BrowserLibrary(localStorage), () => { window.open(`./camera.html?session=${runtime.state.sessionId}`, 'witwitty-camera', 'width=720,height=800'); });
let replay: AbortController | null = null;
document.querySelector<HTMLButtonElement>('#activate')!.onclick = () => runtime.dispatch({ type: runtime.state.phase === 'inactive' ? 'ACTIVATE' : 'DEACTIVATE' });
document.querySelector<HTMLButtonElement>('#replay')!.onclick = async () => {
  if (replay) {
    replay.abort();
    replay = null;
    runtime.dispatch({ type: 'CANCEL' });
    return;
  }
  replay = new AbortController();
  const button = document.querySelector<HTMLButtonElement>('#replay')!;
  button.textContent = 'Stop replay';
  try {
    await canonicalReplay(runtime, replay.signal, 450);
  }
  finally {
    replay = null;
    button.textContent = 'Replay gestures';
  }
};
const theme = document.querySelector<HTMLButtonElement>('#theme')!;
theme.onclick = () => { document.documentElement.classList.toggle('light'); theme.textContent = document.documentElement.classList.contains('light') ? 'Dark' : 'Light'; };
const settings = document.querySelector<HTMLDialogElement>('#settings')!;
document.querySelector<HTMLButtonElement>('#configure')!.onclick = () => settings.showModal();
document.querySelector<HTMLButtonElement>('#close-settings')!.onclick = () => settings.close();
document.querySelector<HTMLButtonElement>('#connect')!.onclick = async () => {
  const mode = document.querySelector<HTMLSelectElement>('#connection-mode')!.value;
  const token = document.querySelector<HTMLInputElement>('#pairing')!.value;
  await runtime.setTransport(mode === 'fixture' ? fixture : new CompanionTransport(token));
  document.querySelector('#connection-result')!.textContent = runtime.state.companion === 'offline' ? 'Companion unavailable. Start it locally; selection and zoom still work.' : 'Connected. Model API keys remain in the companion, never this browser.';
  document.querySelector<HTMLInputElement>('#pairing')!.value = '';
};
document.querySelector<HTMLSelectElement>('#failure')!.onchange = event => { runtime.scenario = (event.target as HTMLSelectElement).value as FailureScenario; };
runtime.subscribe(state => {
  document.querySelector('#activate')!.textContent = state.phase === 'inactive' ? 'Activate WitWitty' : 'Deactivate';
  document.querySelector('#surface-state')!.textContent = state.phase === 'inactive' ? 'Reading, uninterrupted.' : 'Point. Lock. Change your perspective.';
});
// Camera page and demo share only structured intents through a same-origin channel.
const channel = new BroadcastChannel('witwitty-v2-camera');
channel.onmessage = event => {
  const data = event.data;
  if (data?.session !== runtime.state.sessionId)
    return;
  if (data.kind === 'intent') {
    const intent = normalizeInputIntent(data.intent);
    if (intent)
      runtime.dispatch(intent, 'webcam');
  }
  if (data.kind === 'status' && ['inactive', 'starting', 'active', 'failed'].includes(data.status))
    runtime.dispatch({ type: 'CAMERA', status: data.status });
  if (data.kind === 'gesture')
    runtime.record('gesture', { gesture: data.gesture, confidence: data.confidence, classifier: data.classifier });
};
const requestChannel = new BroadcastChannel('witwitty-v2-camera-request');
requestChannel.onmessage = event => { if (event.data?.kind === 'request' && event.data.session === runtime.state.sessionId)
  requestChannel.postMessage({ kind: 'session', session: runtime.state.sessionId, width: innerWidth, height: innerHeight }); };
window.addEventListener('pagehide', () => { replay?.abort(); disposeInputs(); disposeHUD(); disposeStyle(); runtime.dispose(); channel.close(); requestChannel.close(); });
// Only the controlled demo exposes a test handle. Never exposed by extension content.
Object.assign(window, { witwitty: runtime });
