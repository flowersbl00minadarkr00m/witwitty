import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ContextLensPanel } from "../components/ContextLensPanel";
import { demoAmbiguousTerm, demoMissingTerm } from "../data/dictionary";
import "../styles.css";

const searchParameters = new URLSearchParams(window.location.search);
const isDemo = searchParameters.has("demo");
const requestedDemoWidth = Number(searchParameters.get("width"));
const demoState = searchParameters.get("state");
const selectedDemoTerm = demoState === "ambiguous" ? demoAmbiguousTerm : demoState === "missing" ? demoMissingTerm : undefined;

if (isDemo && Number.isFinite(requestedDemoWidth)) {
  const demoWidth = Math.min(440, Math.max(360, requestedDemoWidth));
  document.documentElement.style.width = `${demoWidth}px`;
  document.body.style.width = `${demoWidth}px`;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ContextLensPanel demo={isDemo} selectedTerm={selectedDemoTerm} priorEncounter={selectedDemoTerm ? null : undefined} />
  </StrictMode>,
);
