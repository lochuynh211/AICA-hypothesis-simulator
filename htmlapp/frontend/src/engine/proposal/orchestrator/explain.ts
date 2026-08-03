/**
 * `explain_from_run_log` orchestrator — TS port of `routers/proposal.py`'s
 * `explain_from_run_log` (2172-2269, 98 LOC), `_generate_explanation`
 * (2104-2171, 68 LOC), and `_find_explain_target` (2068-2086, 19 LOC of
 * code — the brief's "36" counts the function's docstring/blank lines too)
 * — feature 026 (htmlapp Combined export), slice C4a Task 7, the LAST
 * porting task in this slice. This is where C3's explanation layer
 * (`../../explanation/{builder,trigger,service,content}.ts`) finally gets a
 * real caller.
 *
 * ── Step 1: control flow, enumerated before any code below ─────────────────
 *
 * `findExplainTarget` (mirrors `_find_explain_target`) — PURE, no I/O:
 *   1. Scan `runLog.evidence` NEWEST-FIRST for the last entry matching
 *      `step` with `error === null` AND a Python-truthy `output` (an
 *      ALGORITHM_ERROR entry, or one with a `null`/`{}` output, is not a
 *      "decision" and is skipped even if present).
 *   2. If none found: return `{ev: null, target: null}`.
 *   3. Else pick `ranked_candidates`/`candidate_id` (step `"service"`) or
 *      `ordered_items`/`item_id` (anything else — Python's own `if/else`,
 *      not a 3-way switch; this port's scope is `"service"`/`"content"`
 *      only, `"trigger"` is out of scope, see "Scope note" below) out of
 *      `ev.output`, find the first item whose key matches `targetId`
 *      (Python `str()`-coerced — see the `pyStr` note below), return
 *      `{ev, target}` (`target` is `null` if nothing matched).
 *
 * `generateExplanation` (mirrors `_generate_explanation`) — PURE, no I/O:
 *   - `provider === 'browser'`: returns immediately —
 *     `[[], 'browser', 'gemini-nano', false, null]`. Nothing is generated;
 *     the caller hands `prompt` back to the client, which runs Gemini Nano
 *     on-device. BYTE-IDENTICAL to Python's own `provider == "browser"`
 *     early return (`routers/proposal.py:2130-2131`).
 *   - `provider === 'off'`: returns `[templateFn(), 'template', 'template',
 *     false, null]` — see "The `off`/`browser`/`backend` design" below for
 *     why this offline-only value exists and why `fellBack` is `false`
 *     here (never `true`).
 *   - `provider: 'backend'` is NOT a member of this function's own type —
 *     see "The `off`/`browser`/`backend` design" below for why the
 *     capability gap is enforced by the CALLER, not here.
 *
 * `explainFromRunLog` (mirrors `explain_from_run_log`) — ASYNC (persists
 * through `../run_manager.ts`, which itself goes through IndexedDB):
 *   1. `body.provider === 'backend'` → throw
 *      `ExplanationProviderUnsupportedError` IMMEDIATELY — before
 *      `findExplainTarget`, before `buildExplanationPrompt` (a façade
 *      call), before anything. See "The `off`/`browser`/`backend` design".
 *   2. `findExplainTarget(runLog, body.step, body.targetId)` — `ev === null`
 *      → `ProposalHttpError(422, {code: 'no_decision', message: ...})`;
 *      `target === null` → `ProposalHttpError(422, {code: 'unknown_target',
 *      message: ...})`.
 *   3. Build `context` — `trigger_purpose`/`lifecycle_stage` off
 *      `ev.input_snapshot` always; `step === 'content'` additionally adds
 *      `song_name`/`song_artist`/`oshi_artist` via `../context.ts`'s
 *      already-ported `resolveSongName`/`resolveSongArtist`/
 *      `resolveOshiArtist` (Task 2 — reused verbatim, not reimplemented).
 *   4. `buildExplanationPrompt(step, target, context)` (façade call, C3) +
 *      `promptHash(prompt)` (`../../explanation/builder.ts`, added by THIS
 *      task — see that function's own doc comment).
 *   5. `body.provider === 'browser'`: call `generateExplanation(prompt,
 *      'browser', ...)`, return the response IMMEDIATELY — no persistence,
 *      matching Python's own early return BEFORE its "Backend (Ollama)"
 *      block.
 *   6. Else (`body.provider === 'off'`, the only remaining value): mint
 *      `generatedAt = nowIso()`, call `generateExplanation(prompt, 'off',
 *      ...)`; if `persistRunId !== null`, build an `Explanation` and
 *      `appendExplanation(persistRunId, explanation)` (mirrors Python's
 *      `if persist_run_id is not None: ... prm.append_explanation(...)`);
 *      return the response.
 *
 * Scope note: `body.step` is `'service' | 'content'` ONLY — Python's own
 * `ExplainRequestBody.step` additionally accepts `"trigger"`, but
 * `explain_from_run_log`/`_find_explain_target` NEVER handle it (the
 * docstring on `ExplainRequestBody` in Python says so explicitly: trigger
 * "has no run-id/target-id lookup of its own — it never reaches
 * `explain_from_run_log`", routed instead through a DIFFERENT function,
 * `routers/merged_runs.py::explain_trigger_endpoint`, out of THIS task's
 * file/reference-function list). Typing `step` narrower here than Python's
 * full three-way union is a faithful mirror of what this port's own scope
 * can actually reach, not an accidental omission.
 *
 * ── The `off`/`browser`/`backend` design (Step 2 of the brief) ─────────────
 *
 * C3 Task 4 dropped the Ollama-backed `provider: "backend"` path — the
 * offline build has no server to attempt it against at all — and SPECIFIED
 * (but deliberately did not code, having no caller yet) the exact contract:
 * `.superpowers/sdd/2026-08-01-htmlapp-combined-c3-explanation/
 * task-4-report.md`, "Step 2 — the `backend` provider decision". This task
 * is that contract's first (and, per that report, intended) caller —
 * implemented verbatim, not redesigned:
 *
 *   - `'backend'` → `ExplanationProviderUnsupportedError` thrown
 *     (`../../../api/errors.ts`), BEFORE any façade function call — never a
 *     successful response silently carrying template text under a
 *     `'backend'` label. This is enforced in `explainFromRunLog` itself
 *     (NOT inside `generateExplanation`, whose own type signature is
 *     `'off' | 'browser'` — deliberately excluding `'backend'` entirely, a
 *     COMPILE-TIME guarantee that any future caller of the shared machinery
 *     must perform its own gate first, exactly the pattern the C3 report's
 *     own closing note anticipates: "C4 Task 8 needs to actually create
 *     `ExplanationProviderUnsupportedError`... it IS new code that task
 *     must write and test" — i.e. each call site owns its own check, this
 *     one is the reference implementation to mirror).
 *   - `'browser'` → mirrors Python's `provider == "browser"` branch
 *     BYTE-FOR-BYTE: real, reachable Python behavior, real parity target
 *     (`__fixtures__/parity/proposal_explain.json`).
 *   - `'off'` is a THIRD value with NO Python equivalent — Python's
 *     `ExplainRequestBody.provider` literal is only ever `"backend"` /
 *     `"browser"`. It is not a renamed `'backend'`: it does not attempt
 *     anything and cannot fail. Per the C3 report's own proposed error
 *     message text (`'... use "browser" ... or "off" (deterministic
 *     template) instead.'`), `'off'` means exactly that — the deterministic
 *     template, requested on purpose, never a fallback. Concretely:
 *       - `providerUsed: 'template'` — an HONEST label for what text is
 *         shown (Python's own model already treats `'template'` as a
 *         legitimate `provider_used` value, just normally reached only
 *         after a real Ollama failure).
 *       - `fellBack: false` — nothing "fell back": no attempt was made
 *         that could fail, so there is nothing to have fallen back FROM.
 *         Setting this `true` (as a genuine Ollama-outage capture would
 *         show) was considered and rejected: it would misrepresent a
 *         deliberate, honest choice as an unexpected failure — the exact
 *         inverse of the `'backend'`-lying-as-success failure mode this
 *         whole design avoids, but still a misattribution of WHY the text
 *         is template text.
 *       - `error: null` — no error occurred; none was attempted.
 *     `'off'` takes over `'backend'`'s STRUCTURAL role in the control flow
 *     (the non-`'browser'` branch that mints `generatedAt` and persists) —
 *     this is why `explainFromRunLog`'s own dispatch is a clean two-way
 *     `provider === 'browser' ? ... : ...` after the `'backend'` guard,
 *     the SAME two-way shape `_generate_explanation`'s Python signature has
 *     (`Literal["backend", "browser"]`, just with the non-browser member
 *     renamed and its internal behavior collapsed to what Python's OWN
 *     `if rationale is None: rationale = template_fn()` fallback produces
 *     when the (here, entirely unported) Ollama ladder never runs).
 *
 * The ENTIRE Ollama-attempt ladder (`_EXPLAIN_ATTEMPT_OPTIONS`, the
 * `for _opts in ...` loop, `ollama_client.generate`,
 * `parse_bilingual`/`response_is_usable`/`strip_placeholder_artifacts`
 * re-verification inside the loop, `routers/proposal.py:2139-2166`) has NO
 * TS port at all — not narrowed, not stubbed, simply absent. It can never
 * execute in a build with no Ollama client (none exists anywhere under
 * `src/` — confirmed: `grep -rln ollama src/ --include='*.ts' -i` matches
 * nothing outside this doc comment), so porting its internal retry/re-roll
 * branches would be dead, untestable code. What IS ported is the
 * OBSERVABLE shape at the ladder's own two exit doors: immediate return for
 * `'browser'`, and — for the non-browser case — exactly what Python
 * produces when the ladder is bypassed entirely: `rationale = template_fn()`
 * with the loop's OWN pre-loop-declared defaults never overwritten
 * (`provider_used = "template"`, `model = "template"`, `fell_back = True`,
 * `error = None` — Python's own initial values at lines 2134-2137, BEFORE
 * the loop runs). The one deliberate divergence from those Python DEFAULTS
 * is `fell_back`: Python's `True` default describes "the loop ran and
 * failed" (even on attempt 0's very first exception) — `'off'` never runs
 * the loop, so `false` is the honest value for THIS reachable path, not a
 * copy of Python's pre-loop placeholder. See the design note above.
 *
 * ── `dict.get(key, default)` / `or` / truthiness audit (per-site) ──────────
 *
 * `grep -c '\.get('` over `routers/proposal.py`'s lines 2068-2269 (this
 * port's full Python scope): 5 sites, all accounted for individually —
 *   1. `ev.output.get("ranked_candidates", []) or []` — TWO-ARG `.get`
 *      WITH a default, THEN `or` — a compound of the first AND second named
 *      idioms (`pyGetDefault(...)` fed into `pyOr(..., [])`), not a single
 *      one. Net effect: absent → `[]`; present-and-falsy (`null`/`[]`) →
 *      `[]`; present-and-truthy → passed through.
 *   2. `ev.output.get("ordered_items", []) or []` — same compound pattern,
 *      the `"content"`-step sibling of (1).
 *   3. `it.get(key)` (inside `str(it.get(key))`) — ONE-ARG `.get`, no `or`
 *      following — Python's implicit `None` default, mirrored as
 *      `pyGetDefault(it, key, null)`, then wrapped in `pyStr` (see below;
 *      NOT one of the three named idioms — no truthiness/`or` involved at
 *      all, just an explicit-default `.get`).
 *   4. `ev.input_snapshot.get("trigger_purpose")` — same one-arg-no-`or`
 *      shape as (3): `pyGetDefault(ev.input_snapshot, 'trigger_purpose',
 *      null)`.
 *   5. `ev.input_snapshot.get("lifecycle_stage")` — same shape as (4).
 * The THIRD named idiom (`if x:` truthiness) appears ONCE, NOT via `.get`
 * at all: the generator condition `e.step == step and e.error is None and
 * e.output` — the bare `and e.output` is `pyTruthy(e.output)` (a present
 * `{}`/`null` output must NOT count as a decision, matching Python's own
 * dict/`None` falsiness — this is exactly the class of bug this program's
 * own retrospective warns about, "Collapsing the third into a
 * `.length > 0` check caused a latent `TypeError` crash two tasks ago").
 * `e.error is None` (direct identity-with-`None`, not `.get`/truthiness at
 * all) is mirrored as plain `e.error === null` — `AlgorithmEvidence.error`
 * is already typed `EvidenceError | null` in this port (`../selector.ts`),
 * so no coercion is needed either way.
 *
 * `pyStr` mirrors `str()` on a value that may be Python `None` —
 * `str(None) == "None"` (four ASCII characters), NOT `String(undefined) ==
 * "undefined"` — needed at site (3) above since a malformed/synthetic
 * candidate/item dict could genuinely lack `candidate_id`/`item_id` (real
 * data from the two ported selector packages always has it — both fields
 * are non-optional `str` on `RankedCandidate`/`OrderedItem`, per
 * `models/proposal/selector_input.py:68` /
 * `models/proposal/content_output.py:100,163,180` — so this is defensive
 * correctness on malformed input, not a reachable branch with real
 * package output). A per-module copy, not imported — same established
 * convention `service.ts`/`content.ts` (C3) already use for their own
 * `pyStr` (see either file's own doc comment on why `str(None) == "None"`
 * would otherwise silently read as `"undefined"`).
 *
 * ── Hazard 8 (`isinstance(x, (int, float))` accepting `bool`) ──────────────
 *
 * `awk 'NR==2068,NR==2269' routers/proposal.py | grep -c isinstance` → `0`.
 * `awk 'NR==718,NR==724' services/explanation_builder.py | grep -c
 * isinstance` (the `prompt_hash` scope, ported into `../../explanation/
 * builder.ts`) → also `0`. N/A for this entire task — no numeric/bool
 * ambiguity anywhere in scope (every value handled here is a string, a
 * dict/list, or `None`).
 *
 * ── Hazards 1/3/5/6/7 (banker's rounding / float repr / Neumaier `sum()` /
 * `:.Nf`) ───────────────────────────────────────────────────────────────
 *
 * All N/A — this task's scope has zero numeric fields of its own (`context`
 * carries only strings/`None`; `promptHash`'s own doc comment covers its
 * ONE genuinely new hazard, the `json.dumps` separator, which is hazard-4
 * adjacent, not 1/3/5/6/7). No `round()`, no bare-float f-string
 * interpolation, no `sum()`, no `:.Nf` format spec anywhere in the ported
 * Python.
 *
 * ── Error-shape mirroring ───────────────────────────────────────────────
 *
 * Every `raise HTTPException(422, detail={...})` site becomes `throw new
 * ProposalHttpError(422, detail)`, reusing (not reinventing) the SAME
 * `ProposalHttpDetail` union `create_run.ts`/`select_service.ts`/
 * `recompute.ts`/`journey_action.ts` already widened four times — see that
 * file's own module doc, "WIDENED A FOURTH AND FIFTH TIME" for the two new
 * members this task adds (`NoDecisionDetail`/`UnknownTargetDetail`). The
 * ONE Python-less error (`'backend'` requested) is `Explanation
 * ProviderUnsupportedError` (`../../../api/errors.ts`) — deliberately NOT a
 * `ProposalHttpError`, see that class's own doc comment for why.
 */
