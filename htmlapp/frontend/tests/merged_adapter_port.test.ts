import { describe, expect, it } from 'vitest'
import {
  mapTriggerPurpose,
  mapLifecycleStage,
  mapRoadType,
  buildWorldFromTick,
  type World,
} from '../src/engine/merged/adapter'
import { loadFixture, expectParity } from '../src/engine/__fixtures__/parity'

/**
 * Conformance test for `src/engine/merged/adapter.ts` — the port of
 * `app/api/aica_api/services/merged_adapter.py` (feature 026, htmlapp
 * Combined export, slice C4 Task 2).
 *
 * Fixture: `src/engine/__fixtures__/parity/merged_adapter.json`, captured by
 * `scripts/gen/capture_all.py#_capture_merged_adapter` — REAL Python calls,
 * see that function's own doc comment for the real-vs-synthetic split.
 *
 * ── Branch coverage table (per the task brief's reporting rule) ────────────
 *
 * `mapTriggerPurpose` — golden covers all 4 result_types BOTH shipped
 * packages actually emit: REST_PROPOSAL/MONOTONY_PROPOSAL (mapped, real),
 * SUPPRESSED/NO_PROPOSAL (unmapped -> null, real). The load-bearing unmapped
 * case is exercised twice over independently-real ticks (tick 0's
 * NO_PROPOSAL and tick 18's SUPPRESSED) — both produce `null`.
 *
 * `mapLifecycleStage` — golden's `stage_cases` is the EXHAUSTIVE
 * fired x result_type x recovery_phase cross-product (2x2x2=8), not a
 * sample. Only 2 of the 8 (fired=true, recovery_phase=null, either
 * result_type) are ever reached by a real production caller — verified by
 * grepping every `map_lifecycle_stage(`/`mapLifecycleStage(` call site in
 * `app/api` (`_project_fire`, `tick_merged_run_endpoint`): both hardcode
 * `fired=True, recovery_phase=None`. The other 6 combos are direct/
 * unit-level calls only (same reach as Python's OWN test suite,
 * `test_merged_adapter.py::test_stage_mapping`, which likewise never drives
 * `fired=False` or a non-null `recovery_phase` through a real run). Cases
 * 2/3/4 (any combo once recovery_phase is non-null) all produce the SAME
 * `during_rest_stopped` output as case 1 — noted explicitly below, not
 * counted as distinguishing coverage.
 *
 * `mapRoadType` — golden covers all 5 mapped keys (highway/normal_road/
 * mountain_road/sightseeing_road/rest) plus an unrecognised string
 * ("unknown_type") plus `null` — the LATTER TWO are different code paths
 * (early-return-on-null vs. dict-`.get(...,"parking")`-fallback) that both
 * happen to produce "parking"; both are exercised, not just one taken as
 * proof of the other. `highway`/`normal_road` are additionally cross-checked
 * against REAL tick data (ticks 12/17/18/20/27's normal_road, tick 37's
 * highway) inside `buildWorldFromTick`'s own cases below.
 * `mountain_road`/`sightseeing_road`/`rest`/unmapped/`null` are NOT reachable
 * from any real committed golden: the shipped uc01 scenario's route facts
 * are built only from `normal_road`/`highway` segments (confirmed via
 * `route_analysis.json`'s own real `route_segments` — 4 entries, only those
 * two types), so this is a genuine scenario limitation, not an oversight.
 *
 * `buildWorldFromTick` — real correlated (tick_state, decision) pairs from
 * a real `nri_fatigue_score_v1` run (`run_log_e2e.json`) reach: motion
 * driving (ticks 0/12/17/18/37) AND stopped (tick 20, the after-nap
 * projection style); segment_type normal_road AND highway; non-trivial
 * (non-tie) drowsiness/fatigue rounding (tick 17: 84.80000000000005 -> 85,
 * 36.199999999999974 -> 36); a present, non-zero monotony_level (100 at
 * tick 17); a present, non-None estimated_min_until_rest_spot (6 at tick
 * 17); INLINE field preservation (driver_profile/catalog_ref byte-identical
 * to the template on every case). Traffic-jam(congested)/night branches,
 * a monotonyLevel-absent-defaults-to-0 branch, an
 * estimated_min_until_rest_spot=null branch (missing key — "older persisted
 * ticks" per the Python docstring), and an exact-.5 banker's-rounding TIE
 * are NOT reachable from any real committed golden (isTrafficJam/isNight
 * are constant `false` across all 41 real tick events in the run; real
 * floats essentially never land on an exact .5 boundary) — covered as
 * clearly-labeled synthetic/direct cases below instead.
 */

