import { describe, it, expect } from 'vitest'
import { evaluate, type NriEvaluateInput } from '../src/data/packages/builtin/nri_fatigue_score_v1'

/**
 * Recovery-semantics refactor (2026-08-08) unit tests — mirrors the
 * "Recovery-semantics refactor" block near the end of
 * `app/api/tests/test_nri_fatigue_score.py`:
 *   - test_stimulus_frozen_stops_cumulative_monotonous_min_advancing
 *   - test_stimulus_relief_min_drains_cumulative_monotonous_min_on_top_of_the_freeze
 *   - test_stimulus_relief_min_floors_cumulative_monotonous_min_at_zero
 *   - test_answered_monotony_proposal_no_longer_zeroes_the_accumulator
 *   - test_exposure_keeps_accruing_while_driving_to_the_rest_spot
 *   - test_exposure_freezes_during_the_stopped_dwell
 *   - test_accumulators_freeze_only_during_the_stopped_dwell
 *   - test_score_keeps_growing_during_the_approach_then_drops_at_resume
 *
 * This REPLACES the previous (2026-08-04 bugfix) test file, which encoded
 * two retired behaviors:
 *   1. The served-monotony-proposal relief hack — `cumulative_monotonous_min`
 *      relieved to 0 when its own `monotony_prevention` proposal was
 *      ANSWERED (`mono_intervention_handled_sec` guard). Relief on the
 *      monotony channel is now the SAME mechanism the tick engine and
 *      `aica_transparent_hybrid_trigger_v1` use: a `stimulusFrozen` freeze
 *      plus a `stimulusReliefMin` drain published on `signals.dynamic` —
 *      see `test_answered_monotony_proposal_no_longer_zeroes_the_accumulator`
 *      below, which asserts the OPPOSITE of what the old tests asserted.
 *   2. Freezing all four cumulative accumulators for the ENTIRE
 *      `recovery_active` window (accept tick, MOVING drive-to-spot, STOPPED
 *      dwell). That over-froze: the driver is still driving, and still
 *      accumulating real exposure, during the MOVING approach to the rest
 *      spot (design §6 case 2). Accumulation is now gated on `motionState`
 *      alone (`is_moving`) rather than `is_moving and not recovery_active` —
 *      the approach leg accrues exactly like ordinary driving; only the
 *      STOPPED dwell freezes. The resume-edge reset to 0 is unchanged.
 *
 * Hyperparameter defaults below are read verbatim from
 * `data/packages/nri_fatigue_score_v1/package.json` (single source), mirroring
 * the Python test file's `_default_hp()` helper.
 */

const HP: Record<string, unknown> = {
  w_base: 0.5,
  w_child: 20.0,
  m_night: 1.2,
  m_familiar: 1.2,
  w_jam: 0.8,
  w_highway: 0.2,
  w_monotonous: 0.3,
  theta_sleep: 60.0,
  w_sleep: 1.5,
  theta_fatigue: 60.0,
  w_fatigue: 1.5,
  threshold_fire: 100.0,
  threshold_monotony: 60.0,
  rest_spot_eta_filter_min: 15.0,
  // Required by evaluate() (manifest default; Task 1). These cases pass no
  // `nri_forecast` block, so forecast_evaluated=false and the early-fire path
  // never triggers regardless of the value — it only needs to exist and sit in
  // the (monotony, fire) band to satisfy the strict hp read.
  threshold_forecast_rest: 65.0,
}

const EMPTY_PH: Record<string, unknown> = {
  lastProposalTimeSec: null,
  lastProposalCategory: null,
  lastProposalResult: null,
  proposalCountLast30Min: 0,
  acceptanceRateRecent: 0.0,
}

type SignalsArgs = {
  drowsiness?: number
  fatigue?: number
  isNight?: boolean
  familiarRoute?: boolean
  childPassenger?: boolean
  segmentType?: string
  motionState?: string
  isTrafficJam?: boolean
  nextRestSpotMin?: number
  recoveryPhase?: string | null
  stimulusFrozen?: boolean
  stimulusReliefMin?: number
}

function signals(args: SignalsArgs = {}): Record<string, unknown> {
  return {
    fixed: {
      isNight: args.isNight ?? false,
      familiarRoute: args.familiarRoute ?? false,
      childPassenger: args.childPassenger ?? false,
      weatherRiskLevel: 0.0,
    },
    dynamic: {
      segmentType: args.segmentType ?? 'normal_road',
      motionState: args.motionState ?? 'MOVING',
      continuousDrivingMin: 0.0,
      speedKph: 80.0,
      routeFraction: 0.0,
      nextRestSpotMin: args.nextRestSpotMin ?? 9999.0,
      isTrafficJam: args.isTrafficJam ?? false,
      recoveryPhase: args.recoveryPhase ?? null,
      // Recovery-semantics refactor: the engine's published freeze/drain
      // signals for the monotony channel (design §7, P5).
      stimulusFrozen: args.stimulusFrozen ?? false,
      stimulusReliefMin: args.stimulusReliefMin ?? 0.0,
    },
    simulated: {
      drowsiness: args.drowsiness ?? 0.0,
      fatigue: args.fatigue ?? 0.0,
      anomaly_rate: 0.0,
    },
  }
}

