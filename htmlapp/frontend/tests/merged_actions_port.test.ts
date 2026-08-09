import { describe, it, expect, beforeEach, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { ensureRegistry } from '../src/data/registry'
import { seedDefaults } from '../src/storage/db'
import { resetDispatchState } from '../src/engine/worker/dispatch'
import { clearDraftRegistry } from '../src/engine/run_plan'
import { clearRegistry, getActiveRunLog, getScenario, getRun as getTriggerRun, replaceScenario, RunNotFoundError } from '../src/engine/run_manager'
import { loadFixture, expectParity } from '../src/engine/__fixtures__/parity'
import { worldSeedStore } from '../src/engine/proposal/stores'
import { createMergedPlan, createMergedRun, type CreateMergedPlanBody, type CreateMergedRunBody } from '../src/engine/merged/run_setup'
import { saveHandle, getHandle } from '../src/storage/merged_runs_store'
import { ProposalHttpError } from '../src/engine/proposal/orchestrator/create_run'
import { tickMergedRun } from '../src/engine/merged/tick'
import { acceptRest, declineRest, proposalAction } from '../src/engine/merged/actions'
import * as journeyActionModule from '../src/engine/proposal/orchestrator/journey_action'
import { runsRestSpots } from '../src/engine/worker/handlers/runs'
import type { JourneyActionType } from '../src/engine/proposal/journey'
import type { MergedRunHandle, CorrelationEntry } from '../src/engine/merged/types'
import type { RunStateM2 } from '../src/engine/run_manager'
import type { ProposalRunLog } from '../src/engine/proposal/run_manager'

/**
 * Conformance test for `src/engine/merged/actions.ts` — the port of the
 * three ACTION endpoints of `routers/merged_runs.py`:
 * `accept_rest_endpoint` (824-892), `decline_rest_endpoint` (892-934),
 * `proposal_action_endpoint` (1206-1327) — feature 026 (htmlapp Combined
 * export), slice C4 Task 7. See `actions.ts`'s own module doc for the
 * full control-flow enumeration, hazard pass, and `.get()`/`or` audit.
 *
 * Fixture: `src/engine/__fixtures__/parity/merged_actions.json`, captured
 * by `scripts/gen/capture_all.py#_capture_merged_actions` — same package/
 * scenario/seed combo `merged_tick.json` uses (tick 12 fires
 * MONOTONY_PROPOSAL, tick 17 fires REST_PROPOSAL).
 *
 * ── Branch coverage table (per the task brief's reporting rule) ───────────
 *
 * `acceptRest`: golden-covered — `not_paused` (422, semantic — the message
 * embeds `run_manager.action`'s own `RunStatus!r}`-shaped text this port's
 * `action()` does not byte-reproduce, a PRE-EXISTING out-of-scope
 * divergence), `merged_run_not_found` (404, exact), `trigger_run_not_found`
 * (404, semantic — the trigger run id is scrubbed in the golden, so only
 * the constant prefix/suffix text is compared), `unknown_recovery_option`
 * (422, exact), `success_no_nap_override` / `success_with_nap_override`
 * (both exact on `run_state`/the id-stripped `handle`, PLUS a direct
 * `getScenario` read proving the override reached the trigger run's own
 * registry entry — not merely that `handle.nap_minutes` was recorded).
 * NOT golden-covered (disclosed): the inner `RunNotFoundError` catch — see
 * `actions.ts`'s own "Genuinely unreachable" doc section; no real call
 * sequence in either language can construct this branch.
 *
 * `declineRest`: golden-covered — `not_paused`, `merged_run_not_found`,
 * `trigger_run_not_found` (SAME three shapes; `trigger_run_not_found` HERE
 * is a genuinely different reachability path than `acceptRest`'s own —
 * `action()`'s own `RunNotFoundError`, not an up-front `getScenario`
 * check `declineRest` doesn't have), `success` (exact).
 *
 * `proposalAction`: golden-covered — `merged_run_not_found`,
 * `no_active_proposal_run` (both 404, exact/semantic), the FOUR
 * required-missing/invalid-enum 422s (exact for the bare-string
 * "required" messages; semantic for the two enum messages, matched
 * against the golden's raw pydantic `.errors()` array by field name +
 * every valid choice appearing in the message), the 5-step REAL sequence
 * (`reject`/`select_service`+acknowledge/`complete`-REJECTED/`accept`/
 * `complete`-success — exact on `plog`/id-stripped `handle` at every
 * step, PLUS the trigger run's own paused->playing transition), the
 * hand-built `correlation_multi_entry_reverse_iteration` case (exact —
 * proves reverse iteration finds the LAST matching entry, Hazard 4), and
 * the hand-built `uncaught_error_propagates` case (exact status codes +
 * the handle-untouched invariant). NOT golden-covered (disclosed, tested
 * separately below instead): all TWELVE `JourneyActionType`s individually
 * reaching `applyJourneyAction` through the enum gate — see `actions.ts`'s
 * own "ALL TWELVE" doc section for why this is a `vi.spyOn`-proven claim,
 * not a Python golden (Python's own equivalent is definitionally true by
 * the enum's own declaration).
 */

ensureRegistry()

beforeEach(async () => {
  globalThis.indexedDB = new IDBFactory()
  resetDispatchState()
  await seedDefaults()
  clearDraftRegistry()
  clearRegistry()
})

const PACKAGE_ID = 'nri_fatigue_score_v1'
const SCENARIO_ID = 'uc01_fatigue_recovery_v0_1'
const SEED_ID = 'seed-night-highway-oshi'
const SERVICE_PKG_ID = 'aica_transparent_service_selector_v1'
const CONTENT_PKG_ID = 'aica_transparent_content_selector_v1'
const RECOVERY_OPTION_ID = 'nap_karaoke'
const TRIGGER_RUN_SEED = 42
const PROPOSAL_RUN_SEED = '7'

function deepCopy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function baseWorld(): Record<string, unknown> {
  const seed = worldSeedStore.getSeed(SEED_ID)
  if (!seed) throw new Error(`fixture seed not found: ${SEED_ID}`)
  return deepCopy(seed.world as Record<string, unknown>)
}

async function setupMergedRun(overrides: Partial<CreateMergedRunBody> = {}): Promise<{ mergedRunId: string; triggerRunId: string }> {
  const planBody: CreateMergedPlanBody = {
    package_id: PACKAGE_ID, scenario_id: SCENARIO_ID, route_preset_id: null,
    run_seed: TRIGGER_RUN_SEED, mountain_range_km: null, jam_range_km: null,
    jam_speed_kph: 15.0, presets: {}, parameters: {}, hyperparameters: {},
    profiles: null, initial_state: null, context_overrides: null,
  }
  const plan = await createMergedPlan(planBody)
  const runBody: CreateMergedRunBody = {
    trigger_plan_id: plan.plan_id, world: baseWorld(),
    service_package_id: SERVICE_PKG_ID, content_package_id: CONTENT_PKG_ID,
    proposal_mode: 'interactive', run_seed: PROPOSAL_RUN_SEED,
    service_parameters: {}, service_hyperparameters: {}, content_parameters: {}, content_hyperparameters: {},
    ...overrides,
  }
  const run = await createMergedRun(runBody)
  return { mergedRunId: run.merged_run_id, triggerRunId: run.trigger_run_id }
}

/** Ticks a merged run until its first fire (`resp.proposal !== null`), OR
 * — when `wantRest` is set — its first REST_PROPOSAL fire specifically.
 * Mirrors `capture_all.py#_capture_merged_actions`'s own `_tick_until_fire`
 * helper (this exact package/scenario/seed combo is empirically pinned:
 * tick 12 = monotony, tick 17 = rest — verified directly against a live
 * Python interpreter before either capture or this test was written). */
async function tickUntilFire(mergedRunId: string, opts: { wantRest?: boolean } = {}, maxTicks = 20): Promise<Awaited<ReturnType<typeof tickMergedRun>>> {
  for (let i = 0; i < maxTicks; i++) {
    const resp = await tickMergedRun(mergedRunId)
    if (resp.proposal !== null) {
      const decision = resp.trigger.decision as { result_type?: string } | null
      if (!opts.wantRest || decision?.result_type === 'REST_PROPOSAL') {
        return resp
      }
    }
  }
  throw new Error(`expected a fire within ${maxTicks} ticks (wantRest=${opts.wantRest ?? false})`)
}

function stripLastAtSuffix(id: string): string {
  const idx = id.lastIndexOf('@')
  return idx === -1 ? id : id.slice(0, idx)
}

function redactRunState(rs: RunStateM2): Record<string, unknown> {
  const recovery = rs.recovery as Record<string, unknown> | null | undefined
  return {
    status: rs.status,
    current_tick: rs.current_tick,
    pending_proposal: rs.pending_proposal,
    recovery: recovery == null ? null : {
      active: recovery.active,
      option_id: recovery.option_id,
      phase: recovery.phase,
      stage_index: recovery.stage_index,
      stage_ticks_remaining: recovery.stage_ticks_remaining,
    },
  }
}

function redactPlog(p: ProposalRunLog): Record<string, unknown> {
  return {
    status: p.status,
    journey_state: {
      lifecycle_stage: p.journey_state.lifecycle_stage,
      playback_state: p.journey_state.playback_state,
      active_service_id: p.journey_state.active_service_id,
      rejected_service_ids: p.journey_state.rejected_service_ids,
    },
    event_types: p.events.map((e) => e.event_type),
  }
}

/** Full redaction, MATCHING the golden's own `_redact_handle` shape
 * (frozen id fields included) — used only where the test does its OWN
 * id-consistency assertions rather than an `expectParity` against the
 * golden (see `stripHandleIds` below for why `expectParity` itself never
 * compares the frozen id fields directly). */
function redactHandleFull(h: MergedRunHandle): Record<string, unknown> {
  return {
    current_proposal_run_id: h.current_proposal_run_id,
    current_proposal_category: h.current_proposal_category,
    rest_stage_synced: h.rest_stage_synced,
    nap_minutes: h.nap_minutes,
    correlation_log: h.correlation_log.map((c) => ({
      trigger_tick_index: c.trigger_tick_index,
      proposal_run_id: c.proposal_run_id,
      event_types: c.proposal_event_ids.map(stripLastAtSuffix),
    })),
  }
}

/** Drops every id field from a `redactHandleFull`-shaped object (or the
 * golden's own `_redact_handle` output — SAME field names minus the
 * `_frozen` suffix) — `expectParity` then compares only what is genuinely
 * DETERMINISTIC and order-independent-of-test-execution: category/stage/
 * nap/tick-index/event-types. The golden's `*_frozen` ids are assigned in
 * FIRST-ENCOUNTER order ACROSS THE WHOLE PYTHON CAPTURE FUNCTION — trying
 * to reproduce the exact same `ID_N` numbers here would require this TS
 * test to create/fire merged runs in the IDENTICAL order the Python
 * capture did, which is incidental test-authoring detail, not a real
 * behavioral claim. The actual id-EQUALITY relationships the golden's
 * numbering encodes (e.g. "this correlation entry targets the SAME run as
 * `current_proposal_run_id`") are instead asserted directly against real
 * (unfrozen) ids in each test below. */
function stripHandleIds(h: Record<string, unknown>): Record<string, unknown> {
  const { current_proposal_run_id_frozen: _a, current_proposal_run_id: _b, correlation_log, ...rest } = h as Record<string, unknown> & {
    correlation_log?: Array<Record<string, unknown>>
  }
  return {
    ...rest,
    correlation_log: (correlation_log ?? []).map((c) => {
      const { proposal_run_id_frozen: _c, proposal_run_id: _d, ...r } = c
      return r
    }),
  }
}

const fixture = loadFixture('merged_actions') as {
  output: {
    accept_rest: Record<string, unknown>
    decline: Record<string, unknown>
    proposal_action: Record<string, unknown> & {
      real_sequence: Record<string, { plog?: Record<string, unknown>; handle?: Record<string, unknown> }>
      correlation_multi_entry_reverse_iteration: {
        before: Array<Record<string, unknown>>
        after: Array<Record<string, unknown>>
      }
      uncaught_error_propagates: {
        select_service: { status_code: number; detail: unknown }
        journey_action: { status_code: number; detail: unknown }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// replaceScenario — small NEW sibling helper this task ported (services/
// run_manager.py's replace_scenario, 193-222) into ../src/engine/run_manager
// .ts — not part of `actions.ts` itself, but genuinely NEW code this task
// introduced (`acceptRest`'s own call site cannot exercise its throw path —
// see actions.ts's own "Genuinely unreachable" doc section), so it gets its
// OWN direct unit coverage here rather than relying solely on acceptRest's
// indirect (success-path-only) exercise of it.
// ---------------------------------------------------------------------------

describe('replaceScenario — direct unit coverage (small sibling helper ported by this task)', () => {
  it('throws RunNotFoundError for an unknown runId', () => {
    expect(() => replaceScenario('run_never_created', {} as never)).toThrow(RunNotFoundError)
  })

  it('installs the NEW scenario into ONLY this run\'s own registry entry, leaving the object getScenario previously returned untouched', async () => {
    const { triggerRunId } = await setupMergedRun()
    const original = getScenario(triggerRunId)!
    const replacement = { ...original, tick_seconds: 999 }

    replaceScenario(triggerRunId, replacement)

    expect(getScenario(triggerRunId)).toBe(replacement)
    expect(getScenario(triggerRunId)?.tick_seconds).toBe(999)
    // The ORIGINAL object itself was never mutated in place (the whole
    // point of the "replace, don't mutate" invariant this function guards).
    expect(original.tick_seconds).not.toBe(999)
  })
})

// ---------------------------------------------------------------------------
// acceptRest — parity against real Python (accept_rest_endpoint)
// ---------------------------------------------------------------------------

describe('acceptRest — parity against real Python (accept_rest_endpoint)', () => {
  it('not_paused: a FRESH (un-ticked) run -> 422 (semantic — action()\'s own pre-existing message-format divergence)', async () => {
    const { mergedRunId } = await setupMergedRun()
    const golden = fixture.output.accept_rest.not_paused as { status_code: number; detail: string }
    try {
      await acceptRest(mergedRunId, {
        recovery_option_id: RECOVERY_OPTION_ID,
        rest_spot: { id: 'rest_0', label: { ja: 'x', en: 'x' }, route_fraction: 0.5, distance_km: 1, eta_min: 1, reachable: true },
        nap_minutes: null,
      })
      expect.unreachable()
    } catch (exc) {
      expect(exc).toBeInstanceOf(ProposalHttpError)
      expect((exc as ProposalHttpError).status).toBe(golden.status_code)
      const detail = (exc as ProposalHttpError).detail as string
      expect(detail).toContain('No pending proposal for run')
      expect(detail).toContain("status='created'")
    }
  })

  it('merged_run_not_found: unknown mergedRunId -> 404 exact', async () => {
    const golden = fixture.output.accept_rest.merged_run_not_found as { status_code: number; detail: string }
    try {
      await acceptRest('mrun_bogus_id', {
        recovery_option_id: RECOVERY_OPTION_ID,
        rest_spot: { id: 'rest_0', label: { ja: 'x', en: 'x' }, route_fraction: 0.5, distance_km: 1, eta_min: 1, reachable: true },
        nap_minutes: null,
      })
      expect.unreachable()
    } catch (exc) {
      expect(exc).toBeInstanceOf(ProposalHttpError)
      expect((exc as ProposalHttpError).status).toBe(golden.status_code)
      expect((exc as ProposalHttpError).detail).toBe(golden.detail)
    }
  })

  it('trigger_run_not_found: handle persists but the trigger run\'s registry entry is gone (clearRegistry) -> 404 semantic', async () => {
    const { mergedRunId, triggerRunId } = await setupMergedRun()
    clearRegistry()
    const golden = fixture.output.accept_rest.trigger_run_not_found as { status_code: number; detail: string }
    try {
      await acceptRest(mergedRunId, {
        recovery_option_id: RECOVERY_OPTION_ID,
        rest_spot: { id: 'rest_0', label: { ja: 'x', en: 'x' }, route_fraction: 0.5, distance_km: 1, eta_min: 1, reachable: true },
        nap_minutes: null,
      })
      expect.unreachable()
    } catch (exc) {
      expect(exc).toBeInstanceOf(ProposalHttpError)
      expect((exc as ProposalHttpError).status).toBe(golden.status_code)
      // The golden's own detail has the real trigger_run_id SCRUBBED to a
      // fixed placeholder (see capture_all.py's own `_scrub` — required
      // for "two consecutive capture runs are byte-identical"), so this
      // test compares the STABLE surrounding text plus this test's own
      // REAL (unscrubbed) triggerRunId, rather than the golden's literal
      // placeholder string.
      expect((exc as ProposalHttpError).detail).toBe(`Trigger run '${triggerRunId}' not found`)
      expect(golden.detail).toBe("Trigger run '<TRIGGER_RUN_ID>' not found")
    }
  })

  it('unknown_recovery_option: a run paused on ANY fire, bogus recovery_option_id -> 422 semantic (a PRE-EXISTING, out-of-scope quote-style divergence in the already-ported action(): JSON.stringify double-quotes where Python\'s {!r} single-quotes)', async () => {
    const { mergedRunId } = await setupMergedRun()
    await tickUntilFire(mergedRunId)
    const golden = fixture.output.accept_rest.unknown_recovery_option as { status_code: number; detail: string }
    try {
      await acceptRest(mergedRunId, {
        recovery_option_id: 'bogus_option_id',
        rest_spot: { id: 'rest_0', label: { ja: 'x', en: 'x' }, route_fraction: 0.5, distance_km: 1, eta_min: 1, reachable: true },
        nap_minutes: null,
      })
      expect.unreachable()
    } catch (exc) {
      expect(exc).toBeInstanceOf(ProposalHttpError)
      expect((exc as ProposalHttpError).status).toBe(golden.status_code)
      const detail = (exc as ProposalHttpError).detail as string
      expect(detail).toBe(golden.detail.replace(/'bogus_option_id'/, '"bogus_option_id"'))
      expect(detail).toContain('accept_rest requires a valid recovery_option_id + rest_spot')
      expect(detail).toContain('bogus_option_id')
    }
  })

  it('success_no_nap_override: tick 17 REST fire, nap_minutes=null -> run_state + handle exact', async () => {
    const { mergedRunId, triggerRunId } = await setupMergedRun()
    await tickUntilFire(mergedRunId, { wantRest: true })
    const { rest_spots: spots } = await runsRestSpots({ runId: triggerRunId })
    const runState = await acceptRest(mergedRunId, {
      recovery_option_id: RECOVERY_OPTION_ID, rest_spot: spots[0], nap_minutes: null,
    })
    const handle = await getHandle(mergedRunId)
    expect(handle?.rest_stage_synced).toBe('before')
    expect(handle?.nap_minutes).toBeNull()

    const golden = fixture.output.accept_rest.success_no_nap_override as { run_state: unknown; handle: Record<string, unknown> }
    expectParity(redactRunState(runState), golden.run_state)
    expectParity(stripHandleIds(redactHandleFull(handle!)), stripHandleIds(golden.handle))
  })

  it('success_with_nap_override: tick 17 REST fire, nap_minutes=15 -> the INSTALLED scenario\'s own nap stage reflects round(15*60/180)==5', async () => {
    const { mergedRunId, triggerRunId } = await setupMergedRun()
    await tickUntilFire(mergedRunId, { wantRest: true })
    const { rest_spots: spots } = await runsRestSpots({ runId: triggerRunId })
    const runState = await acceptRest(mergedRunId, {
      recovery_option_id: RECOVERY_OPTION_ID, rest_spot: spots[0], nap_minutes: 15,
    })
    const handle = await getHandle(mergedRunId)
    expect(handle?.rest_stage_synced).toBe('before')
    expect(handle?.nap_minutes).toBe(15)

    const scenario = getScenario(triggerRunId)!
    const option = scenario.recovery_options!.find((o) => o.id === RECOVERY_OPTION_ID)!
    const napStage = option.stages!.find((s) => s.phase === 'nap' && s.motion === 'STOPPED')!
    expect(napStage.ticks).toBe(5)

    const golden = fixture.output.accept_rest.success_with_nap_override as {
      run_state: unknown; handle: Record<string, unknown>; installed_nap_stage_ticks: number
    }
    expect(napStage.ticks).toBe(golden.installed_nap_stage_ticks)
    expectParity(redactRunState(runState), golden.run_state)
    expectParity(stripHandleIds(redactHandleFull(handle!)), stripHandleIds(golden.handle))
    // The id-consistency claim the golden's ID_2/ID_3 numbering encodes,
    // asserted directly against real (unfrozen) ids instead of trying to
    // reproduce the golden's own first-encounter numbering (see
    // `stripHandleIds`'s own doc comment for why): TWO distinct
    // generations (monotony CREATE at tick 12, rest CREATE at tick 17,
    // category differs) — the LATEST correlation entry is the one
    // `current_proposal_run_id` now points at; the earlier one is a
    // DIFFERENT run.
    expect(handle!.correlation_log.length).toBe(2)
    expect(handle!.correlation_log[1].proposal_run_id).toBe(handle!.current_proposal_run_id)
    expect(handle!.correlation_log[0].proposal_run_id).not.toBe(handle!.correlation_log[1].proposal_run_id)
  })

  it('append-only: accept-rest APPENDS one ActionEvent to the trigger run\'s event log, never rewrites — deep-copy BEFORE the mutating call (IN-PLACE MUTATION TRAP)', async () => {
    const { mergedRunId, triggerRunId } = await setupMergedRun()
    await tickUntilFire(mergedRunId, { wantRest: true })
    const { rest_spots: spots } = await runsRestSpots({ runId: triggerRunId })

    // Deep-copy FIRST — the trigger-side in-memory registry (`run_manager
    // .ts#_registry`) holds the SAME object reference across calls; a
    // shallow/no-copy snapshot here would be corrupted by the very call
    // this test is trying to prove appends rather than rewrites.
    const before = deepCopy((await getActiveRunLog(triggerRunId))!.events)

    await acceptRest(mergedRunId, { recovery_option_id: RECOVERY_OPTION_ID, rest_spot: spots[0], nap_minutes: null })

    const after = (await getActiveRunLog(triggerRunId))!.events
    expect(after.length).toBe(before.length + 1)
    expect(after.slice(0, before.length)).toEqual(before)
    expect((after[after.length - 1] as { kind: string }).kind).toBe('action')
    expect((after[after.length - 1] as { action: string }).action).toBe('accept_rest')
  })
})

// ---------------------------------------------------------------------------
// declineRest — parity against real Python (decline_rest_endpoint)
// ---------------------------------------------------------------------------

describe('declineRest — parity against real Python (decline_rest_endpoint)', () => {
  it('not_paused: a FRESH (un-ticked) run -> 422 semantic', async () => {
    const { mergedRunId } = await setupMergedRun()
    try {
      await declineRest(mergedRunId)
      expect.unreachable()
    } catch (exc) {
      expect(exc).toBeInstanceOf(ProposalHttpError)
      expect((exc as ProposalHttpError).status).toBe(422)
      const detail = (exc as ProposalHttpError).detail as string
      expect(detail).toContain('No pending proposal for run')
    }
  })

  it('merged_run_not_found: unknown mergedRunId -> 404 exact', async () => {
    const golden = fixture.output.decline.merged_run_not_found as { status_code: number; detail: string }
    try {
      await declineRest('mrun_bogus_id')
      expect.unreachable()
    } catch (exc) {
      expect(exc).toBeInstanceOf(ProposalHttpError)
      expect((exc as ProposalHttpError).status).toBe(golden.status_code)
      expect((exc as ProposalHttpError).detail).toBe(golden.detail)
    }
  })

  it('trigger_run_not_found: registry entry gone (clearRegistry) -> 404 via action()\'s OWN RunNotFoundError (no up-front getScenario check, unlike acceptRest)', async () => {
    const { mergedRunId } = await setupMergedRun()
    clearRegistry()
    try {
      await declineRest(mergedRunId)
      expect.unreachable()
    } catch (exc) {
      expect(exc).toBeInstanceOf(ProposalHttpError)
      expect((exc as ProposalHttpError).status).toBe(404)
      expect((exc as ProposalHttpError).detail as string).toContain('Trigger run')
      expect((exc as ProposalHttpError).detail as string).toContain('not found')
    }
  })

  it('success: tick 17 REST fire, decline -> run_state + handle exact (re-arms the fire guard)', async () => {
    const { mergedRunId } = await setupMergedRun()
    await tickUntilFire(mergedRunId, { wantRest: true })
    const runState = await declineRest(mergedRunId)
    const handle = await getHandle(mergedRunId)
    expect(handle?.current_proposal_run_id).toBeNull()
    expect(handle?.current_proposal_category).toBeNull()

    const golden = fixture.output.decline.success as { run_state: unknown; handle: Record<string, unknown> }
    expectParity(redactRunState(runState), golden.run_state)
    expectParity(stripHandleIds(redactHandleFull(handle!)), stripHandleIds(golden.handle))
  })

  it('append-only: decline APPENDS one ActionEvent to the trigger run\'s event log', async () => {
    const { mergedRunId, triggerRunId } = await setupMergedRun()
    await tickUntilFire(mergedRunId, { wantRest: true })
    const before = deepCopy((await getActiveRunLog(triggerRunId))!.events)

    await declineRest(mergedRunId)

    const after = (await getActiveRunLog(triggerRunId))!.events
    expect(after.length).toBe(before.length + 1)
    expect(after.slice(0, before.length)).toEqual(before)
    expect((after[after.length - 1] as { kind: string }).kind).toBe('action')
    expect((after[after.length - 1] as { action: string }).action).toBe('decline')
  })
})

// ---------------------------------------------------------------------------
// proposalAction — validation / not-found (no active proposal run)
// ---------------------------------------------------------------------------

describe('proposalAction — validation and not-found paths, parity against real Python', () => {
  it('merged_run_not_found: unknown mergedRunId -> 404 exact', async () => {
    const golden = fixture.output.proposal_action.merged_run_not_found as { status_code: number; detail: string }
    try {
      await proposalAction('mrun_bogus_id', { kind: 'select_service', selected_service_id: 'music_playlist', action_type: null, payload: {} })
      expect.unreachable()
    } catch (exc) {
      expect(exc).toBeInstanceOf(ProposalHttpError)
      expect((exc as ProposalHttpError).status).toBe(golden.status_code)
      expect((exc as ProposalHttpError).detail).toBe(golden.detail)
    }
  })

  it('no_active_proposal_run: a FRESH run, before any fire -> 404 semantic', async () => {
    const { mergedRunId } = await setupMergedRun()
    try {
      await proposalAction(mergedRunId, { kind: 'select_service', selected_service_id: 'music_playlist', action_type: null, payload: {} })
      expect.unreachable()
    } catch (exc) {
      expect(exc).toBeInstanceOf(ProposalHttpError)
      expect((exc as ProposalHttpError).status).toBe(404)
      expect((exc as ProposalHttpError).detail as string).toContain('has no active proposal run')
    }
  })

  it('select_service_required_missing: selected_service_id null -> 422 exact', async () => {
    const { mergedRunId } = await setupMergedRun()
    await tickUntilFire(mergedRunId)
    const golden = fixture.output.proposal_action.select_service_required_missing as { status_code: number; detail: string }
    try {
      await proposalAction(mergedRunId, { kind: 'select_service', selected_service_id: null, action_type: null, payload: {} })
      expect.unreachable()
    } catch (exc) {
      expect((exc as ProposalHttpError).status).toBe(golden.status_code)
      expect((exc as ProposalHttpError).detail).toBe(golden.detail)
    }
  })

  it('select_service_invalid_enum: unknown service id -> 422 semantic (bare-string, mentions the field + every real choice)', async () => {
    const { mergedRunId } = await setupMergedRun()
    await tickUntilFire(mergedRunId)
    const golden = fixture.output.proposal_action.select_service_invalid_enum as {
      status_code: number
      detail: Array<{ msg: string }>
    }
    try {
      await proposalAction(mergedRunId, { kind: 'select_service', selected_service_id: 'bogus_service_id', action_type: null, payload: {} })
      expect.unreachable()
    } catch (exc) {
      expect((exc as ProposalHttpError).status).toBe(golden.status_code)
      const detail = (exc as ProposalHttpError).detail as string
      expect(detail).toContain('selected_service_id')
      expect(detail).toContain("got \"bogus_service_id\"")
      // Every real choice pydantic's own message lists must also appear here.
      for (const choice of golden.detail[0].msg.match(/'[^']+'/g) ?? []) {
        expect(detail).toContain(choice)
      }
    }
  })

  it('journey_action_required_missing: action_type null -> 422 exact', async () => {
    const { mergedRunId } = await setupMergedRun()
    await tickUntilFire(mergedRunId)
    const golden = fixture.output.proposal_action.journey_action_required_missing as { status_code: number; detail: string }
    try {
      await proposalAction(mergedRunId, { kind: 'journey_action', selected_service_id: null, action_type: null, payload: {} })
      expect.unreachable()
    } catch (exc) {
      expect((exc as ProposalHttpError).status).toBe(golden.status_code)
      expect((exc as ProposalHttpError).detail).toBe(golden.detail)
    }
  })

  it('journey_action_invalid_enum: unknown action_type -> 422 semantic', async () => {
    const { mergedRunId } = await setupMergedRun()
    await tickUntilFire(mergedRunId)
    const golden = fixture.output.proposal_action.journey_action_invalid_enum as {
      status_code: number
      detail: Array<{ msg: string }>
    }
    try {
      await proposalAction(mergedRunId, { kind: 'journey_action', selected_service_id: null, action_type: 'bogus_action_type', payload: {} })
      expect.unreachable()
    } catch (exc) {
      expect((exc as ProposalHttpError).status).toBe(golden.status_code)
      const detail = (exc as ProposalHttpError).detail as string
      expect(detail).toContain('action_type')
      expect(detail).toContain("got \"bogus_action_type\"")
      for (const choice of golden.detail[0].msg.match(/'[^']+'/g) ?? []) {
        expect(detail).toContain(choice)
      }
    }
  })
})

// ---------------------------------------------------------------------------
// proposalAction — the real 5-step sequence (THE headline capture for this endpoint)
// ---------------------------------------------------------------------------

describe('proposalAction — real 5-step sequence, parity against real Python', () => {
  it('reject -> select_service(+acknowledge) -> complete(REJECTED, append-only) -> accept -> complete(success)', async () => {
    const { mergedRunId, triggerRunId } = await setupMergedRun()
    await tickUntilFire(mergedRunId)
    const golden = fixture.output.proposal_action.real_sequence

    // Step 1: reject
    const step1 = await proposalAction(mergedRunId, { kind: 'journey_action', selected_service_id: null, action_type: 'reject', payload: {} })
    let handle = await getHandle(mergedRunId)
    expectParity(redactPlog(step1), golden['1_reject'].plog)
    expectParity(stripHandleIds(redactHandleFull(handle!)), stripHandleIds(golden['1_reject'].handle!))

    // `journey_state` is `run_manager.ts`'s intentionally-opaque JourneyState
    // ([k: string]: unknown beyond the 4 named fields) — same cast convention
    // `journey_action.ts` itself uses for this exact field.
    const rejectedServiceIds = step1.journey_state.rejected_service_ids as string[]
    const rejectedId = rejectedServiceIds[0]
    const selectTarget = step1.opportunity.allowed_service_ids.find((sid) => sid !== rejectedId)!

    // Step 2: select_service (a DIFFERENT allowed id) — also triggers the
    // best-effort acknowledge branch (category is monotony_prevention).
    const statusBefore = getTriggerRun(triggerRunId)!.status
    const step2 = await proposalAction(mergedRunId, { kind: 'select_service', selected_service_id: selectTarget, action_type: null, payload: {} })
    const statusAfter = getTriggerRun(triggerRunId)!.status
    handle = await getHandle(mergedRunId)
    expectParity(redactPlog(step2), golden['2_select_service'].plog)
    expectParity(stripHandleIds(redactHandleFull(handle!)), stripHandleIds(golden['2_select_service'].handle!))
    expect(statusBefore).toBe((golden['2_select_service'] as unknown as { trigger_status_before_acknowledge: string }).trigger_status_before_acknowledge)
    expect(statusAfter).toBe((golden['2_select_service'] as unknown as { trigger_status_after_acknowledge: string }).trigger_status_after_acknowledge)

    // Step 3: complete -> REAL 422 TransitionRejection (playback_state is
    // still 'idle' — accept() hasn't run yet). Append-only "a rejection
    // touches nothing": deep-copy BEFORE, compare byte-exact AFTER.
    const handleBefore3 = deepCopy(redactHandleFull((await getHandle(mergedRunId))!))
    try {
      await proposalAction(mergedRunId, { kind: 'journey_action', selected_service_id: null, action_type: 'complete', payload: {} })
      expect.unreachable()
    } catch (exc) {
      expect(exc).toBeInstanceOf(ProposalHttpError)
      expect((exc as ProposalHttpError).status).toBe(422)
    }
    const handleAfter3 = redactHandleFull((await getHandle(mergedRunId))!)
    expect(handleAfter3).toEqual(handleBefore3)

    // Step 4: accept
    const step4 = await proposalAction(mergedRunId, { kind: 'journey_action', selected_service_id: null, action_type: 'accept', payload: {} })
    expectParity(redactPlog(step4), golden['4_accept'].plog)

    // Step 5: complete -> succeeds this time (playback_state is now 'active')
    const step5 = await proposalAction(mergedRunId, { kind: 'journey_action', selected_service_id: null, action_type: 'complete', payload: {} })
    handle = await getHandle(mergedRunId)
    expectParity(redactPlog(step5), golden['5_complete_success'].plog)
    expectParity(stripHandleIds(redactHandleFull(handle!)), stripHandleIds(golden['5_complete_success'].handle!))

    // Append-only over the WHOLE 5-call sequence, at the proposal-run
    // event-log level: every step's event_types list must be a PREFIX of
    // the next (nothing ever rewritten, only appended).
    const allSteps = [redactPlog(step1), redactPlog(step2), redactPlog(step4), redactPlog(step5)] as Array<{ event_types: string[] }>
    for (let i = 1; i < allSteps.length; i++) {
      const prevLen = allSteps[i - 1].event_types.length
      expect(allSteps[i].event_types.slice(0, prevLen)).toEqual(allSteps[i - 1].event_types)
      expect(allSteps[i].event_types.length).toBeGreaterThan(prevLen)
    }

    // The correlation entry itself never grows in COUNT (single generation,
    // one entry throughout) — only its ONE field is ever overwritten.
    expect(handle!.correlation_log.length).toBe(1)
  })

  it('acknowledge rides on `accept`, not on select_service (fixbug-0806), and its best-effort SWALLOW path is real: a SECOND accept after the trigger has already left "paused" succeeds without raising (real ActionNotAllowedError caught and dropped)', async () => {
    const { mergedRunId, triggerRunId } = await setupMergedRun()
    await tickUntilFire(mergedRunId)

    // select_service alone must NOT acknowledge any more. Picking a service is
    // only BROWSING; acknowledging here consumed the trigger's pending
    // proposal before the driver had even seen the song list, which is what
    // made a later proposal-side reject impossible and rebaselined the
    // Hybrid's monotony accumulator even when the driver went on to reject.
    await proposalAction(mergedRunId, { kind: 'select_service', selected_service_id: 'music_playlist', action_type: null, payload: {} })
    expect(getTriggerRun(triggerRunId)!.status).toBe('paused')

    // `accept` is the driver's real "yes" — acknowledge SUCCEEDS for real
    // here (status paused -> playing).
    await proposalAction(mergedRunId, { kind: 'journey_action', selected_service_id: null, action_type: 'accept', payload: {} })
    expect(getTriggerRun(triggerRunId)!.status).toBe('playing')

    // Re-select a DIFFERENT allowed id, then accept again: the trigger run is
    // NO LONGER paused, so action(trigger_run_id, 'acknowledge') genuinely
    // throws ActionNotAllowedError this time — this call must still SUCCEED
    // (the swallow, not a re-thrown error) rather than turning a successful
    // acceptance into a failure.
    await proposalAction(mergedRunId, { kind: 'select_service', selected_service_id: 'humming_karaoke', action_type: null, payload: {} })
    const plog = await proposalAction(mergedRunId, { kind: 'journey_action', selected_service_id: null, action_type: 'accept', payload: {} })
    expect(plog.journey_state.active_service_id).toBe('humming_karaoke')
    expect(getTriggerRun(triggerRunId)!.status).toBe('playing')
  })
})

// ---------------------------------------------------------------------------
// proposalAction — hand-built: correlation_log reverse iteration (Hazard 4)
// ---------------------------------------------------------------------------

describe('proposalAction — correlation_log reverse iteration finds the LAST matching entry (Hazard 4)', () => {
  it('a hand-built 3-entry correlation_log with TWO entries sharing the real run id: only the LAST is refreshed, order/length preserved', async () => {
    const { mergedRunId } = await setupMergedRun()
    await tickUntilFire(mergedRunId)
    const handle = await getHandle(mergedRunId)
    const realRunId = handle!.current_proposal_run_id!

    const handBuilt: MergedRunHandle = {
      ...handle!,
      correlation_log: [
        { trigger_tick_index: 0, proposal_run_id: 'never_resolved_placeholder', proposal_event_ids: ['UNRELATED@t0'] },
        { trigger_tick_index: 1, proposal_run_id: realRunId, proposal_event_ids: ['STALE_FIRST@t1'] },
        { trigger_tick_index: 2, proposal_run_id: realRunId, proposal_event_ids: ['STALE_SECOND@t2'] },
      ] as CorrelationEntry[],
    }
    await saveHandle(handBuilt)

    // Deep-copy BEFORE the mutating call (IN-PLACE MUTATION TRAP guard —
    // even though this store's `getHandle` is IndexedDB-backed and
    // structurally clones on every read, deep-copying here is a defensive
    // habit this whole test file follows uniformly, never assumed safe by
    // store choice alone).
    const before = deepCopy((await getHandle(mergedRunId))!.correlation_log)

    await proposalAction(mergedRunId, { kind: 'journey_action', selected_service_id: null, action_type: 'reject', payload: {} })

    const after = (await getHandle(mergedRunId))!.correlation_log
    expect(after.length).toBe(before.length)
    expect(after[0]).toEqual(before[0])
    expect(after[1]).toEqual(before[1])
    expect(after[2]).not.toEqual(before[2])
    expect(after[2].proposal_run_id).toBe(realRunId)
    expect(after[2].proposal_event_ids.map(stripLastAtSuffix)).toEqual([
      'DiscreteEventType.OPPORTUNITY_OPENED', 'DiscreteEventType.SERVICE_SELECTED', 'DiscreteEventType.SERVICE_REJECTED',
    ])

    const golden = fixture.output.proposal_action.correlation_multi_entry_reverse_iteration
    expect(golden.before[0]).toEqual({ trigger_tick_index: 0, proposal_run_id_is_real_run: false, proposal_event_ids: ['UNRELATED@t0'] })
    expect(golden.after[2]).toMatchObject({
      trigger_tick_index: 2, proposal_run_id_is_real_run: true,
      proposal_event_types: ['DiscreteEventType.OPPORTUNITY_OPENED', 'DiscreteEventType.SERVICE_SELECTED', 'DiscreteEventType.SERVICE_REJECTED'],
    })
  })
})

// ---------------------------------------------------------------------------
// proposalAction — hand-built: uncaught error propagates, handle untouched
// ---------------------------------------------------------------------------

describe('proposalAction — an uncaught error (bogus current_proposal_run_id) propagates, and leaves the handle completely untouched', () => {
  it('select_service AND journey_action both 404 uncaught; handle byte-identical before/after', async () => {
    const { mergedRunId } = await setupMergedRun()
    await tickUntilFire(mergedRunId)
    const handle = await getHandle(mergedRunId)
    const handBuilt: MergedRunHandle = { ...handle!, current_proposal_run_id: 'prun_never_created' }
    await saveHandle(handBuilt)

    const before = deepCopy(await getHandle(mergedRunId))

    let selectStatus = 0
    try {
      await proposalAction(mergedRunId, { kind: 'select_service', selected_service_id: 'music_playlist', action_type: null, payload: {} })
      expect.unreachable()
    } catch (exc) {
      expect(exc).toBeInstanceOf(ProposalHttpError)
      selectStatus = (exc as ProposalHttpError).status
    }
    let journeyStatus = 0
    try {
      await proposalAction(mergedRunId, { kind: 'journey_action', selected_service_id: null, action_type: 'reject', payload: {} })
      expect.unreachable()
    } catch (exc) {
      expect(exc).toBeInstanceOf(ProposalHttpError)
      journeyStatus = (exc as ProposalHttpError).status
    }

    const after = await getHandle(mergedRunId)
    expect(after).toEqual(before)

    const golden = fixture.output.proposal_action.uncaught_error_propagates
    expect(selectStatus).toBe(golden.select_service.status_code)
    expect(journeyStatus).toBe(golden.journey_action.status_code)
  })
})

// ---------------------------------------------------------------------------
// proposalAction — ALL TWELVE JourneyActionTypes reach applyJourneyAction
// ---------------------------------------------------------------------------

describe('proposalAction — the enum-membership gate admits ALL TWELVE JourneyActionTypes (spy-based, compile-time-checked coverage)', () => {
  // Compile-time-checked source of truth: deleting or misspelling a key
  // here fails to COMPILE (TS2741/TS2353) against `JourneyActionType`
  // (../src/engine/proposal/journey.ts, C2's own twelve-member union),
  // reused rather than rebuilt as a hand-copied array — a THIRTEENTH
  // action, if the union ever grew one, would fail to compile HERE first.
  const COVERAGE: Record<JourneyActionType, string> = {
    accept: 'forwarded to applyJourneyAction',
    reject: 'forwarded to applyJourneyAction (ALSO exercised for real, non-mocked, in the 5-step sequence above)',
    postpone: 'forwarded to applyJourneyAction',
    choose_another: 'forwarded to applyJourneyAction',
    request_more: 'forwarded to applyJourneyAction',
    complete: 'forwarded to applyJourneyAction (ALSO exercised for real: both a REJECTED and a successful call, above)',
    continue: 'forwarded to applyJourneyAction',
    stop: 'forwarded to applyJourneyAction',
    motion_change: 'forwarded to applyJourneyAction',
    rest_spot_arrived: 'forwarded to applyJourneyAction',
    rest_started: 'forwarded to applyJourneyAction',
    rest_completed: 'forwarded to applyJourneyAction',
  }

  it.each(Object.keys(COVERAGE) as JourneyActionType[])(
    '%s passes the enum gate and is forwarded VERBATIM to applyJourneyAction (real precondition outcome — success OR a genuine rejection — is irrelevant here; C2/C4a already exhaustively test each action\'s own branch logic)',
    async (actionType) => {
      const { mergedRunId } = await setupMergedRun()
      await tickUntilFire(mergedRunId)

      const realApply = journeyActionModule.applyJourneyAction
      const spy = vi.spyOn(journeyActionModule, 'applyJourneyAction').mockImplementation((runId, action) => realApply(runId, action))
      try {
        try {
          await proposalAction(mergedRunId, { kind: 'journey_action', selected_service_id: null, action_type: actionType, payload: {} })
        } catch (exc) {
          // A real 404 (unknown run — not the case here) or a real 422
          // TransitionRejection (e.g. `rest_spot_arrived` outside a rest
          // journey) is EXPECTED for most of the twelve at this precise
          // (monotony, freshly-fired) state — this test only proves the
          // gate ADMITTED the action_type, not that its precondition held.
          if (!(exc instanceof ProposalHttpError)) throw exc
        }
        expect(spy).toHaveBeenCalledWith(expect.any(String), { action_type: actionType, payload: {} })
      } finally {
        spy.mockRestore()
      }
    },
  )
})
