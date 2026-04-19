# Hermes Provider Configuration Redesign

**Date:** 2026-04-19  
**Scope:** Redesign the Hermes AI provider configuration experience to match OpenClaw’s information density and usability, while expanding the visible provider coverage to reflect Hermes official documentation.

---

## Summary

The current Hermes `AI Providers` tab is too minimal for the range of providers Hermes actually supports. It only exposes a small fixed set of providers, uses a single generic form pattern, and makes the model field a plain text input with almost no guidance.

This redesign keeps Hermes aligned with its current single-active-provider configuration model, but upgrades the Providers tab into a grouped provider control center with:

- richer provider coverage
- clearer provider categories
- better per-provider metadata and docs entry points
- structured provider-specific field schemas
- recommended model selections with custom model override
- extensible config storage for API key, OAuth-adjacent, AWS, and OpenAI-compatible providers

This is a UI + config-model redesign, not a full OAuth/login flow implementation.

---

## Goals

1. Make Hermes provider setup feel as polished and scannable as OpenClaw.
2. Expand visible support to cover the main provider families documented by Hermes.
3. Preserve the current Hermes config constraint: exactly one active provider at a time.
4. Replace the current plain-text model entry with recommended model choices plus manual override.
5. Support richer provider-specific configuration persistence without pretending unsupported auth flows are complete.

---

## Non-Goals

- No multi-provider simultaneous activation
- No full OAuth login workflow in this iteration
- No live remote model catalog fetching in this iteration
- No attempt to enumerate every model from every provider in the UI
- No broad refactor of non-provider Hermes tabs unless required by shared component extraction

---

## Current State

### Renderer

`frontend/src/renderer/src/pages/Hermes/HermesPage.tsx` currently defines a fixed `PROVIDER_DEFS` array inline and renders providers through `HermesModuleCard`.

Current limitations:

- only a small subset of providers is shown
- provider metadata lives inline in the page component
- model selection is a plain text field
- custom provider is the only path for more advanced endpoint-based setups
- provider cards are visually uniform but semantically shallow
- OAuth/AWS/OpenAI-compatible distinctions are not represented in the UI

### Store / Main Process

`frontend/src/renderer/src/stores/useHermesStore.ts` and `frontend/src/main/services/hermes.service.ts` both use a narrow `HermesConfig.model` shape:

```ts
model: {
  provider: string
  model: string
  apiKey: string
  base_url: string
}
```

This shape is sufficient for basic API-key-based providers but too limited for:

- AWS Bedrock
- OAuth-oriented providers
- routers and compatible endpoints
- provider-specific extra settings
- future dynamic model catalog support

---

## Provider Scope

### Explicitly Visible “Mainstream” Providers

These providers should be shown as first-class cards in the redesigned Providers tab.

#### Hosted

- Anthropic
- OpenAI
- OpenRouter
- xAI
- Gemini API
- AWS Bedrock
- GitHub Copilot
- Ollama Cloud
- DeepSeek
- MiniMax
- Kimi
- Qwen API
- GLM
- Ark

#### OAuth

- Google Gemini OAuth (`google-gemini-cli`)
- Qwen Portal OAuth

#### Self-hosted

- Ollama

### Condensed Compatibility Entrypoints

Instead of listing every official provider individually, the rest of the surface area is represented through:

- `Other Compatible`
- `Custom OpenAI-compatible`

These two entries absorb:

- vLLM
- SGLang
- llama.cpp / llama-server
- LM Studio
- LiteLLM Proxy
- ClawRouter
- Hugging Face-compatible / NIM-like / other endpoint-based integrations
- future provider endpoints that Hermes can reach through OpenAI-compatible transport

This keeps the UI focused on mainstream providers while preserving full escape hatches.

---

## Design

## 1. Providers Tab Information Architecture

The Providers tab becomes a grouped control center instead of a flat set of nearly identical cards.

### Top Intro Block

A compact intro strip above the provider grid explains:

- Hermes supports multiple inference providers
- only one provider is active at a time
- some providers use API keys, some use OAuth, some rely on AWS or local endpoints

This block should be short and purely informational.

### Provider Sections

The grid is split into three sections:

1. `Hosted`
2. `OAuth`
3. `Self-hosted & Compatible`

Each section has a small title and optional note.

### Card Summary State

Collapsed cards show:

