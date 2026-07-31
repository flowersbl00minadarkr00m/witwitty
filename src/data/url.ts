const TRACKING_KEYS = new Set([
  "fbclid",
  "gclid",
  "mc_cid",
  "mc_eid",
  "ref",
  "source",
]);

const SENSITIVE_KEY_PATTERN = /auth|code|email|key|password|secret|session|token/i;

export const sanitizeUrl = (rawUrl: string): string => {
  try {
    const url = new URL(rawUrl);
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (key.toLocaleLowerCase().startsWith("utm_") || TRACKING_KEYS.has(key.toLocaleLowerCase()) || SENSITIVE_KEY_PATTERN.test(key)) {
        url.searchParams.delete(key);
      }
    }
    return url.toString();
  } catch {
    return "";
  }
};
