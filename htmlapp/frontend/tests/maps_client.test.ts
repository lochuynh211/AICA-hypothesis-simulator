import { describe, it, expect, beforeEach, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { seedDefaults } from '../src/storage/db'
import { resetDispatchState } from '../src/engine/worker/dispatch'
import { loadFixture, expectParity } from '../src/engine/__fixtures__/parity'
import { routesAnalyze, getRestSpots } from '../src/api/client'
import { MapsError } from '../src/api/types'
import * as maps from '../src/engine/services/maps_client'
import { createDraft, clearDraftRegistry } from '../src/engine/run_plan'
import { createRun, tick, action, clearRegistry } from '../src/engine/run_manager'
import { ensureRegistry } from '../src/data/registry'

// tests/setup.ts installs globalThis.__AICA_DATA__ from the generated payload.
ensureRegistry()

beforeEach(async () => {
  globalThis.indexedDB = new IDBFactory()
  resetDispatchState()
  await seedDefaults()
  clearDraftRegistry()
  clearRegistry()
  vi.restoreAllMocks()
})

describe('routesAnalyze', () => {
  it('local path returns an envelope with no key', async () => {
    const env = await routesAnalyze({ scenarioId: 'uc01_fatigue_recovery_v0_1' })
    expect(env).toHaveProperty('route_source')
    expect(env.route_source).toBe('local')
    expect(env.alternatives).toHaveLength(1)
    expect(env.alternatives[0].route_id).toBe('local')
    expect(env.alternatives[0].display).toBeNull()
    expect(env.alternatives[0].route_facts.total_route_distance_km).toBeGreaterThan(0)
  })

  it('local path never touches the Maps SDK (zero network)', async () => {
    const directionsSpy = vi.spyOn(maps, 'directions')
    const placesSpy = vi.spyOn(maps, 'placesRestStops')
    await routesAnalyze({ scenarioId: 'uc01_fatigue_recovery_v0_1' })
    expect(directionsSpy).not.toHaveBeenCalled()
    expect(placesSpy).not.toHaveBeenCalled()
  })

  it('404-equivalent: unknown scenario throws before any Maps call', async () => {
    const directionsSpy = vi.spyOn(maps, 'directions')
    await expect(routesAnalyze({ scenarioId: 'does_not_exist' })).rejects.toThrow()
    expect(directionsSpy).not.toHaveBeenCalled()
  })

  it('maps path surfaces MapsError without leaking the key', async () => {
    vi.spyOn(maps, 'directions').mockRejectedValue(
      new MapsError({ error_type: 'invalid_key', message: 'API key was rejected (REQUEST_DENIED)', suggestion: 'Check your API key.' }),
    )
    await expect(
      routesAnalyze({ scenarioId: 'uc01_fatigue_recovery_v0_1', mapsKey: 'SECRET', start: 'A', end: 'B' }),
    ).rejects.toBeInstanceOf(MapsError)

    try {
      await routesAnalyze({ scenarioId: 'uc01_fatigue_recovery_v0_1', mapsKey: 'SECRET', start: 'A', end: 'B' })
      expect.unreachable('expected routesAnalyze to reject')
    } catch (err) {
      expect(err).toBeInstanceOf(MapsError)
      const asJson = JSON.stringify((err as MapsError).body)
      expect(asJson).not.toContain('SECRET')
      expect((err as Error).message).not.toContain('SECRET')
    }
  })

  it('maps path: a non-MapsError directions failure is normalized into a key-free MapsError', async () => {
    vi.spyOn(maps, 'directions').mockRejectedValue(new Error('boom SECRET leak attempt'))
    // The underlying rejection message is attacker-supplied in this test only
    // to prove the wrapping does not launder a leak through Error.message —
    // in real failures maps_client.ts never puts the key in an Error message.
    try {
      await routesAnalyze({ scenarioId: 'uc01_fatigue_recovery_v0_1', mapsKey: 'SECRET', start: 'A', end: 'B' })
      expect.unreachable('expected routesAnalyze to reject')
    } catch (err) {
      expect(err).toBeInstanceOf(MapsError)
    }
  })

  it('maps path calls directions with the given key/start/end and normalizes a successful result', async () => {
    vi.spyOn(maps, 'directions').mockResolvedValue([
      {
        route_id: 'route-0',
        summary: 'Test Route',
        distance_m: 100_000,
        duration_s: 3600,
        encoded_polyline: 'abc123',
        segments: [{ road_class: 'HIGHWAY', distance_m: 100_000 }],
      },
    ])
    vi.spyOn(maps, 'placesRestStops').mockResolvedValue([])

    const env = await routesAnalyze({
      scenarioId: 'uc01_fatigue_recovery_v0_1',
      mapsKey: 'SECRET',
      start: 'Tokyo',
      end: 'Osaka',
    })

    expect(env.route_source).toBe('maps')
    expect(env.alternatives).toHaveLength(1)
    expect(env.alternatives[0].route_id).toBe('route-0')
    expect(env.alternatives[0].notices).toEqual(['no_rest_stops_found'])
    expect(env.alternatives[0].display).not.toBeNull()
    expect(env.alternatives[0].display?.encoded_polyline).toBe('abc123')
    // Key safety: nothing in the envelope contains the key.
    expect(JSON.stringify(env)).not.toContain('SECRET')
  })

  it('maps path supports route-first search without a scenario id', async () => {
    vi.spyOn(maps, 'directions').mockResolvedValue([
      {
        route_id: 'route-0',
        summary: 'Route First',
        distance_m: 50_000,
        duration_s: 2400,
        encoded_polyline: 'routefirst',
        segments: [{ road_class: 'LOCAL', distance_m: 50_000 }],
      },
    ])
    vi.spyOn(maps, 'placesRestStops').mockResolvedValue([])

    const env = await routesAnalyze({
      mapsKey: 'SECRET',
      start: 'Tokyo',
      end: 'Osaka',
    })

    expect(maps.directions).toHaveBeenCalledWith('SECRET', 'Tokyo', 'Osaka')
    expect(env.route_source).toBe('maps')
    expect(env.alternatives[0].route_id).toBe('route-0')
    expect(env.alternatives[0].notices).toEqual(['no_rest_stops_found'])
    expect(JSON.stringify(env)).not.toContain('SECRET')
  })

  it('route-first maps path reports rest data unavailable when Places fails without scenario fallback', async () => {
    vi.spyOn(maps, 'directions').mockResolvedValue([
      {
        route_id: 'route-0',
        summary: 'Route First',
        distance_m: 50_000,
        duration_s: 2400,
        encoded_polyline: 'routefirst',
        segments: [{ road_class: 'LOCAL', distance_m: 50_000 }],
      },
    ])
    vi.spyOn(maps, 'placesRestStops').mockRejectedValue(
      new MapsError({ error_type: 'places_failure', message: 'Places failed', suggestion: 'Try later.' }),
    )

    const env = await routesAnalyze({
      mapsKey: 'SECRET',
      start: 'Tokyo',
      end: 'Osaka',
    })

    expect(env.route_source).toBe('maps')
    expect(env.alternatives[0].notices).toEqual(['rest_data_unavailable'])
    expect(env.alternatives[0].route_facts.rest_spot_positions).toEqual([])
  })

  it('throws when neither scenario nor complete maps input is provided', async () => {
    const directionsSpy = vi.spyOn(maps, 'directions')

    await expect(routesAnalyze({})).rejects.toThrow(/No route source/)

    expect(directionsSpy).not.toHaveBeenCalled()
  })
})

// ── getRestSpots ─────────────────────────────────────────────────────────
//
// Drives a REAL run (declarative_rule package + the bundled M2 scenario —
// same reconstructed fixture run_manager.test.ts uses; see that file's
// docstring for why: the two packages actually bundled into the htmlapp
// are python_module, which the TS adapter does not support, so tick() would
// immediately algorithm_error and the run would never advance position)
// forward a few ticks so distance_km > 0 and short of the scenario's one
// named (non-synthetic) rest spot at 60km, then calls getRestSpots.
//
// rest_spots.json is a genuine parity fixture: captured by driving the REAL
// Python services (run_plan.create_draft -> run_manager.create_run/tick ->
// routers.runs.rest_spots_endpoint, called directly, bypassing HTTP) via
// app/api's project venv, using the SAME input.package/input.scenario as
// run_log_e2e.json (see .superpowers/sdd/task-S7.3-report.md for the exact
// capture script). Both `default` (no overrides) and `custom_ceiling_5_spacing_1`
// (drowsiness_ceiling=5, min_distance_km=1 — low enough to flip reachable to
// false) outputs are captured, exercising both query-param override branches.
describe('getRestSpots (local path)', () => {
  async function driveRunToTick(nTicks: number): Promise<string> {
    const fx = loadFixture('run_log_e2e')
    const { package: pkg, scenario, presets, parameters, hyperparameters, runMode } = fx.input

    const planId = 'plan-rest-spots-test'
    const { draft } = createDraft({ planId, package: pkg, scenario, presets, parameters, hyperparameters, runMode })
    expect(draft.validation_errors).toEqual([])

    const runId = 'run-rest-spots-test'
    await createRun(planId, runId)

    for (let i = 0; i < nTicks; i++) {
      const outcome = await tick(runId)
      expect(outcome.paused, `unexpected pause before tick ${nTicks} reached`).toBe(false)
      expect(outcome.algorithmError).toBeNull()
    }
    return runId
  }

  it('returns the enriched shape and matches the venv-captured parity fixture (defaults)', async () => {
    const fx = loadFixture('rest_spots')
    const runId = await driveRunToTick(fx.input.n_ticks)

    const result = await getRestSpots(runId)

    // Shape assertions (belt-and-braces, human-readable on failure).
    expect(result.rest_spots.length).toBeGreaterThan(0)
    for (const spot of result.rest_spots) {
      expect(spot).toHaveProperty('distance_km')
      expect(spot).toHaveProperty('eta_min')
      expect(spot).toHaveProperty('reachable')
      expect(spot).toHaveProperty('route_fraction')
      expect(spot).toHaveProperty('label')
    }

    // Full parity against the real Python rest_spots_endpoint output.
    expectParity(result, fx.output.default)
  })

  it('reachability is the shared ETA filter; drowsiness_ceiling is removed (no reachable_fallback)', async () => {
    // Mirrors app/api/tests/test_rest_spot_fallback.py: reachability is now the
    // SHARED 30-min ETA rule (rest_spot_eta_filter_min) the NRI trigger uses.
    // The `scenario.rest_drowsiness_ceiling` rule, the `drowsiness_ceiling` query
    // param, and the "never strand the driver" `reachable_fallback` rescue are
    // all removed — a fire only happens once an actionable spot already exists,
    // so the picker is never left with zero reachable options after a fire.
    const fx = loadFixture('rest_spots')
    const runId = await driveRunToTick(fx.input.n_ticks)

    // The 3rd arg is now min_distance_km (drowsiness_ceiling is gone). The golden
    // was captured with the retired `?drowsiness_ceiling=5.0` query param, which
    // the backend now ignores, so the "custom" output equals the default.
    const result = await getRestSpots(runId, undefined, 5.0)

    expectParity(result, fx.output.custom_ceiling_5_spacing_1)

    const filterMin = 30.0 // rest_spot_eta_filter_min default (packages/nri_fatigue_score_v1)
    for (const spot of result.rest_spots) {
      if (spot.eta_min != null) {
        expect(spot.reachable).toBe(spot.eta_min <= filterMin)
      }
      expect('reachable_fallback' in spot).toBe(false)
    }
    // Non-vacuous: this fixture's only spot sits beyond the 30-min filter, so it
    // is genuinely unreachable — the old ceiling fallback would have rescued it;
    // it no longer does.
    expect(result.rest_spots[0].eta_min as number).toBeGreaterThan(filterMin)
    expect(result.rest_spots[0].reachable).toBe(false)
  })

  it('notice is no_rest_stops_found when no candidates are ahead (past the only rest spot)', async () => {
    // Drive far enough that current_distance_km exceeds the 60km rest spot
    // position (route_analysis.json fixture: total 120km, one spot at 60km).
    // The run pauses on REST_PROPOSAL around tick 29 (run_log_e2e's own
    // capture notes) — resolve that exactly like run_manager.test.ts's e2e
    // loop (accept_rest once, decline any subsequent proposal) so ticking can
    // continue, and stop once distance passes 60km or the run completes.
    const fx = loadFixture('run_log_e2e')
    const { package: pkg, scenario, presets, parameters, hyperparameters, runMode, recoveryOptionId, restSpot } = fx.input
    const planId = 'plan-rest-spots-past-test'
    const { draft } = createDraft({ planId, package: pkg, scenario, presets, parameters, hyperparameters, runMode })
    expect(draft.validation_errors).toEqual([])
    const runId = 'run-rest-spots-past-test'
    await createRun(planId, runId)

    let lastDistanceKm = 0
    let acceptedOnce = false
    for (let i = 0; i < 500 && lastDistanceKm <= 60; i++) {
      const outcome = await tick(runId)
      lastDistanceKm = outcome.tickState?.distance_km ?? lastDistanceKm
      if (outcome.completed) break
      if (outcome.paused) {
        if (!acceptedOnce) {
          await action(runId, 'accept_rest', { recoveryOptionId, restSpot })
          acceptedOnce = true
        } else {
          await action(runId, 'decline')
        }
      }
    }
    expect(lastDistanceKm).toBeGreaterThan(60)

    const result = await getRestSpots(runId)
    expect(result.rest_spots).toEqual([])
    expect(result.notice).toBe('no_rest_stops_found')
  })

  it('unknown run_id throws (404-equivalent)', async () => {
    await expect(getRestSpots('no-such-run')).rejects.toThrow()
  })
})

// ── getRestSpots: two-stage MIN_AHEAD selection (discriminating fixture) ──
//
// Every fixture above drives a route with exactly ONE non-synthetic named
// rest spot, so routers/runs.py's stage-1 filter (candidates more than
// _REST_SPOTS_MIN_AHEAD_KM=1km ahead of the driver) and its stage-2
// fallback (anything ahead, used only when stage 1 is empty) always pick
// the SAME candidate — neither can distinguish a stage-2-only
// implementation from the real two-stage one.
//
// rest_spots_min_ahead.json captures the same endpoint against a route with
// TWO EXTRA named rest spots injected via the maps route_facts override
// (real Python, routers/run_plans.py's route_source="maps" contract — see
// scripts/gen/capture_all.py's _capture_rest_spots_min_ahead for the exact
// construction and a self-check that the fixture still discriminates):
//   "Test Near Rest Area" @ +0.5km ahead of the driver — inside the 1km
//     min-ahead band; stage 1 drops it, stage-2-only would offer it FIRST.
//   "Test Far Rest Area"  @ +40km ahead of the driver  — clears the band.
//     The scenario's own "Yuuko Roadside Station" @60km also clears the
//     min-ahead band and, with the current 2km greedy spacing filter (was
//     20km), is >=2km from "Test Far Rest Area" too — so the real two-stage
//     endpoint offers BOTH "Test Far Rest Area" and "Yuuko Roadside Station"
//     by default, nearest first. The near spot is still the one this
//     fixture exists to prove excluded.
describe('getRestSpots (min-ahead two-stage selection)', () => {
  it('matches the venv-captured parity fixture and excludes the near spot', async () => {
    const fx = loadFixture('rest_spots_min_ahead')
    const { package: pkg, scenario, route_facts, n_ticks } = fx.input

    const planId = 'plan-rest-spots-min-ahead-test'
    const { draft } = createDraft({
      planId,
      package: pkg,
      scenario,
      presets: {},
      parameters: {},
      hyperparameters: {},
      runMode: 'standard',
      routeFacts: route_facts,
      routeSource: 'maps',
    })
    expect(draft.validation_errors).toEqual([])

    const runId = 'run-rest-spots-min-ahead-test'
    await createRun(planId, runId)

    for (let i = 0; i < n_ticks; i++) {
      const outcome = await tick(runId)
      expect(outcome.paused, `unexpected pause before tick ${n_ticks} reached`).toBe(false)
      expect(outcome.algorithmError).toBeNull()
    }

    const result = await getRestSpots(runId)

    // Full parity against the real Python rest_spots_endpoint output.
    expectParity(result, fx.output.default)

    // Non-vacuous: the divergence this fixture exists to catch. A
    // stage-2-only implementation returns the near spot too, and returns it
    // FIRST (it is nearest).
    expect(result.rest_spots).toHaveLength(2)
    expect(result.rest_spots[0].label.en).toBe('Test Far Rest Area')
    expect(result.rest_spots.some((s) => s.label.en === 'Yuuko Roadside Station')).toBe(true)
    expect(result.rest_spots.some((s) => s.label.en === 'Test Near Rest Area')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// inferRoadClass — mirrors app/api/tests/test_maps_client.py::TestInferRoadClassDirect
// ---------------------------------------------------------------------------

describe('inferRoadClass', () => {
  function step(distanceM: number, maneuver: string, instructions: string) {
    return {
      distance: { value: distanceM, text: '' },
      maneuver,
      instructions,
    } as unknown as google.maps.DirectionsStep
  }

  it('classifies a merge onto a named ordinary road as LOCAL', () => {
    // fixbug-0806 (UC-01-02): the Nagoya -> Inuyama route leaves the 名古屋高速
    // expressway at Komaki-kita IC and merges onto 名濃バイパス/国道41号 — an
    // ordinary surface national road with a convenience store every few hundred
    // metres. The bare merge maneuver used to tag those 6.8 km HIGHWAY, which
    // both suppressed the convenience-store search on that stretch and dropped
    // any local place projected onto it.
    expect(
      maps.inferRoadClass(step(6_775, 'merge', 'Merge onto <b>名濃バイパス</b>/<b>国道41号</b>')),
    ).toBe('LOCAL')
  })

  it('classifies a ramp onto a named ordinary road as LOCAL', () => {
    expect(
      maps.inferRoadClass(step(367, 'ramp-left', 'Take the <b>国道18号</b> ramp to Nagano/Annaka')),
    ).toBe('LOCAL')
  })

  it('keeps a merge onto a tolled expressway HIGHWAY even when route-numbered', () => {
    expect(
      maps.inferRoadClass(
        step(460, 'merge', 'Merge onto <b>名古屋高速都心環状線</b>/<b>C1</b> <div>Toll road</div>'),
      ),
    ).toBe('HIGHWAY')
  })

  it('keeps the >= 8 km long-step net winning over the ordinary-road exception', () => {
    expect(maps.inferRoadClass(step(12_000, 'merge', 'Merge onto <b>国道25号</b>'))).toBe('HIGHWAY')
  })

  it('keeps a merge with no ordinary-road marker HIGHWAY (US-style instruction)', () => {
    expect(maps.inferRoadClass(step(1_200, 'merge', 'Merge onto <b>I-5 N</b>'))).toBe('HIGHWAY')
  })

  it('classifies a short local step with no keyword or marker as LOCAL', () => {
    expect(maps.inferRoadClass(step(800, 'turn-left', 'Turn left onto Main St'))).toBe('LOCAL')
  })
})
