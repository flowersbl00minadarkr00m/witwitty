import { useEffect, useState } from "react";
import { endpointOrigin } from "../ai/adapter";
import { getAiSettings, removeAiConfiguration, saveAiConfiguration, setAiEnabled, type AiSettings as AiSettingsRecord } from "../data/aiSettings";
import { CloseIcon } from "./Icons";

type FormMode = "hidden" | "add" | "replace";

/**
 * BYOK settings surface (WIT-B01, design §2.2, §4.3, §6.3, §6.4). Lives inside
 * the existing "Your local data" drawer. No provider name, default endpoint,
 * or curated model list appears anywhere here (SA-004) — three free-text
 * fields only.
 */
export function AiSettings() {
  const [settings, setSettings] = useState<AiSettingsRecord | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [formMode, setFormMode] = useState<FormMode>("hidden");
  const [endpointUrl, setEndpointUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [modelId, setModelId] = useState("");
  const [busy, setBusy] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [statusIsError, setStatusIsError] = useState(false);
  const [pendingRemove, setPendingRemove] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getAiSettings().then((value) => {
      if (!cancelled) {
        setSettings(value);
        setLoaded(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const resetForm = () => {
    setEndpointUrl("");
    setApiKey("");
    setModelId("");
    setFormMode("hidden");
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setStatusMessage("");
    setStatusIsError(false);
    try {
      const result = await saveAiConfiguration({ endpointUrl, apiKey, modelId });
      if (result.ok) {
        setSettings(result.settings);
        setStatusMessage(`Verified and saved · ${endpointOrigin(result.settings.endpointUrl) ?? result.settings.endpointUrl}`);
        resetForm();
      } else {
        setStatusIsError(true);
        setStatusMessage(result.error.message);
      }
    } finally {
      setBusy(false);
    }
  };

  const handleToggleEnabled = async () => {
    if (!settings) return;
    setBusy(true);
    try {
      const next = await setAiEnabled(!settings.enabled);
      setSettings(next);
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = async () => {
    setBusy(true);
    try {
      await removeAiConfiguration();
      setSettings(null);
      setPendingRemove(false);
      setStatusMessage("AI configuration removed. Meanings you already accepted are kept.");
      setStatusIsError(false);
    } finally {
      setBusy(false);
    }
  };

  if (!loaded) return null;

  return (
    <section className="ai-settings" aria-labelledby="ai-settings-heading">
      <div className="ai-settings-heading">
        <p className="context-label">Contextual AI (optional)</p>
        <h3 id="ai-settings-heading">Bring your own endpoint</h3>
      </div>
      <p className="ai-settings-copy">
        WitWitty ships with no AI provider, no default endpoint, and no bundled key. Enter your own endpoint, API
        key, and model id to enable AI explanations for terms with no local meaning. Nothing is sent anywhere
        until you configure and verify this.
      </p>

      {settings && formMode === "hidden" && (
        <div className="ai-settings-configured">
          <p>
            <strong>configured</strong> · {endpointOrigin(settings.endpointUrl) ?? settings.endpointUrl} · {settings.modelId} · …{settings.keyLast4}
          </p>
          <div className="ai-settings-actions">
            <button type="button" onClick={handleToggleEnabled} disabled={busy}>{settings.enabled ? "Turn off" : "Turn on"}</button>
            <button type="button" onClick={() => setFormMode("replace")} disabled={busy}>Replace</button>
            <button type="button" className="is-danger" onClick={() => setPendingRemove(true)} disabled={busy}>Remove</button>
          </div>
          {pendingRemove && (
            <div className="delete-confirmation" role="alert">
              <p>Remove this AI configuration? Meanings you already accepted are retained.</p>
              <div>
                <button type="button" onClick={() => setPendingRemove(false)}>Cancel</button>
                <button type="button" className="is-danger" onClick={handleRemove}>Confirm</button>
              </div>
            </div>
          )}
        </div>
      )}

      {!settings && formMode === "hidden" && (
        <button type="button" onClick={() => setFormMode("add")}>Set up AI explanations</button>
      )}

      {(formMode === "add" || formMode === "replace") && (
        <form className="ai-settings-form" onSubmit={handleSubmit}>
          <div className="ai-settings-form-heading">
            <span>{formMode === "replace" ? "Replace configuration" : "New configuration"}</span>
            <button type="button" className="icon-button" aria-label="Cancel" onClick={resetForm}><CloseIcon /></button>
          </div>
          <label>
            Endpoint URL
            <input
              type="url"
              required
              placeholder="https://your-endpoint.example/v1/explain"
              value={endpointUrl}
              onChange={(event) => setEndpointUrl(event.target.value)}
              autoComplete="off"
            />
          </label>
          <label>
            API key
            <input
              type="password"
              required
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              autoComplete="off"
            />
          </label>
          <label>
            Model id
            <input
              type="text"
              required
              placeholder="e.g. your-model-id"
              value={modelId}
              onChange={(event) => setModelId(event.target.value)}
              autoComplete="off"
            />
          </label>
          <button type="submit" className="is-primary" disabled={busy}>{busy ? "Verifying…" : "Verify and save"}</button>
          <p className="ai-settings-hint">
            Saving asks Chrome for permission to reach {endpointUrl ? (endpointOrigin(endpointUrl) ?? "that origin") : "the entered origin"} only, then
            sends one minimal request to confirm it works. Nothing is stored until verification succeeds.
          </p>
        </form>
      )}

      <p className={statusIsError ? "storage-error" : "privacy-message"} role="status" aria-live="polite">
        {statusMessage}
      </p>
    </section>
  );
}
