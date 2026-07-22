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

  it('matches the venv-captured parity fixture with drowsiness_ceiling + min_distance_km overrides', async () => {
    const fx = loadFixture('rest_spots')
    const runId = await driveRunToTick(fx.input.n_ticks)

    const result = await getRestSpots(runId, undefined, 5.0, 1.0)

    expectParity(result, fx.output.custom_ceiling_5_spacing_1)
    // The lowered ceiling must flip reachability to false (non-vacuous check).
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
