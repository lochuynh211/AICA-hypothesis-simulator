import { describe, expect, it, vi, beforeEach } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import {
  createProposalRun,
  freezeSetupSnapshot,
  projectWorld,
  buildProposalOpportunity,
  ProposalHttpError,
  type CreateProposalRunBody,
  type ApplyQuickCheckContentFn,
} from '../src/engine/proposal/orchestrator/create_run'
import * as contextBase from '../src/engine/proposal/orchestrator/context_base'
import * as selectorModule from '../src/engine/proposal/selector'
import { worldSeedStore, proposalPackageRegistry, datasetCatalogRegistry } from '../src/engine/proposal/stores'
import type { ServiceCapabilities } from '../src/engine/proposal/eligibility'
import { ensureRegistry } from '../src/data/registry'
import { loadFixture, expectParity } from '../src/engine/__fixtures__/parity'
import { proposalRunsStore } from '../src/storage/proposal_runs_store'
import type { ProposalRunLog, ProposalRunCache } from '../src/engine/proposal/run_manager'

/**
 * Conformance test for `src/engine/proposal/orchestrator/create_run.ts` —
 * the port of `create_proposal_run` + `_freeze_setup_snapshot`
 * (`app/api/aica_api/routers/proposal.py`) plus this task's own
 * `World.project()` port (`projectWorld`) — feature 026 (htmlapp Combined
 * export), slice C4a Task 3. See `create_run.ts`'s own module doc for the
 * full control-flow enumeration, the `_apply_quick_check_content` seam
 * design, the `World.project()` scope finding, and the hazard pass; this
 * file does not repeat that reasoning, only the resulting test evidence.
 *
 * Fixture: `src/engine/__fixtures__/parity/proposal_create_run.json`,
 * captured by `scripts/gen/capture_all.py#_capture_proposal_create_run` —
 * every success/raising case calls the REAL `create_proposal_run` directly
 * (never a hand-rolled stand-in), always `cache={}` (in-memory, side-effect
 * free for the capture script — see that function's own doc for why a
 * second on-disk capture would add nothing), over the REAL committed seed
 * `seed-night-highway-oshi` and the two REAL ported packages
 * (`aica_transparent_service_selector_v1`/
 * `aica_transparent_content_selector_v1`) — the exact pair
 * `app/api/tests/test_proposal_cache.py`'s own router-level acceptance test
 * uses. `run_id`/`created_at`/`opportunity_id`/every event `at` are frozen
 * to fixed literals post-hoc in the capture (real ids/clock reads,
 * unavoidably non-deterministic) — `stripVolatile` below performs the
 * SAME freeze on this port's own output before comparing.
 *
 * ── Branch coverage table (per the task brief's reporting rule) ────────────
 *
 * quick-check vs full (interactive) mode: BOTH reached —
 *   `interactive_full_mode_service_selected_no_content` (content never
 *   dispatches even though a service WAS selected — proves the `mode`
 *   guard, not merely `selectedServiceId !== null`, gates the branch);
 *   `quick_check_content_dispatched_rank1`/`_with_override`/
 *   `algorithm_config_overrides_applied` (quick_check, content dispatched).
 * content dispatched vs not: BOTH reached — the 3 quick_check cases above
 *   dispatch (via the injected fake seam); `interactive_full_mode_...` and
 *   the "zero eligible" test below do not.
 * eligibility rejecting every candidate: reached via `vi.spyOn` on
 *   `getServiceCapabilities` (see that describe block's own doc comment for
 *   why — the REAL committed capability/matrix data provably cannot reach
 *   this branch through `createProposalRun`'s real call site; even
 *   Python's OWN test suite reaches it only by monkeypatching
 *   `resolve_eligibility`).
 * cache supplied vs absent: BOTH reached — the "non-persisting path" describe
 *   block below (Step 6) plus the "cache absent" converse tests.
 *
 * Every other conditional in `create_run.ts` (unknown/mis-slotted package
 * ids, neither-world-nor-world_snapshot, incompatible/unrepresented matrix
 * pair, empty resolved allowed_service_ids, unknown dataset, invalid-world
 * catalog reference, the `quick_check_service_id` override vs rank-1
 * fallback, `algorithm_config_overrides` present vs absent, legacy
 * `world_snapshot` vs typed `world`) is exercised by a named fixture case
 * below — see each `it()` for which.
 */

ensureRegistry()
beforeEach(() => { globalThis.indexedDB = new IDBFactory() })