function ctx(
  sig: Record<string, unknown>,
  opts: {
    prevState?: Record<string, unknown>
    proposalHistory?: Record<string, unknown>
    simTime?: number
  } = {},
): NriEvaluateInput {
  return {
    simulation_time_sec: opts.simTime ?? 60.0,
    signals: sig,
    feature_groups: { normalized: {}, ordinal: { signal_duration: 'transient' } },
    hyperparameters: HP,
    parameters: {},
    proposal_history: opts.proposalHistory ?? { ...EMPTY_PH },
    user_action_history: [],
    package_runtime_state: opts.prevState ?? {},
    recovery_active: false,
  }
}

/**
 * Mirrors `_nri_context(**overrides)` in `test_nri_fatigue_score.py`: builds a
 * full tiered context for the recovery-semantics tests, seeding
 * `cumulativeMonotonousMin` / `drivingMinSinceRest` into `package_runtime_state`
 * (with `last_sim_time` pinned to `simTime` so the seeded values pass through
 * unchanged by the elapsed-time delta) and threading `lastProposalCategory` /
 * `lastProposalResult` onto `proposal_history`.
 */
function nriContext(
  overrides: SignalsArgs & {
    cumulativeMonotonousMin?: number
    drivingMinSinceRest?: number
    lastProposalCategory?: string | null
    lastProposalResult?: string | null
    simTime?: number
  } = {},
): NriEvaluateInput {
  const simTime = overrides.simTime ?? 60.0

  const prevState: Record<string, unknown> = { last_sim_time: simTime }
  if (overrides.cumulativeMonotonousMin !== undefined) {
    prevState.cumulative_monotonous_min = overrides.cumulativeMonotonousMin
  }
  if (overrides.drivingMinSinceRest !== undefined) {
    prevState.driving_min_since_rest = overrides.drivingMinSinceRest
  }

  const proposalHistory: Record<string, unknown> = { ...EMPTY_PH }
  if (overrides.lastProposalCategory !== undefined) {
    proposalHistory.lastProposalCategory = overrides.lastProposalCategory
  }
  if (overrides.lastProposalResult !== undefined) {
    proposalHistory.lastProposalResult = overrides.lastProposalResult
  }

  return ctx(signals(overrides), { prevState, proposalHistory, simTime })
}

describe('nri_fatigue_score_v1 monotony stimulus freeze/relief (recovery-semantics refactor 2026-08-08)', () => {
  it('stimulus_frozen stops cumulative_monotonous_min from advancing', () => {
    const frozen = evaluate(nriContext({ segmentType: 'highway', stimulusFrozen: true, cumulativeMonotonousMin: 20.0 }))
    const thawed = evaluate(nriContext({ segmentType: 'highway', stimulusFrozen: false, cumulativeMonotonousMin: 20.0 }))
    const fs = frozen.next_package_runtime_state as Record<string, unknown>
    const ts = thawed.next_package_runtime_state as Record<string, unknown>
    expect(fs.cumulative_monotonous_min).toBeCloseTo(20.0, 10)
    expect(ts.cumulative_monotonous_min as number).toBeGreaterThan(20.0)
    // highway exposure still accrues in both.
    expect(fs.cumulative_highway_min).toBeCloseTo(ts.cumulative_highway_min as number, 10)
  })

  it('stimulus_relief_min drains cumulative_monotonous_min on top of the freeze (design §6 case 1)', () => {
    // Freeze alone is incomplete — the engine's published drain amount must
    // also reduce cumulative_monotonous_min, floored at 0.
    const drained = evaluate(nriContext({
      segmentType: 'highway', isTrafficJam: true,
      stimulusFrozen: true, stimulusReliefMin: 6.0,
      cumulativeMonotonousMin: 10.0,
    }))
    const state = drained.next_package_runtime_state as Record<string, unknown>
    // frozen (no advance) then drained by 6.0 -> 10.0 - 6.0 = 4.0
    expect(state.cumulative_monotonous_min).toBeCloseTo(4.0, 10)
  })

  it('stimulus_relief_min floors cumulative_monotonous_min at zero', () => {
    const drained = evaluate(nriContext({
      segmentType: 'highway', stimulusFrozen: true, stimulusReliefMin: 999.0,
      cumulativeMonotonousMin: 10.0,
    }))
    expect((drained.next_package_runtime_state as Record<string, unknown>).cumulative_monotonous_min).toBe(0.0)
  })

  it('answered monotony proposal no longer zeroes the accumulator', () => {
    // Confirmed design decision: the served-monotony-proposal relief hack is
    // retired. An answered `monotony_prevention` proposal does NOT reset
    // cumulative_monotonous_min, and the retired guard key never appears.
    const result = evaluate(nriContext({
      cumulativeMonotonousMin: 40.0,
      lastProposalCategory: 'monotony_prevention',
      lastProposalResult: 'acknowledge',
    }))
    const state = result.next_package_runtime_state as Record<string, unknown>
    expect(state.cumulative_monotonous_min as number).toBeGreaterThanOrEqual(40.0)
    expect('mono_intervention_handled_sec' in state).toBe(false)
  })

  it('exposure keeps accruing while driving to the rest spot (design §6 case 2)', () => {
    // Only the STOPPED dwell freezes, not the MOVING approach.
    const enRoute = evaluate(nriContext({
      recoveryPhase: 'wakefulness', motionState: 'MOVING',
      drivingMinSinceRest: 100.0,
    }))
    expect((enRoute.next_package_runtime_state as Record<string, unknown>).driving_min_since_rest as number).toBeGreaterThan(100.0)
  })

  it('exposure freezes during the stopped dwell', () => {
    const dwelling = evaluate(nriContext({
      recoveryPhase: 'nap', motionState: 'STOPPED',
      drivingMinSinceRest: 100.0,
    }))
    expect((dwelling.next_package_runtime_state as Record<string, unknown>).driving_min_since_rest).toBeCloseTo(100.0, 10)
  })
})

