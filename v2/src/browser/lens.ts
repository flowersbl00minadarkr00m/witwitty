import type { Approved, Mode } from '../core/contracts.js';
import { rawTextNodes, type SelectionPlan, type SemanticIndex } from '../core/semantic.js';
interface Layer {
  original: HTMLElement;
  rendered: HTMLElement;
  hidden: string | null;
}
/** The source nodes (including their listeners) are never replaced or edited. */
export class LensRenderer {
  private layers = new Map<string, Layer>();
  private context: string | null = null;
  constructor(private index: SemanticIndex) {
    index.setVisualResolver(original => [...this.layers.values()].find(layer => layer.original === original && layer.rendered.dataset.mode === 'Rewrite')?.rendered ?? original);
  }
  get count(): number { return this.layers.size; }
  apply(context: string, plan: SelectionPlan, approved: Approved, mode: Mode): boolean {
    if (!approved.provenance.review.pass || !this.index.sourceMatches(plan))
      return false;
    // Build off-DOM before touching a currently approved lens.
    const document = plan.paragraph.element.ownerDocument;
    let rendered: HTMLElement;
    if (mode === 'Rewrite') {
      rendered = plan.paragraph.element.cloneNode(true) as HTMLElement;
      const nodes = rawTextNodes(rendered);
      const edits = new Map(approved.draft.edits?.map(edit => [edit.id, edit.text]));
      if (edits.size !== plan.pieces.length)
        return false;
      for (const piece of [...plan.pieces].sort((a, b) => b.start - a.start)) {
        const text = nodes[piece.textIndex];
        const replacement = edits.get(piece.id);
        if (!text || replacement === undefined || text.data.slice(piece.start, piece.end) !== piece.original)
          return false;
        text.data = text.data.slice(0, piece.start) + replacement + text.data.slice(piece.end);
      }
      // No cloned executable widgets, handlers, duplicate IDs, or form semantics.
      for (const element of [rendered, ...rendered.querySelectorAll('*')]) {
        for (const attribute of [...element.attributes]) {
          if (/^on/i.test(attribute.name) || ['id', 'name', 'autofocus', 'contenteditable', 'srcdoc'].includes(attribute.name))
            element.removeAttribute(attribute.name);
          if (['href', 'src', 'xlink:href'].includes(attribute.name) && /^\s*(?:javascript|data):/i.test(attribute.value))
            element.removeAttribute(attribute.name);
        }
      }
      rendered.querySelectorAll('script,iframe,object,embed,form,input,button,textarea,select').forEach(element => element.remove());
      rendered.removeAttribute('hidden');
    }
    else {
      rendered = document.createElement('div');
      const caption = document.createElement('span');
      caption.className = 'ww-lens-caption';
      caption.textContent = `EXPLAIN · ${plan.node.scope.toUpperCase()} · REVIEWED${approved.provenance.fixture ? ' FIXTURE' : ''}`;
      const text = document.createElement('div');
      text.textContent = approved.draft.explanation ?? '';
      rendered.append(caption, text);
      rendered.setAttribute('role', 'note');
      rendered.setAttribute('aria-label', 'Reviewed contextual explanation');
    }
    rendered.dataset.wwOwned = 'lens';
    rendered.dataset.mode = mode;
    const key = plan.overview ? `${plan.node.id}-overview` : plan.paragraph.id;
    rendered.dataset.wwBlock = key;
    if (plan.overview)
      rendered.dataset.overview = 'true';
    rendered.classList.add('ww-approved-lens');
    if (context !== this.context) {
      this.restore();
      this.context = context;
    }
    this.remove(key);
    const original = plan.paragraph.element;
    const hidden = original.getAttribute('hidden');
    if (plan.overview)
      original.before(rendered);
    else
      original.after(rendered);
    if (mode === 'Rewrite')
      original.setAttribute('hidden', '');
    this.layers.set(key, { original, rendered, hidden });
    return true;
  }
  private remove(id: string): void {
    const layer = this.layers.get(id);
    if (!layer)
      return;
    layer.rendered.remove();
    if (layer.hidden === null)
      layer.original.removeAttribute('hidden');
    else
      layer.original.setAttribute('hidden', layer.hidden);
    this.layers.delete(id);
  }
  restore(): void { for (const id of [...this.layers.keys()])
    this.remove(id); this.context = null; }
}
/** Highlights live outside the source tree. No source classes or styles are changed. */
export class FocusOutline {
  private host: HTMLDivElement;
  private shadow: ShadowRoot;
  constructor(private document: Document) {
    this.host = document.createElement('div');
    this.host.dataset.wwOwned = 'outline';
    this.host.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483644;';
    this.shadow = this.host.attachShadow({ mode: 'open' });
    document.body.append(this.host);
  }
  draw(rectangles: DOMRect[], locked: boolean): void {
    this.shadow.replaceChildren();
    for (const rect of rectangles.slice(0, 80)) {
      if (!rect.width || !rect.height || rect.bottom < 0 || rect.top > innerHeight)
        continue;
      const outline = this.document.createElement('div');
      outline.style.cssText = `position:fixed;left:${rect.left - 5}px;top:${rect.top - 3}px;width:${rect.width + 10}px;height:${rect.height + 6}px;border:1px solid ${locked ? '#36cdb0' : '#36cdb066'};background:${locked ? '#36cdb00a' : '#36cdb004'};border-radius:4px;box-sizing:border-box;`;
      this.shadow.append(outline);
    }
  }
  dispose(): void { this.host.remove(); }
}
