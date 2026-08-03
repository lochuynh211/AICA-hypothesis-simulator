/**
 * Merged-run explanation endpoints — TS port of `routers/merged_runs.py`'s
 * `merged_explain_endpoint` (553-600) and `explain_trigger_endpoint`
 * (600-681) — feature 026 (htmlapp Combined export), slice C4 Task 8.
 *
 * Both endpoints port the endpoint BODY as a plain function; HTTP framing
 * (status codes, `@router.post`, FastAPI `Depends`) is Task 9's job, not
 * this file's.
 *
 * ── Step 1: control flow, enumerated before any code below ─────────────────
 *
 * `mergedExplainEndpoint(body)` (mirrors `merged_explain_endpoint`) — for the
 * Combined Simulator's EPHEMERAL projected proposals (the quickview fire /
 * after-nap projection built with `cache={}`, never written to
 * `proposal_runs/`, so the run-id-addressed explain endpoint would 404): the
 * caller posts the FULL `ProposalRunLog` back inline instead of a run id.
 *   1. `ProposalRunLog.model_validate(body.proposal)` + construct
 *      `ExplainRequestBody(step=body.step, target_id=body.target_id,
 *      provider=body.provider)` — BOTH in one `try`; a `ValidationError`
 *      from EITHER becomes `HTTPException(422, detail=str(exc))`.
 *   2. `explain_from_run_log(run_log, explain_body, persist_run_id=None)` —
 *      already ported (C4a Task 7, `../proposal/orchestrator/explain.ts`);
 *      this endpoint is its first caller in THIS task's scope (the other
 *      caller, the run-id-addressed sibling endpoint, is out of the C4
 *      merged-run file list).
 *
 * `explainTriggerEndpoint(body)` (mirrors `explain_trigger_endpoint`) — for
 * the trigger rank-1 decision's rationale, grounded in a fire's OWN
 * recorded `feature_contributions`/`criteria` (no persisted `ProposalRunLog`
 * to read a target out of — see `../explanation/trigger.ts`'s own module
 * doc). Nothing is EVER persisted here (no run-id to append an
 * `Explanation` record to, matching `mergedExplainEndpoint`'s own
 * `persist_run_id=None`).
 *   1. `FirePoint.model_validate(body.fire)` — `ValidationError` ->
 *      `HTTPException(422, detail=str(exc))`.
 *   2. `chains = fire.get("feature_contributions") or {}`; explicit
 *      `body.category` not `None` and not a key of `chains` ->
 *      `HTTPException(422, {"code": "unknown_target", "message": ...})`.
 *   3. `category = resolve_category(fire, body.category)`;
 *      `target = build_target(fire, category)` — both already ported
 *      (`../explanation/trigger.ts`, C3 Task 2).
 *   4. `prompt = build_explanation_prompt("trigger", target, {})` — built
 *      for EVERY provider (cheap, pure — no reason to skip it for
 *      `"template"`).
 *   5. `body.provider == "template"` (feature 025 S11 — TRIGGER-ONLY, no
 *      Ollama call at all): `rationale = template_rationale("trigger",
 *      target)` directly, `provider_used="template"`, `fell_back=False`,
 *      `error=None` — an HONEST "asked for the template", not a fallback.
 *   6. Else: `_generate_explanation(prompt, body.provider, lambda:
 *      template_rationale(...))` (shared machinery, `../proposal/
 *      orchestrator/explain.ts#generateExplanation`).
 *
 * ── Step 3: the LLM provider gap — mirrored, not rebuilt ───────────────────
 *
 * Per `.superpowers/sdd/2026-08-01-htmlapp-combined-c3-explanation/
 * task-4-report.md`'s "Step 2 — the `backend` provider decision" (which C4a
 * Task 7's `explainFromRunLog` already implements as the reference
 * caller — see that file's own module doc, "The `off`/`browser`/`backend`
 * design"): a request naming `provider: "backend"` gets
 * `ExplanationProviderUnsupportedError` (`../../api/errors.ts`, already
 * built by C4a Task 7) thrown BEFORE any façade function runs — never a
 * successful response silently carrying template text under a `"backend"`
 * label.
 *
 * `mergedExplainEndpoint` needs no gate of its own: it is a THIN wrapper
 * around `explainFromRunLog`, which already gates `body.provider ===
 * 'backend'` at its own top (before `findExplainTarget`, before
 * `buildExplanationPrompt`) — duplicating the check here would just be a
 * second, redundant gate on the same field. This DOES mean
 * `mergedExplainEndpoint`'s OWN shape checks (`validateProposalRunLogShape`/
 * the `step`/`provider` literal checks) run BEFORE the backend gate fires —
 * a malformed `body.proposal` 422s even when `provider === 'backend'` too.
 * This is deliberate, not an inconsistency with `explainTriggerEndpoint`'s
 * own "gate before everything" choice below: validating the WIRE BODY's own
 * shape is request-parsing, the same layer Python's FastAPI/pydantic
 * validates at for EVERY endpoint before any endpoint-specific logic runs
 * (including, in real Python, before any Ollama attempt too) — it is not
 * "façade work" the capability-gap design is protecting against.
 * `explainTriggerEndpoint`'s `FirePoint` validation, by contrast, has no
 * equivalent already-separate pydantic-construction step to defer to (it is
 * this function's OWN first real step), so gating `'backend'` ahead of it
 * was a free choice, not a forced one — resolved toward matching
 * `explainFromRunLog`'s literal ordering for consistency across this
 * slice's two call sites.
 *
 * `explainTriggerEndpoint` has NO shared machinery to delegate the gate to
 * (`_generate_explanation`'s own TS port, `generateExplanation`, has a
 * COMPILE-TIME `'off' | 'browser'` signature that simply cannot express
 * `'backend'` — see that function's own doc comment) — so THIS function
 * gates it directly, at its own very top, before `FirePoint` validation,
 * before `resolveCategory`/`buildTarget`, before everything. Mirrors
 * `explainFromRunLog`'s own established ordering (reject before ANY other
 * work) for consistency across this slice's two `ExplanationProvider
 * UnsupportedError` call sites, not Python's per-endpoint literal order —
 * Python has NO such check at all in either endpoint (its own Ollama is
 * real), so there is no Python ordering to mirror here; this is an
 * offline-only, this-port's-own design choice. Matches C4a Task 7's own
 * capture docstring precedent ("an offline `backend` request is rejected
 * before any Python-comparable work happens" — `proposal_explain.json`'s
 * own `_capture_proposal_explain` docstring) — no golden fixture targets
 * this branch; it is unit-tested directly instead.
 *
 * `explainTriggerEndpoint`'s OWN `provider` literal stays Python's EXACT
 * 3-way set (`'backend' | 'browser' | 'template'`) — UNLIKE
 * `explainFromRunLog`'s wire contract, which C4a Task 7 deliberately WIDENED
 * with a THIRD, Python-less `'off'` value (the only way an offline caller
 * ever reaches the deterministic template for the service/content steps).
 * Trigger does not need an analogous widening: real Python's OWN
 * `"template"` literal (feature 025 S11) already IS "the deterministic
 * sentence, honestly requested, not a fallback" — exactly what `'off'`
 * would mean if invented here — so adding a redundant `'off'` alias would
 * be unnecessary scope creep, not a capability gap. `mergedExplainEndpoint`'s
 * OWN `provider` field, by contrast, IS widened to `'off' | 'browser' |
 * 'backend'` (mirroring `explainFromRunLog`'s own contract exactly, since
 * that is ALL it ever forwards to) — Python's real `MergedExplainBody`
 * wire literal is only `Literal["backend", "browser"]`
 * (`ExplainRequestBody.provider`, routers/proposal.py:1962), so this is a
 * disclosed, deliberate widening for the SAME reason C4a Task 7's own was:
 * there is no other wire-reachable way for an offline caller to request the
 * template for the service/content steps.
 *
 * ── `dict.get(key, default)` / `or` / truthiness audit (per-site) ──────────
 *
 * `grep -n '\.get(' routers/merged_runs.py` restricted to this task's two
 * ported spans (553-600, 600-681):
 *   1. `fire.get("feature_contributions")` (`explain_trigger_endpoint`,
 *      line 622) — ONE-ARG `.get` (implicit `None` default) THEN `or {}` —
 *      idiom 2 (`.get(key)` then `or`), mirrored `pyOr(pyGetDefault(fire,
 *      'feature_contributions', null), {})`. In practice inert here (this
 *      function's OWN `validateFirePointShape` already fills
 *      `feature_contributions` with `{}` when absent, mirroring pydantic's
 *      own default-fill on a successful `model_validate`) — kept anyway for
 *      hazard-audit fidelity and because a directly-constructed `TriggerFire`
 *      (not run through the validator) could still omit it.
 * No other `.get(` call in either span (confirmed: `sed -n '553,600p;600,
 * 681p' routers/merged_runs.py | grep -c '\.get('` → 1). The THIRD named
 * idiom (bare `if x:` truthiness) appears ZERO times in either span (no
 * bare-condition-on-a-dict/list anywhere in this task's own two functions).
 *
 * ── Hazard 8 (`isinstance(x, (int, float))` accepting `bool`) ──────────────
 *
 * `sed -n '553,600p;600,681p' routers/merged_runs.py | grep -c isinstance`
 * → `0`. N/A for this task's own two functions — no numeric/bool ambiguity
 * anywhere in scope (every value handled here is a string, a dict/list, or
 * `None`; `FirePoint.tick`/`time_min` are read-and-forwarded, never
 * branched on by TYPE here).
 *
 * ── Hazards 1/2/3/4/5/6/7 ───────────────────────────────────────────────
 *
 * All N/A for this task's own two functions (no `round()`, no `//`/`%`, no
 * `sorted()`/`sum()`, no bare-float f-string interpolation, no `:.Nf`
 * format spec anywhere in the ported Python spans). Hazard 4 (dict/
 * insertion order) is N/A here specifically — this file introduces no
 * ordering-sensitive iteration/tie-break of its own (the ONE such site in
 * this task's overall scope, `resolve_category`'s `max(chains,
 * key=_chain_score)` first-occurrence tie-break, is `../explanation/
 * trigger.ts#resolveCategory`'s territory — C3 Task 2 — not reintroduced or
 * re-audited here, only called).
 *
 * ── Error-shape mirroring ───────────────────────────────────────────────
 *
 * Every `raise HTTPException(422, detail=...)` site becomes `throw new
 * ProposalHttpError(422, detail)`, reusing the SAME `ProposalHttpDetail`
 * union `create_run.ts`/`select_service.ts`/`recompute.ts`/
 * `journey_action.ts`/`explain.ts` (proposal orchestrator) already widened
 * seven times — see that file's own module doc. This task needs NO ninth
 * member: `explain_trigger_endpoint`'s `{"code": "unknown_target",
 * "message": ...}` structured detail is the exact SAME shape
 * `UnknownTargetDetail` (widened a fourth/fifth time by C4a Task 7) already
 * carries — reused directly, not duplicated. Both `ValidationError`-derived
 * `str(exc)` sites use the union's plain `string` member — same "bare
 * single-line message, not pydantic's multi-line dump" precedent every
 * earlier task in this port established (see `validateProposalRunLogShape`/
 * `validateFirePointShape`'s own doc comments below for why these are
 * shallow structural checks, not a full pydantic model-graph
 * reimplementation).
 */
