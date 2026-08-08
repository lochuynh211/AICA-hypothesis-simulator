import { describe, it, expect, beforeEach } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { ensureRegistry } from '../src/data/registry'
import { dispatch, resetDispatchState } from '../src/engine/worker/dispatch'
import { router } from '../src/engine/worker/router'
import { serializeError, unwrap, type RpcOp, type RpcResponse } from '../src/api/rpc'
import { clearDraftRegistry } from '../src/engine/run_plan'
import { clearRegistry } from '../src/engine/run_manager'
import { worldSeedStore } from '../src/engine/proposal/stores'
import { getHandle } from '../src/storage/merged_runs_store'
import { runsRestSpots } from '../src/engine/worker/handlers/runs'
import { ProposalHttpError } from '../src/engine/proposal/orchestrator/create_run'
import { ExplanationProviderUnsupportedError } from '../src/api/errors'
import type { CreateMergedPlanBody, CreateMergedRunBody } from '../src/engine/merged/run_setup'
import type { MergedQuickviewBody, MergedTickResponse } from '../src/engine/merged/types'

/**
 * Task 9 integration test — round-trips ALL FOURTEEN `merged.*` RPC ops
 * through the REAL worker seam (`dispatch` -> `router` -> the handler in
 * `src/engine/worker/handlers/merged.ts`), never by calling a handler
 * function directly. This is the completeness-gate task: Tasks 5-8 already
 * built and unit-tested every ported module this file's handlers merely
 * adapt (`src/engine/merged/{run_setup,quickview,tick,actions,explain,
 * review_feedback}.ts`) — this file's own job is proving those modules are
 * REACHABLE from a real RPC call, not re-proving their business logic
 * (already covered by `tests/merged_*_port.test.ts`).
 *
 * Every op below is exercised at least once for its happy path AND at least
 * once for an error shape that crosses the RPC boundary (`res.ok === false`
 * with the expected `error.type`/`.message`, and — for `ProposalHttpError`
 * specifically — `.status`/`.detail`, the two fields beyond `{type,
 * message}` that `serializeError`'s generic fallback would otherwise drop;
 * see this task's own `src/api/rpc.ts` diff, "ProposalHttpError-only" doc
 * comment).
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

function basePlanBody(overrides: Partial<CreateMergedPlanBody> = {}): CreateMergedPlanBody {
  return {
    package_id: PACKAGE_ID, scenario_id: SCENARIO_ID, route_preset_id: null,
    run_seed: TRIGGER_RUN_SEED, mountain_range_km: null, jam_range_km: null,
    jam_speed_kph: 15.0, presets: {}, parameters: {}, hyperparameters: {},
    profiles: null, initial_state: null, context_overrides: null,
    ...overrides,
  }
}

function baseQuickviewBody(overrides: Partial<MergedQuickviewBody> = {}): MergedQuickviewBody {
  return {
    package_id: PACKAGE_ID, scenario_id: SCENARIO_ID, route_preset_id: null,
    run_seed: TRIGGER_RUN_SEED, mountain_range_km: null, jam_range_km: null,
    jam_speed_kph: 15.0, hyperparameter_overrides: {}, rest_option_id: null,
    context_overrides: null, initial_state: null, profiles: null, tick_seconds: null,
    world: baseWorld(), service_package_id: SERVICE_PKG_ID, content_package_id: CONTENT_PKG_ID,
    run_seed_proposal: 'seed-merged-ops-test',
    service_parameters: {}, service_hyperparameters: {}, content_parameters: {}, content_hyperparameters: {},
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Small dispatch helpers — real seam only, never a direct handler call.
// ---------------------------------------------------------------------------

async function callOk<T>(op: RpcOp, params?: unknown): Promise<T> {
  const res = (await dispatch({ op, params })) as RpcResponse<T>
  if (!res.ok) {
    throw new Error(`expected ${op} to succeed, got ${res.error.type}: ${res.error.message}`)
  }
  return res.result
}

async function callErr(op: RpcOp, params?: unknown): Promise<Extract<RpcResponse, { ok: false }>> {
  const res = await dispatch({ op, params })
  if (res.ok) throw new Error(`expected ${op} to fail but it returned ok:true`)
  return res
}

/** The rest fire must land while the scenario's one named rest spot is still
 * AHEAD of the driver, or `acceptRest` has nothing to accept. At the package
 * default `threshold_fire` it no longer does: the 2026-08-08 recovery-semantics
 * refactor drains drowsiness while the driver consumes the accepted monotony
 * content, so the rest threshold is crossed later and the car has already
 * passed the spot. Lowering the threshold restores the ordering this round trip
 * needs. Same remedy, same reason as `merged_quickview.json`'s own capture
 * (see `scripts/gen/capture_all.py`), and scoped to the round-trip test so
 * every other test in this file keeps running on package defaults. */
