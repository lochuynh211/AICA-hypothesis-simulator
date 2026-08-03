import { describe, it, expect } from 'vitest'
import { pyFixed } from '../src/data/packages/builtin/mathUtils'

/**
 * Divergence hazard 7 (`Number.prototype.toFixed` rounds exact binary ties
 * AWAY FROM ZERO; Python's `f"{x:.{n}f}"` rounds HALF-TO-EVEN) was found
 * during this slice while porting `aica_transparent_service_selector_v1`
 * (see `../src/data/packages/builtin/mathUtils.ts`'s `pyFixed` doc comment).
 * The two later ports (`aica_transparent_service_selector_v1.ts`,
 * `aica_transparent_content_selector_v1.ts`) adopted `pyFixed()` from day
 * one, but the two EARLIER ports — `nri_fatigue_score_v1.ts` (`:.0f` / `:.1f`
 * bands and scores) and `aica_transparent_hybrid_trigger_v1.ts` (`:.3f`
 * smoothed scores) — were only revisited for it after the fact.
 *
 * This test exists so the helper's necessity at exactly THOSE precisions
 * (0, 1, 3) is documented as a suite assertion, not only as prose in a
 * doc comment: each case below is a double whose EXACT binary value lands
 * precisely on a decimal half-way point at the given precision (verified
 * against a live `python3.12` process — `f"{x:.{n}f}"` — alongside JS's
 * `toFixed`, reproduced in the comments), so `pyFixed` and `toFixed`
 * provably disagree there.
 */
describe('pyFixed vs toFixed at an exact binary tie', () => {
  it('disagrees at 0 decimals (nri_fatigue_score_v1: threshold_fire / threshold_monotony bands)', () => {
    // python3.12: f"{22.5:.0f}" -> "22"; f"{12.5:.0f}" -> "12"
    expect(pyFixed(22.5, 0)).toBe('22')
    expect((22.5).toFixed(0)).toBe('23')
    expect(pyFixed(12.5, 0)).toBe('12')
    expect((12.5).toFixed(0)).toBe('13')
  })

  it('disagrees at 1 decimal (nri_fatigue_score_v1: s_total / s_base / s_env / s_realtime)', () => {
    // python3.12: f"{0.25:.1f}" -> "0.2"
    expect(pyFixed(0.25, 1)).toBe('0.2')
    expect((0.25).toFixed(1)).toBe('0.3')
    expect(pyFixed(2.25, 1)).toBe('2.2')
    expect((2.25).toFixed(1)).toBe('2.3')
  })

  it('disagrees at 3 decimals (aica_transparent_hybrid_trigger_v1: base/rest/monotony smoothed scores)', () => {
    // python3.12: f"{0.0625:.3f}" -> "0.062"; f"{2.0625:.3f}" -> "2.062"
    expect(pyFixed(0.0625, 3)).toBe('0.062')
    expect((0.0625).toFixed(3)).toBe('0.063')
    expect(pyFixed(2.0625, 3)).toBe('2.062')
    expect((2.0625).toFixed(3)).toBe('2.063')
  })
})
