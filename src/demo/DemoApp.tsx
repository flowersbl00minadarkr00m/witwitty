import { useState } from "react";
import { ContextLensPanel } from "../components/ContextLensPanel";
import { AiDisclosure } from "../components/AiDisclosure";
import { AiProposal } from "../components/AiProposal";
import { demoPriorEncounter, demoTerm } from "../data/dictionary";
import type { ActiveTerm, TextMode } from "../types";
import type { ContextPacket } from "../core/explanations";
import type { ProposalV1 } from "../core/proposal";

const terms: Record<string, ActiveTerm> = {
  idempotent: demoTerm,
  "eventual consistency": {
    term: "Eventual consistency",
    definition: "Different parts of a system may update at different times, but are expected to agree later.",
    sentenceExcerpt: "Closely related is the idea of eventual consistency. In distributed systems, it’s often unrealistic to expect all parts of the system to agree immediately.",
    source: demoTerm.source,
    provenance: "bundled",
    provenanceLabel: "Reviewed local definition",
    confidence: 1,
    simpler: "agreement after a delay",
  },
  observability: {
    term: "Observability",
    definition: "The ability to understand a system from signals such as logs, metrics, and traces.",
    sentenceExcerpt: "Finally, effective systems embrace observability. You can’t improve what you can’t see.",
    source: demoTerm.source,
    provenance: "bundled",
    provenanceLabel: "Reviewed local definition",
    confidence: 1,
    simpler: "insight into how a system behaves",
  },
  "chaos engineering": {
    term: "Chaos engineering",
    definition: "No reviewed local explanation is available for this term yet.",
    sentenceExcerpt: "Some teams go further and practice chaos engineering, deliberately breaking things in production to find out whether these assumptions hold before an outage does it for them.",
    source: demoTerm.source,
    provenance: "missing",
    provenanceLabel: "No local definition",
    confidence: 0,
  },
};

const simplerLabels: Record<string, string> = {
  idempotent: "safe to repeat",
  "eventual consistency": "agreement after a delay",
  observability: "insight into how a system behaves",
};

/** Scripted for this public demo only — no request actually leaves the page. See `renderAiDemo` below. */
const chaosPacket: ContextPacket = {
  term: "chaos engineering",
  sentenceExcerpt: terms["chaos engineering"].sentenceExcerpt,
  pageTitle: "Designing reliable systems",
  domain: "example.com",
  domainHints: ["software", "systems"],
};

const cannedProposal: ProposalV1 = {
  outcome: "proposed",
  evidence: [{
    quote: "practice chaos engineering, deliberately breaking things in production",
    observation: "The passage frames it as a deliberate practice for testing resilience, not an accident.",
  }],
  inference: [{
    statement: "In software and systems writing, this term usually denotes intentionally injecting failures into a live system to verify it recovers safely.",
    groundedInPassage: false,
  }],
  recommendation: { definition: "Deliberately introducing controlled failures into a system to verify it holds up before a real outage does." },
  alternatives: [{
    definition: "A broader organizational discipline of stress-testing assumptions under uncertainty, not limited to software systems.",
    domain: "organizational practice",
    why: "Some teams use the term more broadly than infrastructure testing alone.",
  }],
  confidence: "low",
  limits: ["The passage doesn't name a specific tool or failure mode being tested."],
  wouldImprove: ["An example of one chaos experiment this team actually ran."],
  model: { providerId: "example-provider", modelId: "example-model" },
};

type AiDemoState = "idle" | "disclosure" | "pending" | "result";

