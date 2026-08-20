/**
 * Merged-run ACTION endpoints — TS port of the action half of
 * `app/api/aica_api/routers/merged_runs.py` (feature 026, htmlapp Combined
 * export, slice C4 Task 7):
 *
 *   - `accept_rest_endpoint`  (POST /api/merged-runs/{id}/accept-rest, 824-892)
 *   - `decline_rest_endpoint` (POST /api/merged-runs/{id}/decline, 892-934)
 *   - `proposal_action_endpoint` (POST /api/merged-runs/{id}/proposal-action, 1206-1327)
 *
 * Ported as plain functions — HTTP framing (status codes, path params,
 * FastAPI `Depends`) is a LATER task's job (Task 9's handlers), not this
 * one's. Every raise site mirrors its Python `HTTPException` by throwing
 * `ProposalHttpError` (`../proposal/orchestrator/create_run.ts`) with the
 * SAME status + detail shape — REUSING the existing `ProposalHttpDetail`
 * union without needing to widen it: every 422/404 this file raises is
 * EITHER a bare string (this file's own two "required" guards, the two
 * enum-membership guards below, and every `ActionNotAllowedError`/
 * not-found message) OR already produced by a REUSED downstream function
 * (`selectService`'s `ServiceNotEligibleDetail`, `applyJourneyAction`'s
 * `JourneyActionRejectedDetail`, both already members) — no new detail
 * shape originates in this file.
 *
 * `_override_nap_stage_ticks` was ported by **Task 6**, as
 * `overrideNapStageTicks` in `./tick.ts` — imported below, NOT re-ported.
 * `replace_scenario` (`services/run_manager.py:193-222`) was NOT part of
 * any earlier task's file list; it is a small (8-line) helper
 * `accept_rest_endpoint` genuinely needs, so THIS task ports it — as
 * `replaceScenario` in `../run_manager.ts` (the sibling of the
 * already-ported `getScenario`/`action`, all three read the same
 * in-memory registry) — see that function's own doc comment for the
 * "never mutate a possibly-shared ScenarioDef in place" invariant it
 * guards, faithfully mirrored (a whole-entry `_registry.set` replacement,
 * not a field mutation).
 *
 * ── Step 1 — control-flow enumeration (written BEFORE porting, per the
 *    brief) ──────────────────────────────────────────────────────────────
 *
 * `acceptRest` (accept_rest_endpoint):
 *   1. `getHandle(mergedRunId)` — `undefined` -> 404
 *      `Merged run {id!r} not found`.
 *   2. `getScenario(handle.trigger_run_id)` — `null` -> 404
 *      `Trigger run {id!r} not found`. A DIFFERENT code path than step 4's
 *      own `RunNotFoundError` catch below (this one fires when the trigger
 *      run's registry entry is ALREADY gone at call time; step 4's would
 *      fire only if it vanished BETWEEN this check and the calls below —
 *      see "Genuinely unreachable" note under Hazards).
 *   3. `body.nap_minutes !== null` -> `overrideNapStageTicks(scenario,
 *      body.recovery_option_id, body.nap_minutes)` (Task 6, PURE, never
 *      mutates `scenario`) then `replaceScenario(handle.trigger_run_id,
 *      <the new scenario>)` — installs the override into ONLY this
 *      trigger run's own registry entry, BEFORE starting recovery.
 *   4. `action(handle.trigger_run_id, 'accept_rest', {recoveryOptionId,
 *      restSpot})` — the SAME entrypoint the trigger-only screen uses.
 *      Both this call AND step 3's `replaceScenario` are wrapped by ONE
 *      try/catch (mirrors Python's single `try:` spanning both statements):
 *        - `RunNotFoundError` -> 404 `Trigger run {id!r} not found` (SAME
 *          message text as step 2's, a DIFFERENT reachability path).
 *        - `ActionNotAllowedError` -> 422 `exc.message` (mirrors Python's
 *          `HTTPException(422, str(exc))` — a plain `Error.message` IS
 *          Python's `str(exc)` for these single-string-arg error classes).
 *   5. Success: `handle.rest_stage_synced = 'before'`,
 *      `handle.nap_minutes = body.nap_minutes`, `saveHandle(handle)`.
 *      Returns the `RunStateM2` `action()` itself returned (Python:
 *      `run_state.model_dump(mode='json')` — this port returns the typed
 *      object directly, matching every other C4/C4a orchestrator's own
 *      established convention of not hand-rolling a `.model_dump()`
 *      equivalent; Task 9's HTTP layer serializes it).
 *
 * `declineRest` (decline_rest_endpoint):
 *   1. `getHandle(mergedRunId)` — `undefined` -> 404 (SAME message shape
 *      as `acceptRest`'s own step 1). NO `getScenario` pre-check of its
 *      own (unlike `acceptRest`) — `decline` calls `action()` directly.
 *   2. `action(handle.trigger_run_id, 'decline')`:
 *        - `RunNotFoundError` -> 404 `Trigger run {id!r} not found` — HERE
 *          this genuinely IS `action()`'s own catch (there is no earlier
 *          `getScenario` check to intercept it first, unlike `acceptRest`).
 *        - `ActionNotAllowedError` -> 422 `exc.message`.
 *   3. Success: `handle.current_proposal_run_id = null`,
 *      `handle.current_proposal_category = null` (re-arms the once-per-fire
 *      guard so a LATER re-fire, after the trigger cooldown, spawns a
 *      FRESH proposal run instead of being silently swallowed by
 *      `tickMergedRun`'s own Branch A guard), `saveHandle(handle)`. Returns
 *      the `RunStateM2`.
 *
 * `proposalAction` (proposal_action_endpoint):
 *   1. `getHandle(mergedRunId)` — `undefined` -> 404
 *      `Merged run {id!r} not found`.
 *   2. `handle.current_proposal_run_id === null` -> 404
 *      `Merged run {id!r} has no active proposal run`.
 *   3. `body.kind === 'select_service'`:
 *      a. `body.selected_service_id === null` -> 422
 *         `selected_service_id is required for kind='select_service'`.
 *      b. NOT a member of the 14 `ServiceId`s -> 422 (mirrors Python's
 *         caught `pydantic.ValidationError` from constructing
 *         `SelectServiceBody(selected_service_id=...)` — see "Error-shape
 *         decision" below for why this is a bare string, not pydantic's
 *         full `.errors()` array).
 *      c. `selectService(runId, {selected_service_id, parameters:
 *         handle.content_parameters, hyperparameters:
 *         handle.content_hyperparameters})` — propagates ANY
 *         `ProposalHttpError` it throws UNCAUGHT (no try/except wraps this
 *         call in Python either — only the pydantic construction above it
 *         is guarded).
 *      d. `handle.current_proposal_category === 'monotony_prevention'` ->
 *         best-effort `action(handle.trigger_run_id, 'acknowledge')`,
 *         `ActionNotAllowedError`/`RunNotFoundError` SWALLOWED (any OTHER
 *         thrown error propagates — mirrors Python's narrow
 *         `except (ActionNotAllowedError, RunNotFoundError): pass`). REST
 *         opportunities are deliberately excluded from this (answered by
 *         accept-rest/decline instead) by construction — this branch only
 *         runs for `monotony_prevention`.
 *   4. `body.kind === 'journey_action'` (the ONLY other `kind` — Python's
 *      own `else:  # kind == "journey_action"`):
 *      a. `body.action_type === null` -> 422
 *         `action_type is required for kind='journey_action'`.
 *      b. NOT a member of the 12 `JourneyActionType`s -> 422 (SAME
 *         "bare string" shape decision as 3b, mirroring a caught
 *         `JourneyAction(action_type=...)` `ValidationError`).
 *      c. `applyJourneyAction(runId, {action_type, payload})` —
 *         propagates ANY `ProposalHttpError` it throws UNCAUGHT (404
 *         unknown run, OR 422 `JourneyActionRejectedDetail` — a REAL
 *         precondition rejection is NOT caught here; when it throws,
 *         NOTHING below this point runs: no correlation refresh, no
 *         `saveHandle` — the append-only "a rejection touches nothing"
 *         invariant, Step 5).
 *   5. Refresh the correlation entry: iterate `handle.correlation_log` in
 *      REVERSE (index-based — `for (let i = length - 1; i >= 0; i--)`,
 *      NEVER `.reverse()`, which would MUTATE the array's own order — see
 *      Hazard 4 below), find the FIRST one (i.e. the LAST by original
 *      order) whose `proposal_run_id === runId`, overwrite ONLY its
 *      `proposal_event_ids` with the freshly dispatched `plog.events`
 *      (mirrors `f"{event_type}@{at}"`, INCLUDING the `DiscreteEventType.`
 *      f-string-Enum-mixin prefix quirk `tick.ts` already established —
 *      see this file's own local `eventIds` copy), `break` on first match.
 *      No entry is ever ADDED or REMOVED here — only ONE existing entry's
 *      ONE field is overwritten in place, matching Python's own
 *      `corr.proposal_event_ids = [...]` field mutation on a pydantic
 *      model instance already living inside `handle.correlation_log`.
 *   6. `saveHandle(handle)`. Returns `plog` (Python:
 *      `plog.model_dump(mode='json')` — this port returns the typed
 *      `ProposalRunLog` object directly, matching every sibling
 *      orchestrator's convention).
 *
 * ── Coverage: which of the TWELVE `JourneyActionType`s reach
 *    `proposalAction` ────────────────────────────────────────────────────
 *
 * ALL TWELVE. `proposal_action_endpoint` performs NO action-type-specific
 * branching of its own — `MergedProposalActionBody.action_type` is an
 * UNCONSTRAINED `str` at the router-body level (no `Literal`/enum on
 * `models/merged_run.py::MergedProposalActionBody`, verified directly),
 * so ANY string reaches step 4b's membership check; every one of the
 * twelve real names passes it and is forwarded VERBATIM to
 * `applyJourneyAction` (mirrors `journey_action.ts`'s own identical
 * framing for `apply_journey_action` itself — this file adds exactly ONE
 * more layer in front of that same opaque forwarding: an enum-membership
 * gate, not a dispatch). The interesting coverage question for THIS file
 * is therefore not "does each action type get dispatched" (C2/C4a already
 * proved that at `journey.ts`/`journey_action.ts`) but "does the
 * enum-membership gate correctly ADMIT all twelve real names (not just
 * SOME of them) while still REJECTING a 13th" — proven in the test file
 * via a compile-time-checked `Record<JourneyActionType, string>` map
 * (so a future 13th member fails to COMPILE here, not silently ships
 * uncovered) plus a `vi.spyOn(journeyActionModule, 'applyJourneyAction')`
 * asserting each of the twelve is actually the argument
 * `applyJourneyAction` receives — together with a handful of REAL
 * (non-mocked) dispatches (`reject`/`select_service`/`complete`
 * REJECTED/`accept`/`complete` succeeding) captured in the golden for the
 * append-only + acknowledge-branch claims specifically.
 *
 * ── Error-shape decision: bare string, not pydantic's full `.errors()`
 *    array ────────────────────────────────────────────────────────────────
 *
 * Python's `except ValidationError as exc: raise HTTPException(422,
 * detail=exc.errors())` embeds pydantic's own `[{type, loc, msg, input,
 * ctx, url}]` array (`url` is tied to the installed pydantic VERSION).
 * This mirrors `tick.ts`'s OWN already-reviewed precedent for the
 * STRUCTURALLY IDENTICAL situation (Branch A2's `CreateProposalRunBody`
 * `mode` field, see that file's "Mode validation" doc section) rather
 * than reproducing pydantic's dump byte-for-byte: a clean single-line
 * `"{field}: Input should be ... (got {value!r})"` string, built from the
 * SAME source-of-truth enum lists (`SERVICE_ID_VALUES` from
 * `../proposal/enums.ts`; a local `JOURNEY_ACTION_TYPE_KEYS` map derived
 * from `../proposal/journey.ts#JourneyActionType`'s own twelve members —
 * see "reused, not rebuilt" below) via a local `enumMsg` copy (the SAME
 * per-module-copy convention `world_validation.ts`/`matrix.ts` already
 * established for pydantic's `Input should be 'a', 'b' or 'c'`
 * enum-error join style), since nothing in this port's call sites depends
 * on pydantic's exact formatting. The golden (`merged_actions.json`)
 * captures the RAW Python `.errors()` array for documentation, but the
 * test asserts SEMANTICALLY against it (message mentions the field name
 * and both/all valid choices), not byte-exact.
 *
 * ── Reused, not rebuilt: the twelve-member `JourneyActionType` enumeration
 *    ─────────────────────────────────────────────────────────────────────
 *
 * `JOURNEY_ACTION_TYPE_KEYS` below is a `Record<JourneyActionType, true>`
 * literal — every key is checked against `../proposal/journey.ts`'s own
 * `JourneyActionType` union by the TS compiler itself (missing OR extra
 * key -> compile error), so the source of truth for "what are the twelve"
 * is still `journey.ts`'s own type declaration (C2's), never re-typed by
 * hand as an independent array that could silently drift. The ordered
 * array/`Set` this file actually uses (`JOURNEY_ACTION_TYPES`/
 * `JOURNEY_ACTION_TYPE_SET`) are DERIVED from this map's own keys
 * (`Object.keys`, insertion order — reliable for a plain object with only
 * string keys, per the JS spec), not a second hand-copied literal.
 *
 * ── Hazard pass (all eight, every ported span read in full — not grepped
 *    alone) ──────────────────────────────────────────────────────────────
 * - Hazard 1 (banker's rounding): no `round()` anywhere in the three
 *   ported spans — N/A.
 * - Hazard 2 (`sorted()`): none — N/A.
 * - Hazard 3 (`//`/`%` floor division): none — N/A.
 * - Hazard 4 (dict/insertion order): the ONE ordering-sensitive site is
 *   `for corr in reversed(handle.correlation_log)` (proposal_action's
 *   correlation refresh) — mirrored with an index-based reverse loop, NOT
 *   `.reverse()` (which would MUTATE `handle.correlation_log`'s own order
 *   in place — the append-only artefact's ordering is exactly what this
 *   task's brief calls out as load-bearing). Proven, not merely argued: a
 *   dedicated hand-built-handle golden case
 *   (`correlation_multi_entry_reverse_iteration`) seeds THREE entries,
 *   two sharing the SAME `proposal_run_id`, and asserts the LAST one (not
 *   the first) is the one refreshed, with the other two byte-unchanged
 *   AND array order/length preserved.
 * - Hazard 5 (bare `str(float)`): no float is ever interpolated into a
 *   message string in this file's own scope — the two enum-message sites
 *   embed only string enum members; `JSON.stringify(value)` for the "got
 *   ..." suffix operates on a STRING value in both reachable call sites
 *   (the null-check already ran first) — N/A.
 * - Hazard 6 (`neumaierSum`): no `sum()` over floats — N/A.
 * - Hazard 7 (`pyFixed`/`:.Nf`): no format-spec float formatting — N/A.
 * - Hazard 8 (`isinstance(x, (int, float))` accepting `bool`): ZERO
 *   `isinstance` calls anywhere in the three ported spans (verified:
 *   `sed -n '824,934p;1206,1327p' app/api/aica_api/routers/merged_runs.py
 *   | grep -n isinstance` -> no output). N/A, no site to audit.
 *
 * ── `dict.get(key, default)` / truthiness-`or` audit ────────────────────
 *
 * `sed -n '824,934p;1206,1327p' app/api/aica_api/routers/merged_runs.py |
 * grep -n '\.get('` -> NO output (zero `.get()` calls). `... | grep -n "
 * or "` -> five hits, ALL inside docstrings/comments ("merged_run_id or
 * trigger_run_id", "algorithm or recorded simulator decision", etc.), not
 * a single genuine truthiness-`or` expression in code. Both audits: ZERO
 * real sites in this task's scope.
 *
 * ── Singular/plural alias pairs ──────────────────────────────────────────
 *
 * N/A — none of the three ported functions builds or returns a
 * `MergedInstantResult` (the ONE type in this port with singular/plural
 * alias pairs — `fire`/`fires`, `rest_spot`/`rest_spots`,
 * `rest_option`/`rest_options`, all owned by `./quickview.ts`, a
 * different C4 task). `acceptRest`/`declineRest` return a `RunStateM2`;
 * `proposalAction` returns a `ProposalRunLog` — neither type has a
 * singular-aliases-plural[0] shape anywhere in its own fields.
 *
 * ── Genuinely unreachable (disclosed, not silently guarded): `acceptRest`
 *    step 4's `RunNotFoundError` catch ──────────────────────────────────
 *
 * `getScenario`/`replaceScenario` are SYNCHRONOUS (no `await` inside
 * either); `action()`'s own registry lookup happens synchronously too,
 * before its first internal `await`. Since `acceptRest`'s own body calls
 * `getScenario` then (optionally) `replaceScenario` then `action()` with
 * NO `await` in between ANY of them until INSIDE `action()` itself, there
 * is no genuine yield point where the trigger run's registry entry could
 * disappear between step 2's `getScenario` check succeeding and step 4's
 * calls running — matching Python's OWN reasoning (fully synchronous,
 * no I/O between the two) for why this is dead code there too. Ported
 * faithfully anyway (same "port defensively even when a branch is
 * currently unreachable" precedent this program has already established,
 * e.g. `tick.ts`'s own disclosed dead branches) — not tested directly
 * (cannot be, in either language, via any real call sequence), disclosed
 * here rather than silently omitted.
 */
