import { describe, it, beforeEach, expect } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { seedDefaults } from '../src/storage/db'
import { resetDispatchState } from '../src/engine/worker/dispatch'
import { runPreview } from '../src/api/client'
import { loadFixture, expectParity } from '../src/engine/__fixtures__/parity'
import { clearDraftRegistry } from '../src/engine/run_plan'
import { clearRegistry } from '../src/engine/run_manager'
import { ensureRegistry } from '../src/data/registry'

// tests/setup.ts installs globalThis.__AICA_DATA__ from the generated payload.
ensureRegistry()

beforeEach(async () => {
  globalThis.indexedDB = new IDBFactory()
  resetDispatchState()
  await seedDefaults()
  clearDraftRegistry()
  clearRegistry()
})

describe('runPreview parity (InstantResult)', () => {
  it('reproduces Python evaluate_preview byte-for-byte', async () => {
    const { input, output } = loadFixture('preview')
    for (let i = 0; i < input.cases.length; i++) {
      const c = input.cases[i]
      const res = await runPreview(
        {
          package_id: c.package_id,
          scenario_id: c.scenario_id,
          hyperparameter_overrides: c.hyperparameter_overrides,
          run_seed: c.run_seed,
        },
        c.rest_option_id,
      )
      expectParity(res, output.results[i], `case[${i}]`)
    }
  })
})

// ── runPreview: two-stage MIN_AHEAD selection (discriminating fixture) ──
//
// Every case in preview.json drives uc01_fatigue_recovery_v0_1's route,
// which has exactly ONE non-synthetic named rest spot, so the preview's
// auto-accept step (pickPreviewRestSpot / Python's _pick_rest_spot) can't be
// told apart from a stage-2-only ("anything ahead") implementation on that
// fixture — stage 1's 20km-ahead filter and the fallback always agree when
// there is only one candidate.
//
// preview_min_ahead.json captures the same endpoint against a route with
// TWO EXTRA named rest spots injected via the maps route_facts override
// (real Python; see scripts/gen/capture_all.py's _capture_preview_min_ahead
// for the exact construction — the near/far offsets are anchored to the
// REAL tick at which the first rest_required proposal is auto-accepted,
// discovered from an unmodified probe run, not assumed — and a self-check
// that the fixture still discriminates):
//   "Test Near Rest Area" @ +5km ahead of the driver at accept time  —
//     inside the 20km min-ahead band; stage 1 must never auto-accept it.
//   "Test Far Rest Area"  @ +40km ahead of the driver at accept time —
//     clears the band; the ONLY spot the real two-stage picker auto-accepts
//     (the scenario's own "Yuuko Roadside Station" @60km also falls inside
//     the min-ahead band at accept time and is excluded the same way).
describe('runPreview (min-ahead two-stage rest-spot pick)', () => {
  it('matches the venv-captured parity fixture and never auto-accepts the near spot', async () => {
    const { input, output } = loadFixture('preview_min_ahead')

    const res = await runPreview({
      package_id: input.package_id,
      scenario_id: input.scenario_id,
      hyperparameter_overrides: input.hyperparameter_overrides,
      run_seed: input.run_seed,
      route_source: input.route_source,
      route_facts: input.route_facts,
    })

    // Full parity against the real Python evaluate_preview output.
    expectParity(res, output)

    // Non-vacuous: the divergence this fixture exists to catch. A
    // stage-2-only implementation auto-accepts the near spot instead (it is
    // nearest, so it wins the sorted-ascending pick). Read the expected
    // near/far positions from the fixture itself (not hardcoded) so this
    // stays correct if the fixture is ever regenerated with different
    // offsets.
    type NamedRestSpot = { name: string; position_km: number }
    const namedRestSpots = input.route_facts.named_rest_spots as NamedRestSpot[]
    const nearSpot = namedRestSpots.find((s) => s.name === 'Test Near Rest Area')
    const farSpot = namedRestSpots.find((s) => s.name === 'Test Far Rest Area')
    expect(nearSpot).toBeTruthy()
    expect(farSpot).toBeTruthy()

    expect(res.rest_spots?.length).toBeGreaterThan(0)
    expect(res.rest_spots?.every((s) => Math.abs(s.at_km - nearSpot!.position_km) > 1e-6)).toBe(true)
    expect(res.rest_spot?.at_km).toBeCloseTo(farSpot!.position_km, 6)
  })
})