const REST_BEFORE_SPOT_HYPERPARAMS = { threshold_fire: 80.0 }

async function setupMergedRun(
  overrides: Partial<CreateMergedRunBody> = {},
  planOverrides: Partial<CreateMergedPlanBody> = {},
): Promise<{ mergedRunId: string; triggerRunId: string }> {
  const plan = await callOk<{ plan_id: string }>('merged.plan', basePlanBody(planOverrides))
  const run = await callOk<{ merged_run_id: string; trigger_run_id: string }>('merged.create', {
    trigger_plan_id: plan.plan_id, world: baseWorld(),
    service_package_id: SERVICE_PKG_ID, content_package_id: CONTENT_PKG_ID,
    proposal_mode: 'interactive', run_seed: PROPOSAL_RUN_SEED,
    service_parameters: {}, service_hyperparameters: {}, content_parameters: {}, content_hyperparameters: {},
    ...overrides,
  })
  return { mergedRunId: run.merged_run_id, triggerRunId: run.trigger_run_id }
}

/** Ticks (through the real `merged.tick` op) until the first fire, or —
 * when `wantRest` is set — the first REST_PROPOSAL fire specifically.
 * Mirrors `tests/merged_actions_port.test.ts`'s own `tickUntilFire` helper
 * (this exact package/scenario/seed combo is empirically pinned: tick 12 =
 * monotony, tick 17 = rest — see that file's own doc comment). */
async function tickUntilFire(mergedRunId: string, opts: { wantRest?: boolean } = {}, maxTicks = 20): Promise<MergedTickResponse> {
  for (let i = 0; i < maxTicks; i++) {
    const resp = await callOk<MergedTickResponse>('merged.tick', { mergedRunId })
    if (resp.proposal !== null) {
      const decision = resp.trigger.decision as { result_type?: string } | null
      if (!opts.wantRest || decision?.result_type === 'REST_PROPOSAL') return resp
    }
  }
  throw new Error(`expected a fire within ${maxTicks} ticks (wantRest=${opts.wantRest ?? false})`)
}

// ---------------------------------------------------------------------------
// merged.plan
// ---------------------------------------------------------------------------

describe('merged.plan', () => {
  it('happy path: real plan_id', async () => {
    const result = await callOk<{ plan_id: string }>('merged.plan', basePlanBody())
    expect(result.plan_id).toMatch(/^plan_/)
  })

  it('error path: unknown package_id -> ProposalHttpError(400), status+message cross the wire', async () => {
    const res = await callErr('merged.plan', basePlanBody({ package_id: 'bogus_pkg' }))
    expect(res.error.type).toBe('ProposalHttpError')
    expect(res.error.status).toBe(400)
    expect(res.error.message).toContain("Package 'bogus_pkg' not found or invalid")
    // Round-trip through unwrap(): the rebuilt error is a REAL ProposalHttpError
    // instance carrying .status — not just a generic Error with the right message.
    expect(() => unwrap(res)).toThrow(ProposalHttpError)
    try {
      unwrap(res)
      expect.unreachable()
    } catch (exc) {
      expect(exc).toBeInstanceOf(ProposalHttpError)
      expect((exc as ProposalHttpError).status).toBe(400)
    }
  })

  it('structured detail (PlanValidationDetail) survives the RPC boundary, not just the summary message', async () => {
    const res = await callErr('merged.plan', basePlanBody({ initial_state: { bogus_key: 1 } }))
    expect(res.error.type).toBe('ProposalHttpError')
    expect(res.error.status).toBe(400)
    const detail = res.error.detail as { detail: string; validation_errors: { field: string; message: string }[] }
    expect(detail.detail).toBe('One or more initial_state values are invalid.')
    expect(detail.validation_errors[0].field).toBe('initial_state.bogus_key')
  })
})

