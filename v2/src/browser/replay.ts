import { GestureGate, type GestureSample } from '../gesture/engine.js';
import { CANONICAL_GESTURES, gestureTrace } from '../fixtures/gestures.js';
import type { Runtime } from './runtime.js';
export async function replaySamples(runtime: Runtime, samples: GestureSample[], signal: AbortSignal): Promise<void> {
  const gate = new GestureGate();
  for (const sample of samples) {
    if (signal.aborted)
      return;
    runtime.record('gesture', { gesture: sample.gesture, confidence: sample.confidence, ambiguous: !!sample.ambiguous });
    for (const intent of gate.accept(sample))
      runtime.dispatch(intent, 'replay');
    await runtime.settled();
  }
}
export async function canonicalReplay(runtime: Runtime, signal: AbortSignal, pauseMs = 350): Promise<void> {
  runtime.dispatch({ type: 'DEACTIVATE' }, 'replay');
  runtime.dispatch({ type: 'ACTIVATE' }, 'replay');
  runtime.dispatch({ type: 'CHANGE_DEPTH', depth: 'General' }, 'replay');
  const paragraph = runtime.index.paragraphs(runtime.index.rootId)[0];
  if (!paragraph)
    throw new Error('No demo paragraph');
  paragraph.element.scrollIntoView({ block: 'center' });
  const knownTerm = [...runtime.index.nodes.values()].find(node => node.scope === 'Term' && node.paragraphId === paragraph.id && node.text.toLowerCase() === 'replication');
  const rect = (knownTerm ? runtime.index.rects(knownTerm.id)[0] : undefined) ?? paragraph.element.getBoundingClientRect();
  const point = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  const gate = new GestureGate();
  let at = 1000;
  for (const gesture of CANONICAL_GESTURES) {
    if (signal.aborted)
      return;
    gate.accept({ at: at - 80, gesture: 'none', confidence: 0 });
    for (const sample of gestureTrace(gesture, at, point)) {
      runtime.record('gesture', { gesture, confidence: sample.confidence, source: 'recorded-classification' });
      for (const intent of gate.accept(sample))
        runtime.dispatch(intent, 'replay');
      await runtime.settled();
    }
    at += 1500;
    await new Promise(resolve => setTimeout(resolve, pauseMs));
  }
}
