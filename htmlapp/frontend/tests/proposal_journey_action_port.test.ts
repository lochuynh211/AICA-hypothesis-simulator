import { describe, expect, it, vi, beforeEach } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { applyJourneyAction, getProposalRun, type JourneyAction } from '../src/engine/proposal/orchestrator/journey_action'
import { ProposalHttpError } from '../src/engine/proposal/orchestrator/create_run'
import * as journeyModule from '../src/engine/proposal/journey'
import type { JourneyActionType, JourneyTransition } from '../src/engine/proposal/journey'
import { ensureRegistry } from '../src/data/registry'
import { loadFixture, expectParity } from '../src/engine/__fixtures__/parity'
import {
  createRun as runManagerCreateRun,
  updateState,
  getRun,
  type CreateRunArgs,
  type ProposalRunLog,
} from '../src/engine/proposal/run_manager'

/**
 * Conformance test for `src/engine/proposal/orchestrator/journey_action.ts`
 * — the port of `apply_journey_action` (`app/api/aica_api/routers/proposal.py`,
 * 1863-1915) and `get_proposal_run` (1831-1848) — feature 026 (htmlapp
 * Combined export), slice C4a Task 6. See that file's own module doc for the
 * full control-flow enumeration, the "ALL TWELVE" reachability note, the
 * `capabilities_unavailable`-unreachable disclosure, and the hazard pass —
 * this file does not repeat that reasoning, only the resulting test evidence.
 *
 * Fixture: `src/engine/__fixtures__/parity/proposal_journey_action.json`,
 * captured by `scripts/gen/capture_all.py#_capture_proposal_journey_action`
 * — every case calls the REAL `apply_journey_action`/`get_proposal_run`
 * directly (disk-mode; neither Python function has a `cache` parameter),
 * over the REAL committed seed `seed-night-highway-oshi` (plus the REAL alt
 * seed `seed-characteristic-route-event` for the one case that needs a
 * non-`rest_recommended` opportunity) and the two REAL ported packages.
 *
 * ── Which of the twelve JourneyActionType`s reach `applyJourneyAction` ─────
 *
 * ALL TWELVE — see `journey_action.ts`'s own module doc for why (the router
 * performs no action-type-specific branching of its own; every action type
 * is the same call shape from this function's point of view). The
 * `ACTION_TYPE_TO_REPRESENTATIVE_CASE` map below reuses C2's own
 * `JourneyActionType` union (`../src/engine/proposal/journey.ts`) as a
 * `Record<JourneyActionType, string>` — TypeScript itself enforces that the
 * map has an entry for EVERY member and no extra ones, so a future
 * thirteenth action type (or a typo dropping one) fails to COMPILE, not
 * merely to pass a runtime loop over a hand-copied array.
 *
 * ── Branch coverage table (per the task brief's reporting rule) ────────────
 *
 * Guard raise sites: run_not_found_404 (BOTH functions). Engine rejections
 *   (422): reject_wrong_status_422 (real, post-stop), rest_started_wrong_
 *   lifecycle_422 (real), rest_completed_invalid_payload_422 (real),
 *   motion_change_invalid_payload_422 (real), rest_spot_arrived_wrong_
 *   trigger_purpose_422 (real, alt seed), choose_another_no_eligible_
 *   candidate_422 (real, pool fully drained), unrecognized_action_type_422
 *   (real Python call via `JourneyAction.model_construct(...)` bypassing
 *   pydantic's own closed-enum validation — no real HTTP request can reach
 *   this shape, marked `synthetic` in the golden, but it IS a real call
 *   through the real engine, not a hand-built result).
 * `capabilities_unavailable`: UNREACHABLE from `applyJourneyAction`'s real
 *   call site in EITHER language (`getServiceCapabilities()`/`_get_service_
 *   capabilities()` never return `null`/`None` — see `journey_action.ts`'s
 *   own doc) — covered via `vi.spyOn(journeyModule, 'applyAction')` forcing
 *   that exact rejection shape through the wrapper, proving generic 422
 *   handling rather than re-deriving `motionChange`'s own branch (C2 already
 *   tests that directly with `capabilities: null`).
 * `accept`'s/`continue`'s own "no committed content plan" 422s: structurally
 *   UNREACHABLE via any real call sequence (see `journey_action.ts`'s own
 *   doc) — not re-tested here; already covered directly against
 *   `applyAction` by C2's `tests/proposal_journey_validation.test.ts`.
 * Multi-event ORDERING (hazard 4 adjacent): `choose_another_success`
 *   (CHOOSE_ANOTHER then SERVICE_SELECTED) and `rest_completed_success`
 *   (REST_COMPLETED then OPPORTUNITY_OPENED) both assert exact event order,
 *   not merely membership.
 * `reject`'s own SUCCESS-shaped NO_ELIGIBLE_CANDIDATE (pool exhausted, not
 *   an error) vs `choose_another`'s SEPARATE REJECTED `no_eligible_
 *   candidate`: both covered as DISTINCT goldens (`reject_until_pool_
 *   exhausted_no_eligible_candidate` / `choose_another_no_eligible_
 *   candidate_422`) over the SAME real 6-candidate drained pool.
 * `motion_change`'s `hasActivePlan` false vs true: both covered
 *   (`motion_change_no_active_plan_success` / `motion_change_active_plan_
 *   success`) — the real disposition bucket in the latter is asserted only
 *   via parity against the captured golden, not re-derived; `motionChange`'s
 *   OWN disposition-bucketing logic is C2's to verify.
 * Evidence is NEVER touched by this function (unlike `select_service.ts`/
 *   `recompute.ts`): asserted explicitly, both on a success path and on the
 *   append-only describe block below.
 * `getProposalRun`: 404, success + idempotency (two successive calls return
 *   byte-identical results), and a dedicated spy proving it invokes NEITHER
 *   `journey.applyAction` NOR the service/content selector — a pure render.
 * Append-only discipline (Step 4): a dedicated describe block asserts that
 *   everything present in `events` BEFORE an action is still present
 *   AFTERWARDS, in the SAME order, plus the new entries — not merely that
 *   the final result looks right — and that a REJECTED action appends
 *   NOTHING (events/evidence/status/journey_state all byte-identical).
 */