// ---------------------------------------------------------------------------
// merged.quickview
// ---------------------------------------------------------------------------

describe('merged.quickview', () => {
  it('happy path: unpainted local route fires at least once with an embedded proposal', async () => {
    const result = await callOk<import('../src/engine/merged/types').MergedInstantResult>('merged.quickview', baseQuickviewBody())
    expect(result.fired).toBe(true)
    expect(result.fires.length).toBeGreaterThan(0)
    expect(result.fires.some((f) => f.proposal !== null)).toBe(true)
  })

  it('painted branch: mountain_range_km triggers buildQuickviewRouteFacts (this handler\'s own conditional glue)', async () => {
    const result = await callOk<import('../src/engine/merged/types').MergedInstantResult>(
      'merged.quickview',
      baseQuickviewBody({ mountain_range_km: [1, 5] }),
    )
    expect(result.segments.some((s) => s.type === 'mountain_road')).toBe(true)
  })

  it('error path: unknown package_id -> the underlying iterPreviewTicks Error is WRAPPED into ProposalHttpError(400) by this task\'s own handler', async () => {
    const res = await callErr('merged.quickview', baseQuickviewBody({ package_id: 'bogus_pkg' }))
    expect(res.error.type).toBe('ProposalHttpError')
    expect(res.error.status).toBe(400)
    expect(res.error.message).toContain("not found or invalid")
  })
})

// ---------------------------------------------------------------------------
// merged.afterRestProposal
// ---------------------------------------------------------------------------

describe('merged.afterRestProposal', () => {
  it('happy path: default rank-1 dispatch returns a real ProposalRunLog', async () => {
    const result = await callOk<import('../src/engine/proposal/run_manager').ProposalRunLog>('merged.afterRestProposal', {
      world: baseWorld(), service_package_id: SERVICE_PKG_ID, content_package_id: CONTENT_PKG_ID,
      run_seed_proposal: 'seed-after-rest', selected_service_id: null,
      service_parameters: {}, service_hyperparameters: {},
    })
    expect(result.run_id).toMatch(/^prun_/)
    expect(result.opportunity.trigger_purpose).toBe('rest_recommended')
    expect(result.journey_state.lifecycle_stage).toBe('after_rest_before_restart')
  })

  it('error path: unknown content_package_id -> ProposalHttpError(422), propagated uncaught from createProposalRun', async () => {
    const res = await callErr('merged.afterRestProposal', {
      world: baseWorld(), service_package_id: SERVICE_PKG_ID, content_package_id: 'bogus_content_pkg',
      run_seed_proposal: 'seed-after-rest', selected_service_id: null,
      service_parameters: {}, service_hyperparameters: {},
    })
    expect(res.error.type).toBe('ProposalHttpError')
    expect(res.error.status).toBe(422)
    expect(res.error.message).toContain("Unknown or mis-slotted content_package_id: 'bogus_content_pkg'")
  })
})

// ---------------------------------------------------------------------------
// merged.create / merged.get / merged.list
// ---------------------------------------------------------------------------