import type { TriggerFire } from '../explanation/trigger'
import { resolveCategory, buildTarget } from '../explanation/trigger'
import { buildExplanationPrompt, templateRationale, type ExplanationPrompt } from '../explanation/builder'
import {
  explainFromRunLog,
  generateExplanation,
  type ExplainStep,
  type ExplainResponse,
} from '../proposal/orchestrator/explain'
import { ProposalHttpError, type UnknownTargetDetail } from '../proposal/orchestrator/create_run'
import { ExplanationProviderUnsupportedError } from '../../api/errors'
import { pyReprQuoteOne } from '../proposal/py_repr'
import type {
  ProposalRunLog,
  ProposalOpportunity,
  JourneyState,
  DiscreteEvent,
  SetupSnapshot,
  World,
  ProposalRunStatus,
  ProposalRunMode,
  Explanation,
} from '../proposal/run_manager'
import type { AlgorithmEvidence } from '../proposal/selector'

// ---------------------------------------------------------------------------
// Small Python-mirroring local helpers — per-module-copy convention (see
// `../proposal/orchestrator/create_run.ts`'s own module doc for why each
// module keeps its own copy rather than importing one).
// ---------------------------------------------------------------------------

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

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

/** Mirrors pydantic v2's `Input should be 'a', 'b' or 'c'` enum-error
 * message join style — same convention `../actions.ts`'s own `enumMsg`
 * copy already established for this port. */
