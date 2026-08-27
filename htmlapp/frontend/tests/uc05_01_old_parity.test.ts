import { describe, it, expect, beforeEach } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { seedDefaults } from '../src/storage/db'
import { resetDispatchState } from '../src/engine/worker/dispatch'
import { clearDraftRegistry } from '../src/engine/run_plan'
import { clearRegistry } from '../src/engine/run_manager'
import { ensureRegistry } from '../src/data/registry'
import { loadFixture, expectParity } from '../src/engine/__fixtures__/parity'
import { iterPreviewTicks, type PreviewFireEvent } from '../src/engine/services/preview_ticks'
import { loadRoutePreset } from '../src/engine/merged/run_setup'
import type { TieredSignals } from '../src/engine/tick_engine'

/**
 * UC-05-01 forecast-jam demo — OLD (forecast-disabled) cross-check parity.
 *
 * The golden `src/engine/__fixtures__/parity/uc05_01_old_tick_by_tick.json` is
 * captured by `scripts/gen/capture_all.py#_capture_uc05_01_old`, which drives
 * the authoritative Python `scripts/calibrate_forecast_demo.run_uc05_01` with
 * the OLD hyperparameter overrides (`threshold_forecast_rest=100`,
 * `rest_spot_eta_filter_min=120` — i.e. "forecast off") over the UC-05-01
 * Minatomirai→Gotemba maps route/scenario, through the headless
 * `iter_preview_ticks` generator, and records one `TickRow` per fire EPISODE
 * (rising edge).
 *
 * This test reproduces that trace with the htmlapp TS engine's own
 * `iterPreviewTicks` — the SAME headless generator port — and asserts byte
 * parity against the golden. Because the OLD hyperparameters disable the
 * forecast path (`threshold_forecast_rest=100` puts the fire threshold at the
 * ordinary score-100 crossing, never inside the forecast band), this exercises
 * the trigger's ordinary REST_FIRE path with NO forecast code reached — the
 * cross-check the demo's Task 7 exists to lock in.
 *
 * Inputs are read verbatim from the fixture (never re-hardcoded here) so the
 * two sides cannot silently drift:
 *   - hyperparameter_overrides, run_seed, presets (tick_seconds), context
 *     overrides, initial_state — the master-preset demo pins (see
 *     calibrate_forecast_demo's _TICK_SECONDS / _CONTEXT_OVERRIDES /
 *     _INITIAL_STATE for why each is load-bearing to the divergence).
 *   - content_service_id — the recovery content the Combined proposal selector
 *     picks at the first fire (humming_karaoke for Ms. C). The golden records
 *     the discovered pick; this test passes it straight to `contentServiceId`
 *     so both sides drain the projected fatigue curve identically WITHOUT
 *     re-running the discovery pass (the discovery pass routes through
 *     `_project_fire`/the proposal selector — out of this port's scope; the
 *     recorded id is the contract between the two).
 *
 * The route is resolved through the engine's own `loadRoutePreset` (the port of
 * `routers.route_presets.load_route_preset`, the SAME loader the golden's
 * `_load_route()` uses) with `routeSource: 'maps'`. Python additionally passes
 * `display_route`; the TS trigger loop never consults it for scoring (it is a
 * paint-only artifact — positions→lat/lng), so it is omitted here. The byte
 * parity below is the proof that omission is sound.
 */

const _NO_REST_SENTINEL = 9999.0

type Row = {
  tick_index: number
  elapsed_min: number
  distance_km: number
  rest_state: string | null
  fire_reason: string | null
  proposed_spot_eta_min: number | null
}

/** Mirrors `run_uc05_01`'s per-episode `TickRow` construction field-for-field. */
function toRow(ev: PreviewFireEvent): Row {
  const dynamic = (ev.tickState.signals as TieredSignals).dynamic ?? {}
  const rawEta = dynamic['nextRestSpotMin']
  const proposedSpotEtaMin =
    rawEta === null || rawEta === undefined || Number(rawEta) >= _NO_REST_SENTINEL
      ? null
      : Number(rawEta)
  const restState = ev.decision.states['rest']
  return {
    tick_index: ev.tickIndex,
    elapsed_min: ev.elapsedMin,
    distance_km: ev.tickState.distance_km ?? 0.0,
    rest_state: (restState ?? null) as string | null,
    fire_reason: ev.decision.fire_control.reason,
    proposed_spot_eta_min: proposedSpotEtaMin,
  }
}

ensureRegistry()

beforeEach(async () => {
  globalThis.indexedDB = new IDBFactory()
  resetDispatchState()
  await seedDefaults()
  clearDraftRegistry()
  clearRegistry()
})

describe('UC-05-01 OLD (forecast-off) tick-by-tick parity', () => {
  it('iterPreviewTicks reproduces the Python fire-episode trace with no forecast code', async () => {
    const fx = loadFixture('uc05_01_old_tick_by_tick')
    const {
      package: packageId,
      scenario: scenarioId,
      route_preset: routePresetId,
      run_seed: runSeed,
      hyperparameter_overrides: hyperparameterOverrides,
      presets,
      context_overrides: contextOverrides,
      initial_state: initialState,
      content_service_id: contentServiceId,
    } = fx.input

    // Same loader the golden's `_load_route()` uses (routers.route_presets
    // .load_route_preset). Only route_facts is needed — display is paint-only.
    const routeFacts = loadRoutePreset(routePresetId)

    const rows: Row[] = []
    const events = iterPreviewTicks({
      packageId,
      scenarioId,
      hyperparameterOverrides,
      runSeed,
      restOptionId: null,
      routeSource: 'maps',
      routeFacts,
      presets,
      contextOverrides,
      initialState,
      contentServiceId,
    })
    for await (const ev of events) {
      rows.push(toRow(ev))
    }

    // Non-vacuous guards (mirror _capture_uc05_01_old's own self-checks):
    // OLD must produce an ordinary REST_FIRE and never a forecast fire.
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.some((r) => r.fire_reason === 'fire_threshold_passed')).toBe(true)
    expect(rows.every((r) => r.rest_state !== 'REST_FORECAST_FIRE')).toBe(true)

    expectParity(rows, fx.output.fires)
  })
})