import type { RestSpot } from '../../api/types'
import type { AcceptRestBody, MergedProposalActionBody } from './types'
import { getHandle, saveHandle } from '../../storage/merged_runs_store'
import {
  action,
  getRun,
  getScenario,
  replaceScenario,
  RunNotFoundError,
  ActionNotAllowedError,
  type RunStateM2,
} from '../run_manager'
import type { EventPlan } from '../event_plan'
import { overrideNapStageTicks } from './tick'
import { ProposalHttpError } from '../proposal/orchestrator/create_run'
import { selectService, type SelectServiceBody } from '../proposal/orchestrator/select_service'
import { applyJourneyAction, type JourneyAction } from '../proposal/orchestrator/journey_action'
import type { ProposalRunLog } from '../proposal/run_manager'
import type { JourneyActionType } from '../proposal/journey'
import { SERVICE_ID_VALUES, SERVICE_ID_SET, type ServiceId } from '../proposal/enums'
import { pyReprQuoteOne } from '../proposal/py_repr'

// ---------------------------------------------------------------------------
// Small Python-mirroring local helpers (per-module-copy convention already
// established throughout this port — see e.g. `../proposal/world_validation
// .ts`/`../proposal/matrix.ts`'s own identical `enumMsg` copies).
// ---------------------------------------------------------------------------

