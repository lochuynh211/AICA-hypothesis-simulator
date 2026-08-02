/**
 * `apply_journey_action` / `get_proposal_run` orchestrators — TS port of
 * `routers/proposal.py`'s `apply_journey_action` (1863-1915, 53 LOC) and
 * `get_proposal_run` (1831-1848, 18 LOC) — feature 026 (htmlapp Combined
 * export), slice C4a Task 6.
 *
 * ── Control flow (Step 1, written before any code below) ───────────────────
 *
 * `getProposalRun` (mirrors `get_proposal_run`) — ASYNC, READ-ONLY:
 *   1. `getRun(runId)` — `ProposalHttpError(404)` if not found (bare string
 *      detail, `f"Proposal run {run_id!r} not found"`).
 *   2. Return the run AS PERSISTED — no selector is ever re-invoked here
 *      (Python's own docstring: "mirrors `proposal_run_manager.get_run`'s
 *      contract"). There is nothing else in this function — it exists only
 *      to give the 404 an HTTP-shaped error a later handler layer can map.
 *
 * `applyJourneyAction` (mirrors `apply_journey_action`) — ASYNC, the ONLY
 * two side-effecting responsibilities the PURE `journey.ts#applyAction`
 * engine must never perform itself:
 *   1. `getRun(runId)` — `ProposalHttpError(404)` if not found (same bare
 *      string shape as `getProposalRun`'s own 404 — verified byte-identical
 *      in Python: both f-strings are the literal same text).
 *   2. Mint `now` (`nowIso()`) and load `capabilities` (`getServiceCapabilities()`
 *      — see "capabilities_unavailable is unreachable" below), then call
 *      `applyAction(runLog, action, now, capabilities)` (`../journey.ts`,
 *      already fully ported and tested by C2 — this file does NOT re-verify
 *      any of its twelve handlers' own internal branch logic, only that
 *      EVERY one of them is correctly reachable and its result is correctly
 *      persisted-or-rejected by this thin wrapper).
 *   3. `transition.rejected !== null` -> `ProposalHttpError(422, {code,
 *      message})` — a NEW structured detail shape (`JourneyActionRejectedDetail`,
 *      `../create_run.ts`, widened for this task) — and, critically,
 *      NOTHING is appended/updated: a rejection is a pure read, never a
 *      partial write (Python: the raise happens BEFORE either persistence
 *      loop below ever runs).
 *   4. Else: append every `transition.events` entry IN ORDER (`appendEvent`,
 *      sequential `await`, never `Promise.all` — see "Hazard 4" below), then
 *      `updateState(runId, {status: transition.new_status, journeyState:
 *      transition.new_journey_state})`. Evidence is NEVER touched by this
 *      function (unlike `select_service.ts`/`recompute.ts`, neither of which
 *      it calls) — `journey.ts`'s own twelve handlers never produce
 *      `AlgorithmEvidence`, only `DiscreteEvent`s.
 *   5. Return the updated run log (`updateState`'s own return value — the
 *      SAME object `run_log = prm.update_state(...)` reassigns to in
 *      Python).
 *
 * ── Which of the twelve `JourneyActionType`s reach this function ───────────
 *
 * ALL TWELVE. `apply_journey_action` performs NO action-type-specific
 * branching of its own — `action` is threaded to `applyAction` completely
 * opaquely (`../journey.ts`'s own dispatch table, `HANDLERS`, is the ONLY
 * place that branches on `action_type`). So from THIS function's point of
 * view, every one of `accept` / `reject` / `postpone` / `choose_another` /
 * `request_more` / `complete` / `continue` / `stop` / `motion_change` /
 * `rest_spot_arrived` / `rest_started` / `rest_completed` is structurally
 * the SAME call shape — the interesting coverage question for this file is
 * not "does each action type get dispatched" (C2 already proved that,
 * `tests/proposal_journey_validation.test.ts`'s own "dispatch table
 * completeness" describe block) but "does EVERY one of the twelve, when it
 * succeeds OR is rejected, get correctly persisted-or-not by this wrapper".
 * The test file below drives real instances of all twelve through
 * `applyJourneyAction` (not `applyAction` directly) for exactly that reason
 * — see its own module doc for the coverage table, and the reused
 * `JourneyActionType` union (`../journey.ts`) the enumeration is checked
 * against, per the brief's "reuse that enumeration, don't rebuild it".
 *
 * ── `capabilities_unavailable` is unreachable from THIS call site (both
 * languages) ─────────────────────────────────────────────────────────────
 *
 * `journey.ts#motionChange`'s own `capabilities === null` guard exists for
 * `applyAction`'s OTHER callers/tests (its `capabilities` parameter defaults
 * to `null`) — but `applyJourneyAction` ALWAYS calls `getServiceCapabilities()`
 * (`./context_base.ts`), whose return type is `ServiceCapabilities`, never
 * `null` (it either returns a complete artifact or THROWS — see
 * `context_base.ts#assertServiceCapabilitiesComplete`). Verified this is
 * true in Python too, not merely assumed symmetric: `_get_service_
 * capabilities()` (routers/proposal.py:128-130) return-types `->
 * ServiceCapabilities` and its own body, `ServiceCapabilities.load(...)`,
 * either returns a real instance or raises — never returns `None`. So
 * `capabilities_unavailable` is genuinely dead code at `apply_journey_
 * action`'s real call site in BOTH languages — disclosed, not silently
 * skipped, and covered ONLY via a `vi.spyOn(journeyModule, 'applyAction')`
 * forcing that exact rejection shape through the wrapper (proving the
 * wrapper handles it generically, the same as any other rejection code —
 * NOT re-deriving `motionChange`'s own branch, which C2 already tests
 * directly with `capabilities: null`).
 *
 * ── Type bridge: `run_manager.ts#ProposalRunLog` -> `journey.ts#ProposalRunLog` ──
 *
 * In Python there is exactly ONE `ProposalRunLog` class — `apply_action`'s
 * parameter type IS the same model `get_run`/`update_state` return. This
 * TS port has TWO distinct `ProposalRunLog` types for the same runtime
 * shape (an earlier-task modeling choice, not a divergence introduced
 * here): `run_manager.ts`'s, which treats `journey_state` as an
 * intentionally opaque pass-through, and `journey.ts`'s own stricter P4
 * shape (the one module that actually reads/writes `journey_state`
 * field-by-field). Every field except `journey_state` is either IMPORTED
 * from `run_manager.ts` by `journey.ts` directly (`ProposalOpportunity`,
 * `DiscreteEvent`, `ProposalRunStatus`) or a compatible widening
 * (`world_snapshot: Record<string,unknown> | null` accepts run_manager's
 * non-nullable variant) — `journey_state` is the ONE field TS cannot
 * structurally verify is compatible (run_manager's opaque type only
 * statically guarantees 4 of the 8 fields `journey.ts#JourneyState`
 * requires, even though every REAL persisted run carries all 8 — built that
 * way by `create_run.ts#makeJourneyState`/`select_service.ts#makeJourneyState`,
 * both already reviewed). A single `as unknown as` bridges this AT THE
 * CALL SITE ONLY — the same locally-scoped-cast convention already used
 * by `select_service.ts`/`recompute.ts` for their own `SetupSnapshot`
 * narrowing (see those files' own `as unknown as SetupSnapshot` sites) —
 * not a blanket `any`, and not touching `journey.ts` itself (out of this
 * task's file list).
 *
 * The RETURN direction needs no cast: `journey.JourneyState` (a strict
 * superset of `run_manager.JourneyState`'s 4 named fields, each with a
 * narrower-but-assignable type — `LifecycleStage`/`MotionState`/`ServiceId`
 * are all string subtypes) is structurally assignable to `run_manager.
 * JourneyState`'s index-signature-backed shape without help.
 *
 * ── Hazard pass (all eight) ─────────────────────────────────────────────────
 * - Hazard 1 (banker's rounding): no `round()` in either function — N/A.
 * - Hazard 2 (`sorted()`): none — N/A.
 * - Hazard 3 (`//`/`%` floor division): none — N/A.
 * - Hazard 4 (dict/insertion order): the ONE ordering decision either
 *   function makes is `for event in transition.events: prm.append_event(...)`
 *   — a plain sequential `for` loop over an already-ordered array (built by
 *   `journey.ts`'s own handlers via `.push()`, already audited there), NOT a
 *   dict/set iteration. Mirrored with `for (const event of transition.events)
 *   { await appendEvent(runId, event) }` — a real `for...of` with a
 *   sequential `await` INSIDE the loop body (not `Promise.all(events.map(...))`,
 *   which would race independent `getHeader`/`getEvents`/`appendEvent` calls
 *   against each other and could silently reorder or drop an entry under
 *   IndexedDB's own async scheduling) — structurally guaranteed order, not
 *   incidental. Explicitly tested (`choose_another`'s own 2-event
 *   `[CHOOSE_ANOTHER, SERVICE_SELECTED]` and `rest_completed`'s own
 *   `[REST_COMPLETED, OPPORTUNITY_OPENED]`) rather than assumed.
 * - Hazard 5 (bare `str(float)`): no float value is ever formatted into a
 *   string in either function (both are pure passthrough/persistence glue)
 *   — N/A.
 * - Hazard 6 (`neumaierSum`): no `sum()` over floats — N/A.
 * - Hazard 7 (`pyFixed`/`:.Nf`): no format-spec float formatting — N/A.
 * - Hazard 8 (`isinstance(x, (int, float))` accepting `bool`): ZERO
 *   `isinstance` calls in either function's Python body (the full 53+18 LOC
 *   span was read, not grepped alone) — confirmed:
 *   `sed -n '1831,1915p' app/api/aica_api/routers/proposal.py | grep -n
 *   isinstance` -> no output. N/A, no site to audit.
 *
 * ── `dict.get(key, default)` / truthiness-`or` audit ────────────────────────
 *
 * `sed -n '1831,1915p' app/api/aica_api/routers/proposal.py | grep -n
 * '\.get('` -> ONE hit, line 85: `@router.get("/api/proposal/runs/{run_id}
 * /journey/preview")` — a FastAPI route decorator for the NEXT function
 * (`get_journey_preview`, out of scope), not a dict `.get()` call — a false
 * positive from the raw grep, same class `recompute.ts`'s own audit
 * disclosed for its own span's trailing decorator. Excluded.
 * `sed -n '1831,1915p' app/api/aica_api/routers/proposal.py | grep -n ' or
 * '` -> NO output. Both audits: zero genuine sites in this task's scope —
 * the smallest hazard surface of any task in this slice so far, matching
 * the brief's own "two smallest orchestrators" framing.
 *
 * ── Error-shape mirroring ────────────────────────────────────────────────
 *
 * Both functions' 404 reuse the EXACT SAME bare-string `ProposalHttpError`
 * shape every earlier task's file already established (`pyReprQuoteOne`
 * for `run_id!r`). `applyJourneyAction`'s 422 is the FIFTH member added to
 * `../create_run.ts`'s shared `ProposalHttpDetail` union
 * (`JourneyActionRejectedDetail`, a straight alias of `../journey.ts#
 * TransitionRejection` — see `create_run.ts`'s own module doc for why this
 * one is an alias rather than an independent literal, unlike the other
 * four).
 */