describe('merged.create / merged.get / merged.list', () => {
  it('happy path: create -> get reassembles handle+trigger_log; list finds it', async () => {
    const { mergedRunId, triggerRunId } = await setupMergedRun()
    expect(mergedRunId).toMatch(/^mrun_/)
    expect(triggerRunId).toMatch(/^run_/)

    const got = await callOk<import('../src/engine/merged/run_setup').GetMergedRunResult>('merged.get', { mergedRunId })
    expect(got.handle.merged_run_id).toBe(mergedRunId)
    expect(got.handle.trigger_run_id).toBe(triggerRunId)
    expect(got.trigger_log).not.toBeNull()
    expect(got.proposal_logs).toEqual([])

    const listed = await callOk<{ merged_runs: { merged_run_id: string; trigger_run_id: string | null; proposal_run_ids_count: number }[] }>('merged.list')
    const row = listed.merged_runs.find((r) => r.merged_run_id === mergedRunId)
    expect(row).toBeDefined()
    expect(row?.trigger_run_id).toBe(triggerRunId)
    expect(row?.proposal_run_ids_count).toBe(0)
  })

  it('merged.list — no error path exists in Python either (a listing helper, not a validator); disclosed, not tested for a failure shape', async () => {
    const listed = await callOk<{ merged_runs: unknown[] }>('merged.list')
    expect(Array.isArray(listed.merged_runs)).toBe(true)
  })

  it('merged.create error path: unknown trigger_plan_id -> ProposalHttpError(400)', async () => {
    const res = await callErr('merged.create', {
      trigger_plan_id: 'plan_bogus', world: baseWorld(),
      service_package_id: SERVICE_PKG_ID, content_package_id: CONTENT_PKG_ID,
      proposal_mode: 'interactive', run_seed: PROPOSAL_RUN_SEED,
      service_parameters: {}, service_hyperparameters: {}, content_parameters: {}, content_hyperparameters: {},
    })
    expect(res.error.type).toBe('ProposalHttpError')
    expect(res.error.status).toBe(400)
  })

  it('merged.get error path: unknown mergedRunId -> ProposalHttpError(404) exact', async () => {
    const res = await callErr('merged.get', { mergedRunId: 'mrun_bogus_id' })
    expect(res.error.type).toBe('ProposalHttpError')
    expect(res.error.status).toBe(404)
    expect(res.error.message).toBe("Merged run 'mrun_bogus_id' not found")
  })
})

// ---------------------------------------------------------------------------
// merged.tick / merged.acceptRest / merged.proposalAction — one real
// sequential flow (create -> monotony fire -> select_service -> rest fire ->
// acceptRest), matching the real Combined-screen usage order.
// ---------------------------------------------------------------------------