/** Mirrors pydantic v2's `Input should be 'a', 'b' or 'c'` enum-error
 * message join style — see this module's own "Error-shape decision" doc
 * section for why a bare string, not pydantic's full `.errors()` array. */
function enumMsg(values: readonly string[]): string {
  const quoted = values.map(pyReprQuoteOne)
  if (quoted.length <= 1) return `Input should be ${quoted[0] ?? ''}`
  return `Input should be ${quoted.slice(0, -1).join(', ')} or ${quoted[quoted.length - 1]}`
}

/** Compile-time-checked source of truth for "the twelve `JourneyActionType`s"
 * — see this module's own "Reused, not rebuilt" doc section. Deleting or
 * misspelling a member here fails to COMPILE (TS2741/TS2353) rather than
 * silently under-covering the enum-membership gate below. */
const JOURNEY_ACTION_TYPE_KEYS: Record<JourneyActionType, true> = {
  accept: true,
  reject: true,
  postpone: true,
  choose_another: true,
  request_more: true,
  complete: true,
  continue: true,
  stop: true,
  motion_change: true,
  rest_spot_arrived: true,
  rest_started: true,
  rest_completed: true,
}
const JOURNEY_ACTION_TYPES: readonly JourneyActionType[] = Object.keys(JOURNEY_ACTION_TYPE_KEYS) as JourneyActionType[]
const JOURNEY_ACTION_TYPE_SET: ReadonlySet<string> = new Set(JOURNEY_ACTION_TYPES)