import {
  buildExplanationPrompt,
  templateRationale,
  promptHash,
  type ExplanationPrompt,
  type ExplanationTarget,
  type ExplanationContext,
} from '../../explanation/builder'
import { resolveSongName, resolveSongArtist, resolveOshiArtist } from './context'
import { nowIso } from './context_base'
import { ProposalHttpError, type NoDecisionDetail, type UnknownTargetDetail } from './create_run'
import { ExplanationProviderUnsupportedError } from '../../../api/errors'
import { pyReprQuoteOne } from '../py_repr'
import { appendExplanation, type ProposalRunLog, type Explanation } from '../run_manager'
import type { AlgorithmEvidence } from '../selector'

// ---------------------------------------------------------------------------
// Small Python-mirroring local helpers — per-module-copy convention (see
// create_run.ts's own module doc for why each module keeps its own copy
// rather than importing one; `pyReprQuoteOne` is the ONE deliberately
// shared exception, see py_repr.ts's own doc).
// ---------------------------------------------------------------------------

/** Mirrors Python's `dict.get(key, default)` — `default` only when `key` is
 * ABSENT; a present `null`/`undefined` value passes through unchanged. */
function pyGetDefault(obj: Record<string, unknown>, key: string, def: unknown): unknown {
  return Object.prototype.hasOwnProperty.call(obj, key) ? obj[key] : def
}

