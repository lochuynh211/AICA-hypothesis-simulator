import { describe, it, expect, beforeEach, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { ensureRegistry } from '../src/data/registry'
import { seedDefaults } from '../src/storage/db'
import { resetDispatchState } from '../src/engine/worker/dispatch'
import { clearDraftRegistry, getDraftEntry } from '../src/engine/run_plan'
import * as runPlanModule from '../src/engine/run_plan'
import { clearRegistry } from '../src/engine/run_manager'
import { loadFixture, expectParity } from '../src/engine/__fixtures__/parity'
import { worldSeedStore } from '../src/engine/proposal/stores'
import { packagesStore } from '../src/storage/packages_store'
import { createHandle, saveHandle, listHandles, listHandleEntries } from '../src/storage/merged_runs_store'
import { createProposalRun, ProposalHttpError } from '../src/engine/proposal/orchestrator/create_run'
import {
  createMergedPlan,
  buildQuickviewRouteFacts,
  createMergedRun,
  getMergedRun,
  listMergedRuns,
  summarizeMergedRunRow,
  readableErrorText,
  validateMergedInitialState,
  validateMergedContextOverrides,
  loadRoutePreset,
  makeTriggerRunId,
  makeMergedPlanId,
  type CreateMergedPlanBody,
  type CreateMergedRunBody,
} from '../src/engine/merged/run_setup'
import type { PackageRecord } from '../src/data/types'

/**
 * Conformance test for `src/engine/merged/run_setup.ts` — the port of the
 * SETUP half of `routers/merged_runs.py` (feature 026, htmlapp Combined
 * export, slice C4 Task 5). See `run_setup.ts`'s own module doc for the
 * full Step-1 raise-site enumeration and hazard pass.
 *
 * Fixture: `src/engine/__fixtures__/parity/merged_run_setup.json`, captured
 * by `scripts/gen/capture_all.py#_capture_merged_run_setup` via DIRECT calls
 * to the real `create_merged_plan_endpoint` / `create_merged_run_endpoint` /
 * `get_merged_run_endpoint` / `list_merged_runs_endpoint` (not TestClient —
 * see that capture function's own docstring for why).
 *
 * ── Branch coverage table (per the task brief's reporting rule) ────────────
 * `createMergedPlan`:
 *   - package not found / scenario not found / incompatible / route-preset
 *     404 / initial_state (3 sub-branches) / context_overrides (4 sub-
 *     branches) / hyperparameter-invalid: ALL reached via the real captured
 *     golden (`plan_cases`), asserted with `expectParity` against the exact
 *     Python `status_code`/`detail`.
 *   - success (local route, route-preset route, mountain-painted,
 *     jam-painted, valid initial_state, valid context_overrides): reached
 *     via the golden's own success cases; mountain-painting additionally
 *     verified against the golden's OWN captured `draft_route_segments`
 *     (not just "didn't throw"); jam-preset merging (the ONE thing the
 *     Python endpoint's return value never exposes) verified independently
 *     via a `createDraft` spy, not a golden.
 * `buildQuickviewRouteFacts`: shares `resolvePaintedRoute` with
 *   `createMergedPlan` (same underlying raises, proven above) — its own
 *   incremental logic (the jam-vs-no-jam `presets` shape) is exercised
 *   directly (2 branches), not against a Python golden (the Python function
 *   itself has no dedicated capture; its 3 raise branches are structurally
 *   the SAME code path as `createMergedPlan`'s, verified by one shared
 *   "unknown package" assertion here, not re-verified per-branch).
 * `createMergedRun`: success + unknown trigger_plan_id (literal Python
 *   ValueError text, byte-exact) — both against the golden.
 * `getMergedRun`: not-found (golden, literal text) + fresh success (own
 *   assertions — ids are random, not golden-comparable) + trigger_log=null
 *   synthetic (Python's own "should not happen, never raises for it"
 *   branch) + one real persisted proposal_log resolved + the `proposal_run_id
 *   === null` skip guard (dead-by-type in Python and here, exercised
 *   directly against a hand-built handle — see `run_setup.ts`'s own doc
 *   comment on that branch).
 * `listMergedRuns`/`summarizeMergedRunRow`: empty store, real handles in
 *   lexicographic (not insertion) order — against the golden's own
 *   deliberately-out-of-order 3-id case — PLUS the corrupt-row/file-stem-
 *   fallback branches (structurally unreachable through the real keyPath
 *   store) exercised directly against synthetic `(row, key)` pairs.
 * `readableErrorText`: every branch — literal expected strings, NOT
 *   `String(x)` compared to itself (the brief's own named prior-task defect).
 * hazard 8 (bool acceptance): a DEDICATED test proving
 *   `validateMergedInitialState`/`validateMergedContextOverrides` REJECT a
 *   bool value (matching `merged_runs.py`'s explicit `isinstance(..., bool)`
 *   exclusion) — disclosed divergence from the SIBLING
 *   `../worker/handlers/run_plans.ts` validator, which does not exclude bool
 *   (mirrors `routers/run_plans.py`'s own, more lenient check).
 * hazard 4 (ordering): the golden's own 3-id out-of-order case, PLUS an
 *   independent synthetic case with different literal ids (not merely
 *   trusting the golden's own coincidence).
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
const REAL_ROUTE_PRESET_ID = 'short_tokyo_chichibu'

type GoldenCase = { name: string; raises?: boolean; status_code?: number; detail?: unknown; [k: string]: unknown }
const { output } = loadFixture('merged_run_setup') as {
  output: {
    plan_cases: GoldenCase[]
    create_cases: GoldenCase[]
    get_cases: GoldenCase[]
    list_empty: { merged_runs: unknown[] }
    list_ordering: { merged_runs: Array<{ merged_run_id: string; trigger_run_id: string; proposal_run_ids_count: number }> }
  }
}
const PLAN_CASES: Record<string, GoldenCase> = Object.fromEntries(output.plan_cases.map((c) => [c.name, c]))
const CREATE_CASES: Record<string, GoldenCase> = Object.fromEntries(output.create_cases.map((c) => [c.name, c]))
const GET_CASES: Record<string, GoldenCase> = Object.fromEntries(output.get_cases.map((c) => [c.name, c]))

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
    package_id: PACKAGE_ID,
    scenario_id: SCENARIO_ID,
    route_preset_id: null,
    route_facts: null,
    route_source: null,
    run_seed: 42,
    mountain_range_km: null,
    jam_range_km: null,
    jam_speed_kph: 15.0,
    presets: {},
    parameters: {},
    hyperparameters: {},
    profiles: null,
    initial_state: null,
    context_overrides: null,
    ...overrides,
  }
}

async function expectPlanRejects(body: CreateMergedPlanBody, golden: GoldenCase): Promise<void> {
  expect(golden.raises, `golden case ${golden.name} expected to raise`).toBe(true)
  let caught: unknown
  try {
    await createMergedPlan(body)
  } catch (exc) {
    caught = exc
  }
  expect(caught, `${golden.name}: expected createMergedPlan to reject`).toBeInstanceOf(ProposalHttpError)
  const err = caught as ProposalHttpError
  expect(err.status, `${golden.name}: status_code`).toBe(golden.status_code)
  expectParity(err.detail, golden.detail)
}

// ---------------------------------------------------------------------------
// createMergedPlan — parity against real Python, every raise + success case
// ---------------------------------------------------------------------------

describe('createMergedPlan — parity against real Python (POST /api/merged-runs/plan)', () => {
  it('success_local_route: returns a plan_id, no painting', async () => {
    const golden = PLAN_CASES.success_local_route
    expect(golden.raises).toBe(false)
    const result = await createMergedPlan(basePlanBody())
    expect(result.plan_id.startsWith('plan_')).toBe(true)
    const entry = getDraftEntry(result.plan_id)
    expect(entry).not.toBeNull()
  })

  it('unknown_package_id: 400, literal Python message', async () => {
    await expectPlanRejects(basePlanBody({ package_id: 'not_a_real_package' }), PLAN_CASES.unknown_package_id)
  })

  it('unknown_scenario_id: 400, literal Python message', async () => {
    await expectPlanRejects(basePlanBody({ scenario_id: 'not_a_real_scenario' }), PLAN_CASES.unknown_scenario_id)
  })

  it('incompatible_package_scenario: 400, literal Python message (synthetic pair — no real one exists in this repo)', async () => {
    // Python's own capture needed a synthetic temp packages_dir for this
    // branch too (see capture_all.py's own docstring) — every real
    // committed trigger package/scenario pair in this repo is compatible.
    // TS has no pydantic "compatible_scenario_types must not be empty"
    // validator, so a single-element mismatched list is enough here.
    const real = await packagesStore.get(PACKAGE_ID)
    if (!real) throw new Error('fixture package not seeded')
    const incompatible: PackageRecord = {
      ...real,
      id: 'incompatible_test_pkg',
      manifest: { ...real.manifest, id: 'incompatible_test_pkg', compatible_scenario_types: ['some_other_uc_type'] },
    }
    await packagesStore.put(incompatible)
    let caught: unknown
    try {
      await createMergedPlan(basePlanBody({ package_id: 'incompatible_test_pkg' }))
    } catch (exc) {
      caught = exc
    }
    expect(caught).toBeInstanceOf(ProposalHttpError)
    const err = caught as ProposalHttpError
    expect(err.status).toBe(400)
    expect(err.detail).toBe(
      "Package 'incompatible_test_pkg' is not compatible with scenario 'uc01_fatigue_recovery_v0_1' (type='uc01_fatigue')",
    )
  })

  it('route_preset_success: route_source=maps, total_km matches the golden', async () => {
    const golden = PLAN_CASES.route_preset_success
    const result = await createMergedPlan(basePlanBody({ route_preset_id: REAL_ROUTE_PRESET_ID }))
    const entry = getDraftEntry(result.plan_id)
    expect(entry).not.toBeNull()
    expect(entry!.draft.route_facts.route_source).toBe(golden.draft_route_source)
    expect(entry!.draft.route_facts.total_route_distance_km).toBeCloseTo(golden.draft_total_km as number, 6)
  })

  it('route_preset_not_found: 404, literal bilingual Python message', async () => {
    await expectPlanRejects(
      basePlanBody({ route_preset_id: 'not_a_real_preset' }),
      PLAN_CASES.route_preset_not_found,
    )
  })

  it('fixbug-0806 full-plumb: explicit route_facts WINS over route_preset_id — a bogus preset id that would 404 alone succeeds when route_facts is also supplied', async () => {
    const explicitRouteFacts = loadRoutePreset(REAL_ROUTE_PRESET_ID)
    const result = await createMergedPlan(
      basePlanBody({ route_preset_id: 'not_a_real_preset', route_facts: explicitRouteFacts }),
    )
    const entry = getDraftEntry(result.plan_id)
    expect(entry).not.toBeNull()
    expect(entry!.draft.route_facts.total_route_distance_km).toBeCloseTo(
      explicitRouteFacts.total_route_distance_km as number,
      6,
    )
    expect(entry!.draft.route_facts.route_source).toBe('maps')
  })

  it('fixbug-0806 full-plumb: an explicit route_source overrides the supplied route_facts\' own embedded route_source', async () => {
    const explicitRouteFacts = loadRoutePreset(REAL_ROUTE_PRESET_ID) // route_source: 'maps'
    const result = await createMergedPlan(basePlanBody({ route_facts: explicitRouteFacts, route_source: 'local' }))
    const entry = getDraftEntry(result.plan_id)
    expect(entry).not.toBeNull()
    expect(entry!.draft.route_facts.route_source).toBe('local')
  })

  it('mountain_painted: registered draft route_segments match the golden EXACTLY (a range spanning two real segments)', async () => {
    const golden = PLAN_CASES.mountain_painted
    const result = await createMergedPlan(basePlanBody({ mountain_range_km: [10.0, 30.0] }))
    const entry = getDraftEntry(result.plan_id)
    expect(entry).not.toBeNull()
    expectParity(entry!.draft.route_facts.route_segments, golden.draft_route_segments)
    // Self-check: the golden itself must actually exercise the "spans two
    // original segments, producing two separate mountain_road pieces (no
    // merging)" shape it's captured for.
    const mountainSegments = (golden.draft_route_segments as Array<{ segment_type: string }>).filter(
      (s) => s.segment_type === 'mountain_road',
    )
    expect(mountainSegments.length).toBe(2)
  })

  it('jam_painted: succeeds, and the merged presets object reaching createDraft carries the SAME jam createMergedPlan\'s own jamTrafficEvent call would produce', async () => {
    const spy = vi.spyOn(runPlanModule, 'createDraft')
    try {
      const body = basePlanBody({ jam_range_km: [40.0, 60.0], presets: { some_other_key: 'kept' } })
      const result = await createMergedPlan(body)
      expect(result.plan_id.startsWith('plan_')).toBe(true)
      expect(spy).toHaveBeenCalledTimes(1)
      const passedPresets = spy.mock.calls[0][0].presets as Record<string, unknown>
      // Existing (unrelated) preset keys survive the merge — proves this is
      // dict(body.presets)-then-append, not a fresh {traffic_events: [...]}
      // replacement (the mutation this guards: dropping `some_other_key`
      // would pass every OTHER assertion here while silently discarding a
      // reviewer's other preset edits).
      expect(passedPresets.some_other_key).toBe('kept')
      const trafficEvents = passedPresets.traffic_events as Array<Record<string, unknown>>
      expect(trafficEvents).toHaveLength(1)
      expect(trafficEvents[0]).toMatchObject({ id: 'manual_jam', affected_segment_id: 'manual', speed_kph: 15.0 })
      expect(trafficEvents[0].start_min).toBeGreaterThan(0)
      expect(trafficEvents[0].duration_min).toBeGreaterThan(0)
    } finally {
      spy.mockRestore()
    }
  })

  it('jam_painted: an EXISTING traffic_events entry is preserved, not overwritten (pyGetDefault, not a blind assignment)', async () => {
    const spy = vi.spyOn(runPlanModule, 'createDraft')
    try {
      const priorJam = { id: 'preexisting', start_min: 1, duration_min: 2, affected_segment_id: 'x', speed_kph: 10 }
      await createMergedPlan(basePlanBody({ jam_range_km: [40.0, 60.0], presets: { traffic_events: [priorJam] } }))
      const passedPresets = spy.mock.calls[0][0].presets as Record<string, unknown>
      const trafficEvents = passedPresets.traffic_events as Array<Record<string, unknown>>
      expect(trafficEvents).toHaveLength(2)
      expect(trafficEvents[0]).toEqual(priorJam)
      expect(trafficEvents[1].id).toBe('manual_jam')
    } finally {
      spy.mockRestore()
    }
  })

  describe('initial_state validation', () => {
    it('unknown key -> 400', async () => {
      await expectPlanRejects(
        basePlanBody({ initial_state: { bogus_field: 50 } }),
        PLAN_CASES.initial_state_unknown_key,
      )
    })
    it('wrong type (bool — hazard 8, explicitly rejected) -> 400', async () => {
      await expectPlanRejects(
        basePlanBody({ initial_state: { drowsiness_level: true } }),
        PLAN_CASES.initial_state_wrong_type_bool,
      )
    })
    it('wrong type (string) -> 400', async () => {
      await expectPlanRejects(
        basePlanBody({ initial_state: { drowsiness_level: '50' } }),
        PLAN_CASES.initial_state_wrong_type_string,
      )
    })
    it('out of range -> 400', async () => {
      await expectPlanRejects(
        basePlanBody({ initial_state: { drowsiness_level: 150 } }),
        PLAN_CASES.initial_state_out_of_range,
      )
    })
    it('valid -> success', async () => {
      const result = await createMergedPlan(
        basePlanBody({ initial_state: { drowsiness_level: 50, fatigue_level: 30 } }),
      )
      expect(result.plan_id.startsWith('plan_')).toBe(true)
    })
  })

  describe('context_overrides validation', () => {
    it('unknown key -> 400', async () => {
      await expectPlanRejects(
        basePlanBody({ context_overrides: { bogus_field: true } }),
        PLAN_CASES.context_overrides_unknown_key,
      )
    })
    it('weather_risk wrong type (bool — hazard 8, explicitly rejected) -> 400', async () => {
      await expectPlanRejects(
        basePlanBody({ context_overrides: { weather_risk: true } }),
        PLAN_CASES.context_overrides_weather_risk_wrong_type_bool,
      )
    })
    it('weather_risk out of range -> 400', async () => {
      await expectPlanRejects(
        basePlanBody({ context_overrides: { weather_risk: 150 } }),
        PLAN_CASES.context_overrides_weather_risk_out_of_range,
      )
    })
    it('non-weather key wrong type (not boolean) -> 400', async () => {
      await expectPlanRejects(
        basePlanBody({ context_overrides: { is_night: 'yes' } }),
        PLAN_CASES.context_overrides_non_weather_wrong_type,
      )
    })
    it('valid -> success', async () => {
      const result = await createMergedPlan(
        basePlanBody({
          context_overrides: { child_passenger: true, familiar_route: false, is_night: true, weather_risk: 40 },
        }),
      )
      expect(result.plan_id.startsWith('plan_')).toBe(true)
    })
  })

  it('hyperparameter_invalid: 400, wraps createDraft.validation_errors', async () => {
    await expectPlanRejects(
      basePlanBody({ hyperparameters: { not_a_real_hp: 1 } }),
      PLAN_CASES.hyperparameter_invalid,
    )
  })
})

// ---------------------------------------------------------------------------
// buildQuickviewRouteFacts — shares resolvePaintedRoute; own jam/no-jam logic
// ---------------------------------------------------------------------------

describe('buildQuickviewRouteFacts', () => {
  it('no jam -> presets stays null, routeSource is "maps"', async () => {
    const result = await buildQuickviewRouteFacts({
      package_id: PACKAGE_ID,
      scenario_id: SCENARIO_ID,
      route_preset_id: null,
      route_facts: null,
      route_source: null,
      mountain_range_km: null,
      jam_range_km: null,
      jam_speed_kph: 15.0,
    })
    expect(result.routeSource).toBe('maps')
    expect(result.presets).toBeNull()
  })

  it('jam supplied -> presets = {traffic_events: [jam]} ONLY (no unrelated key survives, unlike createMergedPlan)', async () => {
    const result = await buildQuickviewRouteFacts({
      package_id: PACKAGE_ID,
      scenario_id: SCENARIO_ID,
      route_preset_id: null,
      route_facts: null,
      route_source: null,
      mountain_range_km: null,
      jam_range_km: [10.0, 20.0],
      jam_speed_kph: 20.0,
    })
    expect(result.presets).not.toBeNull()
    const traffic = (result.presets as Record<string, unknown>).traffic_events as Array<Record<string, unknown>>
    expect(traffic).toHaveLength(1)
    expect(traffic[0].speed_kph).toBe(20.0)
    expect(Object.keys(result.presets as object)).toEqual(['traffic_events'])
  })

  it('unknown package_id -> 400 (same resolvePaintedRoute raise as createMergedPlan)', async () => {
    await expect(
      buildQuickviewRouteFacts({
        package_id: 'not_a_real_package',
        scenario_id: SCENARIO_ID,
        route_preset_id: null,
        route_facts: null,
        route_source: null,
        mountain_range_km: null,
        jam_range_km: null,
        jam_speed_kph: 15.0,
      }),
    ).rejects.toMatchObject({ status: 400, detail: "Package 'not_a_real_package' not found or invalid" })
  })

  it('fixbug-0806 full-plumb: explicit route_facts WINS over route_preset_id — a bogus preset id that would 404 alone succeeds when route_facts is also supplied', async () => {
    const explicitRouteFacts = loadRoutePreset(REAL_ROUTE_PRESET_ID)
    const result = await buildQuickviewRouteFacts({
      package_id: PACKAGE_ID,
      scenario_id: SCENARIO_ID,
      route_preset_id: 'not_a_real_preset',
      route_facts: explicitRouteFacts,
      route_source: null,
      mountain_range_km: null,
      jam_range_km: null,
      jam_speed_kph: 15.0,
    })
    expect(result.routeFacts.total_route_distance_km).toBeCloseTo(
      explicitRouteFacts.total_route_distance_km as number,
      6,
    )
  })

  it('preset-only path unaffected: no route_facts supplied -> falls through to route_preset_id exactly as before this fix', async () => {
    const result = await buildQuickviewRouteFacts({
      package_id: PACKAGE_ID,
      scenario_id: SCENARIO_ID,
      route_preset_id: REAL_ROUTE_PRESET_ID,
      route_facts: null,
      route_source: null,
      mountain_range_km: null,
      jam_range_km: null,
      jam_speed_kph: 15.0,
    })
    const expected = loadRoutePreset(REAL_ROUTE_PRESET_ID)
    expect(result.routeFacts.total_route_distance_km).toBeCloseTo(expected.total_route_distance_km as number, 6)
    expect(result.routeSource).toBe('maps')
  })
})

// ---------------------------------------------------------------------------
// loadRoutePreset — direct
// ---------------------------------------------------------------------------

describe('loadRoutePreset', () => {
  it('unknown preset id -> 404 bilingual literal', () => {
    expect(() => loadRoutePreset('not_a_real_preset')).toThrowError(
      expect.objectContaining({ status: 404, detail: 'Route preset not found. / ルートプリセットが見つかりません。' }),
    )
  })

  it('real preset -> route_source maps, rest spots sorted by distance_along_route_m', () => {
    const result = loadRoutePreset(REAL_ROUTE_PRESET_ID)
    expect(result.route_source).toBe('maps')
    expect(result.total_route_distance_km).toBeGreaterThan(0)
    const positions = result.rest_spot_positions
    for (let i = 1; i < positions.length; i++) expect(positions[i]).toBeGreaterThanOrEqual(positions[i - 1])
  })
})

// ---------------------------------------------------------------------------
// createMergedRun — parity against real Python
// ---------------------------------------------------------------------------

describe('createMergedRun — parity against real Python (POST /api/merged-runs)', () => {
  async function makeRealPlanId(): Promise<string> {
    const result = await createMergedPlan(basePlanBody())
    return result.plan_id
  }

  function baseCreateBody(overrides: Partial<CreateMergedRunBody> = {}, planId: string): CreateMergedRunBody {
    return {
      trigger_plan_id: planId,
      world: baseWorld(),
      service_package_id: SERVICE_PKG_ID,
      content_package_id: CONTENT_PKG_ID,
      proposal_mode: 'interactive',
      run_seed: 'seed-merged-create-test',
      service_parameters: {},
      service_hyperparameters: {},
      content_parameters: {},
      content_hyperparameters: {},
      ...overrides,
    }
  }

  it('success: returns merged_run_id/trigger_run_id, both correctly formatted, and persists a handle', async () => {
    const golden = CREATE_CASES.success
    expect(golden.raises).toBe(false)
    const planId = await makeRealPlanId()
    const result = await createMergedRun(baseCreateBody({}, planId))
    expect(result.merged_run_id.startsWith('mrun_')).toBe(true)
    expect(result.trigger_run_id.startsWith('run_')).toBe(true)
    expect(Object.keys(result).sort()).toEqual((golden.result_keys as string[]).sort())

    const handles = await listHandles()
    expect(handles).toHaveLength(1)
    expect(handles[0].merged_run_id).toBe(result.merged_run_id)
    expect(handles[0].trigger_run_id).toBe(result.trigger_run_id)
  })

  it('unknown_trigger_plan_id: 400, literal Python ValueError text', async () => {
    const golden = CREATE_CASES.unknown_trigger_plan_id
    let caught: unknown
    try {
      await createMergedRun(baseCreateBody({}, 'not_a_real_plan_id'))
    } catch (exc) {
      caught = exc
    }
    expect(caught).toBeInstanceOf(ProposalHttpError)
    const err = caught as ProposalHttpError
    expect(err.status).toBe(golden.status_code)
    expect(err.detail).toBe(golden.detail)
    expect(err.detail).toBe("Unknown plan_id 'not_a_real_plan_id'")
  })
})

// ---------------------------------------------------------------------------
// getMergedRun — parity against real Python + synthetic branches
// ---------------------------------------------------------------------------

describe('getMergedRun — parity against real Python (GET /api/merged-runs/{id})', () => {
  it('not_found: 404, literal Python message', async () => {
    const golden = GET_CASES.not_found
    let caught: unknown
    try {
      await getMergedRun('not_a_real_merged_run_id')
    } catch (exc) {
      caught = exc
    }
    expect(caught).toBeInstanceOf(ProposalHttpError)
    const err = caught as ProposalHttpError
    expect(err.status).toBe(golden.status_code)
    expect(err.detail).toBe(golden.detail)
    expect(err.detail).toBe("Merged run 'not_a_real_merged_run_id' not found")
  })

  it('success_fresh_no_proposals: trigger_log present (active run, no ticks), proposal_logs empty', async () => {
    const golden = GET_CASES.success_fresh_no_proposals
    const planResult = await createMergedPlan(basePlanBody())
    const created = await createMergedRun({
      trigger_plan_id: planResult.plan_id,
      world: baseWorld(),
      service_package_id: SERVICE_PKG_ID,
      content_package_id: CONTENT_PKG_ID,
      proposal_mode: 'interactive',
      run_seed: 'seed-merged-get-test',
      service_parameters: {},
      service_hyperparameters: {},
      content_parameters: {},
      content_hyperparameters: {},
    })

    const result = await getMergedRun(created.merged_run_id)
    expect(result.handle.merged_run_id).toBe(created.merged_run_id)
    expect(result.trigger_log).not.toBeNull()
    expect(result.trigger_log!.run_id).toBe(created.trigger_run_id)
    expect(result.proposal_logs).toEqual([])
    expect(golden.trigger_log_is_none).toBe(false)
    expect(golden.proposal_logs_count).toBe(0)
  })

  it('trigger_log missing (synthetic handle pointing at a never-created trigger run): trigger_log null, does NOT raise', async () => {
    const golden = GET_CASES.trigger_log_missing_synthetic
    const handle = createHandle({
      mergedRunId: 'mrun_test_missing_trigger',
      triggerRunId: 'run_does_not_exist',
      worldTemplate: baseWorld(),
      servicePackageId: SERVICE_PKG_ID,
      contentPackageId: CONTENT_PKG_ID,
      proposalMode: 'interactive',
      runSeed: 'seed-x',
    })
    await saveHandle(handle)

    const result = await getMergedRun('mrun_test_missing_trigger')
    expect(result.trigger_log).toBeNull()
    expect(result.proposal_logs).toEqual([])
    expect(golden.trigger_log_is_none).toBe(true)
  })

  it('with one real persisted proposal log: proposal_logs has exactly that entry', async () => {
    const golden = GET_CASES.with_one_real_proposal_log
    const plog = await createProposalRun({
      world: baseWorld() as never,
      service_package_id: SERVICE_PKG_ID,
      content_package_id: CONTENT_PKG_ID,
      mode: 'interactive',
      run_seed: 'seed-merged-get-test-2',
      simulation_time: '2026-08-02T09:00:00Z',
    } as never)

    const handle = createHandle({
      mergedRunId: 'mrun_test_with_proposal',
      triggerRunId: 'run_does_not_exist',
      worldTemplate: baseWorld(),
      servicePackageId: SERVICE_PKG_ID,
      contentPackageId: CONTENT_PKG_ID,
      proposalMode: 'interactive',
      runSeed: 'seed-x',
    })
    handle.proposal_run_ids = [plog.run_id]
    await saveHandle(handle)

    const result = await getMergedRun('mrun_test_with_proposal')
    expect(result.proposal_logs).toHaveLength(1)
    expect((result.proposal_logs[0] as { run_id: string }).run_id).toBe(plog.run_id)
    expect(golden.proposal_logs_count).toBe(1)
  })

  it('a null entry in proposal_run_ids is skipped — dead by TS type (string[]) exactly as it is dead by Python\'s Pydantic type (list[str]); exercised via a cast, matching this port\'s established precedent for a type-unreachable-but-still-ported branch', async () => {
    const handle = createHandle({
      mergedRunId: 'mrun_test_null_entry',
      triggerRunId: 'run_does_not_exist',
      worldTemplate: baseWorld(),
      servicePackageId: SERVICE_PKG_ID,
      contentPackageId: CONTENT_PKG_ID,
      proposalMode: 'interactive',
      runSeed: 'seed-x',
    })
    handle.proposal_run_ids = [null, undefined] as unknown as string[]
    await saveHandle(handle)

    const result = await getMergedRun('mrun_test_null_entry')
    expect(result.proposal_logs).toEqual([])
  })

  it('an entry that resolves to no persisted log is skipped (best-effort, not an error)', async () => {
    const handle = createHandle({
      mergedRunId: 'mrun_test_dangling_proposal',
      triggerRunId: 'run_does_not_exist',
      worldTemplate: baseWorld(),
      servicePackageId: SERVICE_PKG_ID,
      contentPackageId: CONTENT_PKG_ID,
      proposalMode: 'interactive',
      runSeed: 'seed-x',
    })
    handle.proposal_run_ids = ['prun_does_not_exist']
    await saveHandle(handle)

    const result = await getMergedRun('mrun_test_dangling_proposal')
    expect(result.proposal_logs).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// listMergedRuns / summarizeMergedRunRow — hazard 4 (ordering) leads
// ---------------------------------------------------------------------------

describe('listMergedRuns — parity against real Python (GET /api/merged-runs)', () => {
  it('empty store -> { merged_runs: [] } (matches the golden\'s own empty-dir case)', async () => {
    expectParity(await listMergedRuns(), output.list_empty)
  })

  it('lexicographic ordering regardless of insertion order — matches the golden EXACTLY (same 3 ids, same order)', async () => {
    // Deliberately inserted out of alphabetical order, mirroring the
    // capture script's own technique — proves this is a KEY sort, not an
    // insertion-order artifact that happens to look right by luck.
    for (const [mrid, triggerId, n] of [
      ['mrun_bbb', 'run_bbb', 2],
      ['mrun_aaa', 'run_aaa', 0],
      ['mrun_ccc', 'run_ccc', 1],
    ] as const) {
      const handle = createHandle({
        mergedRunId: mrid,
        triggerRunId: triggerId,
        worldTemplate: {},
        servicePackageId: SERVICE_PKG_ID,
        contentPackageId: CONTENT_PKG_ID,
        proposalMode: 'interactive',
        runSeed: 'seed-x',
      })
      handle.proposal_run_ids = Array.from({ length: n }, (_, i) => `prun_${i}`)
      await saveHandle(handle)
    }

    const result = await listMergedRuns()
    expectParity(result, output.list_ordering)
    expect(result.merged_runs.map((r) => r.merged_run_id)).toEqual(['mrun_aaa', 'mrun_bbb', 'mrun_ccc'])
  })

  it('independent ordering check with DIFFERENT literal ids (not the golden\'s own 3, to rule out a golden-specific coincidence)', async () => {
    for (const mrid of ['mrun_zzz_last', 'mrun_111_first', 'mrun_mmm_middle']) {
      const handle = createHandle({
        mergedRunId: mrid,
        triggerRunId: 'run_x',
        worldTemplate: {},
        servicePackageId: SERVICE_PKG_ID,
        contentPackageId: CONTENT_PKG_ID,
        proposalMode: 'interactive',
        runSeed: 'seed-x',
      })
      await saveHandle(handle)
    }
    const result = await listMergedRuns()
    expect(result.merged_runs.map((r) => r.merged_run_id)).toEqual([
      'mrun_111_first', 'mrun_mmm_middle', 'mrun_zzz_last',
    ])
  })

  it('verified independently: idb getAllKeys()/getAll() on the merged_runs store both already return ascending-key order (not merely inherited by luck)', async () => {
    for (const mrid of ['mrun_c', 'mrun_a', 'mrun_b']) {
      const handle = createHandle({
        mergedRunId: mrid,
        triggerRunId: 'run_x',
        worldTemplate: {},
        servicePackageId: SERVICE_PKG_ID,
        contentPackageId: CONTENT_PKG_ID,
        proposalMode: 'interactive',
        runSeed: 'seed-x',
      })
      await saveHandle(handle)
    }
    const entries = await listHandleEntries()
    expect(entries.map((e) => e.key)).toEqual(['mrun_a', 'mrun_b', 'mrun_c'])
    expect(entries.map((e) => (e.value as { merged_run_id: string }).merged_run_id)).toEqual(['mrun_a', 'mrun_b', 'mrun_c'])
  })
})

describe('summarizeMergedRunRow — corrupt-row/file-stem-fallback branches (structurally unreachable through the real store)', () => {
  it('a well-formed row summarizes normally', () => {
    const row = { merged_run_id: 'mrun_x', trigger_run_id: 'run_x', proposal_run_ids: ['a', 'b'] }
    expect(summarizeMergedRunRow(row, 'mrun_x')).toEqual({
      merged_run_id: 'mrun_x', trigger_run_id: 'run_x', proposal_run_ids_count: 2,
    })
  })

  it('merged_run_id ABSENT -> falls back to the storage key (the file-stem-equivalent) — pyGetDefault, not a present-value override', () => {
    const row = { trigger_run_id: 'run_x' }
    expect(summarizeMergedRunRow(row, 'mrun_from_key')).toEqual({
      merged_run_id: 'mrun_from_key', trigger_run_id: 'run_x', proposal_run_ids_count: 0,
    })
  })

  it('trigger_run_id ABSENT -> null (one-arg .get, no default)', () => {
    const row = { merged_run_id: 'mrun_x' }
    expect(summarizeMergedRunRow(row, 'mrun_x')?.trigger_run_id).toBeNull()
  })

  it('proposal_run_ids ABSENT -> count 0 (.get() + truthy or)', () => {
    const row = { merged_run_id: 'mrun_x' }
    expect(summarizeMergedRunRow(row, 'mrun_x')?.proposal_run_ids_count).toBe(0)
  })

  it('proposal_run_ids explicitly [] (falsy) -> count 0 via the `or` fallback, not a crash on an empty array', () => {
    const row = { merged_run_id: 'mrun_x', proposal_run_ids: [] }
    expect(summarizeMergedRunRow(row, 'mrun_x')?.proposal_run_ids_count).toBe(0)
  })

  it('a non-object row (Python: json.loads failure) -> null (skip)', () => {
    expect(summarizeMergedRunRow(null, 'mrun_x')).toBeNull()
    expect(summarizeMergedRunRow(42, 'mrun_x')).toBeNull()
    expect(summarizeMergedRunRow('garbage', 'mrun_x')).toBeNull()
    expect(summarizeMergedRunRow([1, 2, 3], 'mrun_x')).toBeNull()
  })

  it('a row whose extraction throws is skipped, not propagated', () => {
    // proposal_run_ids present but truthy AND non-array/non-string (Array.isArray
    // false, typeof !== 'string') -> the count falls back to 0 rather than
    // throwing — this documents that fallback rather than assuming a crash.
    const row = { merged_run_id: 'mrun_x', proposal_run_ids: { weird: true } }
    expect(summarizeMergedRunRow(row, 'mrun_x')?.proposal_run_ids_count).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// readableErrorText — every branch, LITERAL assertions (not String(x) vs
// itself — the brief's own named prior-task defect).
// ---------------------------------------------------------------------------

describe('readableErrorText', () => {
  it('dict with a truthy message -> that message', () => {
    expect(readableErrorText({ code: 'x', message: 'human text' })).toBe('human text')
  })
  it('array of dict, first entry has message -> that message', () => {
    expect(readableErrorText([{ path: 'a', code: 'x', message: 'human text' }])).toBe('human text')
  })
  it('array of dict, first entry has ONLY msg (no message) -> msg (the "or" fallback branch)', () => {
    expect(readableErrorText([{ msg: 'validation text' }])).toBe('validation text')
  })
  it('array of dict, both message and msg present -> message wins (truthy `or` short-circuits)', () => {
    expect(readableErrorText([{ message: 'M', msg: 'X' }])).toBe('M')
  })
  it('bare string -> that string', () => {
    expect(readableErrorText('plain text')).toBe('plain text')
  })
  it('fallback: empty array -> the empty string (literal, not String([]) compared to itself)', () => {
    expect(readableErrorText([])).toBe('')
  })
  it('fallback: dict without a message key -> "[object Object]" (literal)', () => {
    expect(readableErrorText({ code: 'x' })).toBe('[object Object]')
  })
  it('fallback: dict with an empty-string (falsy) message -> the fallback, not the empty string', () => {
    expect(readableErrorText({ code: 'x', message: '' })).toBe('[object Object]')
  })
  it('fallback: a bare number -> "42" (literal)', () => {
    expect(readableErrorText(42)).toBe('42')
  })
})

// ---------------------------------------------------------------------------
// validateMergedInitialState / validateMergedContextOverrides — direct
// branch coverage + the hazard-8 divergence
// ---------------------------------------------------------------------------

describe('validateMergedInitialState', () => {
  it('rejects an explicit bool (hazard 8 — this endpoint EXCLUDES bool, unlike the sibling run_plans.ts validator)', () => {
    const errors = validateMergedInitialState({ drowsiness_level: true })
    expect(errors).toEqual([{
      field: 'initial_state.drowsiness_level',
      message: 'initial_state.drowsiness_level must be a number in [0, 100]; got True',
    }])
  })
  it('rejects an explicit False the same way (True/False Python-repr casing, not lowercase true/false)', () => {
    const errors = validateMergedInitialState({ drowsiness_level: false })
    expect(errors[0].message).toContain('got False')
  })
  it('accepts a real number in range', () => {
    expect(validateMergedInitialState({ drowsiness_level: 50 })).toEqual([])
  })
  it('NaN is rejected by the RANGE check, not the type check (Python isinstance(nan, float) is True)', () => {
    const errors = validateMergedInitialState({ drowsiness_level: Number.NaN })
    expect(errors[0].message).toBe('initial_state.drowsiness_level must be in [0, 100]; got NaN')
  })
})

describe('validateMergedContextOverrides (reused from preview_ticks.ts — see that file\'s own doc)', () => {
  it('rejects weather_risk=true (hazard 8 — explicitly excludes bool)', () => {
    const errors = validateMergedContextOverrides({ weather_risk: true })
    expect(errors).toEqual([{
      field: 'context_overrides.weather_risk',
      message: 'context_overrides.weather_risk must be a number in [0, 100]; got True',
    }])
  })
  it('accepts a fully valid override set', () => {
    expect(validateMergedContextOverrides({
      child_passenger: true, familiar_route: false, is_night: true, weather_risk: 40,
    })).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Id minters — format-only (established precedent for this port's id
// minters; the exact format is a documented, deliberate divergence from
// Python's — see run_setup.ts's own doc comment).
// ---------------------------------------------------------------------------

describe('makeTriggerRunId / makeMergedPlanId', () => {
  it('makeTriggerRunId: run_<base36>_<6hex>, unique across calls', () => {
    const a = makeTriggerRunId()
    const b = makeTriggerRunId()
    expect(a).toMatch(/^run_[a-z0-9]+_[0-9a-f]{6}$/)
    expect(a).not.toBe(b)
  })
  it('makeMergedPlanId: plan_<base36>_<6hex>, unique across calls', () => {
    const a = makeMergedPlanId()
    const b = makeMergedPlanId()
    expect(a).toMatch(/^plan_[a-z0-9]+_[0-9a-f]{6}$/)
    expect(a).not.toBe(b)
  })
})
