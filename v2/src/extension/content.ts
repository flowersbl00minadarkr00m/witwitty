import { Runtime } from '../browser/runtime.js';
import { referenceInputs } from '../browser/inputs.js';
import { mountHUD, installLensStyle } from '../browser/ui.js';
import { Pipeline } from '../core/pipeline.js';
import { isRecord } from '../core/contracts.js';
import { normalizeInputIntent } from '../core/machine.js';
import { ExtensionTransport, ExtensionLibrary } from './client.js';
import { chromeApi } from './chrome.js';
let runtime: Runtime | null = null;
let dispose: (() => void) | null = null;
let starting = false;
export async function activate(): Promise<void> {
  if (runtime) {
    dispose?.();
    return;
  }
  if (starting)
    return;
  starting = true;
  try {
    const chrome = chromeApi();
    const configuration = await chrome.runtime.sendMessage({ type: 'CONFIG' });
    if (!isRecord(configuration) || !['fixture', 'companion'].includes(String(configuration.mode)))
      throw new Error('Activation authorization unavailable');
    const transport = configuration.mode === 'fixture' ? new Pipeline() : new ExtensionTransport();
    const instance = new Runtime(document, transport);
    runtime = instance;
    const cleanups = [installLensStyle(document), referenceInputs(instance), mountHUD(instance, new ExtensionLibrary(), () => { void chrome.runtime.sendMessage({ type: 'OPEN_CAMERA' }); }, () => dispose?.())];
    const receive = (value: unknown) => {
      if (!isRecord(value) || value.session !== instance.state.sessionId)
        return;
      if (value.type === 'NAVIGATED') {
        dispose?.();
        return;
      }
      if (value.type === 'CAMERA_INTENT') {
        const intent = normalizeInputIntent(value.intent);
        if (intent)
          instance.dispatch(intent, 'webcam');
      }
      if (value.type === 'CAMERA_STATUS' && ['inactive', 'starting', 'active', 'failed'].includes(String(value.status)))
        instance.dispatch({ type: 'CAMERA', status: value.status as 'inactive' | 'starting' | 'active' | 'failed' });
      if (value.type === 'CAMERA_GESTURE')
        instance.record('gesture', { gesture: value.gesture, confidence: value.confidence, classifier: 'frozen-calibration' });
    };
    chrome.runtime.onMessage.addListener(receive);
    const hide = () => dispose?.();
    window.addEventListener('pagehide', hide);
    dispose = () => {
      cleanups.forEach(cleanup => cleanup());
      chrome.runtime.onMessage.removeListener(receive);
      window.removeEventListener('pagehide', hide);
      instance.dispose();
      runtime = null;
      dispose = null;
      void chrome.runtime.sendMessage({ type: 'END_SESSION', session: instance.state.sessionId }).catch(() => { });
    };
    let wasActive = false;
    cleanups.push(instance.subscribe(state => {
      if (state.phase !== 'inactive')
        wasActive = true;
      // Keyboard/camera deactivation has the same complete teardown as toolbar Exit.
      else if (wasActive)
        queueMicrotask(() => { if (runtime === instance)
          dispose?.(); });
    }));
    const authorized = await chrome.runtime.sendMessage({ type: 'SESSION', session: instance.state.sessionId, width: innerWidth, height: innerHeight });
    if (!isRecord(authorized) || authorized.ok !== true) {
      dispose();
      throw new Error('Article session could not be authorized');
    }
    if (runtime !== instance)
      return;
    instance.dispatch({ type: 'ACTIVATE' });
    await instance.checkHealth();
  }
  finally {
    starting = false;
  }
}
