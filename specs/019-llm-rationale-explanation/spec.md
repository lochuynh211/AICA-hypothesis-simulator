# Feature 019 — LLM-generated rationale for the Service & Content proposal panels

**Status:** approved (brainstorm 2026-07-17), implementing.
**Branch context:** built on the current working tree (branch `018-proposal-preset-testcases`); user manages branching/commits.

## 1. Summary

Both proposal panels render, at the bottom of each candidate/item's `ReasonBreakdown`
disclosure, a single **italic natural-language "reason" sentence**
(`pickRationale(rationale, lang)`). Today that sentence is a deterministic template
built inside the algorithm packages (`_build_rationale` / `_build_reasons`) from the
top/bottom feature contributions and a static bilingual label dictionary.

This feature adds an **optional LLM narration layer** that regenerates *only that
sentence*, grounded strictly in the already-computed decision trace. Two interchangeable
providers, chosen by a per-run flag on the setup panel:

- **Backend model** — a small open model (default `qwen2.5:3b`) served locally by
  **Ollama** on the host/Ubuntu box; the FastAPI backend calls it over HTTP (stdlib
  `urllib`, **no new Python dependency**), and the generated sentence is **persisted to
  the run log as an append-only `Explanation` record**.
- **Browser (Gemini Nano)** — Chrome's built-in on-device Prompt API
  (`LanguageModel`), running in the reviewer's own browser. The backend builds the
  **same prompt** (so the Nano-vs-Qwen comparison is apples-to-apples) and returns it;
  the browser runs it locally. **Display-only — not persisted** (cannot be reproduced).

The deterministic scores, ranking, per-feature contribution table, and green/red
supporting/opposing chips are **never touched** — the LLM cannot influence any decision.
It only rewrites the prose gloss. (Constitution Principles I/II/V preserved.)

### Non-goals
- No new `constrained_llm` *selector* package (that would replace scoring; out of scope).
- No change to how services/content are ranked or scored.
- No streaming in v1 (spinner + cache; streaming is a possible follow-up).
- No persistence of the browser/Nano output (accepted trade-off).
- No holistic "why this whole plan" summary (only the existing per-candidate/per-item sentence).

## 2. The flag

A per-run **Explanation source** selector on `WorldPanel` (panel ①, the setup surface):

| value | behavior |
|---|---|
| `off` (default) | current deterministic template — unchanged behavior. |
| `backend` | generate via Ollama server-side; persist as `Explanation`. |
| `browser` | fetch the built prompt, run Chrome Gemini Nano client-side; display-only. |

Session-only state (mirrors `uiLanguage` — no localStorage, per repo convention).

## 3. Generation timing & caching

**On-demand when a candidate/item's breakdown is expanded** (the `<details>` opens),
then cached per `(run_id, step, target_id, provider)`. Runs stay fast; inference happens
only for reasons the reviewer actually reads. Re-expanding serves the cache
(frontend store for the session; backend `Explanation` list for `backend` provider).

## 4. Grounding & safety (the crux for a review tool)

A single **backend-built prompt** is the source of grounding for *both* providers.
It contains only facts already in the persisted trace, never invented data:

- decision kind (`service` selection / `content`(song) selection),
- `trigger_purpose`, `lifecycle_stage`, chosen `candidate_id`/`item_id`, rank/position,
  and `score`/`item_fit`,
- the feature contributions (bilingual label + signed contribution + value), sorted by
  |contribution|, top ~6,
- the `supporting_feature_ids` / `opposing_feature_ids` (as labels).

**System-prompt rules:** explain in **1–2 sentences** using ONLY the given facts; do
**not** invent features, numbers, or preferences; describe *qualitatively* which factors
drove the pick (the exact numbers are already shown in the table); output Japanese and
English. Output format is two prefixed lines `JA: …` / `EN: …`, parsed defensively.
`temperature = 0` for stable, reproducible text.