const { output } = loadFixture('proposal_create_run')
const CASES: Record<string, any> = Object.fromEntries(
  output.create_proposal_run_cases.map((c: any) => [c.name, c]),
)

const SERVICE_PKG_ID = 'aica_transparent_service_selector_v1'
const CONTENT_PKG_ID = 'aica_transparent_content_selector_v1'
const SEED_ID = 'seed-night-highway-oshi'

function deepCopy<T>(value: T): T {
  if (Array.isArray(value)) return value.map((v) => deepCopy(v)) as unknown as T
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = deepCopy(v)
    return out as unknown as T
  }
  return value
}

function baseWorld(): Record<string, unknown> {
  const seed = worldSeedStore.getSeed(SEED_ID)
  if (!seed) throw new Error(`fixture seed not found: ${SEED_ID}`)
  return deepCopy(seed.world as Record<string, unknown>)
}

/** Mirrors the capture script's own `_base_kwargs` — deliberately does NOT
 * set `parameters`/`hyperparameters` (relies on `createProposalRun`'s own
 * package-default resolution), matching the real Python capture. */
function baseBody(overrides: Partial<CreateProposalRunBody> = {}): CreateProposalRunBody {
  return {
    world: baseWorld(),
    service_package_id: SERVICE_PKG_ID,
    content_package_id: CONTENT_PKG_ID,
    run_seed: 'seed-create-run-test',
    simulation_time: '2026-08-02T09:00:00Z',
    ...overrides,
  }
}

/** Mirrors the capture script's own `_freeze_ids` — replaces this port's
 * OWN freshly-minted run_id/opportunity_id/created_at/every event `at` with
 * the SAME fixed literals the Python capture wrote, so a structural
 * `expectParity` against the golden is meaningful. */
function stripVolatile(v: unknown, runId: string, opportunityId: string): unknown {
  if (Array.isArray(v)) return v.map((x) => stripVolatile(x, runId, opportunityId))
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (k === 'created_at' || k === 'at') out[k] = '2026-01-01T00:00:00.000000Z'
      else if (k === 'run_id' && val === runId) out[k] = 'prun_TEST_FIXED'
      else if (k === 'opportunity_id' && val === opportunityId) out[k] = 'op_TEST_FIXED'
      else out[k] = stripVolatile(val, runId, opportunityId)
    }
    return out
  }
  return v
}

/** A fake `_apply_quick_check_content` (Task 4 seam) — echoes back what it
 * was called with, so tests can assert `createProposalRun`'s OWN
 * responsibility (detect the branch, resolve content parameters, delegate,
 * forward `cache`) without reimplementing Task 4's real dispatch logic. */
function makeFakeApplyQuickCheckContent(): {
  fn: ApplyQuickCheckContentFn
  calls: Array<{
    runId: string
    runLog: ProposalRunLog
    selectedServiceId: string
    contentParameters: Record<string, unknown>
    contentHyperparameters: Record<string, unknown>
    cache: ProposalRunCache | undefined
  }>
} {
  const calls: Array<any> = []
  const fn: ApplyQuickCheckContentFn = async (runId, runLog, selectedServiceId, contentParameters, contentHyperparameters, options) => {
    calls.push({ runId, runLog, selectedServiceId, contentParameters, contentHyperparameters, cache: options.cache })
    return { ...runLog, status: 'content_selected' }
  }
  return { fn, calls }
}

// ---------------------------------------------------------------------------
// Success-path parity — full run log, structurally compared against the
// REAL captured Python create_proposal_run() output.
// ---------------------------------------------------------------------------

