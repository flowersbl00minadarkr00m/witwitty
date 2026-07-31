/**
 * Bring-your-own-everything settings and secret storage (design §2.2, §4.3,
 * §6.3, §6.4; SA-001, SA-004; WIT-B01).
 *
 * The secret (API key) is stored under a storage key **separate** from
 * settings so the rendering path never reads it — `getAiSettings()` cannot
 * return a credential even by accident. Both live in `chrome.storage.local`,
 * never IndexedDB (credentials must never enter an export).
 */

import { endpointOrigin, isAbsoluteHttpsUrl, verifyEndpoint, type AiEndpointConfig } from "../ai/adapter";
import type { AiCapabilitySettings } from "../core/aiCapability";

interface ChromeStorageArea {
  get(keys: string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string[]): Promise<void>;
}

interface ChromePermissionsApi {
  request(permissions: { origins: string[] }): Promise<boolean>;
  remove(permissions: { origins: string[] }): Promise<boolean>;
  contains(permissions: { origins: string[] }): Promise<boolean>;
}

declare const chrome: {
  storage: { local: ChromeStorageArea };
  permissions: ChromePermissionsApi;
};

const SETTINGS_KEY = "witwittyAiSettings";
const SECRET_KEY = "witwittyAiSecret";

export interface AiSettings {
  endpointUrl: string;
  modelId: string;
  enabled: boolean;
  /** Set only after a live verification request succeeds (FR-009). Cleared by any edit. */
  verifiedAt: string | null;
  /**
   * Last 4 characters of the API key only, kept for the "…last4" display
   * (WIT-B01: `configured · <origin> · <model id> · …<last4>`). Not the
   * secret and not sufficient to reconstruct it.
   */
  keyLast4: string;
}

const isAiSettings = (value: unknown): value is AiSettings => {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<AiSettings>;
  return (
    typeof candidate.endpointUrl === "string" &&
    typeof candidate.modelId === "string" &&
    typeof candidate.enabled === "boolean" &&
    typeof candidate.keyLast4 === "string" &&
    (candidate.verifiedAt === null || typeof candidate.verifiedAt === "string")
  );
};

export const getAiSettings = async (): Promise<AiSettings | null> => {
  const stored = await chrome.storage.local.get([SETTINGS_KEY]);
  const value = stored[SETTINGS_KEY];
  return isAiSettings(value) ? value : null;
};

const setAiSettings = (settings: AiSettings): Promise<void> => chrome.storage.local.set({ [SETTINGS_KEY]: settings });

/** Never read by any rendering path — see `getAiSecretPresent` for a display-safe check. */
export const getAiSecret = async (): Promise<string | null> => {
  const stored = await chrome.storage.local.get([SECRET_KEY]);
  const value = stored[SECRET_KEY];
  return typeof value === "string" && value.length > 0 ? value : null;
};

/** Display-safe: reports only whether a secret exists, never its value. */
export const getAiSecretPresent = async (): Promise<boolean> => (await getAiSecret()) !== null;

const setAiSecret = (apiKey: string): Promise<void> => chrome.storage.local.set({ [SECRET_KEY]: apiKey });

export const clearAiConfiguration = (): Promise<void> => chrome.storage.local.remove([SETTINGS_KEY, SECRET_KEY]);

/** Derives the deterministic capability gate's input from stored settings (WIT-A02 integration). */
export const toCapabilitySettings = (settings: AiSettings | null): AiCapabilitySettings => ({
  configured: settings !== null && settings.verifiedAt !== null,
  enabled: settings?.enabled ?? false,
});

export type SaveConfigurationErrorReason =
  | "invalid-endpoint"
  | "permission-declined"
  | "verification-failed";

export interface SaveConfigurationError {
  reason: SaveConfigurationErrorReason;
  message: string;
}

export type SaveConfigurationResult =
  | { ok: true; settings: AiSettings }
  | { ok: false; error: SaveConfigurationError };

/**
 * Save/replace flow (WIT-B01 acceptance): validate the URL, request the
 * optional host permission for its origin only, run the live verification
 * request, and only then persist. Declining the permission or failing
 * verification leaves any prior configuration untouched.
 */
export const saveAiConfiguration = async (input: {
  endpointUrl: string;
  apiKey: string;
  modelId: string;
}): Promise<SaveConfigurationResult> => {
  const endpointUrl = input.endpointUrl.trim();
  const apiKey = input.apiKey.trim();
  const modelId = input.modelId.trim();

  if (!isAbsoluteHttpsUrl(endpointUrl)) {
    return { ok: false, error: { reason: "invalid-endpoint", message: "Enter a well-formed https:// endpoint URL." } };
  }

  const origin = endpointOrigin(endpointUrl);
  if (!origin) {
    return { ok: false, error: { reason: "invalid-endpoint", message: "Enter a well-formed https:// endpoint URL." } };
  }

  const granted = await chrome.permissions.request({ origins: [`${origin}/*`] });
  if (!granted) {
    return { ok: false, error: { reason: "permission-declined", message: "WitWitty needs permission to reach that origin before it can verify or use it." } };
  }

  const verification = await verifyEndpoint({ endpointUrl, apiKey, modelId });
  if (!verification.ok) {
    await chrome.permissions.remove({ origins: [`${origin}/*`] });
    return { ok: false, error: { reason: "verification-failed", message: verification.error.message } };
  }

  const settings: AiSettings = {
    endpointUrl,
    modelId,
    enabled: true,
    verifiedAt: new Date().toISOString(),
    keyLast4: apiKey.slice(-4),
  };
  await setAiSecret(apiKey);
  await setAiSettings(settings);
  return { ok: true, settings };
};

export const setAiEnabled = async (enabled: boolean): Promise<AiSettings | null> => {
  const current = await getAiSettings();
  if (!current) return null;
  const next = { ...current, enabled };
  await setAiSettings(next);
  return next;
};

/** Removes the credential and settings, and revokes the granted origin permission (WIT-C04). */
export const removeAiConfiguration = async (): Promise<void> => {
  const current = await getAiSettings();
  await clearAiConfiguration();
  if (!current) return;
  const origin = endpointOrigin(current.endpointUrl);
  if (origin) await chrome.permissions.remove({ origins: [`${origin}/*`] });
};

/**
 * WIT-B02 acceptance: "A request is not attempted when the origin permission
 * is absent." Checked immediately before every request, not cached — the
 * reader can revoke a permission from `chrome://extensions` at any time.
 */
export const hasOriginPermission = async (endpointUrl: string): Promise<boolean> => {
  const origin = endpointOrigin(endpointUrl);
  if (!origin) return false;
  try {
    return await chrome.permissions.contains({ origins: [`${origin}/*`] });
  } catch {
    return false;
  }
};

/**
 * The only function that assembles a live request config, including the
 * secret. Used exclusively by the request path (`ai/adapter.ts` call sites in
 * the panel), never by any rendering code — see module doc.
 */
export const getAiEndpointConfig = async (): Promise<AiEndpointConfig | null> => {
  const settings = await getAiSettings();
  if (!settings || !settings.enabled || !settings.verifiedAt) return null;
  const apiKey = await getAiSecret();
  if (!apiKey) return null;
  return { endpointUrl: settings.endpointUrl, apiKey, modelId: settings.modelId };
};
