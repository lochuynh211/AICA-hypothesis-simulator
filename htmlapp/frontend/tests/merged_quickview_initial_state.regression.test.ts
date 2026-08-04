import { describe, it, expect, beforeEach } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { ensureRegistry } from '../src/data/registry'
import { resetDispatchState } from '../src/engine/worker/dispatch'
import { clearDraftRegistry } from '../src/engine/run_plan'
import { clearRegistry } from '../src/engine/run_manager'
import { worldSeedStore } from '../src/engine/proposal/stores'
import { mergedQuickview, type MergedQuickviewReq } from '../src/api/mergedClient'

/**
 * REGRESSION (fixbug-0804): htmlapp Combined *quickview* must honor the
 * `initial_state` setup pins the reviewer sets (initial drowsiness/fatigue),
 * exactly like the live-run/animation path and like the reference
 * `app/frontend` quickview.
 *
 * The bug: `src/api/mergedClient.ts::mergedQuickview` rebuilt the RPC params
 * field-by-field and HARDCODED `initial_state: null` (plus context_overrides
 * /profiles/tick_seconds), silently dropping whatever the setup panel attaches
 * to the request. The reference forwards the request body verbatim, so its
 * quickview seeds from the pinned drowsiness/fatigue; htmlapp's fell back to
 * the SCENARIO default (drowsiness 20 / fatigue 20). Result: htmlapp quickview
 * showed only a late monotony and no rest fire, while htmlapp *animation* (and
 * Python) correctly showed monotony + rest.
 *
 * This is a pure differential test using the ACTUAL uc-01-01 pin
 * (drowsiness 65 / fatigue 75). Two independent proofs that the pin survives:
 *   1. The `rest_required` fire happens strictly EARLIER than at the scenario
 *      default (tick 14 vs 18) — a driver who starts more fatigued needs rest
 *      sooner. This is the exact symptom the user saw: buggy quickview showed
 *      "only monotony, no/late rest" because it seeded from the default 20/20.
 *   2. The full fire timelines DIFFER. If the pin were dropped, both projections
 *      would run at the same (default) seed and the timelines would be
 *      byte-identical — which is exactly what proof (2) forbids.
 *
 * NOTE: we assert on `rest_required` specifically, not `fires[0]`. The first
 * monotony fire's tick is non-monotonic in initial drowsiness (at extreme pins
 * it is suppressed by the more urgent rest state), so it is not a stable signal;
 * the rest fire is.
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

function deepCopy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function baseWorld(): Record<string, unknown> {
  const seed = worldSeedStore.getSeed(SEED_ID)
  if (!seed) throw new Error(`fixture seed not found: ${SEED_ID}`)
  return deepCopy(seed.world as Record<string, unknown>)
}

function baseQuickviewReq(overrides: Partial<MergedQuickviewReq> = {}): MergedQuickviewReq {
  return {
    package_id: PACKAGE_ID,
    scenario_id: SCENARIO_ID,
    run_seed: 42,
    world: baseWorld(),
    service_package_id: SERVICE_PKG_ID,
    content_package_id: CONTENT_PKG_ID,
    run_seed_proposal: 'seed-qv-initial-state',
    ...overrides,
  }
}

describe('mergedQuickview honors initial_state pins (fixbug-0804)', () => {
  const restTick = (r: { fires: { tick: number; category: string }[] }): number | null => {
    const rest = r.fires.find((f) => f.category === 'rest_required')
    return rest ? rest.tick : null
  }
  const timeline = (r: { fires: { tick: number; category: string }[] }): string =>
    r.fires.map((f) => `${f.tick}:${f.category}`).join('|')

  it('the uc-01-01 initial_state pin makes rest_required fire earlier and changes the timeline (pin is not dropped)', async () => {
    // Default projection: scenario's own initial_state (drowsiness 20 / fatigue 20).
    const atDefault = await mergedQuickview(baseQuickviewReq())
    expect(atDefault.fired).toBe(true)
    expect(atDefault.fires.length).toBeGreaterThan(0)

    // Pinned projection: the reviewer's uc-01-01 pins (elevated initial
    // drowsiness/fatigue) — the SAME pins the Combined setup panel sends on
    // Play. `initial_state` is a genuine "setup pin" wire field the panel
    // attaches to the request body.
    const pinned = await mergedQuickview(
      baseQuickviewReq({
        // Field intentionally absent from MergedQuickviewReq's declared shape —
        // the panel attaches it via a spread; the client must FORWARD it, not
        // hardcode null. Cast mirrors how the panel supplies it.
        ...( { initial_state: { drowsiness_level: 65, fatigue_level: 75 } } as Partial<MergedQuickviewReq> ),
      }),
    )
    expect(pinned.fired).toBe(true)
    expect(pinned.fires.length).toBeGreaterThan(0)

    // Proof 1 — the rest_required fire (the user's reported symptom) is present
    // in BOTH and happens strictly EARLIER once the elevated pin is honored.
    const defaultRest = restTick(atDefault)
    const pinnedRest = restTick(pinned)
    expect(defaultRest).not.toBeNull()
    expect(pinnedRest).not.toBeNull()
    expect(pinnedRest as number).toBeLessThan(defaultRest as number)

    // Proof 2 — the full fire timelines DIFFER. If the pin were dropped, both
    // projections would seed identically (default 20/20) and these strings
    // would be byte-identical. This is the direct "pin not silently dropped"
    // guarantee, independent of any single fire's monotonicity.
    expect(timeline(pinned)).not.toBe(timeline(atDefault))
  })
})