type MergedAdapterFixture = {
  input: {
    world_template: World
    situation_key_order: string[]
    control_inputs_key_order: string[]
  }
  output: {
    purpose_cases: Record<string, string | null>
    stage_cases: Array<{ fired: boolean; result_type: string; recovery_phase: string | null; stage: string }>
    road_cases: Array<{ segment_type: string | null; road_type: string }>
    real_build_cases: Record<
      string,
      {
        tick_index: number
        result_type: string
        purpose: string | null
        signals: Record<string, unknown>
        stage: string
        world: World | null
      }
    >
  }
}

const { input, output } = loadFixture('merged_adapter') as MergedAdapterFixture

describe('merged/adapter.ts parity (C4 Task 2)', () => {
  it('mapTriggerPurpose reproduces map_trigger_purpose over every real result_type both shipped packages emit', () => {
    for (const [resultType, expected] of Object.entries(output.purpose_cases)) {
      expect(mapTriggerPurpose(resultType), resultType).toBe(expected)
    }
    // The load-bearing assertions, named explicitly (not just "some entry is null"):
    expect(mapTriggerPurpose('SUPPRESSED')).toBeNull()
    expect(mapTriggerPurpose('NO_PROPOSAL')).toBeNull()
    expect(mapTriggerPurpose('REST_PROPOSAL')).toBe('rest_recommended')
    expect(mapTriggerPurpose('MONOTONY_PROPOSAL')).toBe('inattentive_driving_prevention_recovery')
  })

  it('mapLifecycleStage reproduces map_lifecycle_stage over the EXHAUSTIVE fired x resultType x recoveryPhase cross-product', () => {
    expect(output.stage_cases.length, 'golden must be the full 2x2x2 cross-product').toBe(8)
    for (const c of output.stage_cases) {
      const actual = mapLifecycleStage({ fired: c.fired, resultType: c.result_type, recoveryPhase: c.recovery_phase })
      expect(actual, JSON.stringify(c)).toBe(c.stage)
    }
  })

  it('mapLifecycleStage: the two production-reachable combos, named directly (not just golden-driven)', () => {
    expect(mapLifecycleStage({ fired: true, resultType: 'REST_PROPOSAL', recoveryPhase: null })).toBe(
      'before_rest_until_stop',
    )
    expect(mapLifecycleStage({ fired: true, resultType: 'NO_PROPOSAL', recoveryPhase: null })).toBe(
      'active_driving_content',
    )
  })

  it('mapLifecycleStage: recovery_phase set short-circuits regardless of fired/resultType (cases 2/3/4 == case 1\'s output — noted, not double-counted)', () => {
    const withPhase = output.stage_cases.filter((c) => c.recovery_phase !== null)
    expect(withPhase.length).toBe(4)
    for (const c of withPhase) expect(c.stage).toBe('during_rest_stopped')
  })

  it('mapRoadType reproduces map_road_type over every mapped segment_type + unmapped-string fallback + null-input fallback (two distinct code paths)', () => {
    for (const c of output.road_cases) {
      expect(mapRoadType(c.segment_type), String(c.segment_type)).toBe(c.road_type)
    }
    // Direct, named assertions for the two DIFFERENT "parking" code paths:
    expect(mapRoadType(null), 'early-return branch').toBe('parking')
    expect(mapRoadType('unknown_type'), 'dict .get(...,"parking") fallback branch').toBe('parking')
    expect(mapRoadType(undefined), 'undefined also takes the early-return branch').toBe('parking')
  })

  it('buildWorldFromTick reproduces build_world_from_tick over REAL correlated tick/decision pairs from a real nri_fatigue_score_v1 run', () => {
    for (const [name, c] of Object.entries(output.real_build_cases)) {
      // after_rest_style_stopped (renamed from after_rest_style_tick20_stopped
      // — see the dedicated test below) and monotony_style_highway (a NEW
      // case in the recovery-semantics-refactor recapture — this run's
      // highway stretch is post-rest and carries no proposal of its own)
      // both hardcode purpose/stage (mirroring `_project_after_rest`'s/a
      // directed-call's real call shape: purpose/stage do NOT come from the
      // tick's own result_type for either) rather than deriving them — skip
      // the derived-purpose/stage recompute checks for both; their worlds
      // are still verified below via expectParity like every other case.
      if (name !== 'after_rest_style_stopped' && name !== 'monotony_style_highway') {
        const purpose = mapTriggerPurpose(c.result_type)
        expect(purpose, `${name}: purpose`).toBe(c.purpose)
        if (c.world === null) {
          expect(purpose, `${name}: unmapped result_type must produce a null purpose (no world built)`).toBeNull()
          continue
        }
        const stage = mapLifecycleStage({ fired: true, resultType: c.result_type, recoveryPhase: null })
        expect(stage, `${name}: stage`).toBe(c.stage)
      }
      if (c.world === null) continue
      const world = buildWorldFromTick(
        input.world_template,
        { signals: c.signals as never },
        { triggerPurpose: c.purpose as string, lifecycleStage: c.stage },
      )
      expectParity(world, c.world, name)
    }
  })

  it('buildWorldFromTick: real REST_PROPOSAL tick exercises non-trivial banker\'s rounding, named directly', () => {
    // Recovery-semantics refactor (fixbug-0806): the recaptured golden's run
    // is now 35 ticks instead of 38 (per this port task's own brief), so
    // `merged_adapter.json`'s `real_build_cases` KEYS were renamed to drop
    // the now-stale embedded tick index — `rest_proposal_tick17_normal_road`
    // -> `rest_proposal_normal_road` (a rename, not a weakening; the real
    // tick this case captures is now tick 21, not 17 — see `c.tick_index`).
    const c = output.real_build_cases.rest_proposal_normal_road
    const world = buildWorldFromTick(
      input.world_template,
      { signals: c.signals as never },
      { triggerPurpose: c.purpose as string, lifecycleStage: c.stage },
    )
    // 84.65000000000002 -> 85 (not a tie; ordinary round-up).
    expect((world.situation as Record<string, unknown>).drowsiness_level).toBe(85)
    // 30.499999999999964 -> 30 (not a tie; ordinary round-down).
    expect((world.situation as Record<string, unknown>).fatigue_level).toBe(30)
    // motion_state synced to BOTH locations (real tick is MOVING -> 'driving').
    expect((world.situation as Record<string, unknown>).motion_state).toBe('driving')
    expect((world.control_inputs as Record<string, unknown>).motion_state).toBe('driving')
    // INLINE fields preserved verbatim from the template.
    expect(world.driver_profile).toEqual(input.world_template.driver_profile)
    expect(world.catalog_ref).toEqual(input.world_template.catalog_ref)
  })

  it('buildWorldFromTick: real STOPPED (after-nap projection) tick maps motion to "stopped" in BOTH locations', () => {
    // Same rename as above: `after_rest_style_tick20_stopped` ->
    // `after_rest_style_stopped` (now tick 23, not 20).
    const c = output.real_build_cases.after_rest_style_stopped
    const world = buildWorldFromTick(
      input.world_template,
      { signals: c.signals as never },
      { triggerPurpose: 'rest_recommended', lifecycleStage: 'after_rest_before_restart' },
    )
    expect((world.situation as Record<string, unknown>).motion_state).toBe('stopped')
    expect((world.control_inputs as Record<string, unknown>).motion_state).toBe('stopped')
    // Confirms dynamic.recoveryPhase in the tick's OWN raw signals ("nap")
    // is never read by buildWorldFromTick — only the caller's
    // lifecycleStage argument (passed in directly above) determines the
    // resulting control_inputs.lifecycle_stage.
    expect((world.control_inputs as Record<string, unknown>).lifecycle_stage).toBe('after_rest_before_restart')
  })

  // ── Hazard 4 (dict/insertion order) — structural proof, not incidental ──
  it('buildWorldFromTick preserves the template\'s situation/control_inputs key ORDER exactly (hazard 4)', () => {
    const c = output.real_build_cases.rest_proposal_normal_road
    const world = buildWorldFromTick(
      input.world_template,
      { signals: c.signals as never },
      { triggerPurpose: c.purpose as string, lifecycleStage: c.stage },
    )
    expect(Object.keys(world.situation as Record<string, unknown>)).toEqual(input.situation_key_order)
    expect(Object.keys(world.control_inputs as Record<string, unknown>)).toEqual(input.control_inputs_key_order)
    // The template itself is untouched by the call (no mutation).
    expect(Object.keys(input.world_template.situation)).toEqual(input.situation_key_order)
  })

  // ── Synthetic branch coverage — every case below is reachable ONLY by a
  // direct call, never by any real committed golden. Each is labeled with
  // why a real run cannot produce it (see this file's header comment for
  // the full real-vs-synthetic table).
  describe('synthetic branch coverage (labeled — no real committed golden reaches these)', () => {
    const template = input.world_template

    it('mapRoadType: mountain_road / sightseeing_road — the shipped uc01 route never has one (route_analysis.json has only normal_road/highway)', () => {
      expect(mapRoadType('mountain_road')).toBe('mountain')
      expect(mapRoadType('sightseeing_road')).toBe('local')
    })

    it('mapRoadType: "rest" segment_type — RouteSegmentFact.segment_type\'s own Literal type excludes "rest" (models/run.py:130); _segment_type_at() can never return it, so this mapping is dead-but-defined defensive code, exercised only directly', () => {
      expect(mapRoadType('rest')).toBe('parking')
    })

    it('buildWorldFromTick: isTrafficJam=true -> traffic_state="congested" — real run_log_e2e.json ticks are isTrafficJam=false at all 41 events', () => {
      const world = buildWorldFromTick(
        template,
        { signals: { fixed: { isNight: false }, dynamic: { isTrafficJam: true, segmentType: 'highway', motionState: 'MOVING' }, simulated: { drowsiness: 10, fatigue: 10 } } as never },
        { triggerPurpose: 'rest_recommended', lifecycleStage: 'before_rest_until_stop' },
      )
      expect((world.situation as Record<string, unknown>).traffic_state).toBe('congested')
    })

    it('buildWorldFromTick: isNight=true -> night_state="night" — real run_log_e2e.json ticks are isNight=false at all 41 events', () => {
      const world = buildWorldFromTick(
        template,
        { signals: { fixed: { isNight: true }, dynamic: { isTrafficJam: false, segmentType: 'highway', motionState: 'MOVING' }, simulated: { drowsiness: 10, fatigue: 10 } } as never },
        { triggerPurpose: 'rest_recommended', lifecycleStage: 'before_rest_until_stop' },
      )
      expect((world.situation as Record<string, unknown>).night_state).toBe('night')
    })

    it('buildWorldFromTick: monotonyLevel key absent -> monotony_level defaults to 0 — mirrors "older persisted ticks" per the Python docstring; a live tick_engine run always emits the key', () => {
      const world = buildWorldFromTick(
        template,
        { signals: { fixed: { isNight: false }, dynamic: { isTrafficJam: false, segmentType: 'highway', motionState: 'MOVING' }, simulated: { drowsiness: 10, fatigue: 10 } } as never },
        { triggerPurpose: 'rest_recommended', lifecycleStage: 'before_rest_until_stop' },
      )
      expect((world.situation as Record<string, unknown>).monotony_level).toBe(0)
    })

    it('buildWorldFromTick: nextRestSpotMin key absent -> estimated_min_until_rest_spot=null — the live tick_engine always uses a 9999.0 sentinel instead of None (verified reading advance_tick directly), so null is reachable only via a key-absent (old-persisted-tick) shape', () => {
      const world = buildWorldFromTick(
        template,
        { signals: { fixed: { isNight: false }, dynamic: { isTrafficJam: false, segmentType: 'highway', motionState: 'MOVING' }, simulated: { drowsiness: 10, fatigue: 10 } } as never },
        { triggerPurpose: 'rest_recommended', lifecycleStage: 'before_rest_until_stop' },
      )
      expect((world.situation as Record<string, unknown>).estimated_min_until_rest_spot).toBeNull()
    })

    it('buildWorldFromTick: empty signals object ({}) -> every GENERATED field falls back to its documented default', () => {
      const world = buildWorldFromTick(
        template,
        { signals: {} as never },
        { triggerPurpose: 'rest_recommended', lifecycleStage: 'before_rest_until_stop' },
      )
      const s = world.situation as Record<string, unknown>
      expect(s.drowsiness_level).toBe(0)
      expect(s.fatigue_level).toBe(0)
      expect(s.traffic_state).toBe('normal')
      expect(s.road_type).toBe('parking')
      expect(s.night_state).toBe('day')
      expect(s.monotony_level).toBe(0)
      expect(s.motion_state).toBe('driving')
      expect(s.estimated_min_until_rest_spot).toBeNull()
    })

    it('buildWorldFromTick: banker\'s-rounding TIE (hazard 1) — drowsiness=72.5 rounds to 72 (down, to even), fatigue=73.5 rounds to 74 (up, to even); Math.round would give 73/74 for the first and agree on the second by coincidence, so both ties are asserted', () => {
      const world = buildWorldFromTick(
        template,
        { signals: { fixed: { isNight: false }, dynamic: { isTrafficJam: false, segmentType: 'highway', motionState: 'MOVING' }, simulated: { drowsiness: 72.5, fatigue: 73.5 } } as never },
        { triggerPurpose: 'rest_recommended', lifecycleStage: 'before_rest_until_stop' },
      )
      const s = world.situation as Record<string, unknown>
      expect(s.drowsiness_level, 'round-half-to-even: 72.5 -> 72').toBe(72)
      expect(s.fatigue_level, 'round-half-to-even: 73.5 -> 74').toBe(74)
      // Math.round would get drowsiness wrong (73) — proving pyRound is load-bearing here, not decorative.
      expect(Math.round(72.5)).toBe(73)
    })
  })
})