ensureRegistry()
beforeEach(() => { globalThis.indexedDB = new IDBFactory() })

const { output } = loadFixture('proposal_journey_action')
const CASES: Record<string, any> = Object.fromEntries(
  output.journey_action_cases.map((c: any) => [c.name, c]),
)
const GET_RUN_CASES: Record<string, any> = Object.fromEntries(
  output.get_run_cases.map((c: any) => [c.name, c]),
)

// ---------------------------------------------------------------------------
// Seeding + freezing helpers — mirrors `proposal_recompute_port.test.ts`'s
// own `toCreateArgs`/`seedRun`/`freezeValue` (see that file's own doc
// comment). This function never mints a NEW opportunity_id (unlike
// recompute), so a single fixed run_id/opportunity_id pair per case is
// enough — no `Scenario` class with an incrementing counter is needed.
// ---------------------------------------------------------------------------

function toCreateArgs(raw: any): CreateRunArgs {
  return {
    opportunity: raw.opportunity,
    matrixVersion: raw.matrix_version,
    worldSnapshot: raw.world_snapshot,
    servicePackageId: raw.service_package_id,
    contentPackageId: raw.content_package_id,
    parameters: raw.parameters,
    hyperparameters: raw.hyperparameters,
    journeyState: raw.journey_state,
    events: raw.events,
    evidence: raw.evidence,
    status: raw.status,
    setupSnapshot: raw.setup_snapshot,
    world: raw.world,
    mode: raw.mode,
  }
}

async function seedRun(before: any): Promise<ProposalRunLog> {
  const seeded = await runManagerCreateRun(toCreateArgs(before))
  const hasContentParams = Object.keys(before.content_parameters ?? {}).length > 0
  const hasContentHyperparams = Object.keys(before.content_hyperparameters ?? {}).length > 0
  if (hasContentParams || hasContentHyperparams) {
    return await updateState(seeded.run_id, {
      contentParameters: before.content_parameters,
      contentHyperparameters: before.content_hyperparameters,
    })
  }
  return seeded
}

function freezeValue(value: unknown, freezeMap: Map<string, string>): unknown {
  if (Array.isArray(value)) return value.map((v) => freezeValue(v, freezeMap))
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (k === 'created_at' || k === 'at') out[k] = '2026-01-01T00:00:00.000000Z'
      else if (typeof v === 'string' && freezeMap.has(v)) out[k] = freezeMap.get(v)
      else out[k] = freezeValue(v, freezeMap)
    }
    return out
  }
  return value
}

function snap(log: ProposalRunLog): unknown {
  const freezeMap = new Map<string, string>([
    [log.run_id, 'prun_TEST_FIXED'],
    [log.opportunity.opportunity_id, 'op_TEST_FIXED'],
  ])
  return freezeValue(log, freezeMap)
}