function enumMsg(values: readonly string[]): string {
  const quoted = values.map(pyReprQuoteOne)
  if (quoted.length <= 1) return `Input should be ${quoted[0] ?? ''}`
  return `Input should be ${quoted.slice(0, -1).join(', ')} or ${quoted[quoted.length - 1]}`
}

// ---------------------------------------------------------------------------
// validateProposalRunLogShape — lightweight stand-in for
// `ProposalRunLog.model_validate(body.proposal)`.
// ---------------------------------------------------------------------------

/** The `ProposalRunLog` fields with NO pydantic default (i.e. genuinely
 * required keys) whose declared type is `str` — see `models/proposal/
 * proposal_run.py:59-73`. `content_package_id` is REQUIRED-but-nullable
 * (`str | None`, no `=`) so it is checked separately, not folded in here. */
const REQUIRED_STRING_FIELDS = ['run_id', 'created_at', 'matrix_version', 'service_package_id', 'status'] as const

/** The required fields whose declared type is a plain object/dict. */
const REQUIRED_OBJECT_FIELDS = ['opportunity', 'world_snapshot', 'parameters', 'hyperparameters', 'journey_state'] as const

/** The required fields whose declared type is a list. */
const REQUIRED_ARRAY_FIELDS = ['events', 'evidence'] as const