/** Mirrors Python truthiness for `if x:` / `x or default`. */
function pyTruthy(value: unknown): boolean {
  if (value == null) return false
  if (Array.isArray(value)) return value.length > 0
  if (typeof value === 'object') return Object.keys(value as object).length > 0
  return Boolean(value)
}

/** Mirrors Python's `x or default`. */
function pyOr(value: unknown, fallback: unknown): unknown {
  return pyTruthy(value) ? value : fallback
}

/** Mirrors `str()` on a value that may be Python `None` — `str(None) ==
 * "None"`, NOT `String(undefined) == "undefined"`. Per-module copy — see
 * this file's own module doc ("`pyStr` mirrors...") for why this is needed
 * at all and why it is not a hazard-8 site. */
function pyStr(v: unknown): string {
  if (v === null || v === undefined) return 'None'
  if (typeof v === 'boolean') return v ? 'True' : 'False'
  return String(v)
}

// ---------------------------------------------------------------------------
// _find_explain_target -> findExplainTarget (routers/proposal.py:2068-2086)
// ---------------------------------------------------------------------------

/** This port's own scope — `"trigger"` never reaches this function in
 * Python either, see the module doc's "Scope note". */
export type ExplainStep = 'service' | 'content'

/**
 * Locate the latest non-error evidence for `step` and the candidate/item
 * matching `targetId` within its recorded output (append-only, newest
 * wins). Mirrors `_find_explain_target` exactly — see the module doc's
 * control-flow enumeration and `.get`/truthiness audit.
 */
