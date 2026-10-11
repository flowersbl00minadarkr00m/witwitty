import { LIMITS, neighbours, SCHEMA, type InputSource, type TransformRequest, type Transport, type FailureScenario, type Approved } from '../core/contracts.js';
import { initialState, transition, type Intent, type State } from '../core/machine.js';
import { SemanticIndex, chooseRoot, observeSemantic, type SelectionPlan } from '../core/semantic.js';
import { validateApproved } from '../core/pipeline.js';
import { privacyDecision, safeSourceUrl, type SavedItem } from '../core/privacy.js';
import { LensRenderer, FocusOutline } from './lens.js';
export interface Trace {
  at: number;
  kind: string;
  state: string;
  target: string | null;
  detail?: unknown;
}
export class Runtime {
  readonly index: SemanticIndex;
  readonly lens: LensRenderer;
  readonly traces: Trace[] = [];
  state: State;
  scenario: FailureScenario = 'pass';
  private outline: FocusOutline;
  private listeners = new Set<(state: State) => void>();
  private controller: AbortController | null = null;
  private prefetch: AbortController | null = null;
  private pending: Promise<void> = Promise.resolve();
  private cleanups: Array<() => void> = [];
  private serial = 0;
  private disposed = false;
  constructor(readonly document: Document, private transport: Transport, root?: HTMLElement) {
    const decision = privacyDecision(document.location.href, document);
    if (!decision.allowed)
      throw new Error(decision.reason);
    this.index = new SemanticIndex(root ?? chooseRoot(document));
    this.lens = new LensRenderer(this.index);
    this.outline = new FocusOutline(document);
    this.state = initialState(crypto.randomUUID());
    const navigate = () => this.dispatch({ type: 'SOURCE_CHANGED' });
    const stop = () => this.dispose();
    window.addEventListener('popstate', navigate);
    window.addEventListener('pagehide', stop);
    this.cleanups.push(() => { window.removeEventListener('popstate', navigate); window.removeEventListener('pagehide', stop); });
    const draw = () => this.draw();
    window.addEventListener('scroll', draw, { passive: true });
    window.addEventListener('resize', draw);
    this.cleanups.push(() => { window.removeEventListener('scroll', draw); window.removeEventListener('resize', draw); });
    this.cleanups.push(observeSemantic(this.index, navigate, draw));
  }
  subscribe(listener: (state: State) => void): () => void { this.listeners.add(listener); listener(this.state); return () => this.listeners.delete(listener); }
  record(kind: string, detail?: unknown): void {
    this.traces.push({ at: Math.round(performance.now()), kind, state: this.state.phase, target: this.state.targetId, detail });
    if (this.traces.length > LIMITS.traceEntries)
      this.traces.shift();
  }
  private draw(): void { this.outline.draw(this.index.rects(this.state.targetId ?? this.state.hoveredId ?? ''), !!this.state.targetId); }
  dispatch(intent: Intent, source: InputSource = 'controls'): void {
    if (this.disposed)
      return;
    const changed = transition(this.state, intent, this.index, source);
    this.state = changed.state;
    // Trace contains IDs and state, never selected text, raw prompts, or keys.
    if (intent.type !== 'MOVE_FOCUS')
      this.record(intent.type, { source, scope: this.state.scope, depth: this.state.depth, mode: this.state.mode });
    for (const effect of changed.effects) {
      if (effect.type === 'cancel') {
        this.controller?.abort();
        this.prefetch?.abort();
      }
      else if (effect.type === 'restore')
        this.lens.restore();
      else if (effect.type === 'scroll')
        window.scrollBy({ top: effect.deltaY, behavior: 'instant' });
      else if (effect.type === 'generate')
        this.pending = this.generate();
    }
    this.draw();
    for (const listener of this.listeners)
      listener(this.state);
  }
  async settled(): Promise<void> { let pending: Promise<void>; do {
    pending = this.pending;
    await pending;
  } while (pending !== this.pending); }
  async setTransport(transport: Transport): Promise<void> {
    this.dispatch({ type: 'CANCEL' });
    this.transport = transport;
    await this.checkHealth();
  }
  async checkHealth(): Promise<boolean> {
    try {
      const health = await this.transport.health(AbortSignal.timeout(2500));
      if (health.schema !== SCHEMA || !health.ready)
        throw new Error('Companion not ready');
      this.dispatch({ type: 'COMPANION', status: health.mode === 'mock' ? 'fixture' : 'online' });
      return true;
    }
    catch {
      this.dispatch({ type: 'COMPANION', status: 'offline' });
      return false;
    }
  }
  private request(plan: SelectionPlan, context: State, group: string): TransformRequest {
    const parent = this.index.get(plan.node.parent);
    // Never send a whole Section/Document as context for one block.
    const local = plan.node.scope === 'Term' || plan.node.scope === 'Sentence' ? (parent?.text ?? plan.paragraph.text) : '';
    const blockId = plan.overview ? `${plan.node.id}-overview` : plan.paragraph.id;
    return { schema: SCHEMA, id: `${group}-${blockId}`, sessionId: context.sessionId,
      targetId: context.targetId!, blockId, scope: context.scope, mode: context.mode, depth: context.depth,
      sourceText: plan.sourceText, parentContext: local.slice(0, LIMITS.contextChars), segments: plan.segments, scenario: this.scenario };
  }
  private async generate(): Promise<void> {
    const context = this.state;
    if (!context.targetId)
      return;
    const privacy = privacyDecision(this.document.location.href, this.document);
    if (!privacy.allowed) {
      this.dispatch({ type: 'FAIL', reason: privacy.reason });
      return;
    }
    let plans: SelectionPlan[];
    try {
      plans = this.index.plans(context.targetId, context.mode);
    }
    catch {
      this.dispatch({ type: 'FAIL', reason: `Scope exceeds the ${LIMITS.blocks}-block work limit. Select a smaller section.` });
      return;
    }
    if (!plans.length) {
      this.dispatch({ type: 'FAIL', reason: 'No eligible text at this scope. Code and equations support Explain only.' });
      return;
    }
    const group = `run-${++this.serial}`;
    const controller = new AbortController();
    this.controller = controller;
    this.dispatch({ type: 'BEGIN', requestId: group, epoch: context.epoch, total: plans.length,
      originalText: this.index.get(context.targetId)?.text ?? '' });
    let latest: {
      request: TransformRequest;
      approved: Approved;
    } | undefined;
    for (const plan of plans) {
      if (controller.signal.aborted || context.epoch !== this.state.epoch)
        return;
      const request = this.request(plan, context, group);
      try {
        if (!this.index.sourceMatches(plan)) {
          this.dispatch({ type: 'SOURCE_CHANGED' });
          return;
        }
        const result = await this.transport.transform(request, event => {
          if (controller.signal.aborted || this.state.requestId !== group)
            return;
          if (event.type === 'reviewing')
            this.dispatch({ type: 'REVIEW', requestId: group });
          if (event.type === 'generating')
            this.record('route', { ...event.route, attempt: event.attempt });
        }, controller.signal);
        if (controller.signal.aborted || context.epoch !== this.state.epoch)
          return;
        if (result) {
          const approved = await validateApproved(request, result);
          if (controller.signal.aborted || context.epoch !== this.state.epoch)
            return;
          if (!this.lens.apply(group, plan, approved, context.mode)) {
            this.dispatch({ type: 'SOURCE_CHANGED' });
            return;
          }
          this.dispatch({ type: 'APPROVE', requestId: group, blockId: request.blockId, result: approved });
          this.record('approved', { cache: approved.provenance.cache, attempt: approved.provenance.attempt,
            generationMs: approved.provenance.generationMs, reviewMs: approved.provenance.reviewMs,
            reviewer: approved.provenance.review.reviewer, decision: 'pass' });
          latest = { request, approved };
        }
        else
          this.dispatch({ type: 'REJECT', requestId: group, reason: this.state.activeLens && this.state.activeLens.requestId !== group ? 'Replacement not approved. Previous approved lens retained.' : 'Quality review did not approve this block. Original retained.' });
      }
      catch (error) {
        if (controller.signal.aborted || context.epoch !== this.state.epoch)
          return;
        this.record('block-failure', { block: request.blockId, category: error instanceof Error && error.name === 'AbortError' ? 'cancelled' : 'invalid-or-unavailable' });
        this.dispatch({ type: 'REJECT', requestId: group, reason: 'This block could not be verified. Original retained.' });
      }
      // Let progressive approved blocks paint; no provider draft is ever painted.
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    if (controller.signal.aborted)
      return;
    this.dispatch({ type: 'DONE', requestId: group });
    if (plans.length === 1 && latest && latest.approved.provenance.route.tier === 'fast' && this.scenario === 'pass') {
      this.prefetch?.abort();
      const prefetch = new AbortController();
      this.prefetch = prefetch;
      for (const depth of neighbours(context.depth).filter(depth => depth !== 'Advanced' && depth !== 'Expert')) {
        const request = { ...latest.request, id: `prefetch-${++this.serial}`, depth, speculative: true };
        void this.transport.transform(request, () => { }, prefetch.signal).catch(() => { });
      }
    }
  }
  savedItem(): SavedItem | null {
    const lens = this.state.activeLens;
    if (!lens)
      return null;
    const url = safeSourceUrl(this.document.location.href);
    if (!url)
      return null;
    return { id: crypto.randomUUID(), original: lens.originalText,
      transformed: Object.values(lens.blocks).map(block => block.draft.explanation ?? block.draft.edits?.map(edit => edit.text).join('') ?? '').join('\n\n'),
      title: this.document.title, url, mode: lens.mode, scope: lens.scope, depth: lens.depth, timestamp: new Date().toISOString() };
  }
  dispose(): void {
    if (this.disposed)
      return;
    this.controller?.abort();
    this.prefetch?.abort();
    this.lens.restore();
    this.outline.dispose();
    this.cleanups.forEach(cleanup => cleanup());
    this.listeners.clear();
    this.disposed = true;
  }
}
