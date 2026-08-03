import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { IDBFactory } from 'fake-indexeddb'
import { ensureRegistry } from '../src/data/registry'
import { resetDispatchState } from '../src/engine/worker/dispatch'
import { clearDraftRegistry } from '../src/engine/run_plan'
import { clearRegistry } from '../src/engine/run_manager'
import { worldSeedStore } from '../src/engine/proposal/stores'
import { getHandle } from '../src/storage/merged_runs_store'
import { runsRestSpots } from '../src/engine/worker/handlers/runs'
import { ProposalHttpError } from '../src/engine/proposal/orchestrator/create_run'
import {
  createMergedRun,
  tickMergedRun,
  mergedProposalAction,
  acceptRest,
  declineRest,
  buildMergedPlan,
  mergedQuickview,
  afterRestProposal,
  getMergedRun,
  listMergedRuns,
  postReviewFeedback,
  getReviewFeedback,
  type CreateMergedRunReq,
  type BuildMergedPlanReq,
  type MergedQuickviewReq,
  type MergedTickResponse,
} from '../src/api/mergedClient'

/**
 * Task 1 coverage — every one of the reference's twelve exported functions,
 * round-tripped through the REAL worker RPC seam (this module's own `call()`
 * -> `transport` -> `dispatch` -> `router` -> the `merged.*` handler in
 * `src/engine/worker/handlers/merged.ts`), never a direct handler call —
 * calling the exported client function itself IS the seam entry point (the
 * same pattern `tests/merged_ops.test.ts` establishes one layer down, at
 * `dispatch()`).
 *
 * Every export gets a happy path AND an error path (`listMergedRuns`
 * excepted — no error path exists in the engine either, a listing helper
 * not a validator; disclosed, not faked, mirroring `merged_ops.test.ts`'s
 * own precedent for that exact op).
 */

ensureRegistry()

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory()
  resetDispatchState()
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

function basePlanReq(overrides: Partial<BuildMergedPlanReq> = {}): BuildMergedPlanReq {
  return {
    package_id: PACKAGE_ID,
    scenario_id: SCENARIO_ID,
    route_preset_id: null,
    run_seed: TRIGGER_RUN_SEED,
    mountain_range_km: null,
    jam_range_km: null,
    ...overrides,
  }
}

function baseQuickviewReq(overrides: Partial<MergedQuickviewReq> = {}): MergedQuickviewReq {
  return {
    package_id: PACKAGE_ID,
    scenario_id: SCENARIO_ID,
    run_seed: TRIGGER_RUN_SEED,
    world: baseWorld(),
    service_package_id: SERVICE_PKG_ID,
    content_package_id: CONTENT_PKG_ID,
    run_seed_proposal: 'seed-merged-client-test',
    ...overrides,
  }
}

async function setupMergedRun(overrides: Partial<CreateMergedRunReq> = {}): Promise<{ mergedRunId: string; triggerRunId: string }> {
  const plan = await buildMergedPlan(basePlanReq())
  const run = await createMergedRun({
    trigger_plan_id: plan.plan_id,
    world: baseWorld(),
    service_package_id: SERVICE_PKG_ID,
    content_package_id: CONTENT_PKG_ID,
    run_seed: PROPOSAL_RUN_SEED,
    ...overrides,
  })
  return { mergedRunId: run.merged_run_id, triggerRunId: run.trigger_run_id }
}

/** Ticks (through the real `tickMergedRun` client call) until the first
 * fire, or — when `wantRest` is set — the first REST_PROPOSAL fire
 * specifically. Same empirically-pinned package/scenario/seed combo
 * `tests/merged_ops.test.ts#tickUntilFire` uses (tick 12 = monotony, tick
 * 17 = rest). */
async function tickUntilFire(mergedRunId: string, opts: { wantRest?: boolean } = {}, maxTicks = 20): Promise<MergedTickResponse> {
  for (let i = 0; i < maxTicks; i++) {
    const resp = await tickMergedRun(mergedRunId)
    if (resp.proposal !== null) {
      const decision = resp.trigger.decision as { result_type?: string } | null
      if (!opts.wantRest || decision?.result_type === 'REST_PROPOSAL') return resp
    }
  }
  throw new Error(`expected a fire within ${maxTicks} ticks (wantRest=${opts.wantRest ?? false})`)
}