export function findExplainTarget(
  runLog: ProposalRunLog,
  step: ExplainStep,
  targetId: string,
): { ev: AlgorithmEvidence | null; target: ExplanationTarget | null } {
  let ev: AlgorithmEvidence | null = null
  for (let i = runLog.evidence.length - 1; i >= 0; i--) {
    const e = runLog.evidence[i]
    if (e.step === step && e.error === null && pyTruthy(e.output)) {
      ev = e
      break
    }
  }
  if (ev === null) return { ev: null, target: null }

  const output = ev.output as Record<string, unknown>
  let items: unknown[]
  let key: string
  if (step === 'service') {
    items = pyOr(pyGetDefault(output, 'ranked_candidates', []), []) as unknown[]
    key = 'candidate_id'
  } else {
    items = pyOr(pyGetDefault(output, 'ordered_items', []), []) as unknown[]
    key = 'item_id'
  }
  const found = items.find(
    (it) => pyStr(pyGetDefault(it as Record<string, unknown>, key, null)) === targetId,
  ) as ExplanationTarget | undefined
  return { ev, target: found ?? null }
}

// ---------------------------------------------------------------------------
// _generate_explanation -> generateExplanation (routers/proposal.py:2104-2171)
// ---------------------------------------------------------------------------

/**
 * Shared generate-or-fall-back machinery — mirrors `_generate_explanation`.
 * See the module doc's "The `off`/`browser`/`backend` design" for why this
 * function's own `provider` type is `'off' | 'browser'` (never `'backend'`
 * — that capability gap is enforced by the CALLER) and why the Ollama
 * ladder itself has no port.
 *
 * Returns `[rationale, providerUsed, model, fellBack, error]` — the same
 * 5-tuple shape Python returns (`tuple[list[str], Literal[...], str, bool,
 * str | None]`).
 */