const SELECTED_SERVICE_ID_ENUM_MSG = enumMsg(SERVICE_ID_VALUES)
const ACTION_TYPE_ENUM_MSG = enumMsg(JOURNEY_ACTION_TYPES)

// `f"{e.event_type}@{e.at}"` — mirrors `tick.ts`'s own identical local
// `eventIds`/`DISCRETE_EVENT_TYPE_PY_PREFIX` copy (see that file's own doc
// comment for the interpreter-verified `DiscreteEventType.` prefix quirk;
// not re-derived here, only reproduced — this file's own three ported
// spans embed the EXACT SAME `f"{e.event_type}@{e.at}"` expression at two
// call sites, both ported by tick.ts's sibling task, Task 6, for the
// identical pattern).
const DISCRETE_EVENT_TYPE_PY_PREFIX = 'DiscreteEventType.'
function eventIds(events: ProposalRunLog['events']): string[] {
  return events.map((e) => `${DISCRETE_EVENT_TYPE_PY_PREFIX}${e.event_type}@${e.at}`)
}

// ---------------------------------------------------------------------------
// accept_rest_endpoint -> acceptRest (merged_runs.py:824-892)
// ---------------------------------------------------------------------------

/**
 * Port of `accept_rest_endpoint`. See this module's own doc comment for the
 * full control-flow enumeration (Step 1) and the "genuinely unreachable"
 * note on the inner `RunNotFoundError` catch.
 *
 * @throws ProposalHttpError(404) — unknown `mergedRunId`, or the paired
 *   trigger run is unknown (either via the up-front `getScenario` check or
 *   — structurally unreachable, ported anyway — `action()`'s own
 *   `RunNotFoundError`).
 * @throws ProposalHttpError(422) — `action()` rejects the action (e.g. an
 *   unknown `recovery_option_id`, or the trigger run isn't currently
 *   paused on a pending proposal).
 */