- logo / icon
- provider name
- auth badge (`API Key`, `OAuth`, `AWS`, `Local`, `Compatible`)
- one-line description
- model summary (recommended model family or example)
- docs link

### Active Card Expanded State

Only the active provider card expands to show the editable form.

This preserves scanability and avoids the current problem where every card behaves like a cramped mini form.

### Single Active Provider Rule

The UI continues to enforce exactly one active provider. Switching providers replaces the active provider selection instead of enabling multiple cards.

This matches the current Hermes config model and avoids an unnecessary architecture change.

---

## 2. Provider Registry

Provider metadata should be extracted from `HermesPage.tsx` into a dedicated registry file.

### New Renderer Registry Responsibility

A dedicated file should define, per provider:

- `id`
- `group`
- `title`
- `description`
- `authType`
- `docsUrl`
- `defaultModel`
- `recommendedModels`
- `fieldSchema`
- `badgeLabel`
- optional hint text
- whether the provider is mainstream or compatibility-focused

### Why

This keeps `HermesPage.tsx` focused on rendering and interaction rather than acting as a large hardcoded metadata dump.

It also makes future provider additions low-risk and localized.

---

## 3. Config Model Expansion

The renderer/store/service config model should expand beyond the current 4-field provider object.

### Target Shape

```ts
model: {
  provider: string
  model: string
  base_url: string
  authType: 'api_key' | 'oauth' | 'aws' | 'local' | 'compatible'
  apiKey: string
  oauth?: {
    configured?: boolean
    accountLabel?: string
    authMode?: string
  }
  aws?: {
    region?: string
    profile?: string
    accessKeyId?: string
    secretAccessKey?: string
    sessionToken?: string
    bedrockBaseUrl?: string
  }
  headers?: Record<string, string>
  extra?: Record<string, string>
  local?: {
    toolCallParser?: string
    contextWindow?: string
    endpointHint?: string
  }
}
```

This can be adjusted during implementation, but the model must support these capability buckets.

### Design Constraints

- keep backward compatibility with existing saved Hermes config when reading
- do not require every provider to populate every field bucket
- continue to write only the relevant YAML / `.env` entries for the active provider
- avoid fake persistence for fields Hermes cannot actually consume

---

## 4. Persistence Mapping

`frontend/src/main/services/hermes.service.ts` becomes the canonical mapper between UI config and Hermes filesystem config.

### Responsibilities

- read legacy and expanded config shapes
- map the active provider into `config.yaml`
- write provider secrets into `.env`
- preserve unknown YAML keys already present in the Hermes config
- avoid deleting unrelated config sections

### Mapping Expectations

#### API Key Providers

Continue current behavior:

- provider + model + optional base URL in YAML
- API key in `.env`

#### AWS Bedrock

Support UI-side persistence for:

- region
- optional profile
- optional access key / secret / session token
- optional Bedrock base URL override

Do not claim full IAM discovery UX inside the app. The UI should make it clear that standard AWS credential chain is also supported.

#### OAuth Providers

For this iteration, support only configuration metadata / display state, not full auth flows.

Examples:

- auth mode label
- whether configuration appears present
- account label / hint

The UI must not imply that the app completes OAuth if it does not.

#### Compatible / Router Providers

Support:

- base URL
- optional API key
- model
- optional header / extra key-value storage if needed for specific compatible endpoints

---

## 5. Model Selection Experience

The model field should become a guided input instead of a raw freeform text box.

### UX Rules

For mainstream providers, show:

- a recommended model `Select`
- support for manual input / override
- a compact hint describing the provider’s model family

### Recommended Models

This iteration should ship with curated model suggestions, not exhaustive catalogs.

Examples:

- Anthropic: Claude Sonnet / Opus / Haiku family
- OpenAI: GPT-4o / GPT-4.1 / GPT-5 family as appropriate to current product naming used in the repo
- Gemini API: Gemini 2.x family
- xAI: Grok family
- OpenRouter: a few representative routed models
- Chinese providers: 1–3 representative model IDs per provider
- Ollama / Compatible: mostly manual input, with a few examples

### Manual Override

Users must still be able to type any model ID manually.

This protects completeness without making the default UI noisy.

### Future-Proofing

The provider registry may include a flag like `supportsDynamicModels`, but this iteration does not implement remote fetching.

The UI can reserve a small refresh affordance only if it is clearly disabled or omitted until supported.

---

## 6. Mainstream Chinese Provider Handling