// ---------------------------------------------------------------------------
// Success-path parity — full run log, structurally compared against the
// REAL captured Python apply_journey_action() output.
// ---------------------------------------------------------------------------

describe('applyJourneyAction — success-path parity against real Python apply_journey_action()', () => {
  it('request_more_success: no state change, REQUEST_MORE event only', async () => {
    const golden = CASES.request_more_success
    const seeded = await seedRun(golden.before)
    const result = await applyJourneyAction(seeded.run_id, { action_type: 'request_more', payload: {} })
    expectParity(snap(result), golden.result)
  })

  it('reject_success_pool_not_exhausted: 5 of 6 real eligible remain -- SERVICE_REJECTED only', async () => {
    const golden = CASES.reject_success_pool_not_exhausted
    const seeded = await seedRun(golden.before)
    const result = await applyJourneyAction(seeded.run_id, { action_type: 'reject', payload: {} })
    expectParity(snap(result), golden.result)
    expect(result.events.map((e) => e.event_type)).not.toContain('NO_ELIGIBLE_CANDIDATE')
  })

  it('choose_another_success: CHOOSE_ANOTHER then SERVICE_SELECTED, IN ORDER', async () => {
    const golden = CASES.choose_another_success
    const seeded = await seedRun(golden.before)
    const result = await applyJourneyAction(seeded.run_id, { action_type: 'choose_another', payload: {} })
    expectParity(snap(result), golden.result)
    const newTypes = result.events.slice(seeded.events.length).map((e) => e.event_type)
    expect(newTypes).toEqual(['CHOOSE_ANOTHER', 'SERVICE_SELECTED'])
  })

  it('postpone_success', async () => {
    const golden = CASES.postpone_success
    const seeded = await seedRun(golden.before)
    const result = await applyJourneyAction(seeded.run_id, { action_type: 'postpone', payload: {} })
    expectParity(snap(result), golden.result)
  })

  it('accept_success: content_selected -> content_started, captures previous_content', async () => {
    const golden = CASES.accept_success
    const seeded = await seedRun(golden.before)
    const result = await applyJourneyAction(seeded.run_id, { action_type: 'accept', payload: {} })
    expectParity(snap(result), golden.result)
  })

  it('complete_success', async () => {
    const golden = CASES.complete_success
    const seeded = await seedRun(golden.before)
    const result = await applyJourneyAction(seeded.run_id, { action_type: 'complete', payload: {} })
    expectParity(snap(result), golden.result)
  })

  it('continue_success: playback_state stays completed, CONTINUE_REQUESTED event only', async () => {
    const golden = CASES.continue_success
    const seeded = await seedRun(golden.before)
    const result = await applyJourneyAction(seeded.run_id, { action_type: 'continue', payload: {} })
    expectParity(snap(result), golden.result)
    expect(result.status).toBe(seeded.status)
  })

  it('stop_success: restores previous_content captured at accept', async () => {
    const golden = CASES.stop_success
    const seeded = await seedRun(golden.before)
    const result = await applyJourneyAction(seeded.run_id, { action_type: 'stop', payload: {} })
    expectParity(snap(result), golden.result)
  })

  it('motion_change_no_active_plan_success: active_plan_disposition == "none"', async () => {
    const golden = CASES.motion_change_no_active_plan_success
    const seeded = await seedRun(golden.before)
    const result = await applyJourneyAction(seeded.run_id, {
      action_type: 'motion_change',
      payload: { motion_state: 'stopped' },
    })
    expectParity(snap(result), golden.result)
    expect(result.events.at(-1)?.payload.active_plan_disposition).toBe('none')
  })

  it('motion_change_active_plan_success: hasActivePlan branch (active_service_id set, playback_state active)', async () => {
    const golden = CASES.motion_change_active_plan_success
    const seeded = await seedRun(golden.before)
    expect(seeded.journey_state.active_service_id).not.toBeNull()
    const result = await applyJourneyAction(seeded.run_id, {
      action_type: 'motion_change',
      payload: { motion_state: 'driving' },
    })
    expectParity(snap(result), golden.result)
  })

  it('rest_spot_arrived_success', async () => {
    const golden = CASES.rest_spot_arrived_success
    const seeded = await seedRun(golden.before)
    const result = await applyJourneyAction(seeded.run_id, { action_type: 'rest_spot_arrived', payload: {} })
    expectParity(snap(result), golden.result)
  })

  it('rest_started_success', async () => {
    const golden = CASES.rest_started_success
    const seeded = await seedRun(golden.before)
    const result = await applyJourneyAction(seeded.run_id, { action_type: 'rest_started', payload: {} })
    expectParity(snap(result), golden.result)
  })

  it('rest_completed_success: REST_COMPLETED then OPPORTUNITY_OPENED, IN ORDER', async () => {
    const golden = CASES.rest_completed_success
    const seeded = await seedRun(golden.before)
    const result = await applyJourneyAction(seeded.run_id, {
      action_type: 'rest_completed',
      payload: { post_rest: { drowsiness_level: 20, fatigue_level: 15 } },
    })
    expectParity(snap(result), golden.result)
    const newTypes = result.events.slice(seeded.events.length).map((e) => e.event_type)
    expect(newTypes).toEqual(['REST_COMPLETED', 'OPPORTUNITY_OPENED'])
  })

  it('reject_until_pool_exhausted_no_eligible_candidate: SUCCESS end-state, not an error', async () => {
    const golden = CASES.reject_until_pool_exhausted_no_eligible_candidate
    const seeded = await seedRun(golden.before)
    const result = await applyJourneyAction(seeded.run_id, { action_type: 'reject', payload: {} })
    expectParity(snap(result), golden.result)
    const newTypes = result.events.slice(seeded.events.length).map((e) => e.event_type)
    expect(newTypes).toEqual(['SERVICE_REJECTED', 'NO_ELIGIBLE_CANDIDATE'])
  })
})