export async function acceptRest(mergedRunId: string, body: AcceptRestBody): Promise<RunStateM2> {
  const handle = await getHandle(mergedRunId)
  if (handle === undefined) {
    throw new ProposalHttpError(404, `Merged run ${pyReprQuoteOne(mergedRunId)} not found`)
  }

  const scenario = getScenario(handle.trigger_run_id)
  const triggerRunState = getRun(handle.trigger_run_id)
  if (scenario === null || triggerRunState === null) {
    throw new ProposalHttpError(404, `Trigger run ${pyReprQuoteOne(handle.trigger_run_id)} not found`)
  }

  let runState: RunStateM2
  try {
    if (body.nap_minutes !== null) {
      // Build an isolated per-run ScenarioDefM2 copy (Task 6's
      // `overrideNapStageTicks`, PURE) and install it into ONLY this
      // trigger run's own registry entry — never mutate `scenario` in
      // place (see `overrideNapStageTicks`'s/`replaceScenario`'s own doc
      // comments for why that object may be shared with other runs).
      // Convert nap_minutes -> ticks with the run's EFFECTIVE cadence
      // (event_plan.tick_seconds), not the scenario-authored default: the
      // combined screen pins a finer tick (20s) in the run-plan presets,
      // and dividing by the stale scenario.tick_seconds (180s) would make
      // the nap hold only ~1/9 of the requested duration.
      const updatedScenario = overrideNapStageTicks(
        scenario,
        body.recovery_option_id,
        body.nap_minutes,
        Number((triggerRunState.event_plan as EventPlan).tick_seconds),
      )
      replaceScenario(handle.trigger_run_id, updatedScenario)
    }

    runState = await action(handle.trigger_run_id, 'accept_rest', {
      recoveryOptionId: body.recovery_option_id,
      restSpot: body.rest_spot as RestSpot,
    })
  } catch (exc) {
    if (exc instanceof RunNotFoundError) {
      throw new ProposalHttpError(404, `Trigger run ${pyReprQuoteOne(handle.trigger_run_id)} not found`)
    }
    if (exc instanceof ActionNotAllowedError) {
      throw new ProposalHttpError(422, exc.message)
    }
    throw exc
  }

  handle.rest_stage_synced = 'before'
  handle.nap_minutes = body.nap_minutes
  await saveHandle(handle)

  return runState
}

