import { isRecord, SCHEMA, type Approved, type Health, type PipelineEvent, type TransformRequest, type Transport } from '../core/contracts.js';
export const COMPANION = 'http://127.0.0.1:4317';
export class CompanionTransport implements Transport {
  constructor(private token = '') { }
  async health(signal?: AbortSignal): Promise<Health> {
    const response = await fetch(`${COMPANION}/health`, { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(2500)]) : AbortSignal.timeout(2500), cache: 'no-store', credentials: 'omit' });
    const body: unknown = await response.json();
    if (!response.ok || !isRecord(body) || body.schema !== SCHEMA || !['mock', 'live'].includes(String(body.mode)) || typeof body.ready !== 'boolean')
      throw new Error('Invalid companion health');
    return body as unknown as Health;
  }
  async transform(request: TransformRequest, event: (event: PipelineEvent) => void, signal: AbortSignal): Promise<Approved | null> {
    const boundedSignal = AbortSignal.any([signal, AbortSignal.timeout(65000)]);
    const response = await fetch(`${COMPANION}/v1/transform`, { method: 'POST', signal: boundedSignal,
      headers: { 'Content-Type': 'application/json', 'X-WitWitty-Token': this.token }, credentials: 'omit', body: JSON.stringify(request) });
    if (!response.ok || !response.body)
      throw new Error(`Companion unavailable (${response.status})`);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let bytes = 0;
    let result: Approved | null = null;
    const receive = (line: string) => {
      if (!line.trim())
        return;
      const data: unknown = JSON.parse(line);
      if (!isRecord(data) || data.requestId !== request.id || !['generating', 'reviewing', 'approved', 'rejected'].includes(String(data.type)))
        throw new Error('Invalid protocol event');
      const item = data as unknown as PipelineEvent;
      if (item.type === 'approved')
        result = item.result;
      event(item);
    };
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done)
          break;
        bytes += value.byteLength;
        if (bytes > 250000)
          throw new Error('Companion response exceeded limit');
        buffer += decoder.decode(value, { stream: true });
        let newline: number;
        while ((newline = buffer.indexOf('\n')) >= 0) {
          receive(buffer.slice(0, newline));
          buffer = buffer.slice(newline + 1);
        }
      }
      buffer += decoder.decode();
      if (buffer.trim())
        receive(buffer);
      return result;
    }
    finally {
      await reader.cancel().catch(() => { });
      reader.releaseLock();
    }
  }
}
