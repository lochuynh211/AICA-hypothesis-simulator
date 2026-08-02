import type { ValidationError } from './types'

/**
 * Thrown by createRunPlan/regenerateRunPlan on any router-equivalent 400/404.
 * htmlapp-only: the docker app's api/types.ts has no RunPlanError, so it must
 * live outside the sync-overwritten types.ts (see sync-from-app.mjs FILES).
 */
export class RunPlanError extends Error {
  readonly validationErrors: ValidationError[]
  constructor(detail: string, validationErrors: ValidationError[] = []) {
    super(detail)
    this.name = 'RunPlanError'
    this.validationErrors = validationErrors
  }
}

/**
 * Thrown by `explain.ts#generateExplanation` (and any future caller of that
 * shared machinery, e.g. a `merged.explainTrigger`-equivalent) when a
 * request names `provider: "backend"` — feature 026 (htmlapp Combined
 * export), slice C4a Task 7.
 *
 * htmlapp-only, same reason `RunPlanError` lives here rather than
 * `./types.ts`: the docker app has no such error (it genuinely runs
 * Ollama), so this must live outside the sync-overwritten `types.ts`.
 *
 * This is the EXACT shape C3 Task 4 specified but deliberately did not code
 * (`.superpowers/sdd/2026-08-01-htmlapp-combined-c3-explanation/
 * task-4-report.md`, "Step 2 — the `backend` provider decision"): the
 * offline build has no Ollama server to attempt AT ALL, so unlike a genuine
 * Ollama outage (which Python honestly retries then falls back to the
 * template, `provider_used="template"`, `fell_back=True`), there is no
 * "try, then honestly fall back" path available here — attempting one would
 * be an immediate, deterministic, silent lie (`provider_used="backend"`
 * claimed with template text, or a mislabeled fallback). A caller asking
 * for `"backend"` gets this thrown BEFORE any façade function
 * (`buildExplanationPrompt`/`templateRationale`) is ever called, never a
 * successful response carrying `provider_used: "template"`/`fell_back:
 * true` — that would misreport a capability gap as a normal fallback event.
 */
export class ExplanationProviderUnsupportedError extends Error {
  readonly provider = 'backend'
  constructor() {
    super(
      'The "backend" (Ollama) explanation provider is not available in the offline build; use "browser" (on-device Gemini Nano) or "off" (deterministic template) instead.',
    )
    this.name = 'ExplanationProviderUnsupportedError'
  }
}
