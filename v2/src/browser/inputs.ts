import type { Runtime } from './runtime.js';
import type { Intent } from '../core/machine.js';
export const KEY_BINDINGS = {
  Enter: 'Lock target', e: 'Explain', w: 'Rewrite', '[': 'One semantic level out', ']': 'One semantic level in',
  ArrowLeft: 'Shallower depth', ArrowRight: 'Deeper depth', r: 'Restore original', Escape: 'Cancel generation',
  'Alt+W': 'Activate / deactivate', n: 'Next semantic target', p: 'Previous semantic target',
};
export function keyboardIntent(event: Pick<KeyboardEvent, 'key' | 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey'>, active: boolean): Intent | null {
  if (event.altKey && event.key.toLowerCase() === 'w' && !event.ctrlKey && !event.metaKey)
    return { type: active ? 'DEACTIVATE' : 'ACTIVATE' };
  if (!active || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey)
    return null;
  switch (event.key) {
    case 'Enter': return { type: 'LOCK_TARGET' };
    case 'e': return { type: 'SET_MODE', mode: 'Explain' };
    case 'w': return { type: 'SET_MODE', mode: 'Rewrite' };
    case '[': return { type: 'ZOOM_OUT' };
    case ']': return { type: 'ZOOM_IN' };
    case 'ArrowLeft': return { type: 'CHANGE_DEPTH', delta: -1 };
    case 'ArrowRight': return { type: 'CHANGE_DEPTH', delta: 1 };
    case 'r': return { type: 'RESTORE' };
    case 'Escape': return { type: 'CANCEL' };
    default: return null;
  }
}
export function referenceInputs(runtime: Runtime): () => void {
  const document = runtime.document;
  let scheduled = false;
  let x = 0;
  let y = 0;
  const owned = (event: Event) => event.composedPath().some(node => node instanceof Element && node.matches('[data-ww-owned]:not([data-ww-owned="lens"])'));
  const move = (event: PointerEvent) => {
    if (owned(event) || runtime.state.phase === 'inactive')
      return;
    x = event.clientX;
    y = event.clientY;
    if (!scheduled) {
      scheduled = true;
      requestAnimationFrame(() => { scheduled = false; runtime.dispatch({ type: 'MOVE_FOCUS', point: { x, y } }, 'mouse'); });
    }
  };
  const select = (event: MouseEvent) => {
    if (owned(event) || runtime.state.phase === 'inactive' || (event.target instanceof Element && event.target.closest('a,button,input,textarea,select,[contenteditable]')))
      return;
    const selection = document.getSelection();
    const node = selection && !selection.isCollapsed ? runtime.index.fromSelection(selection) : undefined;
    if (node)
      runtime.dispatch({ type: 'MOVE_FOCUS', targetId: node.id, anchor: { paragraphId: node.paragraphId ?? undefined, offset: node.start } }, 'mouse');
    else
      runtime.dispatch({ type: 'MOVE_FOCUS', point: { x: event.clientX, y: event.clientY } }, 'mouse');
    runtime.dispatch({ type: 'LOCK_TARGET' }, 'mouse');
  };
  const key = (event: KeyboardEvent) => {
    if (event.composedPath().some(node => node instanceof Element && node.matches('input,textarea,select,button,[contenteditable="true"]')))
      return;
    const intent = keyboardIntent(event, runtime.state.phase !== 'inactive');
    if (intent) {
      event.preventDefault();
      runtime.dispatch(intent, 'keyboard');
    }
    // Deterministic keyboard acquisition, not a separate semantic selection rule.
    if (['n', 'p'].includes(event.key) && !event.altKey && !event.ctrlKey && !event.metaKey && runtime.state.phase !== 'inactive') {
      event.preventDefault();
      const candidates = [...runtime.index.nodes.values()].filter(node => node.scope === runtime.state.scope);
      const current = candidates.findIndex(node => node.id === (runtime.state.hoveredId ?? runtime.state.targetId));
      const node = candidates[(current + (event.key === 'p' ? -1 : 1) + candidates.length) % candidates.length];
      if (node)
        runtime.dispatch({ type: 'MOVE_FOCUS', targetId: node.id, anchor: { paragraphId: node.paragraphId ?? undefined, offset: node.start } }, 'keyboard');
    }
  };
  document.addEventListener('pointermove', move);
  document.addEventListener('mouseup', select);
  document.addEventListener('keydown', key);
  return () => { document.removeEventListener('pointermove', move); document.removeEventListener('mouseup', select); document.removeEventListener('keydown', key); };
}