/**
 * Lightweight structural stand-in for `ProposalRunLog.model_validate` (the
 * pydantic parse `merged_explain_endpoint` performs on `body.proposal`,
 * routers/merged_runs.py:568). ACCEPTED DIVERGENCE — same documented
 * precedent `../../run_plan.ts`'s own profile-model validator already
 * established ("error MESSAGE strings are NOT byte-identical to Pydantic's
 * wording — only the... accept/reject DECISION are required to match"):
 * error text approximates pydantic's shape but is not byte-identical, and
 * NESTED submodels (`World`, `JourneyState`, `DiscreteEvent`,
 * `AlgorithmEvidence`, ...) are checked only shallowly (present + the right
 * JS type-category — object/array/string), not recursively re-validated
 * field-by-field the way pydantic would. Porting pydantic's full nested
 * model graph for a body whose real caller ALWAYS supplies an
 * already-well-formed, freshly-`model_dump()`-ed `ProposalRunLog` (this
 * endpoint's own Python docstring: "The frontend already holds the full
 * projected proposal") would be a large, mostly-dead validation engine for
 * a payload shape this port's own writers already control end-to-end — a
 * deliberately bounded scope, not an oversight.
 *
 * Every OPTIONAL field (pydantic default present) is filled with that same
 * default when absent, exactly like a successful `model_validate` would —
 * `setup_snapshot`/`world` -> `null`, `content_parameters`/
 * `content_hyperparameters` -> `{}`, `opportunity_history`/
 * `setup_snapshot_history`/`explanations` -> `[]`, `mode` ->
 * `'interactive'`.
 *
 * `evidence` gets ONE extra per-element check (must be a plain object) —
 * the one field a genuinely malformed entry could otherwise null-pointer
 * crash `findExplainTarget`/`resolveSongName`/`resolveSongArtist` on
 * downstream (reading `.step`/`.error`/`.output` off a non-object array
 * entry), unlike every other field here, whose existing (already-ported,
 * already-defensive) consumers tolerate mere absence.
 *
 * Never throws itself — returns a semantic problem description (the
 * `HTTPException(422, detail=str(exc))` stand-in) on failure so the caller
 * wraps it in the SAME `ProposalHttpError` every other 422 in this port's
 * scope uses.
 */
