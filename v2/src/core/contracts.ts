/** Shared wire, generation and review contracts. No UI or provider dependencies. */
export const VERSION = '2.0.0-preview.1';
export const SCHEMA = 1 as const;
export const CONTRACT_VERSION = 'witwitty-depth-v1.0';
export const SCOPES = ['Document', 'Section', 'Paragraph', 'Sentence', 'Term'] as const;
export const DEPTHS = ['ELI5', 'Plain', 'General', 'Advanced', 'Expert'] as const;
export type Scope = typeof SCOPES[number];
export type Depth = typeof DEPTHS[number];
export type Mode = 'Explain' | 'Rewrite';
export type InputSource = 'mouse' | 'keyboard' | 'replay' | 'webcam' | 'controls';
export interface Point {
  x: number;
  y: number;
}
export interface DepthContract {
  background: string;
  vocabulary: string;
  terminology: string;
  abstraction: string;
  detail: string;
  analogy: string;
  precision: string;
  examples: string;
}
export const DEPTH_CONTRACTS: Readonly<Record<Depth, DepthContract>> = Object.freeze({
  ELI5: {
    background: 'No subject knowledge. Explain without talking down to the reader.',
    vocabulary: 'Everyday words and short sentences.', terminology: 'Introduce at most one essential term at a time.',
    abstraction: 'Concrete actions and consequences before abstractions.', detail: 'Core causal idea, then one necessary qualification.',
    analogy: 'One short analogy only when it preserves the relevant relationship; mark it as an analogy.',
    precision: 'Preserve all material qualifications, quantities, uncertainty and negations.', examples: 'One concrete example when helpful; do not invent source facts.',
  },
  Plain: {
    background: 'An adult reader without specialist training.', vocabulary: 'Common words; remove avoidable jargon.',
    terminology: 'Define unavoidable terms on first use.', abstraction: 'Explain what happens and why.',
    detail: 'Main mechanism and important caveats.', analogy: 'Optional, brief and explicitly limited.',
    precision: 'Preserve distinctions, qualifications and numerical claims.', examples: 'A practical example only if it clarifies the source.',
  },
  General: {
    background: 'A technically curious reader with ordinary general knowledge.', vocabulary: 'Clear standard prose.',
    terminology: 'Use domain terms with short contextual definitions.', abstraction: 'Connect mechanism to its broader purpose.',
    detail: 'Explain the argument and its relevant dependencies.', analogy: 'Use sparingly; prefer a direct account.',
    precision: 'Maintain the source’s degree of certainty and all material boundaries.', examples: 'Use an example to clarify—not extend—the claim.',
  },
  Advanced: {
    background: 'A reader familiar with the field’s basic concepts.', vocabulary: 'Precise technical language.',
    terminology: 'Retain technical terms and distinguish related concepts.', abstraction: 'State mechanisms, assumptions and failure modes.',
    detail: 'Make implicit dependencies explicit only when supported by the provided context.', analogy: 'Usually unnecessary.',
    precision: 'Preserve formal distinctions and identify missing information rather than guessing.', examples: 'A tightly scoped technical illustration when useful.',
  },
  Expert: {
    background: 'A specialist reader; do not reteach elementary concepts.', vocabulary: 'Dense but readable, discipline-appropriate language.',
    terminology: 'Use exact terminology, not impressive-sounding substitutes.', abstraction: 'Expose invariants, assumptions and limits of the claim.',
    detail: 'Explain the source’s technical implications without adding unsupported propositions.', analogy: 'Avoid unless uniquely clarifying.',
    precision: 'Keep quantifiers, uncertainty, conditions and exceptions exact. Flag ambiguity.', examples: 'Only examples necessary to disambiguate the source.',
  },
});
export const LIMITS = Object.freeze({
  sourceChars: 12000, contextChars: 1600, segments: 120, outputChars: 24000,
  blocks: 500, indexBlocks: 2000, indexChars: 250000, cacheEntries: 64, cacheBytes: 2000000,
  cacheTtlMs: 15 * 60000, requestTimeoutMs: 20000, traceEntries: 200,
});
export interface Segment {
  id: string;
  text: string;
}
export interface TransformRequest {
  schema: 1;
  id: string;
  sessionId: string;
  targetId: string;
  blockId: string;
  scope: Scope;
  mode: Mode;
  depth: Depth;
  sourceText: string;
  parentContext: string;
  segments: Segment[];
  scenario?: FailureScenario;
  speculative?: boolean;
}
export type FailureScenario = 'pass' | 'retry' | 'reject' | 'model-timeout' | 'review-timeout' | 'malformed' | 'partial';
export interface Draft {
  explanation?: string;
  edits?: Segment[];
}
export interface Review {
  pass: boolean;
  meaning: number;
  depthFit: number;
  unsupported: number;
  reason: string;
  reviewer: string;
}
export interface Route {
  tier: 'fast' | 'strong';
  reason: string;
  model: string;
}
export interface Provenance {
  route: Route;
  contract: string;
  review: Review;
  attempt: number;
  cache: boolean;
  generationMs: number;
  reviewMs: number;
  fixture: boolean;
}
export interface Approved {
  requestId: string;
  sourceHash: string;
  draft: Draft;
  provenance: Provenance;
}
export type PipelineEvent = {
  type: 'generating';
  requestId: string;
  route: Route;
  attempt: number;
} | {
  type: 'reviewing';
  requestId: string;
  attempt: number;
} | {
  type: 'approved';
  requestId: string;
  result: Approved;
} | {
  type: 'rejected';
  requestId: string;
  reason: string;
};
export interface Health {
  schema: number;
  version: string;
  mode: 'mock' | 'live';
  ready: boolean;
}
export interface Transport {
  health(signal?: AbortSignal): Promise<Health>;
  transform(request: TransformRequest, onEvent: (event: PipelineEvent) => void, signal: AbortSignal): Promise<Approved | null>;
}
export interface Generator {
  identity: string;
  fixture: boolean;
  generate(request: TransformRequest, correction: string | undefined, signal: AbortSignal): Promise<Draft>;
}
export interface Reviewer {
  identity: string;
  review(request: TransformRequest, draft: Draft, attempt: number, signal: AbortSignal): Promise<Review>;
}
export const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const idPattern = /^[A-Za-z0-9:_-]{1,160}$/;
const stringWithin = (x: unknown, max: number): x is string => typeof x === 'string' && x.length <= max;
export function validateRequest(value: unknown): TransformRequest {
  if (!isRecord(value) || value.schema !== SCHEMA)
    throw new Error('Unsupported request schema');
  for (const key of ['id', 'sessionId', 'targetId', 'blockId']) {
    if (typeof value[key] !== 'string' || !idPattern.test(value[key]))
      throw new Error(`Invalid ${key}`);
  }
  if (!SCOPES.includes(value.scope as Scope) || !DEPTHS.includes(value.depth as Depth) || !['Explain', 'Rewrite'].includes(String(value.mode)))
    throw new Error('Invalid scope, depth or mode');
  if (!stringWithin(value.sourceText, LIMITS.sourceChars) || !value.sourceText.trim())
    throw new Error('Empty or oversized source');
  if (!stringWithin(value.parentContext, LIMITS.contextChars))
    throw new Error('Oversized context');
  if (!Array.isArray(value.segments) || value.segments.length > LIMITS.segments)
    throw new Error('Invalid segments');
  const seen = new Set<string>();
  for (const segment of value.segments) {
    if (!isRecord(segment) || typeof segment.id !== 'string' || !idPattern.test(segment.id) || seen.has(segment.id) || !stringWithin(segment.text, LIMITS.sourceChars))
      throw new Error('Invalid or duplicate segment');
    seen.add(segment.id);
  }
  if ((value.segments as Segment[]).reduce((n, s) => n + s.text.length, 0) > LIMITS.sourceChars)
    throw new Error('Oversized segments');
  if (value.mode === 'Rewrite' && !value.segments.length)
    throw new Error('Code and equations cannot be rewritten');
  const scenarios = ['pass', 'retry', 'reject', 'model-timeout', 'review-timeout', 'malformed', 'partial'];
  if (value.scenario !== undefined && !scenarios.includes(String(value.scenario)))
    throw new Error('Invalid failure scenario');
  if (value.speculative !== undefined && typeof value.speculative !== 'boolean')
    throw new Error('Invalid speculative flag');
  // Reconstruct instead of forwarding arbitrary page-controlled properties.
  return {
    schema: SCHEMA, id: String(value.id), sessionId: String(value.sessionId), targetId: String(value.targetId), blockId: String(value.blockId),
    scope: value.scope as Scope, mode: value.mode as Mode, depth: value.depth as Depth,
    sourceText: value.sourceText, parentContext: value.parentContext,
    segments: (value.segments as Segment[]).map(({ id, text }) => ({ id, text })),
    scenario: value.scenario as FailureScenario | undefined, speculative: value.speculative as boolean | undefined,
  };
}
export function validateDraft(request: TransformRequest, value: unknown): Draft {
  if (!isRecord(value))
    throw new Error('Malformed model output');
  if (request.mode === 'Explain') {
    if (!stringWithin(value.explanation, LIMITS.outputChars) || !value.explanation.trim() || /<\/?[a-z][^>]*>/i.test(value.explanation))
      throw new Error('Invalid explanation');
    return { explanation: value.explanation };
  }
  if (!Array.isArray(value.edits) || value.edits.length !== request.segments.length)
    throw new Error('Segment coverage mismatch');
  const expected = new Set(request.segments.map(s => s.id));
  let size = 0;
  const edits: Segment[] = value.edits.map(edit => {
    if (!isRecord(edit) || typeof edit.id !== 'string' || !expected.delete(edit.id) || !stringWithin(edit.text, LIMITS.outputChars) || !edit.text.trim() || /<\/?[a-z][^>]*>/i.test(edit.text))
      throw new Error('Invalid edit');
    size += edit.text.length;
    return { id: edit.id, text: edit.text };
  });
  if (expected.size || size > LIMITS.outputChars)
    throw new Error('Incomplete or oversized edit');
  // Deterministic guard complements (does not replace) probabilistic meaning review.
  const numericTokens = (text: string) => text.match(/(?<![\w.])[+-]?\d+(?:\.\d+)?%?(?!\w|\.\d)/g) ?? [];
  const originalNumbers = request.segments.flatMap(s => numericTokens(s.text));
  const counts = new Map<string, number>();
  for (const number of numericTokens(edits.map(edit => edit.text).join(' ')))
    counts.set(number, (counts.get(number) ?? 0) + 1);
  for (const number of originalNumbers) {
    const remaining = counts.get(number) ?? 0;
    if (!remaining)
      throw new Error('A source quantity was removed or changed');
    counts.set(number, remaining - 1);
  }
  return { edits };
}
export function validateReview(value: unknown): Review {
  if (!isRecord(value) || typeof value.pass !== 'boolean' || typeof value.reason !== 'string' || typeof value.reviewer !== 'string')
    throw new Error('Malformed review');
  for (const key of ['meaning', 'depthFit', 'unsupported']) {
    const n = value[key];
    if (typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > 1)
      throw new Error('Invalid review probability');
  }
  const review = value as unknown as Review;
  return { ...review, pass: review.pass && review.meaning >= 0.90 && review.depthFit >= 0.85 && review.unsupported <= 0.05 };
}
export function routeFor(request: Pick<TransformRequest, 'scope' | 'depth' | 'sourceText' | 'speculative'>, fast: string, strong: string): Route {
  const strongReason = request.depth === 'Expert' || request.depth === 'Advanced' ? 'advanced-depth'
    : request.scope === 'Document' || request.scope === 'Section' ? 'large-scope'
      : request.sourceText.length > 1800 ? 'input-over-1800-characters' : null;
  return strongReason ? { tier: 'strong', reason: strongReason, model: strong } : { tier: 'fast', reason: 'small-scope-standard-depth', model: fast };
}
export async function sha256(text: string): Promise<string> {
  const data = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(data), n => n.toString(16).padStart(2, '0')).join('');
}
export function abortError(): DOMException { return new DOMException('Operation cancelled', 'AbortError'); }
export function throwIfAborted(signal: AbortSignal): void { if (signal.aborted)
  throw abortError(); }
export async function bounded<T>(operation: (signal: AbortSignal) => Promise<T>, signal: AbortSignal, ms: number): Promise<T> {
  throwIfAborted(signal);
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let rejectAbort: ((reason: Error) => void) | undefined;
  const abort = () => { controller.abort(); rejectAbort?.(abortError()); };
  const timeout = new Promise<never>((_, reject) => {
    rejectAbort = reject;
    timer = setTimeout(() => { controller.abort(); reject(new Error('Operation timed out')); }, ms);
  });
  signal.addEventListener('abort', abort, { once: true });
  try {
    return await Promise.race([operation(controller.signal), timeout]);
  }
  finally {
    if (timer)
      clearTimeout(timer);
    signal.removeEventListener('abort', abort);
  }
}
export function neighbours(depth: Depth): Depth[] {
  const i = DEPTHS.indexOf(depth);
  return [DEPTHS[i - 1], DEPTHS[i + 1]].filter((d): d is Depth => d !== undefined);
}
