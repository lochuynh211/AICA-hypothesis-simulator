/**
 * Seeded-Poisson anomaly-event generator (Tier-3b) — bit-parity port of
 * `app/api/aica_api/services/behavior/anomaly_signal.py` (feature 009).
 *
 * The ONLY place randomness enters the tick loop. A behavioral-anomaly event
 * (lane-departure / steering-jerk) fires sporadically, more often as the driver
 * tires. Fully replayable: `u` comes from the seeded PRNG keyed by
 * `(run_seed, tick_index, "anomaly")`.
 *
 *   Δt_min       = tick_seconds / 60
 *   λ            = lambda_base + lambda_gain · max(0, drowsiness − theta) / 100   (clamped ≥ 0)
 *   p            = clamp(1 − exp(−λ · Δt_min), 0, 1)
 *   u            = seeded_uniform(run_seed, tick_index, "anomaly")
 *   spike        = 1 if (is_moving and u < p) else 0
 *   events'      = [t ∈ prev.events : tick_index − t < window_ticks] + ([tick_index] if spike)
 *   anomaly_rate = len(events')
 *   window_ticks = round(window_min · 60 / tick_seconds)   // Python round = banker's rounding
 *
 * NOTE: while `is_moving == false` (resting/STOPPED) `spike` is forced 0, but `u`
 * is STILL drawn (the PRNG channel advances with tick_index regardless).
 */

import { seededUniform } from '../prng'

export type AnomalySignalParams = {
  lambda_base: number
  lambda_gain: number
  theta: number
  window_min: number
}

export type AnomalyState = {
  events: number[]
}

export type AnomalyUpdate = {
  spike: number
  anomaly_rate: number
  next: AnomalyState
}

export type AdvanceAnomalyArgs = {
  drowsiness: number
  tickIndex: number
  tickSeconds: number
  runSeed: number
  isMoving: boolean
}

/** Python round() — round half to even (banker's rounding). */
function pyRound(x: number): number {
  const floor = Math.floor(x)
  const diff = x - floor
  if (diff < 0.5) return floor
  if (diff > 0.5) return floor + 1
  // exactly .5 → round to even
  return floor % 2 === 0 ? floor : floor + 1
}

export function advanceAnomaly(
  params: AnomalySignalParams,
  prev: AnomalyState,
  { drowsiness, tickIndex, tickSeconds, runSeed, isMoving }: AdvanceAnomalyArgs,
): AnomalyUpdate {
  const dtMin = tickSeconds / 60.0
  let lam = params.lambda_base + params.lambda_gain * (Math.max(0.0, drowsiness - params.theta) / 100.0)
  lam = Math.max(0.0, lam)
  let p = 1.0 - Math.exp(-lam * dtMin)
  p = Math.min(1.0, Math.max(0.0, p))
  const u = seededUniform(runSeed, tickIndex, 'anomaly')
  const spike = isMoving && u < p ? 1 : 0
  const windowTicks = pyRound((params.window_min * 60) / tickSeconds)
  const events = prev.events.filter((t) => tickIndex - t < windowTicks)
  if (spike) events.push(tickIndex)
  return { spike, anomaly_rate: events.length, next: { events } }
}
