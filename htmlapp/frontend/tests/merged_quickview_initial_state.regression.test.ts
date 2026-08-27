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
 * (drowsiness 65 / fatigue 75). Two independent proofs that the pin survives,
 * verified against the authoritative Python `POST /api/merged-runs/quickview`
 * on this branch:
 *   1. At the scenario default (20/20) the forecast-free quickview fires ONLY
 *      `[monotony_prevention]` and NO `rest_required` — under the branch's
 *      SHARED 30-min ETA actionability rule the default-seed driver never
 *      reaches an actionable rest fire in the projection. Honoring the elevated
 *      uc-01-01 pin INTRODUCES a `rest_required` fire the default seed does not
 *      produce. This is the exact symptom the user saw: buggy quickview showed
 *      "only monotony, no rest" precisely BECAUSE it seeded from the dropped-to
 *      -default 20/20; the pinned projection must surface the rest fire.
 *   2. The full fire timelines DIFFER. If the pin were dropped, both projections
 *      would run at the same (default) seed and the timelines would be
 *      byte-identical — which is exactly what proof (2) forbids.
 *
 * NOTE: we assert on `rest_required` presence/absence, not `fires[0]`. The first
 * monotony fire's tick is non-monotonic in initial drowsiness (at elevated pins
 * it shifts as the rest fire preempts it), so it is not a stable signal; the
 * presence of the rest fire — absent at default, present when pinned — is.
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

  it('the uc-01-01 initial_state pin introduces the rest_required fire and changes the timeline (pin is not dropped)', async () => {
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

    // Proof 1 — the rest_required fire (the user's reported symptom) is ABSENT
    // at the dropped-to-default 20/20 seed and PRESENT once the elevated pin is
    // honored. Verified against authoritative Python: default -> [monotony@10];
    // pinned -> [rest@9, monotony@36]. If the pin were dropped, the "pinned"
    // projection would also seed 20/20 and show no rest — exactly the bug.
    const defaultRest = restTick(atDefault)
    const pinnedRest = restTick(pinned)
    expect(defaultRest).toBeNull()
    expect(pinnedRest).not.toBeNull()

    // Proof 2 — the full fire timelines DIFFER. If the pin were dropped, both
    // projections would seed identically (default 20/20) and these strings
    // would be byte-identical. This is the direct "pin not silently dropped"
    // guarantee, independent of any single fire's monotonicity.
    expect(timeline(pinned)).not.toBe(timeline(atDefault))
  })
})