The user explicitly wants several Chinese providers visible as mainstream options.

These should be promoted into the main Hosted section:

- DeepSeek
- MiniMax
- Kimi
- Qwen API
- GLM
- Ark

### Important Distinction

`Qwen API` and `Qwen Portal OAuth` must be represented as separate providers with separate cards and separate auth badges.

This prevents a confusing mix of API-key and OAuth setup paths.

---

## 7. Self-hosted and Compatible Strategy

The user does not want every long-tail provider exposed equally.

Therefore:

- `Ollama` remains a first-class visible self-hosted provider
- all other endpoint-driven / router-like integrations collapse into compatibility entries

### `Other Compatible`

A simplified card for users who know they have a Hermes-supported but not explicitly promoted backend.

Fields:

- base URL
- model
- auth type hint
- optional API key
- optional notes / compatibility hint

### `Custom OpenAI-compatible`

Explicit escape hatch for any `/v1/chat/completions`-style endpoint.

Fields:

- base URL
- model
- API key
- optional headers / extras

This provider becomes the preferred fallback for advanced users rather than exploding the visible card count.

---

## 8. UI Components

### Existing Component Reuse

`HermesModuleCard.tsx` can remain the visual base, but it likely needs small enhancements for this redesign:

- richer badge support
- docs link area
- summary metadata row
- better expanded-form composition
- optional inline hint / note blocks

### New Supporting Layer

A provider-specific form builder should be introduced so Hermes does not keep hand-writing every provider form inline inside `HermesPage.tsx`.

This can be lightweight:

- a schema-driven field renderer
- provider registry metadata + renderer helpers

The goal is not abstraction for its own sake, but to prevent the expanded provider matrix from bloating `HermesPage.tsx` further.

---

## 9. Files to Modify

### Main targets

- `frontend/src/renderer/src/pages/Hermes/HermesPage.tsx`
- `frontend/src/renderer/src/pages/Hermes/HermesModuleCard.tsx`
- `frontend/src/renderer/src/stores/useHermesStore.ts`
- `frontend/src/main/services/hermes.service.ts`

### Likely new files

- `frontend/src/renderer/src/pages/Hermes/hermes-provider-registry.ts`
- `frontend/src/renderer/src/pages/Hermes/hermes-provider-form.tsx` or equivalent helper file

### Supporting updates

- `frontend/src/renderer/src/i18n/index.ts`
- any shared provider icon mapping file if new provider logos are introduced there

---

## 10. Error Handling and UX Messaging

The redesigned provider UX should surface setup constraints clearly.

### Required behaviors

- if a provider requires API key setup, the form should state that plainly
- if a provider is only configuration-ready but not login-enabled, the UI should say so
- if AWS is selected, the UI should explain that standard AWS credentials may already work
- if a compatible endpoint is selected, the UI should explain that the server must support Hermes-compatible OpenAI-style chat completions

### Avoid

- fake “connected” status for providers without validation
- implying OAuth completion where no app-managed OAuth exists yet
- vague labels that hide auth differences

---

## 11. Testing Strategy

### Renderer

- verify provider grouping and active-card expansion behavior
- verify switching providers updates the active provider cleanly
- verify recommended model selection and manual override both work
- verify mainstream Chinese providers appear in the Hosted section
- verify Qwen API and Qwen Portal are distinct entries
- verify Other Compatible / Custom OpenAI-compatible remain usable fallback paths

### Store

- verify config patching preserves unrelated config buckets
- verify dirty state is set only on meaningful edits

### Main Process

- verify legacy config still reads successfully
- verify expanded config writes only relevant YAML / env fields
- verify provider switching rewrites provider-specific secret mapping correctly
- verify unknown YAML sections are preserved

---

## 12. Success Criteria

This redesign is successful if:

1. Hermes provider setup is visually closer to OpenClaw quality.
2. The Providers tab clearly distinguishes mainstream, OAuth, and compatible setups.
3. Mainstream Chinese providers are visible as first-class entries.
4. Users get recommended model guidance without losing manual control.
5. The config model is extensible enough that future provider support does not require another major redesign.

---

## Open Questions Resolved

- **Single vs multiple active providers:** single active provider only
- **Model list strategy:** curated recommendations + manual override; no exhaustive first-screen lists
- **Official provider breadth:** mainstream providers visible, long-tail providers condensed into compatibility entries
- **OAuth scope:** configuration-ready only, not full login workflow