export function generateExplanation(
  // Kept in the signature for fidelity with Python's own
  // `_generate_explanation(prompt, provider, template_fn)` — genuinely
  // unused here because the Ollama ladder that would consume it (building
  // `messages` for `ollama_client.generate`) has no TS port at all, see
  // the module doc's "off/browser/backend design". Prefixed `_` so
  // `noUnusedParameters` doesn't flag an intentional, documented gap.
  _prompt: ExplanationPrompt,
  provider: 'off' | 'browser',
  templateFn: () => [string, string],
): [rationale: string[], providerUsed: 'browser' | 'template', model: string, fellBack: boolean, error: string | null] {
  if (provider === 'browser') {
    return [[], 'browser', 'gemini-nano', false, null]
  }
  // provider === 'off' — the Ollama ladder never runs offline; this is
  // exactly what Python produces when the (unported) loop is bypassed —
  // `rationale = template_fn()` — MINUS the `fell_back: true` Python's own
  // pre-loop placeholder would carry (see module doc's design note: `off`
  // is a deliberate choice, not an unattempted-then-failed generation).
  return [templateFn(), 'template', 'template', false, null]
}

// ---------------------------------------------------------------------------
// explain_from_run_log -> explainFromRunLog (routers/proposal.py:2172-2269)
// ---------------------------------------------------------------------------

/** Mirrors `ExplainRequestBody` (routers/proposal.py:1950-1962), narrowed
 * to this port's own `step`/`provider` scope — see the module doc's "Scope
 * note" and "The `off`/`browser`/`backend` design". */
export type ExplainRequestBody = {
  step: ExplainStep
  target_id: string
  provider: 'off' | 'browser' | 'backend'
}

/** Mirrors `ExplainResponse` (routers/proposal.py:1965-1979), narrowed the
 * same way `ExplainRequestBody` is. `requested_provider`/`provider_used`
 * exclude `'backend'`/`'template'`-as-requested and `'trigger'`-only
 * `"template"`-as-requested-provider respectively — see the module doc. */