describe('createProposalRun — success-path parity against real Python create_proposal_run()', () => {
  it('interactive_full_mode_service_selected_no_content: service selected, content NEVER dispatched even though a service was picked (mode gates the branch, not just selectedServiceId)', async () => {
    const golden = CASES.interactive_full_mode_service_selected_no_content
    const { fn, calls } = makeFakeApplyQuickCheckContent()
    const result = await createProposalRun(baseBody({ mode: 'interactive' }), { applyQuickCheckContent: fn })
    expect(calls).toHaveLength(0) // interactive mode never calls the seam
    expectParity(stripVolatile(result, result.run_id, result.opportunity.opportunity_id), golden.result)
  })

  it('quick_check_content_dispatched_rank1: quick_check auto-selects rank-1 and dispatches content (fake seam simulates Task 4 success)', async () => {
    const golden = CASES.quick_check_content_dispatched_rank1
    const { fn, calls } = makeFakeApplyQuickCheckContent()
    const result = await createProposalRun(baseBody({ mode: 'quick_check' }), { applyQuickCheckContent: fn })
    expect(calls).toHaveLength(1)
    expect(calls[0].selectedServiceId).toBe('humming_karaoke')
    // STEP-1-only comparison (the fake seam's own return is a stub, not a
    // real content dispatch — see module doc: Task 4's own logic is out of
    // this task's scope). Compare everything EXCEPT status/evidence/events
    // (which the real Python run advances past STEP 1 via the real
    // _apply_quick_check_content, that this fake does not reimplement).
    const step1 = calls[0].runLog
    expect(step1.status).toBe('service_selected')
    expect(step1.evidence).toHaveLength(1)
    expect(step1.evidence[0].step).toBe('service')
    const goldenServiceEvidence = golden.result.evidence.find((e: any) => e.step === 'service')
    expectParity(step1.evidence[0].output, goldenServiceEvidence.output, 'service evidence output')
    // The content parameters/hyperparameters THIS function computed and
    // forwarded to the seam must match what real Python's OWN content
    // dispatch ultimately persisted (run_log.content_parameters/
    // content_hyperparameters) — cross-checked against the REAL end state,
    // even though the fake seam itself never touches persistence.
    expectParity(calls[0].contentParameters, golden.result.content_parameters, 'content_parameters')
    expectParity(calls[0].contentHyperparameters, golden.result.content_hyperparameters, 'content_hyperparameters')
  })

  it('quick_check_content_dispatched_with_override: quick_check_service_id picks a non-rank-1 ranked candidate ("quiz", rank 3) — proves the override branch, not a coincidental rank-1 match', async () => {
    const golden = CASES.quick_check_content_dispatched_with_override
    const { fn, calls } = makeFakeApplyQuickCheckContent()
    await createProposalRun(baseBody({ mode: 'quick_check', quick_check_service_id: 'quiz' }), { applyQuickCheckContent: fn })
    expect(calls).toHaveLength(1)
    expect(calls[0].selectedServiceId).toBe('quiz')
    expect(golden.result.journey_state.active_service_id).toBe('quiz') // sanity: matches real Python too
  })

  it('algorithm_config_overrides_applied: service override merges into hyperparameters BEFORE dispatch, content override merges into contentHyperparameters forwarded to the seam', async () => {
    const golden = CASES.algorithm_config_overrides_applied
    const { fn, calls } = makeFakeApplyQuickCheckContent()
    const result = await createProposalRun(
      baseBody({
        mode: 'quick_check',
        algorithm_config_overrides: { service: { gamma_drowsiness: 0.123456 }, content: { plan_item_count: 1 } },
      }),
      { applyQuickCheckContent: fn },
    )
    expect((result.hyperparameters as any).gamma_drowsiness).toBe(0.123456)
    expect(calls[0].contentHyperparameters.plan_item_count).toBe(1)
    expectParity((result.hyperparameters as any).gamma_drowsiness, golden.result.hyperparameters.gamma_drowsiness, 'gamma_drowsiness')
    expectParity(calls[0].contentHyperparameters.plan_item_count, golden.result.content_hyperparameters.plan_item_count, 'plan_item_count')
    expectParity(result.setup_snapshot, golden.result.setup_snapshot, 'setup_snapshot')
  })

  it('legacy_world_snapshot_path_no_freeze: a pre-frozen world_snapshot (no typed world) skips freezeSetupSnapshot entirely — setup_snapshot stays null, world stays null', async () => {
    const golden = CASES.legacy_world_snapshot_path_no_freeze
    const legacyWorldSnapshot = golden.result.world_snapshot
    const result = await createProposalRun({
      world_snapshot: legacyWorldSnapshot,
      trigger_purpose: 'rest_recommended',
      lifecycle_stage: 'before_rest_until_stop',
      motion_state: 'driving',
      service_package_id: SERVICE_PKG_ID,
      content_package_id: CONTENT_PKG_ID,
      run_seed: 'seed-create-run-test',
      simulation_time: '2026-08-02T09:00:00Z',
      mode: 'interactive',
    })
    expect(result.setup_snapshot).toBeNull()
    expect(result.world).toBeNull()
    expectParity(stripVolatile(result, result.run_id, result.opportunity.opportunity_id), golden.result)
  })
})