export function DemoApp() {
  const [selectedKey, setSelectedKey] = useState("idempotent");
  const [modes, setModes] = useState<Record<string, TextMode>>({});
  const [aiDemoState, setAiDemoState] = useState<AiDemoState>("idle");
  const [aiAccepted, setAiAccepted] = useState(false);

  const selectTerm = (key: string) => {
    setSelectedKey(key);
    setModes({});
    setAiDemoState("idle");
  };

  const renderTerm = (key: string) => (
    <button
      type="button"
      className={`article-term ${selectedKey === key ? "is-selected" : ""}`}
      onClick={() => selectTerm(key)}
    >
      {modes[key] === "simpler" ? simplerLabels[key] : key}
    </button>
  );

  const activeTerm = selectedKey === "chaos engineering" && aiAccepted
    ? {
      ...terms[selectedKey],
      definition: cannedProposal.recommendation!.definition,
      provenance: "inferred" as const,
      provenanceLabel: "Contextual interpretation · example-model",
      confidence: 0.3,
    }
    : terms[selectedKey];

  const renderAiDemo = () => {
    if (selectedKey !== "chaos engineering" || aiAccepted) return null;
    return (
      <section className="ai-region" aria-label="AI explanation (scripted example)">
        {aiDemoState === "idle" && (
          <div className="ai-affordance">
            <button type="button" onClick={() => setAiDemoState("disclosure")}>Explain this term here</button>
          </div>
        )}
        {aiDemoState === "disclosure" && (
          <AiDisclosure
            packet={chaosPacket}
            destination="api.example-provider.com"
            modelId="example-model"
            onCancel={() => setAiDemoState("idle")}
            onSend={() => {
              setAiDemoState("pending");
              window.setTimeout(() => setAiDemoState("result"), 1100);
            }}
          />
        )}
        {aiDemoState === "pending" && (
          <div className="ai-pending" aria-live="polite">
            <span>Asking the configured endpoint…</span>
            <button type="button" onClick={() => setAiDemoState("idle")}>Cancel</button>
          </div>
        )}
        {aiDemoState === "result" && (
          <AiProposal
            proposal={cannedProposal}
            onDiscard={() => setAiDemoState("idle")}
            onAccept={() => {
              setAiAccepted(true);
              setAiDemoState("idle");
            }}
          />
        )}
        <p className="ai-demo-note">
          Scripted for this demo — no request actually leaves this page. With the real extension, this box is a live
          request to whichever endpoint <em>you</em> configure.
        </p>
      </section>
    );
  };

  return (
    <main className="demo-browser">
      <div className="browser-tabbar" aria-hidden="true">
        <span className="window-dot red" /><span className="window-dot amber" /><span className="window-dot green" />
        <div className="browser-tab"><span className="tab-favicon">T</span>Designing reliable systems<span>×</span></div>
        <span className="new-tab">+</span>
      </div>
      <div className="browser-addressbar" aria-hidden="true">
        <span>‹</span><span>›</span><span>↻</span>
        <div className="address-field"><span>●</span> example.com/articles/designing-reliable-systems</div>
        <span>☆</span><span className="toolbar-w">W</span><span>⋮</span>
      </div>
      <div className="demo-workspace">
        <article className="demo-article">
          <div className="article-meta"><span>Engineering</span><i>•</i><time>May 12, 2024</time></div>
          <h1>Designing reliable systems</h1>
          <p className="article-deck">Principles and patterns for building software that behaves<br />well—no matter what.</p>
          <hr />
          <p>Reliable systems don’t happen by accident. They’re the result of deliberate design, careful trade-offs, and a healthy respect for failure. As systems scale, the cost of unexpected behavior compounds—impacting users, teams, and the business.</p>
          <p>A foundational practice is to make operations {renderTerm("idempotent")}. When an operation can be repeated without changing the result beyond the initial application, retries and recovery become significantly safer.</p>
          <p>Closely related is the idea of {renderTerm("eventual consistency")}. In distributed systems, it’s often unrealistic to expect all parts of the system to agree immediately. Instead, we design for convergence over time.</p>
          <p>Finally, effective systems embrace {renderTerm("observability")}. You can’t improve what you can’t see. Logs, metrics, and traces illuminate how your system behaves in the real world—helping you detect issues and build confidence.</p>
          <p>Some teams go further and practice {renderTerm("chaos engineering")}, deliberately breaking things in production to find out whether these assumptions hold before an outage does it for them.</p>
          <p>These principles aren’t silver bullets, but they provide a strong foundation. The goal isn’t perfection. It’s building systems that are predictable, understandable, and kind to both users and operators.</p>
        </article>
        <ContextLensPanel
          demo
          selectedTerm={activeTerm}
          priorEncounter={selectedKey === "idempotent" ? demoPriorEncounter : null}
          onTextModeChange={(term, mode) => setModes((current) => ({ ...current, [term.toLocaleLowerCase()]: mode }))}
          renderAiDemo={renderAiDemo}
        />
      </div>
    </main>
  );
}