describe('merged.tick / merged.proposalAction / merged.acceptRest — real sequential round trip', () => {
  it('tick 0 (no fire) -> tick until MONOTONY fire -> select_service -> tick until REST fire -> acceptRest', async () => {
    const { mergedRunId, triggerRunId } = await setupMergedRun(
      {},
      { hyperparameters: REST_BEFORE_SPOT_HYPERPARAMS },
    )

    // tick #1: no fire yet.
    const first = await callOk<MergedTickResponse>('merged.tick', { mergedRunId })
    expect(first.proposal).toBeNull()
    expect(first.correlation).toBeNull()

    // tick until the first (MONOTONY) fire creates a proposal run.
    const monotonyTick = await tickUntilFire(mergedRunId)
    expect(monotonyTick.proposal).not.toBeNull()
    const monotonyProposal = monotonyTick.proposal as Record<string, unknown> & {
      run_id: string
      evidence: { step: string; error: unknown; output: { ranked_candidates?: { candidate_id: string }[] } }[]
    }
    const serviceEvidence = monotonyProposal.evidence.find((e) => e.step === 'service' && e.error === null)
    const candidateId = serviceEvidence?.output.ranked_candidates?.[0]?.candidate_id
    expect(candidateId).toBeTruthy()

    // merged.proposalAction — select_service, real round trip.
    const selected = await callOk<import('../src/engine/proposal/run_manager').ProposalRunLog>('merged.proposalAction', {
      mergedRunId,
      body: { kind: 'select_service', selected_service_id: candidateId, action_type: null, payload: {} },
    })
    expect(selected.journey_state.active_service_id).toBe(candidateId)

    // tick until the REST fire (a DIFFERENT category -> a NEW proposal run).
    const restTick = await tickUntilFire(mergedRunId, { wantRest: true })
    expect(restTick.proposal).not.toBeNull()
    const restProposalRunId = (restTick.proposal as { run_id: string }).run_id
    expect(restProposalRunId).not.toBe(monotonyProposal.run_id)

    // merged.acceptRest — real rest spot from the already-registered
    // runs.restSpots op's own handler (test-helper only, not under test).
    const { rest_spots: spots } = await runsRestSpots({ runId: triggerRunId })
    expect(spots.length).toBeGreaterThan(0)
    const runState = await callOk<import('../src/engine/run_manager').RunStateM2>('merged.acceptRest', {
      mergedRunId,
      body: { recovery_option_id: RECOVERY_OPTION_ID, rest_spot: spots[0], nap_minutes: null },
    })
    expect(runState.recovery?.active).toBe(true)
    const handle = await getHandle(mergedRunId)
    expect(handle?.rest_stage_synced).toBe('before')
  })

  it('merged.tick error path: unknown mergedRunId -> ProposalHttpError(404) exact (tick.ts\'s own pre-existing message uses JSON.stringify, double-quoted — a different, already-tested quote style from the other merged.* 404s below, which use pyReprQuoteOne/single-quoted; not this task\'s scope to unify)', async () => {
    const res = await callErr('merged.tick', { mergedRunId: 'mrun_bogus_id' })
    expect(res.error.type).toBe('ProposalHttpError')
    expect(res.error.status).toBe(404)
    expect(res.error.message).toBe('Merged run "mrun_bogus_id" not found')
  })

  it('merged.acceptRest error path: a FRESH (un-ticked) run -> ProposalHttpError(422), "not paused"', async () => {
    const { mergedRunId } = await setupMergedRun()
    const res = await callErr('merged.acceptRest', {
      mergedRunId,
      body: {
        recovery_option_id: RECOVERY_OPTION_ID,
        rest_spot: { id: 'rest_0', label: { ja: 'x', en: 'x' }, route_fraction: 0.5, distance_km: 1, eta_min: 1, reachable: true },
        nap_minutes: null,
      },
    })
    expect(res.error.type).toBe('ProposalHttpError')
    expect(res.error.status).toBe(422)
    expect(res.error.message).toContain('No pending proposal for run')
  })

  it('merged.proposalAction error path: fresh run has NO active proposal run yet -> ProposalHttpError(404)', async () => {
    const { mergedRunId } = await setupMergedRun()
    const res = await callErr('merged.proposalAction', {
      mergedRunId,
      body: { kind: 'select_service', selected_service_id: 'full_karaoke', action_type: null, payload: {} },
    })
    expect(res.error.type).toBe('ProposalHttpError')
    expect(res.error.status).toBe(404)
    expect(res.error.message).toBe(`Merged run '${mergedRunId}' has no active proposal run`)
  })
})

// ---------------------------------------------------------------------------
// merged.decline — separate run (mutually exclusive with the accept flow
// above once a rest journey has started).
// ---------------------------------------------------------------------------

describe('merged.decline', () => {
  it('happy path: decline the first (MONOTONY) fire, re-arms the fire guard', async () => {
    const { mergedRunId } = await setupMergedRun()
    await tickUntilFire(mergedRunId)
    const before = await getHandle(mergedRunId)
    expect(before?.current_proposal_run_id).not.toBeNull()

    const runState = await callOk<import('../src/engine/run_manager').RunStateM2>('merged.decline', { mergedRunId })
    expect(runState.pending_proposal).toBeNull()

    const after = await getHandle(mergedRunId)
    expect(after?.current_proposal_run_id).toBeNull()
    expect(after?.current_proposal_category).toBeNull()
  })

  it('error path: unknown mergedRunId -> ProposalHttpError(404) exact', async () => {
    const res = await callErr('merged.decline', { mergedRunId: 'mrun_bogus_id' })
    expect(res.error.type).toBe('ProposalHttpError')
    expect(res.error.status).toBe(404)
    expect(res.error.message).toBe("Merged run 'mrun_bogus_id' not found")
  })
})

// ---------------------------------------------------------------------------
// merged.explain / merged.explainTrigger — sourced from a real quickview
// projection's embedded fire+proposal (no need to tick 12-17 times again).
// ---------------------------------------------------------------------------