The rendered sentence is **badged `AI · <model>`**, visually distinct from the numeric
trace. If generation fails/unavailable/times out, we **fall back to the deterministic
template** and show a small "fell back" note — an LLM failure never blocks a decision and
never masquerades as a real generation (mirrors the M4 Maps "graceful degrade + honest
notice" pattern, and the "failures are never disguised" rule).

## 5. Architecture & data flow

```
WorldPanel [Explanation source: off|backend|browser]  ──(store: explanationProvider)
        │
        ▼
Service/Content panel: on <details> expand, if provider≠off and not cached →
        │
        ├─ provider=backend ─▶ POST /api/proposal/runs/{id}/explain {step,target_id,provider:"backend"}
        │        backend: load run → find latest non-error evidence for `step`
        │                → locate candidate/item by target_id → build prompt
        │                → call Ollama (temp 0) → parse [ja,en]
        │                → on OllamaError: fall back to template, mark fell_back
        │                → append Explanation to run log (atomic) → return ExplainResponse
        │
        └─ provider=browser ─▶ POST .../explain {…,provider:"browser"}
                 backend: same build-prompt, **no inference, no persist** →
                          return ExplainResponse{ prompt, rationale:[] , provider_used:"browser" }
                 frontend: LanguageModel.availability() → run prompt in Nano →
                           parse [ja,en] → display; if unavailable → template fallback
```

### 5.1 Backend components

- **`app/api/aica_api/config.py`** — add `@property` readers: `ollama_base_url`
  (default `http://localhost:11434`), `ollama_model` (default `qwen2.5:3b`),
  `ollama_timeout_sec` (default `20`). Plain `os.environ.get`, no pydantic-settings.
- **`app/api/aica_api/services/ollama_client.py`** *(new)* — mirrors `maps_client.py`:
  module-level injectable `_urlopen` seam (PYTEST live-call guard); typed
  `OllamaError(error_type, message)`; `generate(messages, *, model, base_url, timeout)
  -> str` that POSTs to `/api/chat` (`{model, messages, stream:false, options:{temperature:0}}`),
  decodes JSON, returns the assistant text; maps `URLError`/timeout/bad-JSON/HTTP≠200 to
  `OllamaError`. No secrets, no new deps.
- **`app/api/aica_api/models/proposal/explanation.py`** *(new)* — isolated proposal
  model (never imports trigger models):
  - `ExplainMessage{role: Literal["system","user"], content: str}`
  - `ExplanationPrompt{messages: list[ExplainMessage], grounding: dict}`
  - `Explanation{step, target_id, requested_provider, provider_used, model,
     rationale: list[str] (== [ja,en]), fell_back: bool, error: str|None,
     prompt_hash: str, generated_at: str}` — the persisted, append-only record.
- **`app/api/aica_api/services/proposal/explanation_builder.py`** *(new)* — pure,
  fully unit-testable:
  - a merged `FEATURE_LABELS` dict (union of both packages' label maps, keyed by every
    id/leaf string; falls back to the raw `feature_id` when absent),
  - `build_explanation_prompt(step, target_dict, run_context) -> ExplanationPrompt`
    (deterministic; no I/O),
  - `parse_bilingual(text) -> list[str]` returning `[ja, en]` defensively
    (prefix parse → line split → whole-text fallback),
  - `template_rationale(step, target_dict) -> list[str]` — reuses the existing package
    contributions to produce the same-style `[ja, en]` fallback pair (also normalizes
    the content side's variable-length shape into a clean `[ja, en]`).
- **`app/api/aica_api/services/proposal_run_manager.py`** — add
  `append_explanation(run_id, explanation, runs_dir) -> ProposalRunLog` (mirrors
  `append_evidence`); export in `__all__`.
- **`app/api/aica_api/models/proposal/proposal_run.py`** — add
  `explanations: list[Explanation] = Field(default_factory=list)` after `mode`
  (additive/defaulted → old JSON still loads); import `Field` + `Explanation`.
  Re-export `Explanation` in `models/proposal/__init__.py`.
- **`app/api/aica_api/routers/proposal.py`** — append at EOF:
  - `ExplainRequestBody{step: Literal["service","content"], target_id: str,
     provider: Literal["backend","browser"]}`,
  - `ExplainResponse{step, target_id, requested_provider, rationale: list[str],
     provider_used: Literal["backend","browser","template"], model: str,
     fell_back: bool, error: str|None, prompt: ExplanationPrompt}`,
  - `@router.post("/api/proposal/runs/{run_id}/explain") def explain_run(run_id, body)`:
    load run (404), find latest non-error evidence for `body.step` (422 if none),
    locate the candidate/item by `target_id` (422 if missing), build prompt.
    - `provider=browser`: return `ExplainResponse{prompt, rationale:[], provider_used:"browser", model:<nano-hint>}`, no persist.
    - `provider=backend`: call `ollama_client.generate`; on success parse → `[ja,en]`,
      `provider_used="backend"`; on `OllamaError` → `template_rationale`,
      `provider_used="template"`, `fell_back=True`, `error=<type>`.
      Build `Explanation`, `prm.append_explanation(...)`, return `ExplainResponse`.
    - Ollama failure is **not** an HTTP error (mirrors the codebase rule that algorithm
      failures return 200 with a recorded, honest fallback).

### 5.2 Frontend components

- **`app/frontend/src/state/proposalStore.ts`** — add
  `explanationProvider: 'off'|'backend'|'browser'` (default `'off'`),
  `SET_EXPLANATION_PROVIDER` action + reducer case (scalar; no world-mirroring).
- **`app/frontend/src/components/proposal/panels/WorldPanel.tsx`** — a 3-way
  `<select data-testid="explanation-provider-select">` near the Preset section,
  labeled via `t(LABELS.explanationSource, …)`.
- **`app/frontend/src/api/proposalClient.ts`** — types `ExplainMessage`,
  `ExplanationPrompt`, `ExplainResponse`; `explain(runId, {step, targetId, provider})`
  wrapper over `apiFetch`.
- **`app/frontend/src/lib/nano.ts`** *(new)* — thin Chrome Prompt API wrapper:
  `nanoAvailable(): Promise<boolean>` (feature-detect `LanguageModel`/`window.ai`),
  `runNano(messages): Promise<string>` (create session, prompt, return text). All
  guarded so non-Chrome environments (and tests) simply report unavailable.
- **`app/frontend/src/components/proposal/useExplanation.ts`** *(new)* — hook
  `useExplanation(runId, step, targetId, provider, lang)` returning
  `{status:'idle'|'loading'|'ready'|'error', text?, model?, fellBack?, error?, request()}`.
  `request()` (called on first expand) no-ops for `off`; for `backend` calls `explain`
  and uses the returned `rationale`; for `browser` calls `explain` (gets prompt), checks
  `nanoAvailable()`, runs `runNano`, parses `[ja,en]`; caches in a module/store map keyed
  by `(runId,step,targetId,provider)`; any failure → `status:'error'` so the panel shows
  the template with a fell-back note.
- **`app/frontend/src/components/proposal/ReasonBreakdown.tsx`** — add optional prop
  `aiExplanation?: { status; text?; model?; fellBack?; error? } | null` and `onExpand?()`.
  The italic `<p>` becomes: if `aiExplanation?.status==='ready'` → AI text + `AI · model`
  badge (+ "fell back" note if `fellBack`); else the existing `pickRationale(...)`.
  `onExpand` fires on the `<details>` first open. Component stays a pure renderer.
- **`ServiceProposalPanel.tsx` / `ContentProposalPanel.tsx`** — per candidate/item, wire
  `useExplanation(runId, 'service'|'content', id, state.explanationProvider, lang)`;
  pass `aiExplanation` + `onExpand={request}` into `ReasonBreakdown`.

### 5.3 Infra

- **`docker-compose.yml`** — add an `ollama` service under an opt-in `llm` **profile**
  (image `ollama/ollama`, named volume `ollama_models:/root/.ollama`, reachable at
  `http://ollama:11434`); add `OLLAMA_BASE_URL=http://ollama:11434` +
  `OLLAMA_MODEL=qwen2.5:3b` to the `api` service `environment:`. Base `docker compose up`
  stays unchanged (profile is opt-in: `docker compose --profile llm up`). Document the
  one-time `docker compose --profile llm exec ollama ollama pull qwen2.5:3b`.

## 6. Model recommendation (CPU, 8 GB RAM)

Default `qwen2.5:3b` (~1.9 GB Q4; beats Gemini Nano on JA + instruction-following;
~10–20 s/gen on CPU, acceptable under lazy generation). Swappable via `OLLAMA_MODEL`.
Alternatives: `qwen2.5:1.5b` (faster), `gemma2:2b` (Google open cousin), `qwen2.5:7b`
(better but tight on 8 GB).

## 7. Failure & determinism rules

- Provider unavailable / error / timeout → deterministic template + honest "fell back" note.
- `temperature=0` (Ollama) and low/greedy Nano config → stable text (review-tool requirement).
- Backend explanations persisted with `model` + `prompt_hash` + `generated_at` for auditability.
- No secrets/keys involved; nothing new logged or exported beyond the recorded `Explanation`.

## 8. Test plan (TDD)

**Backend (pytest):**
- `explanation_builder`: label merge; prompt contains purpose/chosen id/top contributions/
  supporting-opposing and *no* fabricated fields; `parse_bilingual` prefix/line/fallback
  cases; `template_rationale` yields `[ja,en]` for both service and content shapes.
- `ollama_client`: monkeypatch `_urlopen` — success returns text; URLError/timeout/bad-JSON/
  non-200 → `OllamaError`; POST body shape (`stream:false`, `temperature:0`); live-call guard.
- endpoint: 404 unknown run; 422 unknown step target; `provider=browser` returns prompt +
  empty rationale + no persisted `Explanation`; `provider=backend` (mock generate) persists
  exactly one `Explanation` and returns it; `provider=backend` with `OllamaError` →
  `fell_back=True`, `provider_used="template"`, still persists an honest record.
- `proposal_run_manager.append_explanation`: appends + re-persists; round-trips through
  `get_run`; old JSON without `explanations` still loads (default `[]`).

**Frontend (vitest):**
- store: `SET_EXPLANATION_PROVIDER` reducer + default `off`.
- `proposalClient.explain`: posts correct body/path; parses response.
- `useExplanation`: `off` no-ops; `backend` uses returned rationale (mocked fetch);
  `browser` runs a mocked `LanguageModel` and parses; failure → `error` status; cache hit
  avoids a second call.
- `ReasonBreakdown`: renders AI text + badge when `status:'ready'`; renders template +
  fell-back note otherwise; `onExpand` fires on open.
- `WorldPanel`: selector renders 3 options and dispatches `SET_EXPLANATION_PROVIDER`.

**Verification:** full backend + frontend suites green; `vite build` clean; endpoint
exercised with a stubbed Ollama transport (real Ollama/Nano inference cannot run headless
— that gap is stated, not hidden).

## 9. File change list

New: `services/ollama_client.py`, `models/proposal/explanation.py`,
`services/proposal/explanation_builder.py`, `lib/nano.ts`,
`components/proposal/useExplanation.ts` (+ test files for each).
Edited: `config.py`, `proposal_run.py`, `models/proposal/__init__.py`,
`services/proposal_run_manager.py`, `routers/proposal.py`, `proposalStore.ts`,
`WorldPanel.tsx`, `proposalClient.ts`, `ReasonBreakdown.tsx`,
`ServiceProposalPanel.tsx`, `ContentProposalPanel.tsx`, `docker-compose.yml`.