function validateProposalRunLogShape(
  value: unknown,
): { ok: true; runLog: ProposalRunLog } | { ok: false; message: string } {
  if (!isPlainObject(value)) {
    return {
      ok: false,
      message: '1 validation error for ProposalRunLog\nInput should be a valid dictionary or object to extract fields from',
    }
  }
  const problems: string[] = []
  for (const key of REQUIRED_STRING_FIELDS) {
    if (typeof value[key] !== 'string') problems.push(`${key}\n  Field required and must be a string`)
  }
  for (const key of REQUIRED_OBJECT_FIELDS) {
    if (!isPlainObject(value[key])) problems.push(`${key}\n  Field required and must be a valid dictionary or object`)
  }
  for (const key of REQUIRED_ARRAY_FIELDS) {
    if (!Array.isArray(value[key])) problems.push(`${key}\n  Field required and must be a valid list`)
  }
  if (!('content_package_id' in value) || (value['content_package_id'] !== null && typeof value['content_package_id'] !== 'string')) {
    problems.push('content_package_id\n  Field required and must be a string or null')
  }
  if (Array.isArray(value['evidence'])) {
    ;(value['evidence'] as unknown[]).forEach((e, i) => {
      if (!isPlainObject(e)) problems.push(`evidence.${i}\n  Input should be a valid dictionary or object`)
    })
  }
  if (problems.length > 0) {
    return { ok: false, message: `${problems.length} validation error(s) for ProposalRunLog\n${problems.join('\n')}` }
  }

  const v = value
  const runLog: ProposalRunLog = {
    run_id: v['run_id'] as string,
    created_at: v['created_at'] as string,
    opportunity: v['opportunity'] as ProposalOpportunity,
    matrix_version: v['matrix_version'] as string,
    world_snapshot: v['world_snapshot'] as Record<string, unknown>,
    setup_snapshot: (v['setup_snapshot'] as SetupSnapshot | null | undefined) ?? null,
    service_package_id: v['service_package_id'] as string,
    content_package_id: v['content_package_id'] as string | null,
    parameters: v['parameters'] as Record<string, unknown>,
    hyperparameters: v['hyperparameters'] as Record<string, unknown>,
    content_parameters: isPlainObject(v['content_parameters']) ? v['content_parameters'] : {},
    content_hyperparameters: isPlainObject(v['content_hyperparameters']) ? v['content_hyperparameters'] : {},
    journey_state: v['journey_state'] as JourneyState,
    events: v['events'] as DiscreteEvent[],
    evidence: v['evidence'] as AlgorithmEvidence[],
    status: v['status'] as ProposalRunStatus,
    world: (v['world'] as World | null | undefined) ?? null,
    opportunity_history: Array.isArray(v['opportunity_history']) ? (v['opportunity_history'] as ProposalOpportunity[]) : [],
    setup_snapshot_history: Array.isArray(v['setup_snapshot_history']) ? (v['setup_snapshot_history'] as SetupSnapshot[]) : [],
    mode: (v['mode'] as ProposalRunMode | undefined) ?? 'interactive',
    explanations: Array.isArray(v['explanations']) ? (v['explanations'] as Explanation[]) : [],
  }
  return { ok: true, runLog }
}

// ---------------------------------------------------------------------------
// validateFirePointShape — lightweight stand-in for
// `FirePoint.model_validate(body.fire)`.
// ---------------------------------------------------------------------------

/**
 * Lightweight structural stand-in for `FirePoint.model_validate` (`models/
 * run.py:406-418`). Unlike `validateProposalRunLogShape` above, `FirePoint`
 * is genuinely small (2 required fields, 4 defaulted) so this checks every
 * field directly rather than needing a bounded-scope carve-out. Same
 * ACCEPTED-DIVERGENCE precedent (message text approximates, not
 * byte-identical to, pydantic's own).
 */
