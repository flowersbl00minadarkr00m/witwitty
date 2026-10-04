import { isRecord, SCHEMA, type Approved, type Health, type PipelineEvent, type TransformRequest, type Transport } from '../core/contracts.js';
import { validateSaved, type SavedItem } from '../core/privacy.js';
import type { LibraryStore } from '../browser/ui.js';
import { chromeApi } from './chrome.js';
export class ExtensionTransport implements Transport {
  async health(): Promise<Health> {
    const health = await chromeApi().runtime.sendMessage({ type: 'HEALTH' });
    if (!isRecord(health) || health.schema !== SCHEMA || !health.ready)
      throw new Error('Companion unavailable');
    return health as unknown as Health;
  }
  transform(request: TransformRequest, onEvent: (event: PipelineEvent) => void, signal: AbortSignal): Promise<Approved | null> {
    if (signal.aborted)
      return Promise.reject(new DOMException('Cancelled', 'AbortError'));
    return new Promise((resolve, reject) => {
      const port = chromeApi().runtime.connect({ name: 'witwitty-transform' });
      let result: Approved | null = null;
      let completed = false;
      const finish = (error?: Error) => {
        if (completed)
          return;
        completed = true;
        clearTimeout(timer);
        signal.removeEventListener('abort', abort);
        port.disconnect();
        if (error)
          reject(error);
        else
          resolve(result);
      };
      const abort = () => finish(new DOMException('Cancelled', 'AbortError'));
      const timer = setTimeout(() => finish(new Error('Companion deadline exceeded')), 65000);
      signal.addEventListener('abort', abort, { once: true });
      port.onDisconnect.addListener(() => { if (!completed)
        finish(new Error('Companion connection closed')); });
      port.onMessage.addListener(value => {
        if (!isRecord(value)) {
          finish(new Error('Invalid extension protocol'));
          return;
        }
        if (value.type === 'done') {
          finish();
          return;
        }
        if (value.type === 'error') {
          finish(new Error('Companion unavailable'));
          return;
        }
        if (!['generating', 'reviewing', 'approved', 'rejected'].includes(String(value.type)) || value.requestId !== request.id) {
          finish(new Error('Invalid extension event'));
          return;
        }
        const event = value as unknown as PipelineEvent;
        if (event.type === 'approved')
          result = event.result;
        onEvent(event);
      });
      port.postMessage(request);
    });
  }
}
export class ExtensionLibrary implements LibraryStore {
  async load(): Promise<SavedItem[]> {
    const response = await chromeApi().runtime.sendMessage({ type: 'LIBRARY_LOAD' });
    return Array.isArray(response) ? response.map(validateSaved) : [];
  }
  async save(item: SavedItem): Promise<void> {
    const response = await chromeApi().runtime.sendMessage({ type: 'LIBRARY_SAVE', item: validateSaved(item) });
    if (!isRecord(response) || !response.ok)
      throw new Error('Local save failed');
  }
  async delete(id: string): Promise<void> { await chromeApi().runtime.sendMessage({ type: 'LIBRARY_DELETE', id }); }
}