describe('merged.explain / merged.explainTrigger', () => {
  async function realFireAndProposal() {
    const result = await callOk<import('../src/engine/merged/types').MergedInstantResult>('merged.quickview', baseQuickviewBody())
    const fired = result.fires.find(
      (f) => f.proposal !== null && (f.proposal as { journey_state?: { active_service_id?: string | null } }).journey_state?.active_service_id,
    )
    if (!fired) throw new Error('expected at least one fire with a dispatched service in the quickview projection')
    return fired
  }

  it('merged.explain happy path: provider="off" (deterministic template, no LLM) resolves the dispatched service target', async () => {
    const fire = await realFireAndProposal()
    const proposal = fire.proposal as { journey_state: { active_service_id: string } }
    const result = await callOk<import('../src/engine/proposal/orchestrator/explain').ExplainResponse>('merged.explain', {
      proposal: fire.proposal, step: 'service', target_id: proposal.journey_state.active_service_id, provider: 'off',
    })
    expect(result.step).toBe('service')
    expect(result.provider_used).toBe('template')
  })

  it('merged.explain error path: malformed proposal -> ProposalHttpError(422)', async () => {
    const res = await callErr('merged.explain', {
      proposal: { not: 'a real ProposalRunLog' }, step: 'service', target_id: 'anything', provider: 'off',
    })
    expect(res.error.type).toBe('ProposalHttpError')
    expect(res.error.status).toBe(422)
  })

  it('merged.explainTrigger happy path: provider="template" (trigger-only, no Ollama/browser call)', async () => {
    const fire = await realFireAndProposal()
    const { proposal: _p, proposal_error: _pe, ...plainFire } = fire
    const result = await callOk<import('../src/engine/merged/explain').TriggerExplainResponse>('merged.explainTrigger', {
      fire: plainFire, category: null, provider: 'template',
    })
    expect(result.step).toBe('trigger')
    expect(result.provider_used).toBe('template')
    expect(result.fell_back).toBe(false)
  })

  it('merged.explainTrigger error path (a DIFFERENT error class, round trips through the pre-existing branch): provider="backend" -> ExplanationProviderUnsupportedError', async () => {
    const fire = await realFireAndProposal()
    const { proposal: _p, proposal_error: _pe, ...plainFire } = fire
    const res = await callErr('merged.explainTrigger', { fire: plainFire, category: null, provider: 'backend' })
    expect(res.error.type).toBe('ExplanationProviderUnsupportedError')
    expect(() => unwrap(res)).toThrow(ExplanationProviderUnsupportedError)
  })
})

// ---------------------------------------------------------------------------
// merged.reviewFeedback.post / merged.reviewFeedback.get
// ---------------------------------------------------------------------------

describe('merged.reviewFeedback.post / merged.reviewFeedback.get', () => {
  it('happy path: post then get round-trips the SAME judgement (append-only, one feedback event)', async () => {
    const { mergedRunId } = await setupMergedRun()
    const posted = await callOk<import('../src/api/types').FeedbackEvent>('merged.reviewFeedback.post', {
      mergedRunId,
      body: { scope: 'review_decision', case_id: 'c1', checkpoint_id: 'cp1', stage: 'trigger', review_target: 'decision' },
    })
    expect(posted.kind).toBe('feedback')
    expect(posted.target.scope).toBe('review_decision')

    const listed = await callOk<import('../src/engine/merged/review_feedback').ReviewFeedbackListResponse>(
      'merged.reviewFeedback.get',
      { mergedRunId },
    )
    expect(listed.events.length).toBe(1)
    expect(listed.events[0].target.case_id).toBe('c1')
    expect(listed.package_versions.service.id).toBe(SERVICE_PKG_ID)
    expect(listed.package_versions.content.id).toBe(CONTENT_PKG_ID)
  })

  it('merged.reviewFeedback.post error path: unknown mergedRunId -> ProposalHttpError(404) exact', async () => {
    const res = await callErr('merged.reviewFeedback.post', {
      mergedRunId: 'mrun_bogus_id',
      body: { scope: 'review_decision', case_id: 'c1', checkpoint_id: 'cp1', stage: 'trigger', review_target: 'decision' },
    })
    expect(res.error.type).toBe('ProposalHttpError')
    expect(res.error.status).toBe(404)
    expect(res.error.message).toBe("Merged run 'mrun_bogus_id' not found")
  })

  it('merged.reviewFeedback.get error path: unknown mergedRunId -> ProposalHttpError(404) exact', async () => {
    const res = await callErr('merged.reviewFeedback.get', { mergedRunId: 'mrun_bogus_id' })
    expect(res.error.type).toBe('ProposalHttpError')
    expect(res.error.status).toBe(404)
    expect(res.error.message).toBe("Merged run 'mrun_bogus_id' not found")
  })
})