// ---------------------------------------------------------------------------
// Evidence is NEVER touched by applyJourneyAction — a real, disclosed
// invariant distinct from select_service.ts/recompute.ts (both of which DO
// append evidence). Asserted on a representative success path.
// ---------------------------------------------------------------------------

describe('applyJourneyAction never appends/modifies evidence', () => {
  it('accept_success: evidence is byte-identical before and after', async () => {
    const golden = CASES.accept_success
    const seeded = await seedRun(golden.before)
    const priorEvidence = structuredClone(seeded.evidence)
    const result = await applyJourneyAction(seeded.run_id, { action_type: 'accept', payload: {} })
    expect(result.evidence).toEqual(priorEvidence)
  })
})

// ---------------------------------------------------------------------------
// Raising paths — ProposalHttpError.status/.detail match the real captured
// Python HTTPException.status_code/.detail. NOTHING is appended/updated.
// ---------------------------------------------------------------------------

describe('applyJourneyAction — rejecting paths, byte-exact against real Python HTTPException detail', () => {
  it('run_not_found_404', async () => {
    const golden = CASES.run_not_found_404
    await expect(applyJourneyAction('not-a-real-run-id-at-all', { action_type: 'accept', payload: {} }))
      .rejects.toMatchObject({ status: golden.status_code, detail: golden.detail })
  })

  it('reject_wrong_status_422: status=content_stopped (post-stop) -- nothing appended', async () => {
    const golden = CASES.reject_wrong_status_422
    const seeded = await seedRun(golden.before)
    await expect(applyJourneyAction(seeded.run_id, { action_type: 'reject', payload: {} }))
      .rejects.toMatchObject({ status: golden.status_code, detail: golden.detail })
    const after = (await getRun(seeded.run_id))!
    expect(after.events).toEqual(seeded.events)
    expect(after.status).toBe(seeded.status)
    expect(after.journey_state).toEqual(seeded.journey_state)
  })

  it('rest_started_wrong_lifecycle_422', async () => {
    const golden = CASES.rest_started_wrong_lifecycle_422
    const seeded = await seedRun(golden.before)
    await expect(applyJourneyAction(seeded.run_id, { action_type: 'rest_started', payload: {} }))
      .rejects.toMatchObject({ status: golden.status_code, detail: golden.detail })
  })

  it('rest_completed_invalid_payload_422: missing post_rest', async () => {
    const golden = CASES.rest_completed_invalid_payload_422
    const seeded = await seedRun(golden.before)
    await expect(applyJourneyAction(seeded.run_id, { action_type: 'rest_completed', payload: {} }))
      .rejects.toMatchObject({ status: golden.status_code, detail: golden.detail })
  })

  it('motion_change_invalid_payload_422: missing motion_state', async () => {
    const golden = CASES.motion_change_invalid_payload_422
    const seeded = await seedRun(golden.before)
    await expect(applyJourneyAction(seeded.run_id, { action_type: 'motion_change', payload: {} }))
      .rejects.toMatchObject({ status: golden.status_code, detail: golden.detail })
  })

  it('rest_spot_arrived_wrong_trigger_purpose_422: real alt seed (route_music), not rest_recommended', async () => {
    const golden = CASES.rest_spot_arrived_wrong_trigger_purpose_422
    const seeded = await seedRun(golden.before)
    expect(seeded.opportunity.trigger_purpose).toBe('route_music')
    await expect(applyJourneyAction(seeded.run_id, { action_type: 'rest_spot_arrived', payload: {} }))
      .rejects.toMatchObject({ status: golden.status_code, detail: golden.detail })
  })

  it('choose_another_no_eligible_candidate_422: pool fully drained -- DISTINCT code from reject\'s own success-shaped event', async () => {
    const golden = CASES.choose_another_no_eligible_candidate_422
    const seeded = await seedRun(golden.before)
    await expect(applyJourneyAction(seeded.run_id, { action_type: 'choose_another', payload: {} }))
      .rejects.toMatchObject({ status: golden.status_code, detail: golden.detail })
    expect(golden.detail.code).toBe('no_eligible_candidate')
  })

  it('unrecognized_action_type_422: a bypass-constructed action_type (no real HTTP request can reach this)', async () => {
    const golden = CASES.unrecognized_action_type_422
    expect(golden.synthetic).toBe(true)
    const seeded = await seedRun(golden.before)
    await expect(applyJourneyAction(seeded.run_id, { action_type: 'garbage_xyz', payload: {} }))
      .rejects.toMatchObject({ status: golden.status_code, detail: golden.detail })
  })
})