import { ProposalHttpError, type JourneyActionRejectedDetail } from './create_run'
import { getServiceCapabilities, nowIso } from './context_base'
import { pyReprQuoteOne } from '../py_repr'
import { applyAction, type JourneyAction, type ProposalRunLog as JourneyProposalRunLog } from '../journey'
import { getRun, appendEvent, updateState, type ProposalRunLog } from '../run_manager'

export type { JourneyAction }

/**
 * Port of `get_proposal_run` (routers/proposal.py:1831-1848). PURE READ —
 * renders the persisted log exactly as recorded; no selector is ever
 * re-invoked.
 *
 * @throws ProposalHttpError(404) — `runId` has no persisted run.
 */
export async function getProposalRun(runId: string): Promise<ProposalRunLog> {
  const runLog = await getRun(runId)
  if (runLog === null) {
    throw new ProposalHttpError(404, `Proposal run ${pyReprQuoteOne(runId)} not found`)
  }
  return runLog
}

/**
 * Port of `apply_journey_action` (routers/proposal.py:1863-1915). See
 * module doc for the full control-flow enumeration, which of the twelve
 * `JourneyActionType`s reach this function (all of them), the
 * `capabilities_unavailable` unreachability note, and the type-bridge cast.
 *
 * @throws ProposalHttpError(404) — `runId` has no persisted run.
 * @throws ProposalHttpError(422) — the engine rejected the action (a
 *   structured `{code, message}` detail, `JourneyActionRejectedDetail`);
 *   NOTHING is appended/updated in this case — the run is left byte-identical.
 */
export async function applyJourneyAction(runId: string, action: JourneyAction): Promise<ProposalRunLog> {
  const runLog = await getRun(runId)
  if (runLog === null) {
    throw new ProposalHttpError(404, `Proposal run ${pyReprQuoteOne(runId)} not found`)
  }

  // Type-bridge cast — see module doc's "Type bridge" section. `runLog`
  // structurally satisfies `journey.ProposalRunLog` at runtime (every real
  // persisted run's `journey_state` carries the full P4 shape); only TS's
  // static view of `run_manager.JourneyState`'s opaque index signature
  // cannot prove it.
  const transition = applyAction(
    runLog as unknown as JourneyProposalRunLog,
    action,
    nowIso(),
    getServiceCapabilities(),
  )

  if (transition.rejected !== null) {
    const detail: JourneyActionRejectedDetail = {
      code: transition.rejected.code,
      message: transition.rejected.message,
    }
    throw new ProposalHttpError(422, detail)
  }

  // Sequential, in order — see module doc's Hazard 4 note. Evidence is
  // never touched here; only events + journey_state/status.
  for (const event of transition.events) {
    await appendEvent(runId, event)
  }

  return updateState(runId, {
    status: transition.new_status,
    journeyState: transition.new_journey_state,
  })
}