// ---------------------------------------------------------------------------
// decline_rest_endpoint -> declineRest (merged_runs.py:892-934)
// ---------------------------------------------------------------------------

/**
 * Port of `decline_rest_endpoint`. See this module's own doc comment for
 * the full control-flow enumeration (Step 1).
 *
 * @throws ProposalHttpError(404) — unknown `mergedRunId`, or the paired
 *   trigger run is unknown (`action()`'s own `RunNotFoundError` — the ONLY
 *   path to this 404 for `declineRest`, unlike `acceptRest`'s two).
 * @throws ProposalHttpError(422) — `action()` rejects the action (the
 *   trigger run isn't currently paused on a pending proposal).
 */
export async function declineRest(mergedRunId: string): Promise<RunStateM2> {
  const handle = await getHandle(mergedRunId)
  if (handle === undefined) {
    throw new ProposalHttpError(404, `Merged run ${pyReprQuoteOne(mergedRunId)} not found`)
  }

  let runState: RunStateM2
  try {
    runState = await action(handle.trigger_run_id, 'decline')
  } catch (exc) {
    if (exc instanceof RunNotFoundError) {
      throw new ProposalHttpError(404, `Trigger run ${pyReprQuoteOne(handle.trigger_run_id)} not found`)
    }
    if (exc instanceof ActionNotAllowedError) {
      throw new ProposalHttpError(422, exc.message)
    }
    throw exc
  }

  // Re-arm the fire guard so a later re-fire creates a new proposal run.
  handle.current_proposal_run_id = null
  // Clear the category alongside the run id — they describe the same
  // "current proposal", so leaving a stale category behind would make the
  // next fire's category comparison meaningless.
  handle.current_proposal_category = null
  await saveHandle(handle)

  return runState
}

// ---------------------------------------------------------------------------
// reject_proposal_endpoint -> rejectProposal (fixbug-0806)
// ---------------------------------------------------------------------------