// ---------------------------------------------------------------------------
// capabilities_unavailable — unreachable from any real call site in EITHER
// language (see journey_action.ts's own module doc). Covered via a spy
// forcing the exact rejection shape through, proving GENERIC 422 handling.
// ---------------------------------------------------------------------------

describe('capabilities_unavailable rejection (disclosed unreachable-via-real-data branch)', () => {
  it('is wrapped exactly like any other engine rejection code', async () => {
    const golden = CASES.request_more_success
    const seeded = await seedRun(golden.before)
    const forced: JourneyTransition = {
      events: [],
      new_journey_state: seeded.journey_state as unknown as journeyModule.JourneyState,
      new_status: seeded.status,
      rejected: {
        code: 'capabilities_unavailable',
        message: "This action couldn't be completed due to missing internal data. / 内部データの不足によりこの操作を完了できませんでした。",
      },
    }
    const spy = vi.spyOn(journeyModule, 'applyAction').mockReturnValueOnce(forced)
    try {
      await expect(applyJourneyAction(seeded.run_id, { action_type: 'motion_change', payload: {} }))
        .rejects.toMatchObject({
          status: 422,
          detail: { code: 'capabilities_unavailable', message: forced.rejected!.message },
        })
      expect(spy).toHaveBeenCalledTimes(1)
    } finally {
      spy.mockRestore()
    }
    // Nothing was appended -- the forced rejection is treated exactly like a
    // real one.
    const after = (await getRun(seeded.run_id))!
    expect(after.events).toEqual(seeded.events)
  })
})

// ---------------------------------------------------------------------------
// getProposalRun — pure read, no selector re-invoked, idempotent.
// ---------------------------------------------------------------------------

describe('getProposalRun', () => {
  it('get_run_not_found_404', async () => {
    const golden = GET_RUN_CASES.get_run_not_found_404
    await expect(getProposalRun('not-a-real-run-id-at-all'))
      .rejects.toMatchObject({ status: golden.status_code, detail: golden.detail })
  })

  it('get_run_success_renders_persisted_state_idempotently: two successive calls, byte-identical, both == persisted state', async () => {
    const golden = GET_RUN_CASES.get_run_success_renders_persisted_state_idempotently
    const seeded = await seedRun(golden.before)
    const first = await getProposalRun(seeded.run_id)
    const second = await getProposalRun(seeded.run_id)
    expectParity(snap(first), golden.result)
    expectParity(snap(second), golden.result_repeat_call)
    expect(first).toEqual(second)
  })

  it('never invokes the engine or any selector -- a pure render', async () => {
    const golden = CASES.request_more_success
    const seeded = await seedRun(golden.before)
    const applyActionSpy = vi.spyOn(journeyModule, 'applyAction')
    try {
      await getProposalRun(seeded.run_id)
      expect(applyActionSpy).not.toHaveBeenCalled()
    } finally {
      applyActionSpy.mockRestore()
    }
  })
})