// ---------------------------------------------------------------------------
// Raising paths — ProposalHttpError.status/.detail match the real captured
// Python HTTPException.status_code/.detail.
// ---------------------------------------------------------------------------

describe('createProposalRun — raising paths, byte-exact against real Python HTTPException detail (except where noted)', () => {
  it('unknown_service_package_id_raises', async () => {
    const golden = CASES.unknown_service_package_id_raises
    await expect(createProposalRun(baseBody({ service_package_id: 'not_a_real_package_id' })))
      .rejects.toMatchObject({ status: golden.status_code, detail: golden.detail })
  })

  it('mis_slotted_service_package_id_raises: a real CONTENT package id used in the SERVICE slot', async () => {
    const golden = CASES.mis_slotted_service_package_id_raises
    await expect(createProposalRun(baseBody({ service_package_id: CONTENT_PKG_ID })))
      .rejects.toMatchObject({ status: golden.status_code, detail: golden.detail })
  })

  it('unknown_content_package_id_raises', async () => {
    const golden = CASES.unknown_content_package_id_raises
    await expect(createProposalRun(baseBody({ content_package_id: 'not_a_real_package_id' })))
      .rejects.toMatchObject({ status: golden.status_code, detail: golden.detail })
  })

  it('neither_world_nor_world_snapshot_raises', async () => {
    const golden = CASES.neither_world_nor_world_snapshot_raises
    await expect(createProposalRun({
      trigger_purpose: 'rest_recommended', lifecycle_stage: 'before_rest_until_stop', motion_state: 'driving',
      service_package_id: SERVICE_PKG_ID, content_package_id: CONTENT_PKG_ID,
      run_seed: 'seed-create-run-test', simulation_time: '2026-08-02T09:00:00Z',
    })).rejects.toMatchObject({ status: golden.status_code, detail: golden.detail })
  })

  it('empty_matrix_row_raises: during_rest_stopped resolves an empty allowed_service_ids row — ProposalOpportunity construction fails. NOT byte-compared to Python\'s multi-line pydantic ValidationError dump (same documented precedent as matrix.ts/world_validation.ts) — only the core validator text + status.', async () => {
    const golden = CASES.empty_matrix_row_raises
    await expect(
      createProposalRun(baseBody({ trigger_purpose: 'rest_recommended', lifecycle_stage: 'during_rest_stopped' })),
    ).rejects.toMatchObject({
      status: golden.status_code,
      message: 'allowed_service_ids must not be empty; supply at least one ServiceId.',
    })
  })

  it('incompatible_matrix_pair_raises', async () => {
    const golden = CASES.incompatible_matrix_pair_raises
    await expect(
      createProposalRun(baseBody({ trigger_purpose: 'rest_recommended', lifecycle_stage: 'active_driving_content' })),
    ).rejects.toMatchObject({ status: golden.status_code, message: golden.detail })
  })

  it('unknown_dataset_id_raises', async () => {
    const golden = CASES.unknown_dataset_id_raises
    const world = baseWorld()
    ;(world.control_inputs as Record<string, unknown>).dataset_id = 'not-a-real-dataset-id'
    await expect(createProposalRun(baseBody({ world })))
      .rejects.toMatchObject({ status: golden.status_code, detail: golden.detail })
  })

  it('catalog_reference_invalid_raises: driver_profile.oshi_artists[0].artist_id absent from the real catalog — proves freezeSetupSnapshot\'s validateWorld call is genuinely wired in', async () => {
    const golden = CASES.catalog_reference_invalid_raises
    const world = baseWorld()
    ;((world.driver_profile as Record<string, unknown>).oshi_artists as any[])[0].artist_id = 'not-a-real-artist-id'
    await expect(createProposalRun(baseBody({ world })))
      .rejects.toMatchObject({ status: golden.status_code, detail: golden.detail })
  })
})

// ---------------------------------------------------------------------------
// "Eligibility rejects every candidate" (T017a) — see module doc: provably
// UNREACHABLE through createProposalRun's real call site with the real
// committed service_capabilities/matrix data (every non-empty matrix row
// has at least one motion/entity-safe service, and create_proposal_run
// never passes unavailable_service_ids to resolve_eligibility). Python's
// OWN test suite (test_p4_evidence_gate.py) reaches this branch only by
// monkeypatching resolve_eligibility itself — this test does the TS
// equivalent: vi.spyOn the SAME seam (getServiceCapabilities, imported by
// create_run.ts from context_base.ts) so the REAL resolveEligibility still
// runs, over FAKE capability data that makes every candidate driving-unsafe.
// ---------------------------------------------------------------------------

