# Depth, routing and review contracts

`src/core/contracts.ts` is the executable authority. Prompts and review consume the same versioned contract, not separate hand-written definitions.

| Depth | Intended behavior |
| --- | --- |
| ELI5 | No background assumed; everyday wording, very low abstraction, a helpful simple analogy where appropriate, short concrete examples, qualifications retained |
| Plain | Minimal specialist background; necessary terms explained inline; direct literal explanation with a concrete example if useful |
| General | Educated reader; domain terms introduced in context; moderate abstraction and explanation of the argument/mechanism |
| Advanced | Relevant domain background; precise terminology, explicit assumptions and mechanisms; less analogy, more technical distinctions |
| Expert | Specialist background; compact technical precision, formal distinctions where supported; no invented rigor or removed uncertainty |

The full source contract includes assumed background, vocabulary, terminology, abstraction, detail, analogy, precision and examples. Higher depth is not permission to invent facts. Lower depth is not permission to erase a negation, quantity, limitation or uncertainty.

## Explain and Rewrite

Term Explain is contextual, not an unrelated dictionary lookup. Sentence Explain addresses the selected claim. Paragraph Explain addresses its meaning/argument. Section/Document Explain combines a coherent scope overview, within the explicit size limit, with reviewed block contributions.

Rewrite accepts the exact editable segment IDs and returns each once. An unchanged result is allowed when an accurate replacement cannot be produced. Code and equations are never eligible rewrite segments. A deterministic quantity multiset guard rejects changed, dropped or duplicated digit-form quantities, including signs, decimals and percentages. This conservative rule can reject valid digit-to-word rewrites; it is preferable to silently changing a quantity. It is not a general semantic-equivalence proof.

## Deterministic routing

| Explicit condition, in order | Tier |
| --- | --- |
| Depth is Advanced or Expert | Strong |
| Scope is Section or Document | Strong |
| Input is over 1,800 characters | Strong |
| Otherwise | Fast |

The named model IDs come from configuration. Route reason is inspectable. Jev neither selects a DOM target nor controls scope/gesture recognition. Speculation is suppressed whenever this table selects Strong.

## Quality gate

```text
Validate request → deterministic route → generate structured text
→ deterministic schema/coverage/quantity validation → Jev review
→ approve OR one corrective retry → final approve / fail closed
```

Malformed output uses the same maximum-two-generation-attempt budget. Generation and review have individual 20-second bounds. Review timeout, invalid probability output, provider timeout or final rejection fails closed. Cancellable browser/server request bounds additionally protect the whole transaction. There is no unbounded retry loop and no streaming of unreviewed draft tokens into the page.

The concrete native Jev adapter calls TypeSafe's `systemone` API with `noul` questions for meaning preservation, depth fit and unsupported additions. The V1 gates are **meaning ≥ 0.90**, **depth fit ≥ 0.85**, and **unsupported additions ≤ 0.05**, with finite values in [0,1]. These are an explicit initial review policy, not evidence that those scores are calibrated for this application or that a passed answer is true. Real-output evaluation remains part of local credential integration.

The fixture reviewer is plainly labeled and deterministic. It demonstrates orchestration, approval isolation, retry, rejection and cancellation; it does not provide independent assurance of arbitrary text. Curated fixture prose is authored for this demo, not produced live by Jev.

## Adapter ports

`Generator.generate(request, correction, signal)` returns a structured draft; `Reviewer.review(request, draft, attempt, signal)` returns a validated quality decision. `Transport.transform(request, onEvent, signal)` exposes route/review/progress and an approved result or null. Models never receive DOM objects or camera frames.

A new provider API can implement those ports without changing semantics, state, rendering or gestures. The shipped live generation adapter targets OpenAI-compatible JSON Chat Completions. A provider with an incompatible protocol needs a thin additional concrete adapter; no such compatibility is claimed merely because it has an API key.
