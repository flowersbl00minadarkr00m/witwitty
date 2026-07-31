import { inferDomainHints, rankCandidates, type ReadableTextBlock, type TermCandidate } from "../core/candidates";
import { createContextPacket, resolveLocalExplanation } from "../core/explanations";

interface ExtensionStorage {
  get(keys: string[]): Promise<Record<string, unknown>>;
}

interface ExtensionRuntime {
  sendMessage(message: unknown): void;
  onMessage: { addListener(listener: (message: Record<string, unknown>) => void): void };
}

declare const chrome: {
  runtime: ExtensionRuntime;
  storage: { local: ExtensionStorage };
};

const STYLE_ID = "witwitty-page-styles";
// Raised from 5/8 candidates/marks to 10/15, then to 15/20 (2026-07-31) after
// real-page testing on a dense technical article showed the original
// 5-candidate limit left plausible undetected terms (BASEFEE, MCOPY) off the
// page entirely.
const MAX_TOTAL_MARKS = 20;
const MAX_MARKS_PER_TERM = 3;
const excludedTags = new Set([
  "A", "BUTTON", "CODE", "INPUT", "KBD", "MATH", "NOSCRIPT", "OPTION", "PRE", "SAMP", "SCRIPT", "SELECT", "STYLE", "SVG", "TEXTAREA", "VAR",
]);
const protectedSelector = [
  "[contenteditable]:not([contenteditable='false'])",
  "a",
  "button",
  "code",
  "form",
  "input",
  "kbd",
  "math",
  "pre",
  "samp",
  "select",
  "svg",
  "textarea",
  "var",
].join(", ");
const candidateByTerm = new Map<string, TermCandidate>();
let activeScanId: string | undefined;
let currentDomainHints: string[] = [];

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const normalize = (value: string) => value.trim().toLocaleLowerCase();

