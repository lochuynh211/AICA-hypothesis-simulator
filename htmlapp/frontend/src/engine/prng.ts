/**
 * Seedable deterministic PRNG.
 *
 * The Python engine (app/api/aica_api/services/event_plan.py, run_plan.py, and
 * the wider services tree) consumes NO random draws: it is fully deterministic
 * from (scenario, params) alone — no `random.Random(seed)`, no seed input on
 * any API. The only randomness in the Python backend is `os.urandom` used
 * solely for plan/run ID generation, which is outside the decision path and
 * has nothing to reproduce here.
 *
 * This module exists per the project's Global Constraint that forbids
 * `Math.random()` without a seeded PRNG. It is currently unused by the TS
 * engine (which mirrors the Python engine's RNG-free determinism) and is
 * provided as sanctioned infrastructure for any future stochastic feature.
 * There is no Python draw sequence to achieve parity against.
 */

/** mulberry32 — small deterministic PRNG. Draw sequence is stable per seed. */
export function makePrng(seed: number): () => number {
  let a = seed >>> 0
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