// ---------------------------------------------------------------------------
// ProposalHttpError round trip — structuredClone, not just in-process
// dispatch. The REAL worker transport (`backend.worker.ts`'s `postMessage`)
// structured-clones the RpcResponse; a field that survives `serializeError`
// in-process but not through structuredClone would be invisible until a
// user actually runs the built worker.
// ---------------------------------------------------------------------------

describe('ProposalHttpError — structuredClone round trip (not just in-process)', () => {
  it('a structured (non-string) detail survives structuredClone, and unwrap() rebuilds a real ProposalHttpError with .status/.detail intact', () => {
    const original = new ProposalHttpError(400, {
      detail: 'One or more initial_state values are invalid.',
      validation_errors: [{ field: 'initial_state.bogus_key', message: 'bad' }],
    })
    const wire = serializeError(original)
    const cloned = structuredClone(wire)
    expect(cloned).toEqual(wire)
    expect(cloned.status).toBe(400)
    expect((cloned.detail as { validation_errors: unknown[] }).validation_errors).toHaveLength(1)

    let caught: unknown
    try {
      unwrap({ ok: false, error: cloned })
    } catch (exc) {
      caught = exc
    }
    expect(caught).toBeInstanceOf(ProposalHttpError)
    expect((caught as ProposalHttpError).status).toBe(400)
    expect((caught as ProposalHttpError).detail).toEqual(original.detail)
  })

  it('a bare-string detail survives structuredClone too', () => {
    const original = new ProposalHttpError(404, "Merged run 'mrun_x' not found")
    const cloned = structuredClone(serializeError(original))
    expect(cloned.status).toBe(404)
    expect(cloned.detail).toBe("Merged run 'mrun_x' not found")
  })
})

// ---------------------------------------------------------------------------
// Completeness gate, both directions.
// ---------------------------------------------------------------------------

describe('router completeness — both directions', () => {
  const MERGED_OPS: RpcOp[] = [
    'merged.plan', 'merged.quickview', 'merged.afterRestProposal',
    'merged.explain', 'merged.explainTrigger',
    'merged.create', 'merged.get', 'merged.list',
    'merged.acceptRest', 'merged.decline', 'merged.tick', 'merged.proposalAction',
    'merged.reviewFeedback.post', 'merged.reviewFeedback.get',
  ]

  it('every declared merged.* op has a registered handler (the TS compiler already enforces this — Record<RpcOp, ...> makes a missing key a compile error; this is the runtime restatement)', () => {
    for (const op of MERGED_OPS) {
      expect(typeof router[op]).toBe('function')
    }
  })

  it('DELETE A HANDLER REGISTRATION and confirm dispatch fails — proves this suite goes through the real seam, not a mock that would stay green regardless', async () => {
    const original = router['merged.tick']
    // @ts-expect-error — deliberately violating Record<RpcOp, ...> completeness
    // at runtime, the exact mutation the brief calls out as highest-value:
    // deleting a handler registration must make something fail.
    delete router['merged.tick']
    try {
      const { mergedRunId } = await setupMergedRun()
      const res = await callErr('merged.tick', { mergedRunId })
      expect(res.error.type).toBe('UnknownOp')
      expect(res.error.message).toBe('unknown op: merged.tick')
    } finally {
      router['merged.tick'] = original
    }
    // Restored — the SAME op now succeeds again, proving the failure above
    // was caused by the deletion, not by some other break.
    const { mergedRunId } = await setupMergedRun()
    const restored = await callOk<MergedTickResponse>('merged.tick', { mergedRunId })
    expect(restored.trigger).toBeDefined()
  })
})