/** What `rejectProposal` returns: the updated proposal run, plus whether the
 * trigger-side decline actually ran. The flag is not cosmetic — it is what
 * tells the caller whether the fire guard was re-armed (see below). */
export type RejectProposalResult = { proposal: ProposalRunLog; declined: boolean }

/**
 * Port of `reject_proposal_endpoint`. Rejects the CURRENT proposal-side
 * service/content offer — the guided overlay's "Reject" at the pre-rest
 * SERVICE step and at the CONTENT step, for any trigger category.
 *
 * Why this is NOT `declineRest`: that answers "no" to the TRIGGER's rest
 * recommendation and needs the trigger run still paused on a pending
 * proposal. Once the driver has accepted the rest (`acceptRest`) or the
 * monotony flow has acknowledged the trigger (`proposalAction`'s accept
 * branch), that precondition is gone and calling it again fails. But the
 * owner's semantics are narrower than "undo the rest": the driver may accept
 * the rest stop and STILL reject the service offered for the drive there, and
 * wrong content may make them reject even after accepting the service. So
 * this always applies the proposal-side rejection and treats the trigger-side
 * decline as OPTIONAL/best-effort.
 *
 * `declined` distinguishes two outcomes with OPPOSITE effects on the guard:
 *   - true  — the decline ran, so (exactly like `declineRest`) the fire guard
 *     is re-armed and a later re-fire spawns a fresh proposal run.
 *   - false — the trigger had already moved on. Re-arming here would be
 *     actively WRONG for the REST flow: `tickMergedRun`'s auto-drive keys its
 *     before->during->after transitions off `current_proposal_run_id` +
 *     `rest_stage_synced`, both still pointing at the run the driver is
 *     mid-journey on. Clearing it would orphan that journey — the next tick
 *     would see no current proposal and try to spawn a brand-new run instead
 *     of continuing the recovery already under way.
 *
 * @throws ProposalHttpError(404) — unknown `mergedRunId`, or the merged run
 *   has no active proposal run yet.
 * @throws ProposalHttpError(422) — propagated UNCAUGHT from
 *   `applyJourneyAction` (e.g. nothing offered to reject), same convention
 *   as `proposalAction`'s journey_action branch.
 */
export async function rejectProposal(mergedRunId: string): Promise<RejectProposalResult> {
  const handle = await getHandle(mergedRunId)
  if (handle === undefined) {
    throw new ProposalHttpError(404, `Merged run ${pyReprQuoteOne(mergedRunId)} not found`)
  }
  if (handle.current_proposal_run_id === null) {
    throw new ProposalHttpError(404, `Merged run ${pyReprQuoteOne(mergedRunId)} has no active proposal run`)
  }

  const runId = handle.current_proposal_run_id
  const plog = await applyJourneyAction(runId, { action_type: 'reject', payload: {} })

  let declined = false
  try {
    await action(handle.trigger_run_id, 'decline')
    declined = true
  } catch (exc) {
    // Already resolved by acceptRest (rest under way) or a prior acknowledge
    // (monotony content already accepted) — not a failure of the
    // proposal-side reject the caller asked for.
    if (!(exc instanceof ActionNotAllowedError || exc instanceof RunNotFoundError)) {
      throw exc
    }
  }

  if (declined) {
    handle.current_proposal_run_id = null
    handle.current_proposal_category = null
  }

  // Refresh the matching CorrelationEntry's proposal_event_ids (mirrors
  // `proposalAction`'s own loop — index-based REVERSE iteration, never
  // `.reverse()`, which would mutate the append-only log's order in place).
  for (let i = handle.correlation_log.length - 1; i >= 0; i--) {
    const corr = handle.correlation_log[i]
    if (corr.proposal_run_id === runId) {
      corr.proposal_event_ids = plog.events.map((e) => `${e.event_type}@${e.at}`)
      break
    }
  }
  await saveHandle(handle)

  return { proposal: plog, declined }
}

// ---------------------------------------------------------------------------
// proposal_action_endpoint -> proposalAction (merged_runs.py:1206-1327)
// ---------------------------------------------------------------------------