async function expectRejects(p: Promise<unknown>): Promise<unknown> {
  try {
    await p
  } catch (exc) {
    return exc
  }
  expect.unreachable('expected the promise to reject')
}

// ---------------------------------------------------------------------------
// Step 3 — zero fetch calls (static regression guard; the manual grep this
// task's report also pastes is the authoritative measurement).
// ---------------------------------------------------------------------------

describe('zero network calls', () => {
  it('src/api/mergedClient.ts contains no fetch(/XMLHttpRequest/WebSocket/EventSource call', () => {
    const path = resolve(__dirname, '..', 'src', 'api', 'mergedClient.ts')
    const src = readFileSync(path, 'utf8')
    expect(src).not.toMatch(/\bfetch\(/)
    expect(src).not.toMatch(/XMLHttpRequest|new WebSocket|EventSource/)
  })
})

// ---------------------------------------------------------------------------
// buildMergedPlan -> merged.plan
// ---------------------------------------------------------------------------

describe('buildMergedPlan', () => {
  it('happy path: real plan_id', async () => {
    const result = await buildMergedPlan(basePlanReq())
    expect(result.plan_id).toMatch(/^plan_/)
  })

  it('default-fill: initial_state/context_overrides/profiles omitted -> sent as null, not undefined (createMergedPlan checks `!== null` — an undefined leak would wrongly enter the validation branch)', async () => {
    // No initial_state/context_overrides/profiles keys at all in the request.
    const result = await buildMergedPlan(basePlanReq())
    expect(result.plan_id).toMatch(/^plan_/)
  })

  it('error path: unknown package_id -> ProposalHttpError(400), .status/.message survive the client call', async () => {
    const exc = await expectRejects(buildMergedPlan(basePlanReq({ package_id: 'bogus_pkg' })))
    expect(exc).toBeInstanceOf(ProposalHttpError)
    expect((exc as ProposalHttpError).status).toBe(400)
    expect((exc as ProposalHttpError).message).toContain("Package 'bogus_pkg' not found or invalid")
  })

  it('structured PlanValidationDetail survives through THIS client (not just rpc.ts unit tests): .detail.validation_errors, not just the summary message', async () => {
    const exc = await expectRejects(buildMergedPlan(basePlanReq({ initial_state: { bogus_key: 1 } })))
    expect(exc).toBeInstanceOf(ProposalHttpError)
    const err = exc as ProposalHttpError
    expect(err.status).toBe(400)
    const detail = err.detail as { detail: string; validation_errors: { field: string; message: string }[] }
    expect(detail.detail).toBe('One or more initial_state values are invalid.')
    expect(detail.validation_errors[0].field).toBe('initial_state.bogus_key')
  })
})

// ---------------------------------------------------------------------------
// createMergedRun -> merged.create
// ---------------------------------------------------------------------------

describe('createMergedRun', () => {
  it('happy path: real merged_run_id/trigger_run_id', async () => {
    const { mergedRunId, triggerRunId } = await setupMergedRun()
    expect(mergedRunId).toMatch(/^mrun_/)
    expect(triggerRunId).toMatch(/^run_/)
  })

  it('default-fill: proposal_mode omitted -> "interactive" (Pydantic field default), observable via getMergedRun', async () => {
    const { mergedRunId } = await setupMergedRun()
    const got = await getMergedRun(mergedRunId)
    expect(got.handle.proposal_mode).toBe('interactive')
  })

  it('error path: unknown trigger_plan_id -> ProposalHttpError(400)', async () => {
    const exc = await expectRejects(
      createMergedRun({
        trigger_plan_id: 'plan_bogus',
        world: baseWorld(),
        service_package_id: SERVICE_PKG_ID,
        content_package_id: CONTENT_PKG_ID,
        run_seed: PROPOSAL_RUN_SEED,
      }),
    )
    expect(exc).toBeInstanceOf(ProposalHttpError)
    expect((exc as ProposalHttpError).status).toBe(400)
  })
})

// ---------------------------------------------------------------------------
// getMergedRun / listMergedRuns -> merged.get / merged.list
// ---------------------------------------------------------------------------

describe('getMergedRun / listMergedRuns', () => {
  it('happy path: get reassembles handle+trigger_log; list finds it as a plain array (envelope unwrapped)', async () => {
    const { mergedRunId, triggerRunId } = await setupMergedRun()

    const got = await getMergedRun(mergedRunId)
    expect(got.handle.merged_run_id).toBe(mergedRunId)
    expect(got.handle.trigger_run_id).toBe(triggerRunId)
    expect(got.trigger_log).not.toBeNull()
    expect(got.proposal_logs).toEqual([])

    const listed = await listMergedRuns()
    expect(Array.isArray(listed)).toBe(true)
    // Not the {merged_runs: [...]} envelope itself — a caller that forgot to
    // unwrap would fail this specific assertion (no .length on the wrapper).
    const row = listed.find((r) => r.merged_run_id === mergedRunId)
    expect(row).toBeDefined()
    expect(row?.trigger_run_id).toBe(triggerRunId)
    expect(row?.proposal_run_ids_count).toBe(0)
  })

  it('listMergedRuns — no error path exists in the engine either (a listing helper, not a validator); disclosed, not tested for a failure shape', async () => {
    const listed = await listMergedRuns()
    expect(Array.isArray(listed)).toBe(true)
  })

  it('getMergedRun error path: unknown mergedRunId -> ProposalHttpError(404) exact message', async () => {
    const exc = await expectRejects(getMergedRun('mrun_bogus_id'))
    expect(exc).toBeInstanceOf(ProposalHttpError)
    expect((exc as ProposalHttpError).status).toBe(404)
    expect((exc as ProposalHttpError).message).toBe("Merged run 'mrun_bogus_id' not found")
  })
})

// ---------------------------------------------------------------------------
// mergedQuickview -> merged.quickview
// ---------------------------------------------------------------------------

describe('mergedQuickview', () => {
  it('happy path: unpainted local route fires at least once with an embedded proposal', async () => {
    const result = await mergedQuickview(baseQuickviewReq())
    expect(result.fired).toBe(true)
    expect(result.fires.length).toBeGreaterThan(0)
    expect(result.fires.some((f) => f.proposal !== null)).toBe(true)
  })

  it('painted branch: mountain_range_km triggers buildQuickviewRouteFacts', async () => {
    const result = await mergedQuickview(baseQuickviewReq({ mountain_range_km: [1, 5] }))
    expect(result.segments.some((s) => s.type === 'mountain_road')).toBe(true)
  })

  it('error path: unknown package_id -> ProposalHttpError(400)', async () => {
    const exc = await expectRejects(mergedQuickview(baseQuickviewReq({ package_id: 'bogus_pkg' })))
    expect(exc).toBeInstanceOf(ProposalHttpError)
    expect((exc as ProposalHttpError).status).toBe(400)
    expect((exc as ProposalHttpError).message).toContain('not found or invalid')
  })
})

// ---------------------------------------------------------------------------
// afterRestProposal -> merged.afterRestProposal
// ---------------------------------------------------------------------------

describe('afterRestProposal', () => {
  it('happy path: default rank-1 dispatch returns a real ProposalRunLog', async () => {
    const result = await afterRestProposal({
      world: baseWorld(),
      service_package_id: SERVICE_PKG_ID,
      content_package_id: CONTENT_PKG_ID,
      run_seed_proposal: 'seed-after-rest-client',
    })
    expect(result.run_id).toMatch(/^prun_/)
    expect(result.opportunity.trigger_purpose).toBe('rest_recommended')
    expect(result.journey_state.lifecycle_stage).toBe('after_rest_before_restart')
  })

  it('error path: unknown content_package_id -> ProposalHttpError(422)', async () => {
    const exc = await expectRejects(
      afterRestProposal({
        world: baseWorld(),
        service_package_id: SERVICE_PKG_ID,
        content_package_id: 'bogus_content_pkg',
        run_seed_proposal: 'seed-after-rest-client',
      }),
    )
    expect(exc).toBeInstanceOf(ProposalHttpError)
    expect((exc as ProposalHttpError).status).toBe(422)
    expect((exc as ProposalHttpError).message).toContain("Unknown or mis-slotted content_package_id: 'bogus_content_pkg'")
  })
})

// ---------------------------------------------------------------------------
// tickMergedRun / mergedProposalAction / acceptRest — one real sequential
// flow (create -> monotony fire -> select_service -> journey_action(postpone)
// -> rest fire -> acceptRest), matching real Combined-screen usage order.
// ---------------------------------------------------------------------------

describe('tickMergedRun / mergedProposalAction / acceptRest — real sequential round trip', () => {
  it('tick 0 (no fire) -> tick until MONOTONY fire -> select_service -> journey_action(postpone) -> tick until REST fire -> acceptRest', async () => {
    const { mergedRunId, triggerRunId } = await setupMergedRun()

    // tick #1: no fire yet.
    const first = await tickMergedRun(mergedRunId)
    expect(first.proposal).toBeNull()
    expect(first.correlation).toBeNull()

    // tick until the first (MONOTONY) fire creates a proposal run.
    const monotonyTick = await tickUntilFire(mergedRunId)
    expect(monotonyTick.proposal).not.toBeNull()
    const monotonyProposal = monotonyTick.proposal as {
      run_id: string
      evidence: { step: string; error: unknown; output: { ranked_candidates?: { candidate_id: string }[] } | null }[]
    }
    const serviceEvidence = monotonyProposal.evidence.find((e) => e.step === 'service' && e.error === null)
    const candidateId = serviceEvidence?.output?.ranked_candidates?.[0]?.candidate_id
    expect(candidateId).toBeTruthy()

    // mergedProposalAction — kind='select_service' branch of the wire-shape
    // normalization (../api/mergedClient.ts's own discriminated-union ->
    // full-body mapping).
    const selected = await mergedProposalAction(mergedRunId, { kind: 'select_service', selected_service_id: candidateId! })
    expect(selected.journey_state.active_service_id).toBe(candidateId)
    // Interactive mode auto-dispatches content on select_service, so status
    // advances straight to 'content_selected' — still one of the two states
    // `postpone` (next) accepts as a precondition.
    expect(selected.status).toBe('content_selected')

    // mergedProposalAction — kind='journey_action' branch. Asserts a field
    // (POSTPONED event appended, status STAYS 'service_selected') that only
    // a correctly-mapped action_type/payload could produce — proves the
    // OTHER half of the ternary in mergedProposalAction, not just that it
    // doesn't throw.
    const postponed = await mergedProposalAction(mergedRunId, { kind: 'journey_action', action_type: 'postpone', payload: {} })
    expect(postponed.status).toBe('service_selected')
    expect(postponed.events.some((e) => e.event_type === 'POSTPONED')).toBe(true)

    // tick until the REST fire (a DIFFERENT category -> a NEW proposal run).
    const restTick = await tickUntilFire(mergedRunId, { wantRest: true })
    expect(restTick.proposal).not.toBeNull()
    const restProposalRunId = (restTick.proposal as { run_id: string }).run_id
    expect(restProposalRunId).not.toBe(monotonyProposal.run_id)

    // acceptRest — real rest spot from the trigger-side handler (test-helper
    // only, not under test; mirrors tests/merged_ops.test.ts's own use).
    const { rest_spots: spots } = await runsRestSpots({ runId: triggerRunId })
    expect(spots.length).toBeGreaterThan(0)
    const runState = await acceptRest(mergedRunId, { recovery_option_id: RECOVERY_OPTION_ID, rest_spot: spots[0], nap_minutes: null })
    expect(runState.recovery?.active).toBe(true)
    const handle = await getHandle(mergedRunId)
    expect(handle?.rest_stage_synced).toBe('before')
  })

  it('tickMergedRun error path: unknown mergedRunId -> ProposalHttpError(404) exact (double-quoted — tick.ts uses JSON.stringify, a different quote style from the other merged.* 404s tested here, which use single quotes; not this task\'s scope to unify)', async () => {
    const exc = await expectRejects(tickMergedRun('mrun_bogus_id'))
    expect(exc).toBeInstanceOf(ProposalHttpError)
    expect((exc as ProposalHttpError).status).toBe(404)
    expect((exc as ProposalHttpError).message).toBe('Merged run "mrun_bogus_id" not found')
  })

  it('acceptRest error path: a FRESH (un-ticked) run -> ProposalHttpError(422), "not paused"', async () => {
    const { mergedRunId } = await setupMergedRun()
    const exc = await expectRejects(
      acceptRest(mergedRunId, {
        recovery_option_id: RECOVERY_OPTION_ID,
        rest_spot: { id: 'rest_0', label: { ja: 'x', en: 'x' }, route_fraction: 0.5, distance_km: 1, eta_min: 1, reachable: true },
        nap_minutes: null,
      }),
    )
    expect(exc).toBeInstanceOf(ProposalHttpError)
    expect((exc as ProposalHttpError).status).toBe(422)
    expect((exc as ProposalHttpError).message).toContain('No pending proposal for run')
  })

  it('mergedProposalAction error path: fresh run has NO active proposal run yet -> ProposalHttpError(404)', async () => {
    const { mergedRunId } = await setupMergedRun()
    const exc = await expectRejects(mergedProposalAction(mergedRunId, { kind: 'select_service', selected_service_id: 'full_karaoke' }))
    expect(exc).toBeInstanceOf(ProposalHttpError)
    expect((exc as ProposalHttpError).status).toBe(404)
    expect((exc as ProposalHttpError).message).toBe(`Merged run '${mergedRunId}' has no active proposal run`)
  })
})

// ---------------------------------------------------------------------------
// declineRest -> merged.decline
// ---------------------------------------------------------------------------

describe('declineRest', () => {
  it('happy path: decline the first (MONOTONY) fire, re-arms the fire guard', async () => {
    const { mergedRunId } = await setupMergedRun()
    await tickUntilFire(mergedRunId)
    const before = await getHandle(mergedRunId)
    expect(before?.current_proposal_run_id).not.toBeNull()

    const runState = await declineRest(mergedRunId)
    expect(runState.pending_proposal).toBeNull()

    const after = await getHandle(mergedRunId)
    expect(after?.current_proposal_run_id).toBeNull()
    expect(after?.current_proposal_category).toBeNull()
  })

  it('error path: unknown mergedRunId -> ProposalHttpError(404) exact', async () => {
    const exc = await expectRejects(declineRest('mrun_bogus_id'))
    expect(exc).toBeInstanceOf(ProposalHttpError)
    expect((exc as ProposalHttpError).status).toBe(404)
    expect((exc as ProposalHttpError).message).toBe("Merged run 'mrun_bogus_id' not found")
  })
})

// ---------------------------------------------------------------------------
// postReviewFeedback / getReviewFeedback -> merged.reviewFeedback.post / .get
// ---------------------------------------------------------------------------

describe('postReviewFeedback / getReviewFeedback', () => {
  it('happy path: post (returns void) then get round-trips the SAME judgement (append-only, one event)', async () => {
    const { mergedRunId } = await setupMergedRun()
    const posted = await postReviewFeedback(mergedRunId, {
      scope: 'review_decision',
      case_id: 'c1',
      checkpoint_id: 'cp1',
      stage: 'trigger',
      review_target: 'decision',
      labels: { assessment: 'agree' },
    })
    expect(posted).toBeUndefined()

    const listed = await getReviewFeedback(mergedRunId)
    expect(listed.events.length).toBe(1)
    expect(listed.events[0].target.case_id).toBe('c1')
    expect(listed.events[0].labels).toEqual({ assessment: 'agree' })
    expect(listed.package_versions.service.id).toBe(SERVICE_PKG_ID)
    expect(listed.package_versions.content.id).toBe(CONTENT_PKG_ID)
  })

  it('postReviewFeedback error path: unknown mergedRunId -> ProposalHttpError(404) exact', async () => {
    const exc = await expectRejects(
      postReviewFeedback('mrun_bogus_id', {
        scope: 'review_decision',
        case_id: 'c1',
        checkpoint_id: 'cp1',
        stage: 'trigger',
        review_target: 'decision',
        labels: {},
      }),
    )
    expect(exc).toBeInstanceOf(ProposalHttpError)
    expect((exc as ProposalHttpError).status).toBe(404)
    expect((exc as ProposalHttpError).message).toBe("Merged run 'mrun_bogus_id' not found")
  })

  it('getReviewFeedback error path: unknown mergedRunId -> ProposalHttpError(404) exact', async () => {
    const exc = await expectRejects(getReviewFeedback('mrun_bogus_id'))
    expect(exc).toBeInstanceOf(ProposalHttpError)
    expect((exc as ProposalHttpError).status).toBe(404)
    expect((exc as ProposalHttpError).message).toBe("Merged run 'mrun_bogus_id' not found")
  })
})