export type ExplainResponse = {
  step: ExplainStep
  target_id: string
  requested_provider: 'off' | 'browser'
  rationale: string[]
  provider_used: 'browser' | 'template'
  model: string
  fell_back: boolean
  error: string | null
  prompt: ExplanationPrompt
}

/**
 * Port of `explain_from_run_log` (routers/proposal.py:2172-2269). See the
 * module doc for the full control-flow enumeration and the `off`/
 * `browser`/`backend` design this task's own brief calls out as landing
 * here.
 *
 * `persistRunId`: the on-disk run id to append the generated `'off'`
 * explanation to; `null` skips persistence — mirrors Python's identical
 * `persist_run_id: str | None` parameter, used by the Combined Simulator's
 * inline explain over an ephemeral, never-persisted projection (out of
 * THIS task's own scope to wire a caller for — `explain_run`, the
 * `@router.post` HTTP-handler-equivalent wrapper, is explicitly NOT ported,
 * per the brief's "Port function bodies, not HTTP handlers").
 *
 * @throws ExplanationProviderUnsupportedError — `body.provider === 'backend'`.
 * @throws ProposalHttpError(422, NoDecisionDetail) — no matching evidence.
 * @throws ProposalHttpError(422, UnknownTargetDetail) — evidence exists but
 *   no candidate/item matches `body.target_id`.
 */
export async function explainFromRunLog(
  runLog: ProposalRunLog,
  body: ExplainRequestBody,
  persistRunId: string | null,
): Promise<ExplainResponse> {
  if (body.provider === 'backend') {
    throw new ExplanationProviderUnsupportedError()
  }

  const { ev, target } = findExplainTarget(runLog, body.step, body.target_id)
  if (ev === null) {
    const detail: NoDecisionDetail = {
      code: 'no_decision',
      message: `No ${body.step} decision recorded for this run`,
    }
    throw new ProposalHttpError(422, detail)
  }
  if (target === null) {
    const detail: UnknownTargetDetail = {
      code: 'unknown_target',
      message: `${body.step} target ${pyReprQuoteOne(body.target_id)} not found in the recorded decision`,
    }
    throw new ProposalHttpError(422, detail)
  }

  const inputSnapshot = ev.input_snapshot as Record<string, unknown>
  const context: ExplanationContext = {
    trigger_purpose: pyGetDefault(inputSnapshot, 'trigger_purpose', null),
    lifecycle_stage: pyGetDefault(inputSnapshot, 'lifecycle_stage', null),
  }
  // feature 019 (Maximal grounding) / feature 022 (causal explanation
  // enrichment) — best-effort song/artist facts, content step only. Reuses
  // Task 2's already-ported resolvers verbatim (see ../context.ts).
  if (body.step === 'content') {
    context.song_name = resolveSongName(runLog, body.target_id)
    context.song_artist = resolveSongArtist(runLog, body.target_id)
    context.oshi_artist = resolveOshiArtist(runLog)
  }

  const prompt = buildExplanationPrompt(body.step, target, context)
  const pHash = promptHash(prompt)

  // ── Browser (Gemini Nano) — build-only, no inference, no persistence ────
  if (body.provider === 'browser') {
    const [rationale, providerUsed, model, fellBack, error] = generateExplanation(
      prompt,
      'browser',
      () => templateRationale(body.step, target),
    )
    return {
      step: body.step,
      target_id: body.target_id,
      requested_provider: 'browser',
      rationale,
      provider_used: providerUsed,
      model,
      fell_back: fellBack,
      error,
      prompt,
    }
  }

  // ── Off (deterministic template) — the offline-only, honest, non-Ollama
  // branch that takes over Python's "Backend (Ollama)" branch's STRUCTURAL
  // role: mints generatedAt, persists when persistRunId is set. ──────────
  const generatedAt = nowIso()
  const [rationale, providerUsed, model, fellBack, error] = generateExplanation(
    prompt,
    'off',
    () => templateRationale(body.step, target),
  )

  if (persistRunId !== null) {
    const explanation: Explanation = {
      step: body.step,
      target_id: body.target_id,
      requested_provider: 'off',
      provider_used: providerUsed,
      model,
      rationale,
      fell_back: fellBack,
      error,
      prompt_hash: pHash,
      generated_at: generatedAt,
    }
    await appendExplanation(persistRunId, explanation)
  }

  return {
    step: body.step,
    target_id: body.target_id,
    requested_provider: 'off',
    rationale,
    provider_used: providerUsed,
    model,
    fell_back: fellBack,
    error,
    prompt,
  }
}