/**
 * Port of `proposal_action_endpoint`. See this module's own doc comment
 * for the full control-flow enumeration (Step 1), the twelve-action
 * coverage statement, the error-shape decision, and the reverse-iteration
 * Hazard-4 note.
 *
 * @throws ProposalHttpError(404) — unknown `mergedRunId`; the merged run
 *   has no active proposal run yet (no fire has happened); OR propagated
 *   UNCAUGHT from `selectService`/`applyJourneyAction` (e.g. an unknown
 *   proposal run id).
 * @throws ProposalHttpError(422) — `selected_service_id`/`action_type`
 *   missing for their respective `kind`; not a member of the 14
 *   `ServiceId`s / 12 `JourneyActionType`s; OR propagated UNCAUGHT from
 *   `selectService` (not eligible / unknown content package / unsupported
 *   by the content package) or `applyJourneyAction` (a real
 *   `TransitionRejection`) — in every UNCAUGHT case NOTHING below the
 *   throwing call runs: no correlation refresh, no `saveHandle`.
 */
export async function proposalAction(mergedRunId: string, body: MergedProposalActionBody): Promise<ProposalRunLog> {
  const handle = await getHandle(mergedRunId)
  if (handle === undefined) {
    throw new ProposalHttpError(404, `Merged run ${pyReprQuoteOne(mergedRunId)} not found`)
  }
  if (handle.current_proposal_run_id === null) {
    throw new ProposalHttpError(404, `Merged run ${pyReprQuoteOne(mergedRunId)} has no active proposal run`)
  }

  const runId = handle.current_proposal_run_id
  let plog: ProposalRunLog

  if (body.kind === 'select_service') {
    if (body.selected_service_id === null) {
      throw new ProposalHttpError(422, "selected_service_id is required for kind='select_service'")
    }
    if (!SERVICE_ID_SET.has(body.selected_service_id)) {
      throw new ProposalHttpError(
        422,
        `selected_service_id: ${SELECTED_SERVICE_ID_ENUM_MSG} (got ${JSON.stringify(body.selected_service_id)})`,
      )
    }
    const selectBody: SelectServiceBody = {
      selected_service_id: body.selected_service_id as ServiceId,
      // feature 020 override plumbing: CONTENT parameters/hyperparameters
      // carried from CreateMergedRunBody onto the handle. Empty (default
      // {}) is identical to SelectServiceBody's own field defaults, so an
      // existing merged run created without these fields is unaffected.
      parameters: handle.content_parameters,
      hyperparameters: handle.content_hyperparameters,
    }
    plog = await selectService(runId, selectBody)
  } else {
    // kind === 'journey_action' (the only other MergedProposalActionBody.kind)
    if (body.action_type === null) {
      throw new ProposalHttpError(422, "action_type is required for kind='journey_action'")
    }
    if (!JOURNEY_ACTION_TYPE_SET.has(body.action_type)) {
      throw new ProposalHttpError(
        422,
        `action_type: ${ACTION_TYPE_ENUM_MSG} (got ${JSON.stringify(body.action_type)})`,
      )
    }
    const journeyAction: JourneyAction = { action_type: body.action_type, payload: body.payload }
    plog = await applyJourneyAction(runId, journeyAction)

    // ── Record the driver's response on the TRIGGER run ─────────────────
    // Picking a service for a MONOTONY opportunity is only BROWSING — the
    // driver's real "yes" is starting the content (fixbug-0806: this block
    // used to sit in the `select_service` branch above; acknowledging at
    // selection time consumed the trigger's pending proposal before the
    // driver had even seen the song list, which made a later proposal-side
    // reject impossible and rebaselined the Hybrid's monotony accumulator
    // even when the driver ultimately rejected the content). The trigger
    // side has to learn the ACCEPT: proposal_history.lastProposalResult is
    // what rebaselines that accumulator. REST opportunities are deliberately
    // excluded (answered by accept-rest/decline instead).
    // Best-effort: action() rejects when the trigger run isn't paused on a
    // pending proposal — that must not turn a successful accept into an error.
    if (body.action_type === 'accept' && handle.current_proposal_category === 'monotony_prevention') {
      try {
        await action(handle.trigger_run_id, 'acknowledge')
      } catch (exc) {
        if (!(exc instanceof ActionNotAllowedError || exc instanceof RunNotFoundError)) {
          throw exc
        }
      }
    }
  }

  // Refresh the correlation entry's proposal_event_ids for this proposal
  // run (LAST entry tied to run_id — see this module's own Hazard-4 doc
  // section for why index-based reverse iteration, never `.reverse()`).
  for (let i = handle.correlation_log.length - 1; i >= 0; i--) {
    const corr = handle.correlation_log[i]
    if (corr.proposal_run_id === runId) {
      corr.proposal_event_ids = eventIds(plog.events)
      break
    }
  }
  await saveHandle(handle)

  return plog
}