function validateFirePointShape(value: unknown): { ok: true; fire: TriggerFire } | { ok: false; message: string } {
  if (!isPlainObject(value)) {
    return {
      ok: false,
      message: '1 validation error for FirePoint\nInput should be a valid dictionary or object to extract fields from',
    }
  }
  const problems: string[] = []
  if (typeof value['tick'] !== 'number') problems.push('tick\n  Field required and must be an integer')
  if (typeof value['time_min'] !== 'number') problems.push('time_min\n  Field required and must be a number')
  const category = value['category']
  if (category !== undefined && category !== null && typeof category !== 'string') {
    problems.push('category\n  Input should be a valid string or null')
  }
  const strength = value['strength']
  if (strength !== undefined && strength !== null && typeof strength !== 'string') {
    problems.push('strength\n  Input should be a valid string or null')
  }
  if ('feature_contributions' in value && value['feature_contributions'] != null && !isPlainObject(value['feature_contributions'])) {
    problems.push('feature_contributions\n  Input should be a valid dictionary or object')
  }
  if ('criteria' in value && value['criteria'] != null && !isPlainObject(value['criteria'])) {
    problems.push('criteria\n  Input should be a valid dictionary or object')
  }
  if (problems.length > 0) {
    return { ok: false, message: `${problems.length} validation error(s) for FirePoint\n${problems.join('\n')}` }
  }

  const v = value
  const fire: TriggerFire = {
    category: (v['category'] as string | null | undefined) ?? null,
    strength: (v['strength'] as string | null | undefined) ?? null,
    tick: v['tick'],
    time_min: v['time_min'],
    feature_contributions: isPlainObject(v['feature_contributions']) ? v['feature_contributions'] : {},
    criteria: isPlainObject(v['criteria']) ? v['criteria'] : {},
  }
  return { ok: true, fire }
}

// ---------------------------------------------------------------------------
// merged_explain_endpoint -> mergedExplainEndpoint (routers/merged_runs.py:
// 553-600)
// ---------------------------------------------------------------------------

/** Mirrors `MergedExplainBody` (routers/merged_runs.py:538-549). `step` is
 * Python's raw (unconstrained) `str` — the REAL literal check happens at
 * `ExplainRequestBody` construction, mirrored inside `mergedExplainEndpoint`
 * itself, not in this input type. `provider` defaults to `"backend"`,
 * exactly like Python's own field default — an offline caller that omits it
 * therefore always hits `ExplanationProviderUnsupportedError` downstream, a
 * faithful (if strict) mirror of that default, not a bug. See the module
 * doc's "Step 3" section for why `provider`'s own type here is WIDENED to
 * include `'off'` (Python's real literal is `'backend' | 'browser'` only). */
export type MergedExplainBody = {
  proposal: Record<string, unknown>
  step: string
  target_id: string
  provider?: 'backend' | 'browser' | 'off' | string
}

/**
 * Port of `merged_explain_endpoint` (routers/merged_runs.py:553-600). See
 * the module doc for the full control-flow enumeration.
 *
 * @throws ProposalHttpError(422, string) — malformed `body.proposal`, an
 *   unrecognized `step`, or an unrecognized `provider`.
 * @throws ExplanationProviderUnsupportedError — `body.provider === 'backend'`
 *   (thrown by `explainFromRunLog` itself, not duplicated here).
 * @throws ProposalHttpError(422, NoDecisionDetail | UnknownTargetDetail) —
 *   propagated from `explainFromRunLog` (`../proposal/orchestrator/
 *   explain.ts`) unchanged.
 */
export async function mergedExplainEndpoint(body: MergedExplainBody): Promise<ExplainResponse> {
  const runLogResult = validateProposalRunLogShape(body.proposal)
  if (!runLogResult.ok) {
    throw new ProposalHttpError(422, runLogResult.message)
  }

  const step = body.step
  if (step !== 'service' && step !== 'content' && step !== 'trigger') {
    throw new ProposalHttpError(422, `step\n  ${enumMsg(['service', 'content', 'trigger'])}`)
  }

  const provider = body.provider ?? 'backend'
  if (provider !== 'backend' && provider !== 'browser' && provider !== 'off') {
    throw new ProposalHttpError(422, `provider\n  ${enumMsg(['backend', 'browser', 'off'])}`)
  }

  // `step === 'trigger'` is a REAL, reachable Python behavior: `Explain
  // RequestBody.step` accepts it (Literal["service","content","trigger"]),
  // but `_find_explain_target`/`explain_from_run_log` never match it (no
  // AlgorithmEvidence.step is ever "trigger") — it always falls through to
  // a `no_decision` 422 one level down. Cast is a compile-time convenience
  // only (`ExplainStep` is `'service' | 'content'`, this port's own scope
  // note on that type) — the runtime string is passed through verbatim,
  // exactly mirroring what Python's own dynamic `step` field does.
  return explainFromRunLog(
    runLogResult.runLog,
    { step: step as ExplainStep, target_id: body.target_id, provider },
    null,
  )
}

