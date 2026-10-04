import { DEPTHS, type Approved, type Depth, type InputSource, type Mode, type Point, type Scope } from './contracts.js';
import type { Anchor, SemanticNode } from './semantic.js';
export type Phase = 'inactive' | 'acquiring_target' | 'target_hovered' | 'target_locked' | 'generating' | 'reviewing' | 'replacement_generating' | 'replacement_reviewing' | 'lens_active' | 'restored' | 'cancelled' | 'failed';
export interface LensContext {
  sessionId: string;
  targetId: string;
  scope: Scope;
  mode: Mode;
  depth: Depth;
  originalText: string;
  requestId: string;
  blocks: Record<string, Approved>;
}
export interface State {
  sessionId: string;
  phase: Phase;
  hoveredId: string | null;
  targetId: string | null;
  scope: Scope;
  mode: Mode;
  depth: Depth;
  anchor: Anchor;
  hoverAnchor: Anchor;
  epoch: number;
  requestId: string | null;
  activeLens: LensContext | null;
  originalText: string;
  progress: {
    total: number;
    completed: number;
    approved: number;
    failed: number;
  };
  failure: string | null;
  companion: 'fixture' | 'online' | 'offline';
  camera: 'inactive' | 'starting' | 'active' | 'failed';
  lastSource: InputSource;
}
export type Intent = {
  type: 'ACTIVATE' | 'DEACTIVATE' | 'LOCK_TARGET' | 'UNLOCK_TARGET' | 'ZOOM_IN' | 'ZOOM_OUT' | 'RESTORE' | 'CANCEL';
} | {
  type: 'MOVE_FOCUS';
  point?: Point;
  targetId?: string;
  anchor?: Anchor;
} | {
  type: 'SET_MODE';
  mode: Mode;
} | {
  type: 'CHANGE_DEPTH';
  depth?: Depth;
  delta?: number;
} | {
  type: 'SCROLL';
  deltaY: number;
} | {
  type: 'SOURCE_CHANGED';
} | {
  type: 'BEGIN';
  requestId: string;
  epoch: number;
  total: number;
  originalText: string;
} | {
  type: 'REVIEW';
  requestId: string;
} | {
  type: 'APPROVE';
  requestId: string;
  blockId: string;
  result: Approved;
} | {
  type: 'REJECT';
  requestId: string;
  reason: string;
} | {
  type: 'DONE';
  requestId: string;
} | {
  type: 'FAIL';
  reason: string;
  requestId?: string;
} | {
  type: 'COMPANION';
  status: State['companion'];
} | {
  type: 'CAMERA';
  status: State['camera'];
};
export interface SemanticNavigator {
  get(id: string | null | undefined): SemanticNode | undefined;
  snap(point: Point, scope: Scope): {
    node: SemanticNode | undefined;
  };
  anchorAt(point: Point, candidate: SemanticNode): Anchor;
  zoom(id: string, direction: 'in' | 'out', anchor: Anchor): SemanticNode | undefined;
}
export type Effect = {
  type: 'cancel' | 'restore' | 'generate';
} | {
  type: 'scroll';
  deltaY: number;
};
export interface Transition {
  state: State;
  effects: Effect[];
}
export function initialState(sessionId: string): State {
  return {
    sessionId, phase: 'inactive', hoveredId: null, targetId: null, scope: 'Paragraph', mode: 'Explain', depth: 'General',
    anchor: {}, hoverAnchor: {}, epoch: 0, requestId: null, activeLens: null, originalText: '',
    progress: { total: 0, completed: 0, approved: 0, failed: 0 }, failure: null,
    companion: 'fixture', camera: 'inactive', lastSource: 'controls',
  };
}
/** All device adapters enter here. Effects are explicit and independently testable. */
export function transition(previous: State, intent: Intent, navigator: SemanticNavigator, source: InputSource = 'controls'): Transition {
  let state = { ...previous, lastSource: source };
  const effects: Effect[] = [];
  const resetWork = () => {
    effects.push({ type: 'cancel' });
    state = { ...state, epoch: state.epoch + 1, requestId: null, failure: null,
      phase: state.activeLens ? 'lens_active' : state.targetId ? 'target_locked' : 'acquiring_target' };
  };
  const generate = () => {
    if (!state.targetId)
      return;
    if (state.companion === 'offline') {
      state = { ...state, phase: 'failed', failure: 'Companion unavailable. Navigation still works.' };
      return;
    }
    effects.push({ type: 'generate' });
  };
  const matches = (requestId: string) => state.requestId === requestId;
  if (intent.type === 'ACTIVATE')
    return { state: { ...state, phase: previous.phase === 'inactive' ? 'acquiring_target' : previous.phase }, effects };
  if (intent.type === 'COMPANION')
    return { state: { ...state, companion: intent.status }, effects };
  if (intent.type === 'CAMERA')
    return { state: { ...state, camera: intent.status }, effects };
  if (state.phase === 'inactive')
    return { state: previous, effects };
  switch (intent.type) {
    case 'DEACTIVATE':
      resetWork();
      effects.push({ type: 'restore' });
      state = { ...initialState(state.sessionId), epoch: state.epoch, companion: state.companion };
      break;
    case 'MOVE_FOCUS': {
      const node = intent.targetId ? navigator.get(intent.targetId) : intent.point ? navigator.snap(intent.point, state.scope).node : undefined;
      state = { ...state, hoveredId: node?.id ?? null, hoverAnchor: intent.anchor ?? (node && intent.point ? navigator.anchorAt(intent.point, node) : state.anchor) };
      if (!state.targetId)
        state = { ...state, phase: node ? 'target_hovered' : 'acquiring_target',
          anchor: state.hoverAnchor };
      break;
    }
    case 'LOCK_TARGET': {
      const node = navigator.get(state.hoveredId ?? state.targetId);
      if (!node)
        break;
      const changed = node.id !== state.targetId;
      resetWork();
      if (changed) {
        effects.push({ type: 'restore' });
        state.activeLens = null;
      }
      state = { ...state, targetId: node.id, scope: node.scope, anchor: state.hoveredId === node.id ? state.hoverAnchor : state.anchor, phase: state.activeLens ? 'lens_active' : 'target_locked' };
      break;
    }
    case 'UNLOCK_TARGET':
      resetWork();
      effects.push({ type: 'restore' });
      state = { ...state, targetId: null, activeLens: null, phase: 'acquiring_target' };
      break;
    case 'SET_MODE':
      resetWork();
      state = { ...state, mode: intent.mode };
      generate();
      break;
    case 'CHANGE_DEPTH': {
      const index = DEPTHS.indexOf(state.depth);
      const next = intent.depth ?? DEPTHS[Math.max(0, Math.min(DEPTHS.length - 1, index + Math.sign(intent.delta ?? 0)))];
      if (!next || next === state.depth)
        break;
      const needsGeneration = !!state.activeLens || !!state.requestId;
      resetWork();
      state = { ...state, depth: next };
      if (needsGeneration)
        generate();
      break;
    }
    case 'ZOOM_IN':
    case 'ZOOM_OUT': {
      if (!state.targetId)
        break;
      const node = navigator.zoom(state.targetId, intent.type === 'ZOOM_IN' ? 'in' : 'out', state.anchor);
      if (!node || node.id === state.targetId)
        break;
      const needsGeneration = !!state.activeLens || !!state.requestId;
      resetWork();
      state = { ...state, targetId: node.id, hoveredId: node.id, scope: node.scope };
      if (needsGeneration)
        generate();
      break;
    }
    case 'RESTORE':
      resetWork();
      effects.push({ type: 'restore' });
      state = { ...state, activeLens: null, targetId: null, hoveredId: null, phase: 'restored',
        progress: { total: 0, completed: 0, approved: 0, failed: 0 } };
      break;
    case 'CANCEL':
      resetWork();
      state = { ...state, phase: 'cancelled', failure: 'Cancelled. Previously approved content is retained.' };
      break;
    case 'SOURCE_CHANGED':
      resetWork();
      effects.push({ type: 'restore' });
      state = { ...state, targetId: null, hoveredId: null, activeLens: null, phase: 'acquiring_target', failure: 'Source changed. Select the updated text.' };
      break;
    case 'SCROLL':
      if (Number.isFinite(intent.deltaY))
        effects.push({ type: 'scroll', deltaY: Math.max(-600, Math.min(600, intent.deltaY)) });
      break;
    case 'BEGIN':
      if (intent.epoch !== state.epoch || !state.targetId)
        break;
      state = { ...state, requestId: intent.requestId, originalText: intent.originalText, failure: null,
        phase: state.activeLens ? 'replacement_generating' : 'generating', progress: { total: intent.total, completed: 0, approved: 0, failed: 0 } };
      break;
    case 'REVIEW':
      if (matches(intent.requestId))
        state = { ...state, phase: state.activeLens ? 'replacement_reviewing' : 'reviewing' };
      break;
    case 'APPROVE': {
      if (!matches(intent.requestId) || !state.targetId)
        break;
      const blocks = state.activeLens?.requestId === intent.requestId ? state.activeLens.blocks : {};
      state = { ...state, activeLens: {
          sessionId: state.sessionId, targetId: state.targetId, scope: state.scope, mode: state.mode, depth: state.depth,
          originalText: state.originalText, requestId: intent.requestId, blocks: { ...blocks, [intent.blockId]: intent.result },
        }, phase: 'lens_active', progress: { ...state.progress, completed: state.progress.completed + 1, approved: state.progress.approved + 1 } };
      break;
    }
    case 'REJECT':
      if (matches(intent.requestId))
        state = { ...state, failure: intent.reason,
          progress: { ...state.progress, completed: state.progress.completed + 1, failed: state.progress.failed + 1 } };
      break;
    case 'DONE':
      if (matches(intent.requestId))
        state = { ...state, requestId: null, phase: state.activeLens ? 'lens_active' : state.progress.failed ? 'failed' : 'target_locked' };
      break;
    case 'FAIL':
      if (!intent.requestId || matches(intent.requestId))
        state = { ...state, requestId: null, phase: 'failed', failure: intent.reason };
      break;
  }
  return { state, effects };
}
/** Allowlisted external input boundary. Internal approval/status events cannot be forged by a camera message. */
export function normalizeInputIntent(value: unknown): Intent | null {
  if (!value || typeof value !== 'object' || !('type' in value))
    return null;
  const input = value as Record<string, unknown>;
  const type = input.type;
  if (['ACTIVATE', 'DEACTIVATE', 'LOCK_TARGET', 'UNLOCK_TARGET', 'ZOOM_IN', 'ZOOM_OUT', 'RESTORE', 'CANCEL'].includes(String(type)))
    return { type } as Intent;
  if (type === 'SET_MODE' && (input.mode === 'Explain' || input.mode === 'Rewrite'))
    return { type, mode: input.mode };
  if (type === 'CHANGE_DEPTH') {
    if (DEPTHS.includes(input.depth as Depth))
      return { type, depth: input.depth as Depth };
    if (input.delta === -1 || input.delta === 1)
      return { type, delta: input.delta };
  }
  if (type === 'SCROLL' && typeof input.deltaY === 'number' && Number.isFinite(input.deltaY))
    return { type, deltaY: Math.max(-600, Math.min(600, input.deltaY)) };
  if (type === 'MOVE_FOCUS' && input.point && typeof input.point === 'object') {
    const point = input.point as Point;
    if (Number.isFinite(point.x) && Number.isFinite(point.y) && point.x >= 0 && point.y >= 0 && point.x <= 20000 && point.y <= 20000)
      return { type, point: { x: point.x, y: point.y } };
  }
  return null;
}