const installStyles = () => {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    mark[data-witwitty-term] {
      background: #cfeee1 !important;
      color: inherit !important;
      border-radius: .28em;
      padding: .03em .1em;
      box-decoration-break: clone;
      -webkit-box-decoration-break: clone;
      cursor: pointer;
    }
    mark[data-witwitty-term]:focus-visible,
    mark[data-witwitty-term][data-selected="true"] {
      outline: 2px solid #4f57c9;
      outline-offset: 2px;
    }
  `;
  document.head.appendChild(style);
};

const isReadableParent = (element: HTMLElement | null) => {
  if (!element || excludedTags.has(element.tagName) || element.isContentEditable) return false;
  if (element.closest(`[aria-hidden='true'], [hidden], nav, footer, dialog, ${protectedSelector}`)) return false;
  const style = window.getComputedStyle(element);
  return style.display !== "none" && style.visibility !== "hidden";
};

const readableTextNodes = (): Text[] => {
  const root = document.querySelector("article, main") ?? document.body;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!isReadableParent(parent) || parent?.closest("mark[data-witwitty-term]")) return NodeFilter.FILTER_REJECT;
      if (!node.nodeValue?.trim()) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  const nodes: Text[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  return nodes;
};

const extractReadableBlocks = (): ReadableTextBlock[] => {
  const root = document.querySelector("article, main") ?? document.body;
  const preferred = [...root.querySelectorAll<HTMLElement>("h1, h2, h3, p, li, blockquote, dt, dd")];
  const elements = preferred.length > 0 ? preferred : [...root.children].filter((element): element is HTMLElement => element instanceof HTMLElement);
  return elements
    .filter(isReadableParent)
    .map((element) => ({ text: element.innerText.replace(/\s+/g, " ").trim(), tagName: element.tagName }))
    .filter((block) => block.text.length >= 20);
};

const sentenceAround = (node: Node, term: string) => {
  const element = node instanceof HTMLElement ? node : node.parentElement;
  const contextElement = element?.closest("p, li, blockquote, dd, dt, h1, h2, h3") ?? element?.parentElement;
  const text = contextElement?.textContent?.replace(/\s+/g, " ").trim() || term;
  const escaped = escapeRegExp(term);
  const match = text.match(new RegExp(`(?:^|[.!?]\\s+)([^.!?]*\\b${escaped}\\b[^.!?]*[.!?]?)`, "i"));
  return (match?.[1] || text).trim().slice(0, 280);
};

const pageSource = () => ({
  url: window.location.href,
  title: document.title,
  domain: window.location.hostname,
});

const selectMark = (mark: HTMLElement) => {
  document.querySelectorAll("mark[data-witwitty-term]").forEach((item) => item.removeAttribute("data-selected"));
  mark.dataset.selected = "true";
  const key = normalize(mark.dataset.witwittyTerm ?? "");
  const candidate = candidateByTerm.get(key);
  if (!candidate) return;
  const source = pageSource();
  const excerpt = sentenceAround(mark, mark.textContent || candidate.term);
  const packet = createContextPacket(candidate.term, excerpt, source, currentDomainHints);
  chrome.runtime.sendMessage({
    type: "WITWITTY_TERM_SELECTED",
    ...(activeScanId ? { scanId: activeScanId } : {}),
    // domainHints is appended here rather than inside resolveLocalExplanation
    // itself — that function is part of the protected deterministic core and
    // stays untouched; this only carries forward data it already computed.
    payload: { ...resolveLocalExplanation(candidate, packet, source), domainHints: packet.domainHints },
  });
};

const clearAnnotations = () => {
  document.querySelectorAll<HTMLElement>("mark[data-witwitty-term]").forEach((mark) => {
    mark.replaceWith(document.createTextNode(mark.dataset.originalText || mark.textContent || ""));
  });
  candidateByTerm.clear();
};

const marksForTerm = (term: string): HTMLElement[] => {
  const normalizedTerm = normalize(term);
  return [...document.querySelectorAll<HTMLElement>("mark[data-witwitty-term]")]
    .filter((mark) => normalize(mark.dataset.witwittyTerm || "") === normalizedTerm);
};

const annotateCandidates = (candidates: TermCandidate[]): HTMLElement[] => {
  const labelToCandidate = new Map<string, TermCandidate>();
  for (const candidate of candidates) {
    candidateByTerm.set(normalize(candidate.term), candidate);
    for (const label of [candidate.term, ...candidate.aliases]) labelToCandidate.set(normalize(label), candidate);
  }
  const labels = [...labelToCandidate.keys()].sort((left, right) => right.length - left.length);
  if (labels.length === 0) return [];
  const pattern = new RegExp(`\\b(${labels.map(escapeRegExp).join("|")})\\b`, "gi");
  const counts = new Map<string, number>();
  const marks: HTMLElement[] = [];

  for (const node of readableTextNodes()) {
    if (marks.length >= MAX_TOTAL_MARKS) break;
    const value = node.nodeValue || "";
    pattern.lastIndex = 0;
    const matches = [...value.matchAll(pattern)].filter((match) => {
      const candidate = labelToCandidate.get(normalize(match[0]));
      if (!candidate) return false;
      return (counts.get(normalize(candidate.term)) ?? 0) < MAX_MARKS_PER_TERM && marks.length + counts.size < MAX_TOTAL_MARKS;
    });
    if (matches.length === 0) continue;

    const fragment = document.createDocumentFragment();
    let cursor = 0;
    for (const match of matches) {
      const candidate = labelToCandidate.get(normalize(match[0]));
      if (!candidate || match.index === undefined) continue;
      const key = normalize(candidate.term);
      if ((counts.get(key) ?? 0) >= MAX_MARKS_PER_TERM || marks.length >= MAX_TOTAL_MARKS) continue;
      fragment.append(value.slice(cursor, match.index));
      const mark = document.createElement("mark");
      mark.dataset.witwittyTerm = candidate.term;
      mark.tabIndex = 0;
      mark.setAttribute("role", "button");
      mark.setAttribute("aria-label", `${match[0]}. Open explanation in WitWitty.`);
      mark.textContent = match[0];
      mark.addEventListener("click", () => selectMark(mark));
      mark.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          selectMark(mark);
        }
      });
      fragment.append(mark);
      marks.push(mark);
      counts.set(key, (counts.get(key) ?? 0) + 1);
      cursor = match.index + match[0].length;
    }
    fragment.append(value.slice(cursor));
    node.parentNode?.replaceChild(fragment, node);
  }
  return marks;
};

const getDetectionPreferences = async () => {
  try {
    const stored = await chrome.storage.local.get(["knownTerms", "notJargonTerms", "excludedDomains"]);
    return {
      knownTerms: Array.isArray(stored.knownTerms) ? stored.knownTerms.filter((term): term is string => typeof term === "string") : [],
      notJargonTerms: Array.isArray(stored.notJargonTerms) ? stored.notJargonTerms.filter((term): term is string => typeof term === "string") : [],
      excludedDomains: Array.isArray(stored.excludedDomains) ? stored.excludedDomains.filter((domain): domain is string => typeof domain === "string") : [],
    };
  } catch {
    return { knownTerms: [], notJargonTerms: [], excludedDomains: [] };
  }
};

const scan = async (scanId?: string) => {
  activeScanId = scanId;
  clearAnnotations();
  const preferences = await getDetectionPreferences();
  if (preferences.excludedDomains.map(normalize).includes(normalize(window.location.hostname))) {
    chrome.runtime.sendMessage({
      type: "WITWITTY_SCAN_EXCLUDED",
      ...(scanId ? { scanId } : {}),
      domain: window.location.hostname,
    });
    return;
  }
  const blocks = extractReadableBlocks();
  const pageSignalText = `${document.title} ${window.location.hostname} ${blocks.slice(0, 24).map((block) => block.text).join(" ")}`;
  currentDomainHints = inferDomainHints(pageSignalText);
  const candidates = rankCandidates(blocks, { ...preferences, domainHints: currentDomainHints, limit: 15 });
  const marks = annotateCandidates(candidates);
  chrome.runtime.sendMessage({
    type: "WITWITTY_SCAN_COMPLETE",
    ...(scanId ? { scanId } : {}),
    count: marks.length,
    candidateCount: candidates.length,
    candidates: candidates.map(({ term, score, evidence }) => ({ term, score, evidence })),
  });
  if (marks[0]) selectMark(marks[0]);
};

const setTextMode = (term: string, mode: string) => {
  const candidate = candidateByTerm.get(normalize(term));
  marksForTerm(term).forEach((mark) => {
    if (!mark.dataset.originalText) mark.dataset.originalText = mark.textContent || term;
    mark.textContent = mode === "simpler" && candidate?.entry?.simpler ? candidate.entry.simpler : mark.dataset.originalText;
  });
};

const removeTerm = (term: string) => {
  marksForTerm(term).forEach((mark) => {
    mark.replaceWith(document.createTextNode(mark.dataset.originalText || mark.textContent || term));
  });
  candidateByTerm.delete(normalize(term));
};

if (!window.__witWittyInstalled) {
  window.__witWittyInstalled = true;
  installStyles();
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === "WITWITTY_SCAN_PAGE") void scan(typeof message.scanId === "string" ? message.scanId : undefined);
    if (message.type === "WITWITTY_SET_TEXT_MODE" && typeof message.term === "string" && typeof message.mode === "string") setTextMode(message.term, message.mode);
    if (message.type === "WITWITTY_REMOVE_TERM" && typeof message.term === "string") removeTerm(message.term);
    if (message.type === "WITWITTY_REMOVE_ALL_ANNOTATIONS") clearAnnotations();
  });
}
