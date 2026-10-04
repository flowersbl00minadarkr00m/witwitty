const sensitiveDomains = [
  'mail.google.com', 'outlook.live.com', 'outlook.office.com', 'outlook.office365.com', 'proton.me',
  'rbcroyalbank.com', 'royalbank.com', 'td.com', 'bmo.com', 'cibc.com', 'scotiabank.com', 'chase.com', 'bankofamerica.com',
  'mychart.com', 'myhealth.alberta.ca', 'healthgateway.gov.bc.ca', 'workday.com', 'myworkday.com', 'adp.com', 'successfactors.com',
  'login.microsoftonline.com', 'accounts.google.com', 'account.microsoft.com', 'okta.com', 'auth0.com',
];
export function privacyDecision(input: string, document?: Document): {
  allowed: boolean;
  reason: string;
} {
  let url: URL;
  try {
    url = new URL(input);
  }
  catch {
    return { allowed: false, reason: 'Unsupported page URL.' };
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
    return { allowed: false, reason: 'Only ordinary HTTP(S) articles are supported.' };
  const host = url.hostname.toLowerCase();
  if (sensitiveDomains.some(domain => host === domain || host.endsWith(`.${domain}`)) || /(^|\.)(?:bank(?:ing)?|webmail|mail|patient|payroll|hr|login|auth|accounts|sso)\./.test(host))
    return { allowed: false, reason: 'Sensitive site category is blocked.' };
  const path = decodeURIComponentSafe(url.pathname).toLowerCase();
  if (/(?:^|\/)(?:log-?in|sign-?in|sign-?up|oauth|authorize|authentication|account|accounts|patient|mychart|banking|payroll|webmail|inbox)(?:\/|$)/.test(path))
    return { allowed: false, reason: 'Account, authentication or private-portal path is blocked.' };
  if (document && [...document.querySelectorAll('input[type="password"],input[autocomplete^="cc-"],input[autocomplete="current-password"],input[autocomplete="new-password"],[data-sensitive="true"]')].some(element => !element.closest('[data-ww-owned]')))
    return { allowed: false, reason: 'Sensitive form detected. WitWitty is inactive.' };
  return { allowed: true, reason: 'Explicitly activated article.' };
}
function decodeURIComponentSafe(value: string): string { try {
  return decodeURIComponent(value);
}
catch {
  return value;
} }
export function safeSourceUrl(value: string): string {
  if (!privacyDecision(value).allowed)
    throw new Error('Unsafe source URL');
  const url = new URL(value);
  return `${url.origin}${url.pathname}`; // No query tokens, fragments or browsing history.
}
export interface SavedItem {
  id: string;
  original: string;
  transformed: string;
  title: string;
  url: string;
  mode: 'Explain' | 'Rewrite';
  scope: string;
  depth: string;
  timestamp: string;
}
export function validateSaved(value: unknown): SavedItem {
  if (!value || typeof value !== 'object')
    throw new Error('Invalid saved item');
  const item = value as SavedItem;
  for (const key of ['id', 'original', 'transformed', 'title', 'url', 'mode', 'scope', 'depth', 'timestamp'] as const) {
    if (typeof item[key] !== 'string' || item[key].length > (key === 'original' || key === 'transformed' ? 100000 : 2000))
      throw new Error('Invalid saved field');
  }
  if (!['Explain', 'Rewrite'].includes(item.mode) || !['Document', 'Section', 'Paragraph', 'Sentence', 'Term'].includes(item.scope) || !['ELI5', 'Plain', 'General', 'Advanced', 'Expert'].includes(item.depth) || !Number.isFinite(Date.parse(item.timestamp)))
    throw new Error('Invalid saved metadata');
  return { id: item.id, original: item.original, transformed: item.transformed, title: item.title, url: safeSourceUrl(item.url), mode: item.mode, scope: item.scope, depth: item.depth, timestamp: item.timestamp };
}
export function exportMarkdown(items: SavedItem[]): string {
  return items.map(item => {
    const fence = '`'.repeat(Math.max(3, ...[...item.original.matchAll(/`+/g), ...item.transformed.matchAll(/`+/g)].map(m => m[0].length + 1)));
    const title = item.title.replace(/[\r\n#<>]/g, ' ');
    return `## ${title}\n\nSource: ${item.url}\n\n${item.mode} · ${item.scope} · ${item.depth} · ${item.timestamp}\n\n### Original\n${fence}text\n${item.original}\n${fence}\n\n### Transformation\n${fence}text\n${item.transformed}\n${fence}\n`;
  }).join('\n---\n\n');
}
