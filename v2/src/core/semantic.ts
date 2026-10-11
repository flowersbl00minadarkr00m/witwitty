import { LIMITS, type Point, type Scope, type Segment } from './contracts.js';
const OWNED = '[data-ww-owned]';
const EXCLUDED = 'script,style,noscript,template,nav,button,input,textarea,select,table,figure,iframe,[contenteditable="true"],[aria-hidden="true"],[data-ww-owned]';
const PROTECTED = 'code,pre,math,.katex,.MathJax,[data-equation],[role="math"]';
const BLOCKS = 'p,li,blockquote,pre,math,[data-equation],[role="math"]';
const CANDIDATES = `h1,h2,h3,h4,h5,h6,${BLOCKS}`;
export interface Span {
  start: number;
  end: number;
}
export interface TextPart extends Span {
  node: Text;
  index: number;
  protected: boolean;
}
export interface SemanticNode extends Span {
  id: string;
  scope: Scope;
  parent: string | null;
  children: string[];
  text: string;
  element: HTMLElement;
  paragraphId: string | null;
  order: number;
  parts: TextPart[];
}
export interface Anchor {
  point?: Point;
  paragraphId?: string;
  offset?: number;
}
export interface SnapCandidate {
  id: string;
  distance: number;
  centerDistance: number;
  order: number;
  reason: string;
}
export interface SelectionPlan {
  node: SemanticNode;
  paragraph: SemanticNode;
  sourceText: string;
  overview?: boolean;
  segments: Segment[];
  pieces: Array<{
    id: string;
    textIndex: number;
    start: number;
    end: number;
    original: string;
  }>;
}
/** Deliberately versioned English rules, not platform-dependent ICU boundaries. */
export function sentences(text: string): Span[] {
  const result: Span[] = [];
  let start = 0;
  const abbreviations = /\b(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|vs|etc|e\.g|i\.e|U\.S|U\.K)\.$/i;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char !== '.' && char !== '!' && char !== '?')
      continue;
    if (char === '.' && /\d/.test(text[i - 1] ?? '') && /\d/.test(text[i + 1] ?? ''))
      continue;
    if (char === '.' && (abbreviations.test(text.slice(start, i + 1)) || /\b[A-Z]\.$/.test(text.slice(start, i + 1))))
      continue;
    let end = i + 1;
    while (/[.!?"'”’\])]/.test(text[end] ?? '') && end < text.length)
      end++;
    if (end !== text.length && !/\s/.test(text[end] ?? ''))
      continue;
    while (start < end && /\s/.test(text[start] ?? ''))
      start++;
    if (start < end)
      result.push({ start, end });
    start = end;
    i = end - 1;
  }
  while (start < text.length && /\s/.test(text[start] ?? ''))
    start++;
  if (start < text.length)
    result.push({ start, end: text.length });
  return result;
}
export function terms(text: string): Span[] {
  return Array.from(text.matchAll(/[\p{L}\p{N}]+(?:[’'-][\p{L}\p{N}]+)*/gu), m => ({ start: m.index, end: m.index + m[0].length }));
}
export function chooseRoot(document: Document): HTMLElement {
  const roots = Array.from(document.querySelectorAll<HTMLElement>('article,[role="article"],main'))
    .filter(e => !e.closest(EXCLUDED));
  return roots.sort((a, b) => Number(b.matches('article,[role="article"]')) - Number(a.matches('article,[role="article"]')) || (b.textContent?.length ?? 0) - (a.textContent?.length ?? 0))[0] ?? document.body;
}
export function textParts(element: HTMLElement): TextPart[] {
  const document = element.ownerDocument;
  const walker = document.createTreeWalker(element, 4 /* SHOW_TEXT */);
  const parts: TextPart[] = [];
  let offset = 0;
  let index = 0;
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    const parent = node.parentElement;
    const textIndex = index++;
    if (!parent || parent.closest(EXCLUDED))
      continue;
    // A nested paragraph/list item is its own block, never indexed twice.
    const nearest = parent.closest(BLOCKS);
    if (nearest && nearest !== element && element.contains(nearest))
      continue;
    const end = offset + node.data.length;
    parts.push({ node, index: textIndex, start: offset, end, protected: !!parent.closest(PROTECTED) });
    offset = end;
  }
  return parts;
}
export function rawTextNodes(element: HTMLElement): Text[] {
  const nodes: Text[] = [];
  const walker = element.ownerDocument.createTreeWalker(element, 4);
  while (walker.nextNode())
    nodes.push(walker.currentNode as Text);
  return nodes;
}
function distanceToRect(point: Point, rect: DOMRect): number {
  return Math.hypot(Math.max(rect.left - point.x, 0, point.x - rect.right), Math.max(rect.top - point.y, 0, point.y - rect.bottom));
}
export class SemanticIndex {
  readonly nodes = new Map<string, SemanticNode>();
  readonly root: HTMLElement;
  readonly rootId = 'document';
  readonly history: Array<{
    chosen: string | null;
    candidates: SnapCandidate[];
  }> = [];
  limited = false;
  rebuilds = 0;
  incrementalUpdates = 0;
  private ids = new WeakMap<HTMLElement, string>();
  private serial = 0;
  private visual: (element: HTMLElement) => HTMLElement = e => e;
  constructor(root: HTMLElement) { this.root = root; this.rebuild(); }
  setVisualResolver(resolve: (element: HTMLElement) => HTMLElement): void { this.visual = resolve; }
  get(id: string | null | undefined): SemanticNode | undefined { return id ? this.nodes.get(id) : undefined; }
  private add(scope: Scope, id: string, element: HTMLElement, parent: string | null, text = '', start = 0, end = text.length, paragraphId: string | null = null, parts: TextPart[] = []): SemanticNode {
    const node: SemanticNode = { id, scope, element, parent, text, start, end, paragraphId, parts, children: [], order: this.nodes.size };
    this.nodes.set(id, node);
    if (parent)
      this.nodes.get(parent)?.children.push(id);
    return node;
  }
  rebuild(): void {
    this.rebuilds++;
    this.nodes.clear();
    this.limited = false;
    this.add('Document', this.rootId, this.root, null);
    let section = this.add('Section', 'section-0', this.root, this.rootId);
    let sectionNumber = 1;
    let blockCount = 0;
    let indexedChars = 0;
    let currentContainer: Element | null = null;
    for (const element of this.root.querySelectorAll<HTMLElement>(CANDIDATES)) {
      if (element.closest(EXCLUDED))
        continue;
      if (/^H[1-6]$/.test(element.tagName)) {
        if (element.tagName !== 'H1') {
          section = this.add('Section', `section-${sectionNumber++}`, element, this.rootId);
          currentContainer = element.closest('section');
        }
        continue; // Headings are structural metadata, never rewrite blocks.
      }
      const parts = textParts(element);
      const text = parts.map(p => p.node.data).join('');
      if (!text.trim())
        continue;
      if (text.length > LIMITS.sourceChars) {
        this.limited = true;
        continue;
      }
      if (indexedChars + text.length > LIMITS.indexChars) {
        this.limited = true;
        break;
      }
      indexedChars += text.length;
      if (blockCount++ >= LIMITS.indexBlocks) {
        this.limited = true;
        break;
      }
      const container = element.closest('section');
      if (container && container !== currentContainer && section.children.length)
        section = this.add('Section', `section-${sectionNumber++}`, container as HTMLElement, this.rootId);
      currentContainer = container;
      let id = this.ids.get(element);
      if (!id) {
        id = `paragraph-${this.serial++}`;
        this.ids.set(element, id);
      }
      this.addParagraph(id, element, section.id, parts, text);
    }
    // Empty synthetic sections are harmless but should not be zoom destinations.
    for (const node of [...this.nodes.values()]) {
      if (node.scope === 'Section' && !node.children.length) {
        this.nodes.delete(node.id);
        const documentNode = this.nodes.get(this.rootId)!;
        documentNode.children = documentNode.children.filter(id => id !== node.id);
      }
    }
    this.refreshAncestors();
  }
  private addParagraph(id: string, element: HTMLElement, sectionId: string, parts: TextPart[], text: string): void {
    const paragraph = this.add('Paragraph', id, element, sectionId, text, 0, text.length, id, parts);
    sentences(text).forEach((span, i) => {
      const sentence = this.add('Sentence', `${id}-s${i}`, element, paragraph.id, text.slice(span.start, span.end), span.start, span.end, id, parts);
      terms(sentence.text).forEach((term, j) => this.add('Term', `${sentence.id}-t${j}`, element, sentence.id, sentence.text.slice(term.start, term.end), span.start + term.start, span.start + term.end, id, parts));
    });
  }
  private refreshAncestors(): void {
    for (const section of this.nodes.values())
      if (section.scope === 'Section') {
        section.text = section.children.map(id => this.nodes.get(id)?.text ?? '').join('\n\n');
        section.end = section.text.length;
      }
    const document = this.nodes.get(this.rootId)!;
    document.text = document.children.map(id => this.nodes.get(id)?.text ?? '').join('\n\n');
    document.end = document.text.length;
  }
  update(elements: Set<HTMLElement>, structural: boolean): void {
    if (structural) {
      this.rebuild();
      return;
    }
    for (const element of elements) {
      const currentText = textParts(element).map(part => part.node.data).join('');
      const existing = this.get(this.ids.get(element));
      if (this.limited || currentText.length > LIMITS.sourceChars || (this.get(this.rootId)?.text.length ?? 0) - (existing?.text.length ?? 0) + currentText.length > LIMITS.indexChars) {
        this.rebuild();
        return;
      }
      const id = this.ids.get(element);
      const old = this.get(id);
      if (!old || !old.parent || !element.isConnected) {
        this.rebuild();
        return;
      }
      for (const node of [...this.nodes.values()])
        if (node.paragraphId === id)
          this.nodes.delete(node.id);
      const parent = this.get(old.parent)!;
      const order = parent.children.indexOf(old.id);
      parent.children = parent.children.filter(child => child !== old.id);
      const parts = textParts(element);
      this.addParagraph(old.id, element, old.parent, parts, parts.map(p => p.node.data).join(''));
      parent.children = parent.children.filter(child => child !== old.id);
      parent.children.splice(order, 0, old.id);
      this.incrementalUpdates++;
    }
    // Tie-breaking follows DOM order even after incremental replacements.
    let order = 0;
    const walk = (id: string) => { const node = this.get(id)!; node.order = order++; node.children.forEach(walk); };
    walk(this.rootId);
    this.refreshAncestors();
  }
  paragraphs(id: string): SemanticNode[] {
    const node = this.get(id);
    if (!node)
      return [];
    if (node.paragraphId)
      return [this.get(node.paragraphId)!];
    return node.children.flatMap(child => this.paragraphs(child));
  }
  rects(id: string): DOMRect[] {
    const node = this.get(id);
    if (!node)
      return [];
    if (node.scope === 'Document' || node.scope === 'Section')
      return this.paragraphs(id).flatMap(p => this.rects(p.id));
    const visual = this.visual(node.element);
    if (visual !== node.element || node.scope === 'Paragraph')
      return Array.from(visual.getClientRects());
    const startPart = node.parts.find(p => p.end > node.start);
    const endPart = [...node.parts].reverse().find(p => p.start < node.end);
    if (!startPart || !endPart)
      return [];
    const range = node.element.ownerDocument.createRange();
    try {
      range.setStart(startPart.node, Math.max(0, node.start - startPart.start));
      range.setEnd(endPart.node, Math.min(endPart.node.length, node.end - endPart.start));
      return Array.from(range.getClientRects());
    }
    catch {
      return [];
    }
  }
  snap(point: Point, scope: Scope, maxDistance = 160): {
    node: SemanticNode | undefined;
    candidates: SnapCandidate[];
  } {
    const candidates = [...this.nodes.values()].filter(n => n.scope === scope).flatMap(node => {
      const rects = this.rects(node.id).filter(r => r.width > 0 && r.height > 0);
      if (!rects.length)
        return [];
      const distance = Math.min(...rects.map(r => distanceToRect(point, r)));
      const centerDistance = Math.min(...rects.map(r => Math.hypot(point.x - (r.left + r.right) / 2, point.y - (r.top + r.bottom) / 2)));
      return distance <= maxDistance ? [{ id: node.id, distance, centerDistance, order: node.order, reason: distance === 0 ? 'point-inside-semantic-range' : 'nearest-range-within-160px' }] : [];
    }).sort((a, b) => a.distance - b.distance || a.centerDistance - b.centerDistance || a.order - b.order);
    const node = this.get(candidates[0]?.id);
    this.history.push({ chosen: node?.id ?? null, candidates: candidates.slice(0, 6) });
    if (this.history.length > 40)
      this.history.shift();
    return { node, candidates: candidates.slice(0, 6) };
  }
  anchorAt(point: Point, candidate: SemanticNode): Anchor {
    const paragraph = candidate.paragraphId ? this.get(candidate.paragraphId) : this.snap(point, 'Paragraph').node;
    if (!paragraph)
      return { point };
    const term = this.snap(point, 'Term', 160).node;
    return { point, paragraphId: paragraph.id, offset: term?.paragraphId === paragraph.id ? term.start : paragraph.start };
  }
  zoom(id: string, direction: 'in' | 'out', anchor: Anchor): SemanticNode | undefined {
    const node = this.get(id);
    if (!node)
      return undefined;
    if (direction === 'out')
      return this.get(node.parent) ?? node;
    const children = node.children.map(child => this.get(child)!).filter(Boolean);
    if (!children.length)
      return node;
    const anchored = children.find(child => {
      if (child.scope === 'Section')
        return this.paragraphs(child.id).some(p => p.id === anchor.paragraphId);
      if (child.scope === 'Paragraph')
        return child.id === anchor.paragraphId;
      return child.paragraphId === anchor.paragraphId && anchor.offset !== undefined && child.start <= anchor.offset && child.end > anchor.offset;
    });
    if (anchored)
      return anchored;
    if (anchor.point) {
      const point = anchor.point;
      return children.map(child => ({ child, distance: Math.min(...this.rects(child.id).map(r => distanceToRect(point, r)), Infinity) }))
        .sort((a, b) => a.distance - b.distance || a.child.order - b.child.order)[0]?.child;
    }
    return children[0];
  }
  fromSelection(selection: Selection): SemanticNode | undefined {
    if (!selection.rangeCount || selection.isCollapsed)
      return undefined;
    const range = selection.getRangeAt(0);
    const start = range.startContainer;
    const end = range.endContainer;
    if (!this.root.contains(start) || !this.root.contains(end))
      return undefined;
    const paragraphs = [...this.nodes.values()].filter(n => n.scope === 'Paragraph');
    const first = paragraphs.find(n => n.parts.some(p => p.node === start));
    const last = paragraphs.find(n => n.parts.some(p => p.node === end));
    if (!first || !last)
      return undefined;
    if (first.id !== last.id)
      return first.parent === last.parent ? this.get(first.parent) : this.get(this.rootId);
    const startPart = first.parts.find(p => p.node === start)!;
    const endPart = first.parts.find(p => p.node === end)!;
    const a = startPart.start + range.startOffset;
    const b = endPart.start + range.endOffset;
    return [...this.nodes.values()].filter(n => n.paragraphId === first.id && n.start <= a && n.end >= b)
      .sort((x, y) => (x.end - x.start) - (y.end - y.start) || (y.scope === 'Term' ? 1 : -1))[0];
  }
  plans(id: string, mode: 'Explain' | 'Rewrite'): SelectionPlan[] {
    const target = this.get(id);
    if (!target)
      return [];
    const paragraphs = this.paragraphs(id);
    if (paragraphs.length > LIMITS.blocks)
      throw new Error(`This scope exceeds the ${LIMITS.blocks}-block work limit. Select a smaller section.`);
    const plans: SelectionPlan[] = paragraphs.map(paragraph => {
      const node = target.paragraphId ? target : paragraph;
      const pieces = paragraph.parts.filter(p => !p.protected && p.end > node.start && p.start < node.end).flatMap(p => {
        const start = Math.max(0, node.start - p.start);
        const end = Math.min(p.node.length, node.end - p.start);
        const original = p.node.data.slice(start, end);
        return original.trim() ? [{ id: `${paragraph.id}:t${p.index}:${start}:${end}`, textIndex: p.index, start, end, original }] : [];
      });
      return { node, paragraph, sourceText: node.text, pieces, segments: pieces.map(p => ({ id: p.id, text: p.original })) };
    }).filter(plan => mode === 'Explain' || plan.segments.length > 0);
    // One reviewed overview of the explicitly selected scope, then reviewed block detail.
    // Very large scopes remain block-local; the HUD discloses the overview size limit.
    if (mode === 'Explain' && !target.paragraphId && target.text.length <= LIMITS.sourceChars && paragraphs[0]) {
      plans.unshift({ node: target, paragraph: paragraphs[0], sourceText: target.text, segments: [], pieces: [], overview: true });
    }
    return plans;
  }
  sourceMatches(plan: SelectionPlan): boolean {
    if (plan.overview)
      return this.root.isConnected && this.paragraphs(plan.node.id).map(paragraph => paragraph.element.isConnected ? textParts(paragraph.element).map(part => part.node.data).join('') : '').join('\n\n') === plan.sourceText;
    return this.root.isConnected && plan.paragraph.element.isConnected &&
      textParts(plan.paragraph.element).map(p => p.node.data).join('') === plan.paragraph.text;
  }
}
/** Coalesces local text updates; bounded structural fallback preserves stable block IDs. */
export function observeSemantic(index: SemanticIndex, invalidate: () => void, updated: () => void): () => void {
  const dirty = new Set<HTMLElement>();
  let structural = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const observer = new MutationObserver(records => {
    let changed = false;
    for (const record of records) {
      const element = record.target.nodeType === 1 ? record.target as HTMLElement : record.target.parentElement;
      if (!element || element.closest(OWNED))
        continue;
      if (record.type === 'childList' && [...record.addedNodes, ...record.removedNodes].every(n => n.nodeType === 1 && (n as Element).matches(OWNED)))
        continue;
      if (!index.root.contains(element) && index.root.isConnected)
        continue;
      changed = true;
      if (record.type === 'childList')
        structural = true;
      const block = element.closest<HTMLElement>(BLOCKS);
      if (block)
        dirty.add(block);
      else
        structural = true;
      if (dirty.size > 100)
        structural = true;
    }
    if (!changed)
      return;
    invalidate();
    if (timer)
      return;
    timer = setTimeout(() => {
      timer = undefined;
      if (index.root.isConnected)
        index.update(dirty, structural);
      dirty.clear();
      structural = false;
      updated();
    }, 100);
  });
  observer.observe(index.root.ownerDocument.body, { childList: true, subtree: true, characterData: true });
  return () => { observer.disconnect(); if (timer)
    clearTimeout(timer); };
}
