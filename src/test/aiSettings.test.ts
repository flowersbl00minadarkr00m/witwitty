import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearAiConfiguration,
  getAiSecret,
  getAiSecretPresent,
  getAiSettings,
  removeAiConfiguration,
  saveAiConfiguration,
  setAiEnabled,
  toCapabilitySettings,
} from "../data/aiSettings";

describe("aiSettings storage and configuration flow", () => {
  let store: Record<string, unknown>;
  let fetchMock: ReturnType<typeof vi.fn>;
  let permissionsRequest: ReturnType<typeof vi.fn>;
  let permissionsRemove: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    store = {};
    fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ choices: [{ message: { content: '{"outcome":"insufficient-evidence"}' } }] }) });
    vi.stubGlobal("fetch", fetchMock);
    permissionsRequest = vi.fn().mockResolvedValue(true);
    permissionsRemove = vi.fn().mockResolvedValue(true);

    Object.assign(globalThis, {
      chrome: {
        storage: {
          local: {
            get: vi.fn(async (keys: string[]) => Object.fromEntries(keys.filter((key) => key in store).map((key) => [key, store[key]]))),
            set: vi.fn(async (items: Record<string, unknown>) => { Object.assign(store, items); }),
            remove: vi.fn(async (keys: string[]) => { keys.forEach((key) => delete store[key]); }),
          },
        },
        permissions: {
          request: permissionsRequest,
          remove: permissionsRemove,
          contains: vi.fn().mockResolvedValue(true),
        },
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    Reflect.deleteProperty(globalThis, "chrome");
  });

  it("has no configuration and no secret before anything is saved", async () => {
    await expect(getAiSettings()).resolves.toBeNull();
    await expect(getAiSecretPresent()).resolves.toBe(false);
  });

  it("rejects a non-HTTPS endpoint before requesting any permission", async () => {
    const result = await saveAiConfiguration({ endpointUrl: "http://insecure.test", apiKey: "k", modelId: "m" });
    expect(result).toEqual({ ok: false, error: { reason: "invalid-endpoint", message: expect.any(String) } });
    expect(permissionsRequest).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("requests the optional permission for exactly the entered origin", async () => {
    await saveAiConfiguration({ endpointUrl: "https://api.example.test/v1/explain", apiKey: "k", modelId: "m" });
    expect(permissionsRequest).toHaveBeenCalledWith({ origins: ["https://api.example.test/*"] });
  });

  it("leaves the reader unconfigured when the permission prompt is declined", async () => {
    permissionsRequest.mockResolvedValueOnce(false);
    const result = await saveAiConfiguration({ endpointUrl: "https://api.example.test/v1/explain", apiKey: "k", modelId: "m" });
    expect(result).toEqual({ ok: false, error: { reason: "permission-declined", message: expect.any(String) } });
    expect(fetchMock).not.toHaveBeenCalled();
    await expect(getAiSettings()).resolves.toBeNull();
  });

  it("does not persist and revokes the just-granted permission when verification fails", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({}) });
    const result = await saveAiConfiguration({ endpointUrl: "https://api.example.test/v1/explain", apiKey: "bad-key", modelId: "m" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.reason).toBe("verification-failed");
    expect(permissionsRemove).toHaveBeenCalledWith({ origins: ["https://api.example.test/*"] });
    await expect(getAiSettings()).resolves.toBeNull();
    await expect(getAiSecretPresent()).resolves.toBe(false);
  });

  it("persists settings and secret under separate keys after a successful save", async () => {
    const result = await saveAiConfiguration({ endpointUrl: "https://api.example.test/v1/explain ", apiKey: " secret-key ", modelId: " m " });
    expect(result.ok).toBe(true);

    const settings = await getAiSettings();
    expect(settings).toMatchObject({ endpointUrl: "https://api.example.test/v1/explain", modelId: "m", enabled: true });
    expect(settings?.verifiedAt).toEqual(expect.any(String));
    await expect(getAiSecret()).resolves.toBe("secret-key");

    // Settings never carry the secret value.
    expect(JSON.stringify(settings)).not.toContain("secret-key");
  });

  it("derives capability settings as configured only once verifiedAt is set", async () => {
    expect(toCapabilitySettings(null)).toEqual({ configured: false, enabled: false });
    await saveAiConfiguration({ endpointUrl: "https://api.example.test/v1/explain", apiKey: "k", modelId: "m" });
    const settings = await getAiSettings();
    expect(toCapabilitySettings(settings)).toEqual({ configured: true, enabled: true });
  });

  it("turns the feature off without discarding the stored credential", async () => {
    await saveAiConfiguration({ endpointUrl: "https://api.example.test/v1/explain", apiKey: "k", modelId: "m" });
    await setAiEnabled(false);
    const settings = await getAiSettings();
    expect(settings?.enabled).toBe(false);
    await expect(getAiSecretPresent()).resolves.toBe(true);
  });

  it("removes settings, secret, and the granted permission on removal", async () => {
    await saveAiConfiguration({ endpointUrl: "https://api.example.test/v1/explain", apiKey: "k", modelId: "m" });
    await removeAiConfiguration();
    await expect(getAiSettings()).resolves.toBeNull();
    await expect(getAiSecretPresent()).resolves.toBe(false);
    expect(permissionsRemove).toHaveBeenCalledWith({ origins: ["https://api.example.test/*"] });
  });

  it("clearAiConfiguration removes both storage keys directly", async () => {
    await saveAiConfiguration({ endpointUrl: "https://api.example.test/v1/explain", apiKey: "k", modelId: "m" });
    await clearAiConfiguration();
    await expect(getAiSettings()).resolves.toBeNull();
    await expect(getAiSecretPresent()).resolves.toBe(false);
  });
});