describe('createProposalRun — eligibility rejects every candidate (T017a, real data cannot reach this — see module doc)', () => {
  it('every candidate excluded -> NO_ELIGIBLE_CANDIDATE event, status service_selected, evidence: [], no selector dispatch, no content dispatch', async () => {
    const allStoppedOnly: ServiceCapabilities = {
      get: (serviceId) => ({
        service_id: serviceId,
        driving_capable: false,
        screen_dependent: true,
        stopped_only: true,
        background_on_motion: false,
        lighting_compatible: false,
        requires_entity: null,
      }),
    }
    const spy = vi.spyOn(contextBase, 'getServiceCapabilities').mockReturnValue(allStoppedOnly)
    try {
      const { fn, calls } = makeFakeApplyQuickCheckContent()
      const result = await createProposalRun(baseBody({ mode: 'quick_check' }), { applyQuickCheckContent: fn })

      expect(result.status).toBe('service_selected')
      expect(result.evidence).toEqual([])
      expect(result.journey_state.active_service_id).toBeNull()
      const eventTypes = result.events.map((e) => e.event_type)
      expect(eventTypes).toEqual(['OPPORTUNITY_OPENED', 'NO_ELIGIBLE_CANDIDATE'])
      const noEligibleEvent = result.events[1]
      expect((noEligibleEvent.payload.excluded as any[]).length).toBeGreaterThan(0)
      for (const excl of noEligibleEvent.payload.excluded as any[]) {
        expect(Object.keys(excl).sort()).toEqual(['reason_codes', 'service_id']) // FR-003: no score/fit/weight/utility key
      }
      expect(calls).toHaveLength(0) // content is NEVER dispatched for a zero-eligible run, even in quick_check mode
    } finally {
      spy.mockRestore()
    }
  })
})

// ---------------------------------------------------------------------------
// Step 6 — the LOAD-BEARING negative assertion: cache mode NEVER writes
// proposalRunsStore. Mirrors proposal_run_manager_cache.test.ts's own
// technique exactly (spy on every store write method + read the store back
// afterward) — an implementation writing to BOTH cache and store would pass
// a positive-only "the return value looks right" test but still corrupt the
// user's persisted run list; this is why the assertion here is negative.
// ---------------------------------------------------------------------------

describe('createProposalRun — cache supplied vs absent (the defect this task exists to prevent)', () => {
  it('cache supplied (interactive): proposalRunsStore is NEVER written; the cache holds the finished log', async () => {
    const putHeaderSpy = vi.spyOn(proposalRunsStore, 'putHeader')
    const appendEventSpy = vi.spyOn(proposalRunsStore, 'appendEvent')
    const appendEvidenceSpy = vi.spyOn(proposalRunsStore, 'appendEvidence')

    const cache: ProposalRunCache = new Map()
    const result = await createProposalRun(baseBody({ mode: 'interactive' }), { cache })

    expect(putHeaderSpy).not.toHaveBeenCalled()
    expect(appendEventSpy).not.toHaveBeenCalled()
    expect(appendEvidenceSpy).not.toHaveBeenCalled()
    expect(await proposalRunsStore.listHeaders()).toEqual([])
    expect(cache.get(result.run_id)).toEqual(result)
  })

  it('cache supplied (quick_check, content dispatched via the fake seam, cache forwarded to it): proposalRunsStore is STILL never written', async () => {
    const putHeaderSpy = vi.spyOn(proposalRunsStore, 'putHeader')
    const cache: ProposalRunCache = new Map()
    const { fn, calls } = makeFakeApplyQuickCheckContent()

    await createProposalRun(baseBody({ mode: 'quick_check' }), { cache, applyQuickCheckContent: fn })

    expect(putHeaderSpy).not.toHaveBeenCalled()
    expect(await proposalRunsStore.listHeaders()).toEqual([])
    // The seam itself received the SAME cache — proving createProposalRun
    // forwards `cache` verbatim to the Task-4 seam, exactly like Python
    // forwards its own `cache` kwarg to `_apply_quick_check_content`.
    expect(calls[0].cache).toBe(cache)
  })

  it('an empty Map (mirrors Python\'s cache={}) still counts as "supplied" — the literal call pattern merged_quickview.py uses', async () => {
    const putHeaderSpy = vi.spyOn(proposalRunsStore, 'putHeader')
    const cache: ProposalRunCache = new Map()
    await createProposalRun(baseBody({ mode: 'interactive' }), { cache })
    expect(putHeaderSpy).not.toHaveBeenCalled()
    expect(cache.size).toBe(1)
  })

  it('cache ABSENT: proposalRunsStore IS written (the converse — behaviour unchanged from before this feature)', async () => {
    const result = await createProposalRun(baseBody({ mode: 'interactive' }))
    const header = await proposalRunsStore.getHeader(result.run_id)
    expect(header).toBeTruthy()
    expect(header!.run_id).toBe(result.run_id)
  })
})

