import { ARTICLE } from '../dist/fixtures/article.js';
export function request(overrides = {}) {
  return { schema: 1, id: 'request-1', sessionId: 'session-1', targetId: 'paragraph-0', blockId: 'paragraph-0', scope: 'Paragraph', mode: 'Explain', depth: 'General', sourceText: ARTICLE[0].source, parentContext: '', segments: [{ id: 'segment-0', text: ARTICLE[0].source }], ...overrides };
}
export const signal = () => new AbortController().signal;