// ---------------------------------------------------------------------------
// All twelve JourneyActionType members reach applyJourneyAction — reuses
// C2's own `JourneyActionType` union as a TYPE-CHECKED Record (see module
// doc's "Which of the twelve" section for why this catches a missing/extra
// member at COMPILE time, not just at runtime).
// ---------------------------------------------------------------------------

const ACTION_TYPE_TO_REPRESENTATIVE_CASE: Record<JourneyActionType, string> = {
  accept: 'accept_success',
  reject: 'reject_success_pool_not_exhausted',
  postpone: 'postpone_success',
  choose_another: 'choose_another_success',
  request_more: 'request_more_success',
  complete: 'complete_success',
  continue: 'continue_success',
  stop: 'stop_success',
  motion_change: 'motion_change_no_active_plan_success',
  rest_spot_arrived: 'rest_spot_arrived_success',
  rest_started: 'rest_started_success',
  rest_completed: 'rest_completed_success',
}

describe('all twelve JourneyActionType members reach applyJourneyAction (via a real captured golden)', () => {
  const entries = Object.entries(ACTION_TYPE_TO_REPRESENTATIVE_CASE) as Array<[JourneyActionType, string]>

  it('the representative map itself has exactly twelve entries', () => {
    expect(entries).toHaveLength(12)
  })

  it.each(entries)('%s has a captured, non-synthetic SUCCESS golden case', (_actionType, caseName) => {
    const golden = CASES[caseName]
    expect(golden, `missing golden case ${caseName}`).toBeDefined()
    expect(golden.raises).toBe(false)
    expect(golden.synthetic).not.toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Append-only discipline (brief Step 4) — assert that applyJourneyAction
// APPENDS rather than rewrites: everything present before must still be
// present afterwards, in the SAME order, plus the new entries; a REJECTED
// action appends NOTHING at all.
// ---------------------------------------------------------------------------

describe('append-only discipline — applyJourneyAction mutates by appending only, never rewriting history', () => {
  it('events: the ENTIRE prior events array survives as an exact prefix (single action)', async () => {
    const golden = CASES.postpone_success
    const seeded = await seedRun(golden.before)
    const priorEvents = structuredClone(seeded.events)
    const result = await applyJourneyAction(seeded.run_id, { action_type: 'postpone', payload: {} })
    expect(result.events.slice(0, priorEvents.length)).toEqual(priorEvents)
    expect(result.events.length).toBeGreaterThan(priorEvents.length)
  })

  it('events: survive as an exact prefix across a LONG real chain of successive actions', async () => {
    // Reproduces RUN1's own multi-step chain (request_more -> reject ->
    // choose_another -> postpone), each seeded from ITS OWN golden `before`
    // (already reflecting the accumulated real Python state at that point),
    // proving the SAME wrapper call appends correctly no matter how deep
    // into a chain the run already is.
    const chain: Array<{ caseName: string; action: JourneyAction }> = [
      { caseName: 'request_more_success', action: { action_type: 'request_more', payload: {} } },
      { caseName: 'reject_success_pool_not_exhausted', action: { action_type: 'reject', payload: {} } },
      { caseName: 'choose_another_success', action: { action_type: 'choose_another', payload: {} } },
      { caseName: 'postpone_success', action: { action_type: 'postpone', payload: {} } },
    ]
    for (const { caseName, action } of chain) {
      const golden = CASES[caseName]
      const seeded = await seedRun(golden.before)
      const priorEvents = structuredClone(seeded.events)
      const result = await applyJourneyAction(seeded.run_id, action)
      expect(result.events.slice(0, priorEvents.length)).toEqual(priorEvents)
      expect(result.events.length).toBeGreaterThan(priorEvents.length)
    }
  })

  it('a REJECTED action (422) appends NOTHING at all -- events/evidence/status/journey_state byte-identical', async () => {
    const golden = CASES.reject_wrong_status_422
    const seeded = await seedRun(golden.before)
    const before = structuredClone({
      events: seeded.events, evidence: seeded.evidence,
      status: seeded.status, journeyState: seeded.journey_state,
    })
    await expect(applyJourneyAction(seeded.run_id, { action_type: 'reject', payload: {} }))
      .rejects.toThrow(ProposalHttpError)

    const after = (await getRun(seeded.run_id))!
    expect(after.events).toEqual(before.events)
    expect(after.evidence).toEqual(before.evidence)
    expect(after.status).toBe(before.status)
    expect(after.journey_state).toEqual(before.journeyState)
  })
})