// ---------------------------------------------------------------------------
// applyQuickCheckContent seam — the Task-4 boundary itself (see module doc's
// "OUT OF SCOPE" section for why this file injects a fake rather than a real
// implementation).
// ---------------------------------------------------------------------------

describe('createProposalRun — applyQuickCheckContent seam (Task 4 boundary)', () => {
  it('throws a named, loud error when quick_check selects a service but no seam was supplied (never a silent divergence from Python)', async () => {
    await expect(createProposalRun(baseBody({ mode: 'quick_check' })))
      .rejects.toThrow(/applyQuickCheckContent/)
  })

  it('interactive mode never requires the seam, even when omitted', async () => {
    await expect(createProposalRun(baseBody({ mode: 'interactive' }))).resolves.toBeTruthy()
  })

  it('the seam\'s own return value becomes createProposalRun\'s own return value', async () => {
    const fn: ApplyQuickCheckContentFn = async (_runId, runLog) => ({ ...runLog, status: 'content_selected' })
    const result = await createProposalRun(baseBody({ mode: 'quick_check' }), { applyQuickCheckContent: fn })
    expect(result.status).toBe('content_selected')
  })
})

// ---------------------------------------------------------------------------
// freezeSetupSnapshot / projectWorld — direct unit-level coverage,
// including the mechanical dict.get(key,default) proof no real Python call
// can reach (see create_run.ts's own module doc + the capture script's
// dropped-case note for why).
// ---------------------------------------------------------------------------

describe('freezeSetupSnapshot (routers/proposal.py:738-814)', () => {
  const servicePkg = proposalPackageRegistry.get(SERVICE_PKG_ID)!
  const contentPkg = proposalPackageRegistry.get(CONTENT_PKG_ID)!

  it('matches the real captured Python output for the seed world (cross-checked via the legacy_world_snapshot_path_no_freeze golden, which embeds a REAL _freeze_setup_snapshot output)', () => {
    const golden = CASES.legacy_world_snapshot_path_no_freeze.result.world_snapshot
    const serviceHp: Record<string, unknown> = {}
    for (const hp of servicePkg.hyperparameters as any[]) serviceHp[hp.key] = hp.default
    const { worldSnapshot } = freezeSetupSnapshot({
      world: baseWorld(), matrixVersion: 'v1', servicePkg, contentPkg, serviceHyperparameters: serviceHp,
    })
    expectParity(worldSnapshot, golden, 'worldSnapshot')
  })

  it('unknown dataset_id -> ProposalHttpError(422, [{path, code: "unknown_dataset", message}])', () => {
    const world = baseWorld()
    ;(world.control_inputs as Record<string, unknown>).dataset_id = 'not-a-real-dataset-id'
    expect(() =>
      freezeSetupSnapshot({ world, matrixVersion: 'v1', servicePkg, contentPkg, serviceHyperparameters: {} }),
    ).toThrow(ProposalHttpError)
    try {
      freezeSetupSnapshot({ world, matrixVersion: 'v1', servicePkg, contentPkg, serviceHyperparameters: {} })
      expect.unreachable()
    } catch (err) {
      expect(err).toBeInstanceOf(ProposalHttpError)
      expect((err as ProposalHttpError).status).toBe(422)
      expect((err as ProposalHttpError).detail).toEqual([
        { path: 'control_inputs.dataset_id', code: 'unknown_dataset', message: "Unknown dataset_id: 'not-a-real-dataset-id'" },
      ])
    }
  })

  it('invalid world (catalog reference) -> ProposalHttpError(422, ValidationIssue[])', () => {
    const world = baseWorld()
    ;((world.driver_profile as Record<string, unknown>).oshi_artists as any[])[0].artist_id = 'not-a-real-artist-id'
    expect(() =>
      freezeSetupSnapshot({ world, matrixVersion: 'v1', servicePkg, contentPkg, serviceHyperparameters: {} }),
    ).toThrow(ProposalHttpError)
  })

  it('SCOPE FINDING PROOF: dict.get(key, default) — an explicit null in serviceHyperparameters passes through as null, NOT the package default. This exact state cannot be reached through create_proposal_run\'s real call site (SetupSnapshot.service_parameter_set_version is a REQUIRED non-nullable str in Python — passing None there crashes _freeze_setup_snapshot with an uncaught pydantic ValidationError; see the capture script\'s own dropped-case note), so this proves pyGetDefault\'s mechanical correctness directly rather than via a Python-verified golden.', () => {
    const { setupSnapshot } = freezeSetupSnapshot({
      world: baseWorld(), matrixVersion: 'v1', servicePkg, contentPkg,
      serviceHyperparameters: { parameter_set_version: null },
    })
    expect(setupSnapshot.service_parameter_set_version).toBeNull()
    expect(setupSnapshot.service_parameter_set_version).not.toBe(servicePkg.version)
  })

  it('ABSENT parameter_set_version (the real service package\'s own natural state) falls back to servicePkg.version', () => {
    const { setupSnapshot } = freezeSetupSnapshot({
      world: baseWorld(), matrixVersion: 'v1', servicePkg, contentPkg, serviceHyperparameters: {},
    })
    expect(setupSnapshot.service_parameter_set_version).toBe(servicePkg.version)
  })
})