describe('nri_fatigue_score_v1 accumulators freeze only during the stopped dwell (recovery-semantics refactor 2026-08-08)', () => {
  it('keeps growing through the MOVING drive-to-spot leg (real driving, real exposure) and freezes only once the vehicle actually stops', () => {
    // Build up real pre-accept exposure so a regression in either direction
    // (frozen too early, or never freezing at all) is visibly detectable.
    const r1 = evaluate(ctx(signals({ isTrafficJam: true, segmentType: 'highway', motionState: 'MOVING' }), { simTime: 60.0 }))
    let state = r1.next_package_runtime_state as Record<string, unknown>
    const preAcceptJam = state.cumulative_jam_min as number
    expect(preAcceptJam).toBeGreaterThan(0.0)
    expect(state.cumulative_highway_min as number).toBeGreaterThan(0.0)
    expect(state.cumulative_monotonous_min as number).toBeGreaterThan(0.0)
    expect(state.driving_min_since_rest as number).toBeGreaterThan(0.0)

    // Accept-tick and several more MOVING ticks while recoveryPhase is set —
    // the drive-to-spot leg. All four accumulators keep GROWING tick over
    // tick, exactly like ordinary driving; firing stays suppressed throughout.
    let t = 120.0
    for (let i = 0; i < 5; i++) {
      const r = evaluate(ctx(
        signals({ isTrafficJam: true, segmentType: 'highway', motionState: 'MOVING', recoveryPhase: 'driving_to_spot' }),
        { prevState: state, simTime: t },
      ))
      const ns = r.next_package_runtime_state as Record<string, unknown>
      expect(ns.cumulative_jam_min as number).toBeGreaterThan(state.cumulative_jam_min as number)
      expect(ns.cumulative_highway_min as number).toBeGreaterThan(state.cumulative_highway_min as number)
      expect(ns.cumulative_monotonous_min as number).toBeGreaterThan(state.cumulative_monotonous_min as number)
      expect(ns.driving_min_since_rest as number).toBeGreaterThan(state.driving_min_since_rest as number)
      expect(r.fire_control.suppressed).toBe(true)
      expect(r.fire_control.reason).toBe('recovery_after_accept')
      state = ns
      t += 60.0
    }

    // Confirm the approach really grew them past the pre-accept value before
    // checking the freeze below (otherwise a frozen-at-pre-accept regression
    // would be indistinguishable from a frozen-at-approach-end pass).
    expect(state.cumulative_jam_min as number).toBeGreaterThan(preAcceptJam)
    const approachEndJam = state.cumulative_jam_min as number
    const approachEndHw = state.cumulative_highway_min as number
    const approachEndMono = state.cumulative_monotonous_min as number
    const approachEndDriving = state.driving_min_since_rest as number

    // Now the STOPPED dwell — accumulators freeze at the approach-end value.
    for (let i = 0; i < 3; i++) {
      const r = evaluate(ctx(
        signals({ isTrafficJam: true, segmentType: 'highway', motionState: 'STOPPED', recoveryPhase: 'resting' }),
        { prevState: state, simTime: t },
      ))
      const ns = r.next_package_runtime_state as Record<string, unknown>
      expect(ns.cumulative_jam_min).toBeCloseTo(approachEndJam, 10)
      expect(ns.cumulative_highway_min).toBeCloseTo(approachEndHw, 10)
      expect(ns.cumulative_monotonous_min).toBeCloseTo(approachEndMono, 10)
      expect(ns.driving_min_since_rest).toBeCloseTo(approachEndDriving, 10)
      state = ns
      t += 60.0
    }

    // Resume (recoveryPhase null again): resets to 0 and starts re-accumulating
    // fresh, landing back at "one fresh tick" (1.0 each) — a genuine restart
    // from 0, not merely a smaller number than the approach-end total.
    const rResume = evaluate(ctx(signals({ isTrafficJam: true, segmentType: 'highway', motionState: 'MOVING' }), { prevState: state, simTime: t }))
    const nsResume = rResume.next_package_runtime_state as Record<string, unknown>
    expect(nsResume.cumulative_jam_min).toBeCloseTo(1.0, 10)
    expect(nsResume.cumulative_highway_min).toBeCloseTo(1.0, 10)
    expect(nsResume.cumulative_monotonous_min).toBeCloseTo(1.0, 10)
    expect(nsResume.driving_min_since_rest).toBeCloseTo(1.0, 10)

    // One more tick after resume grows past the "1.0" reset value, proving
    // accumulation resumed from 0 and not from the (much larger) approach total.
    const rAfterResume = evaluate(ctx(signals({ isTrafficJam: true, segmentType: 'highway', motionState: 'MOVING' }), { prevState: nsResume, simTime: t + 60.0 }))
    expect((rAfterResume.next_package_runtime_state as Record<string, unknown>).cumulative_jam_min).toBeCloseTo(2.0, 10)
  })

  it('score keeps growing during the approach then drops at resume, not at accept-time', () => {
    // Since the accumulators now grow through the MOVING drive-to-spot leg
    // (matching ordinary driving), s_total keeps growing right through the
    // approach too — it is no longer held flat for the whole recovery window.
    // Recovery still suppresses FIRING, not scoring; the score only drops at
    // the resume edge, once the accumulators reset to 0.
    const r1 = evaluate(ctx(
      signals({ isTrafficJam: true, segmentType: 'highway', motionState: 'MOVING', drowsiness: 90.0, fatigue: 0.0 }),
      { simTime: 60.0 },
    ))
    let state = r1.next_package_runtime_state as Record<string, unknown>
    let lastTotal = (r1 as unknown as { scores: { s_total: number } }).scores.s_total

    // Several approach ticks: s_total keeps growing, exactly like ordinary
    // driving would.
    let t = 120.0
    for (let i = 0; i < 3; i++) {
      const r = evaluate(ctx(
        signals({
          isTrafficJam: true, segmentType: 'highway', motionState: 'MOVING',
          drowsiness: 90.0, fatigue: 0.0, recoveryPhase: 'driving_to_spot',
        }),
        { prevState: state, simTime: t },
      ))
      const total = (r as unknown as { scores: { s_total: number } }).scores.s_total
      expect(total).toBeGreaterThan(lastTotal)
      lastTotal = total
      state = r.next_package_runtime_state as Record<string, unknown>
      t += 60.0
    }

    const approachEndTotal = lastTotal

    // STOPPED dwell: frozen at the approach-end value.
    const rDwell = evaluate(ctx(
      signals({
        isTrafficJam: true, segmentType: 'highway', motionState: 'STOPPED',
        drowsiness: 90.0, fatigue: 0.0, recoveryPhase: 'resting',
      }),
      { prevState: state, simTime: t },
    ))
    expect((rDwell as unknown as { scores: { s_total: number } }).scores.s_total).toBeCloseTo(approachEndTotal, 10)
    state = rDwell.next_package_runtime_state as Record<string, unknown>
    t += 60.0

    // Resume edge: accumulators reset to 0, so the total drops well below the
    // approach-end plateau, leaving only this tick's fresh contribution.
    const rResume = evaluate(ctx(
      signals({
        isTrafficJam: false, segmentType: 'mountain_road', motionState: 'MOVING',
        drowsiness: 90.0, fatigue: 0.0,
      }),
      { prevState: state, simTime: t },
    ))
    const resumeScores = (rResume as unknown as { scores: { s_base: number; s_env: number; s_realtime: number; s_total: number } }).scores
    expect(resumeScores.s_total).toBeLessThan(approachEndTotal)
    expect(resumeScores.s_total).toBeCloseTo(resumeScores.s_base + resumeScores.s_env + resumeScores.s_realtime, 10)
  })
})