// ---------------------------------------------------------------------------
// explain_trigger_endpoint -> explainTriggerEndpoint (routers/merged_runs.py:
// 600-681)
// ---------------------------------------------------------------------------

/** Mirrors `ExplainTriggerBody` (routers/merged_runs.py:594-609). `provider`
 * defaults to `"backend"`, exactly like Python's own field default — see
 * this endpoint's own gate below. Kept at Python's EXACT 3-way literal (no
 * `'off'` widening) — see the module doc's "Step 3" section for why. */
export type ExplainTriggerBody = {
  fire: Record<string, unknown>
  category?: string | null
  provider?: 'backend' | 'browser' | 'template'
}

/** Mirrors `ExplainResponse` (routers/proposal.py:1965-1979) as reached
 * through THIS endpoint specifically — `step` is always `'trigger'`;
 * `requested_provider` is Python's exact 3-way set (never `'off'`, see the
 * module doc); `provider_used` narrows to what `generateExplanation`/the
 * `'template'` branch can actually PRODUCE offline (never `'backend'`). A
 * separate type from `../proposal/orchestrator/explain.ts#ExplainResponse`
 * (deliberately — that one's `step`/`requested_provider` are narrower,
 * scoped to the service/content endpoint it belongs to; forcing one shared
 * type across both would either widen that file's own scope note for no
 * reason or narrow this endpoint's real 3-way provider set incorrectly). */
export type TriggerExplainResponse = {
  step: 'trigger'
  target_id: string
  requested_provider: 'backend' | 'browser' | 'template'
  rationale: string[]
  provider_used: 'browser' | 'template'
  model: string
  fell_back: boolean
  error: string | null
  prompt: ExplanationPrompt
}

/**
 * Port of `explain_trigger_endpoint` (routers/merged_runs.py:600-681). See
 * the module doc for the full control-flow enumeration and the provider-gap
 * design (why the `'backend'` gate sits at THIS function's own top, before
 * `FirePoint` validation, rather than mirroring any Python ordering).
 *
 * @throws ExplanationProviderUnsupportedError — `provider === 'backend'`
 *   (default when omitted, matching Python's own field default).
 * @throws ProposalHttpError(422, string) — malformed `body.fire`.
 * @throws ProposalHttpError(422, UnknownTargetDetail) — an explicit
 *   `body.category` not present among the fire's recorded chains.
 */
export function explainTriggerEndpoint(body: ExplainTriggerBody): TriggerExplainResponse {
  const provider = body.provider ?? 'backend'
  if (provider === 'backend') {
    throw new ExplanationProviderUnsupportedError()
  }

  const fireResult = validateFirePointShape(body.fire)
  if (!fireResult.ok) {
    throw new ProposalHttpError(422, fireResult.message)
  }
  const fire = fireResult.fire

  const chains = pyOr(
    pyGetDefault(fire as unknown as Record<string, unknown>, 'feature_contributions', null),
    {},
  ) as Record<string, unknown>
  const bodyCategory = body.category ?? null
  if (bodyCategory !== null && !(bodyCategory in chains)) {
    const detail: UnknownTargetDetail = {
      code: 'unknown_target',
      message: `category ${pyReprQuoteOne(bodyCategory)} not found in the recorded fire`,
    }
    throw new ProposalHttpError(422, detail)
  }

  const category = resolveCategory(fire, bodyCategory)
  const target = buildTarget(fire, category)
  const prompt = buildExplanationPrompt('trigger', target, {})

  if (provider === 'template') {
    const rationale = templateRationale('trigger', target)
    return {
      step: 'trigger',
      target_id: pyOr(category, '') as string,
      requested_provider: 'template',
      rationale,
      provider_used: 'template',
      model: 'template',
      fell_back: false,
      error: null,
      prompt,
    }
  }

  // provider === 'browser' — the only value left reachable here ('backend'
  // rejected above, 'template' handled above).
  const [rationale, providerUsed, model, fellBack, error] = generateExplanation(
    prompt,
    'browser',
    () => templateRationale('trigger', target),
  )
  return {
    step: 'trigger',
    target_id: pyOr(category, '') as string,
    requested_provider: provider,
    rationale,
    provider_used: providerUsed,
    model,
    fell_back: fellBack,
    error,
    prompt,
  }
}