describe('projectWorld (models/proposal/world.py:497-541 — World.project(), this task\'s own scope finding)', () => {
  it('matches the real captured Python World.project() output for the seed world (feature_snapshot + feature_provenance)', () => {
    const golden = CASES.legacy_world_snapshot_path_no_freeze.result.world_snapshot
    const { featureSnapshot, featureProvenance } = projectWorld(baseWorld())
    expectParity(featureSnapshot, golden.feature_snapshot, 'featureSnapshot')
    expectParity(featureProvenance, golden.feature_provenance, 'featureProvenance')
  })

  it('hazard 4: feature_snapshot top-level key order is situation, preference, history, additional_proposed, _genre_extension_enabled (matches Python dict-literal-then-assign order)', () => {
    const { featureSnapshot } = projectWorld(baseWorld())
    expect(Object.keys(featureSnapshot)).toEqual(['situation', 'preference', 'history', 'additional_proposed', '_genre_extension_enabled'])
  })

  it('genre extension OFF (this seed\'s natural state): no genre_affinity_v1 key at all', () => {
    const { featureSnapshot } = projectWorld(baseWorld())
    expect(featureSnapshot._genre_extension_enabled).toBe(false)
    expect('genre_affinity_v1' in featureSnapshot).toBe(false)
  })

  it('genre extension ON: genre_affinity_v1 = {usage_by_genre, scene_genre_usage}, defaulting to {} for a null field', () => {
    const world = baseWorld()
    ;(world.driver_profile as Record<string, unknown>).genre_affinity_v1_enabled = true
    const { featureSnapshot } = projectWorld(world)
    expect(featureSnapshot._genre_extension_enabled).toBe(true)
    const gav1 = featureSnapshot.genre_affinity_v1 as Record<string, unknown>
    expect(gav1.usage_by_genre).toEqual({})
    expect(gav1.scene_genre_usage).toEqual({})
    expect(Object.keys(featureSnapshot)).toEqual(['situation', 'preference', 'history', 'additional_proposed', '_genre_extension_enabled', 'genre_affinity_v1'])
  })
})

// ---------------------------------------------------------------------------
// buildProposalOpportunity — full validator coverage (only 1 of 3 is
// reachable via createProposalRun's own call site; ported/tested in full
// anyway — see create_run.ts's own doc comment).
// ---------------------------------------------------------------------------

describe('buildProposalOpportunity (models/proposal/opportunity.py::ProposalOpportunity validators)', () => {
  const args = {
    opportunityId: 'op-test-1',
    triggerPurpose: 'rest_recommended' as const,
    lifecycleStage: 'before_rest_until_stop' as const,
    allowedServiceIds: ['music_playlist'] as const,
    simulationTime: '2026-08-02T09:00:00Z',
    runSeed: 'seed-1',
  }

  it('builds a valid opportunity', () => {
    const opp = buildProposalOpportunity({ ...args, allowedServiceIds: [...args.allowedServiceIds] })
    expect(opp).toEqual({
      opportunity_id: 'op-test-1', trigger_purpose: 'rest_recommended', lifecycle_stage: 'before_rest_until_stop',
      allowed_service_ids: ['music_playlist'], simulation_time: '2026-08-02T09:00:00Z', run_seed: 'seed-1',
    })
  })

  it('empty opportunity_id -> ProposalHttpError(422) [never reachable via createProposalRun\'s own call site — makeOpportunityId never returns empty; ported for fidelity]', () => {
    expect(() => buildProposalOpportunity({ ...args, opportunityId: '', allowedServiceIds: [...args.allowedServiceIds] }))
      .toThrow(ProposalHttpError)
  })

  it('empty allowedServiceIds -> ProposalHttpError(422) — the REACHABLE validator (during_rest_stopped\'s empty matrix row)', () => {
    expect(() => buildProposalOpportunity({ ...args, allowedServiceIds: [] }))
      .toThrow('allowed_service_ids must not be empty; supply at least one ServiceId.')
  })

  it('rest-stage purpose mismatch -> ProposalHttpError(422) [never reachable via createProposalRun\'s own call site — resolveMatrix already guarantees a compatible pair; ported for fidelity]', () => {
    expect(() =>
      buildProposalOpportunity({ ...args, triggerPurpose: 'route_music', lifecycleStage: 'before_rest_until_stop', allowedServiceIds: [...args.allowedServiceIds] }),
    ).toThrow(/only compatible with trigger_purpose 'rest_recommended'/)
  })

  it('active_driving_content purpose mismatch -> ProposalHttpError(422) [same reachability note]', () => {
    expect(() =>
      buildProposalOpportunity({ ...args, triggerPurpose: 'rest_recommended', lifecycleStage: 'active_driving_content', allowedServiceIds: [...args.allowedServiceIds] }),
    ).toThrow(/only compatible with purposes/)
  })
})

// ---------------------------------------------------------------------------
// Regression: Python's `if ranked_candidates:` (routers/proposal.py:1016) is a
// TRUTHINESS check and a SECOND guard distinct from the `.get()` above it.
// This file originally mirrored it with `.length > 0`, which throws TypeError
// on a key present with an explicit null — where Python cleanly takes the
// false branch. recompute.ts ports the identical idiom (proposal.py:1743) and
// covers it; this is create_run.ts's own dedicated proof, so the fix does not
// rest on a sibling module's test plus code-reading.
//
// Mechanical proof, verified against both languages directly:
//   python:  {'ranked_candidates': None}.get('ranked_candidates', []) -> None
//            if ranked_candidates:                                    -> False
//   ts:      pyGetDefault(...) -> null ;  null.length -> TypeError
//            pyTruthy(null)    -> false   (matches Python)
// ---------------------------------------------------------------------------
describe("create_run mirrors Python's ranked_candidates truthiness, not a length check", () => {
  it('evidence.output with ranked_candidates PRESENT but explicitly null does not crash, and selects no service', async () => {
    const fn: ApplyQuickCheckContentFn = async (_id, runLog) => runLog
    // Same evidence shape recompute's own equivalent test uses; `error: null`
    // matters — without it the ALGORITHM_ERROR branch fires first and the
    // ranked_candidates guard is never reached, so the test would pass for
    // entirely the wrong reason.
    const spy = vi.spyOn(selectorModule, 'dispatchSelector').mockReturnValue({
      step: 'service' as const,
      package_id: 'aica_transparent_service_selector_v1',
      contract_version: '1.0.0',
      schema_version: '1.0.0',
      matrix_version: 'v1',
      input_snapshot: {},
      error: null,
      used_feature_ids: [],
      unused_available_features: [],
      missing_features: [],
      output: { ranked_candidates: null, decision_type: 'ranked_candidates' },
    } as never)
    try {
      // Must RESOLVE. Before the fix this threw
      // "Cannot read properties of null (reading 'length')".
      const result = await createProposalRun(
        baseBody({ mode: 'quick_check', quick_check_service_id: 'quiz' }),
        { applyQuickCheckContent: fn },
      )
      expect(result.journey_state.active_service_id).toBeNull()
      expect(result.events.map((e) => e.event_type)).not.toContain('SERVICE_SELECTED')
    } finally {
      spy.mockRestore()
    }
  })
})
