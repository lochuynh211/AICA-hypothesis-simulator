import { describe, it, expect } from 'vitest'
import { evaluate, type NriEvaluateInput } from '../src/data/packages/builtin/nri_fatigue_score_v1'

/**
 * Bugfix (2026-08-04) unit tests — mirrors
 * `app/api/tests/test_nri_fatigue_score.py`'s 7 tests near the end of that
 * file (the `# --- Bugfix (2026-08-04) ---` block): `cumulative_monotonous_min`
 * is now RELIEVED (reset to 0) when its own `monotony_prevention` proposal is
 * ANSWERED (acknowledge OR decline — any non-null `lastProposalResult`),
 * mirroring `aica_transparent_hybrid_trigger_v1`'s `mono_min` rebaseline. A
 * once-per-intervention guard (`mono_intervention_handled_sec`) prevents
 * re-zeroing every tick. Only the monotony accumulator is relieved; jam/
 * highway/driving accumulators are untouched.
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

function monoPh(result: string | null = 'acknowledge', timeSec = 60.0): Record<string, unknown> {
  return { ...EMPTY_PH, lastProposalTimeSec: timeSec, lastProposalCategory: 'monotony_prevention', lastProposalResult: result }
}

/**
 * Drive `ticks` MOVING ticks on a monotonous (highway) segment, threading
 * `package_runtime_state` forward. Returns [lastNextState, nextSimTime],
 * where `nextSimTime` is the sim_time of the NEXT (not yet evaluated) tick.
 */
function driveMonotonous(ticks: number, startT = 60.0, step = 60.0): [Record<string, unknown>, number] {
  let state: Record<string, unknown> = {}
  let t = startT
  for (let i = 0; i < ticks; i++) {
    const result = evaluate(ctx(signals({ segmentType: 'highway', motionState: 'MOVING' }), { prevState: state, simTime: t }))
    state = result.next_package_runtime_state as Record<string, unknown>
    t += step
  }
  return [state, t]
}

describe('nri_fatigue_score_v1 monotony relief (bugfix 2026-08-04)', () => {
  it('monotony answer relieves cumulative_monotonous_min', () => {
    const [state, t] = driveMonotonous(5)
    expect((state.cumulative_monotonous_min as number) > 0.0).toBe(true)

    // Non-monotonous segment on the relief tick isolates the reset from
    // same-tick re-accumulation (mirrors the existing recovery-reset test).
    const ph = monoPh('acknowledge', t)
    const relief = evaluate(ctx(signals({ segmentType: 'mountain_road', motionState: 'MOVING' }), { prevState: state, simTime: t, proposalHistory: ph }))
    const nextState = relief.next_package_runtime_state as Record<string, unknown>
    expect(nextState.cumulative_monotonous_min).toBe(0.0)
    expect(nextState.mono_intervention_handled_sec).toBe(t)
  })

  it('monotony relief drops s_env and s_total', () => {
    const [state, t] = driveMonotonous(5)

    const baseline = evaluate(ctx(signals({ segmentType: 'mountain_road', motionState: 'MOVING' }), { prevState: state, simTime: t }))
    const relief = evaluate(ctx(signals({ segmentType: 'mountain_road', motionState: 'MOVING' }), { prevState: state, simTime: t, proposalHistory: monoPh('acknowledge', t) }))

    const baselineScores = (baseline as unknown as { scores: { s_env: number; s_total: number } }).scores
    const reliefScores = (relief as unknown as { scores: { s_env: number; s_total: number } }).scores
    expect(reliefScores.s_env).toBeLessThan(baselineScores.s_env)
    expect(reliefScores.s_total).toBeLessThan(baselineScores.s_total)
    expect((relief.next_package_runtime_state as Record<string, unknown>).cumulative_monotonous_min).toBe(0.0)

    const contributions = (relief as unknown as {
      feature_contributions: { rest_required: { rows: Array<{ feature_id: string; contribution: number }> } }
    }).feature_contributions
    const monoRow = contributions.rest_required.rows.find((row) => row.feature_id === 'monotony')
    expect(monoRow?.contribution).toBe(0.0)
  })

  it('monotony relief fires only once (guard holds across repeated ticks with the same lastProposalTimeSec)', () => {
    const [state, t] = driveMonotonous(5)
    const ph = monoPh('acknowledge', t)

    const relief = evaluate(ctx(signals({ segmentType: 'mountain_road', motionState: 'MOVING' }), { prevState: state, simTime: t, proposalHistory: ph }))
    let later = relief.next_package_runtime_state as Record<string, unknown>
    expect(later.cumulative_monotonous_min).toBe(0.0)
    expect(later.mono_intervention_handled_sec).toBe(t)

    // The SAME (already-handled) proposal_history over several more ticks must
    // NOT re-zero the accumulator each tick — it has to resume accumulating,
    // otherwise monotony could never rebuild to fire again.
    let tt = t
    let prevVal = later.cumulative_monotonous_min as number
    for (let i = 0; i < 3; i++) {
      tt += 60.0
      const result = evaluate(ctx(signals({ segmentType: 'highway', motionState: 'MOVING' }), { prevState: later, simTime: tt, proposalHistory: ph }))
      later = result.next_package_runtime_state as Record<string, unknown>
      expect((later.cumulative_monotonous_min as number) > prevVal).toBe(true)
      prevVal = later.cumulative_monotonous_min as number
      expect(later.mono_intervention_handled_sec).toBe(t)
    }
  })

  it('unanswered monotony proposal (lastProposalResult null) does NOT relieve', () => {
    const [state, t] = driveMonotonous(5)
    const ph = monoPh(null, t)
    const result = evaluate(ctx(signals({ segmentType: 'mountain_road', motionState: 'MOVING' }), { prevState: state, simTime: t, proposalHistory: ph }))
    const nextState = result.next_package_runtime_state as Record<string, unknown>
    expect(nextState.cumulative_monotonous_min).toBeCloseTo(state.cumulative_monotonous_min as number, 10)
    expect(nextState.mono_intervention_handled_sec).toBe(null)
  })

  it('monotony decline also relieves (not just acknowledge)', () => {
    // Confirmed design decision: ANY non-null result relieves, not
    // acknowledge-only.
    const [state, t] = driveMonotonous(5)
    const ph = monoPh('decline', t)
    const result = evaluate(ctx(signals({ segmentType: 'mountain_road', motionState: 'MOVING' }), { prevState: state, simTime: t, proposalHistory: ph }))
    const nextState = result.next_package_runtime_state as Record<string, unknown>
    expect(nextState.cumulative_monotonous_min).toBe(0.0)
    expect(nextState.mono_intervention_handled_sec).toBe(t)
  })

  it('rest proposal answer does NOT relieve monotony (category must be monotony_prevention)', () => {
    function driveJamHighway(ticks: number, startT = 60.0, step = 60.0): [Record<string, unknown>, number] {
      let state: Record<string, unknown> = {}
      let t = startT
      for (let i = 0; i < ticks; i++) {
        const r = evaluate(ctx(signals({ isTrafficJam: true, segmentType: 'highway', motionState: 'MOVING' }), { prevState: state, simTime: t }))
        state = r.next_package_runtime_state as Record<string, unknown>
        t += step
      }
      return [state, t]
    }

    const [state, t] = driveJamHighway(5)
    const ph = { ...EMPTY_PH, lastProposalTimeSec: t, lastProposalCategory: 'rest_required', lastProposalResult: 'accept_rest' }

    const withPh = evaluate(ctx(signals({ isTrafficJam: true, segmentType: 'highway', motionState: 'MOVING' }), { prevState: state, simTime: t, proposalHistory: ph }))
    const withoutPh = evaluate(ctx(signals({ isTrafficJam: true, segmentType: 'highway', motionState: 'MOVING' }), { prevState: state, simTime: t }))

    const nsWith = withPh.next_package_runtime_state as Record<string, unknown>
    const nsWithout = withoutPh.next_package_runtime_state as Record<string, unknown>
    expect(nsWith.cumulative_monotonous_min).toBeCloseTo(nsWithout.cumulative_monotonous_min as number, 10)
    expect(nsWith.cumulative_jam_min).toBeCloseTo(nsWithout.cumulative_jam_min as number, 10)
    expect(nsWith.cumulative_highway_min).toBeCloseTo(nsWithout.cumulative_highway_min as number, 10)
    expect(nsWith.mono_intervention_handled_sec).toBe(null)
  })

  it('missing mono_intervention_handled_sec key defaults gracefully (legacy prevState)', () => {
    // A prevState persisted BEFORE this bugfix never had
    // `mono_intervention_handled_sec` — its absence must default gracefully
    // (null-ish), not throw.
    const [state, t] = driveMonotonous(5)
    delete state.mono_intervention_handled_sec // simulate a pre-bugfix legacy state

    const ph = monoPh('acknowledge', t)
    const result = evaluate(ctx(signals({ segmentType: 'mountain_road', motionState: 'MOVING' }), { prevState: state, simTime: t, proposalHistory: ph }))
    const nextState = result.next_package_runtime_state as Record<string, unknown>
    expect(nextState.cumulative_monotonous_min).toBe(0.0)
    expect(nextState.mono_intervention_handled_sec).toBe(t)
  })
})

/**
 * Bugfix (2026-08-04) unit tests — mirrors the two tests in
 * `app/api/tests/test_nri_fatigue_score.py`:
 * `test_accumulators_frozen_at_pre_accept_value_through_the_entire_recovery_window`
 * and `test_score_does_not_drop_at_accept_time_only_at_resume`. The four
 * cumulative accumulators (`cumulative_jam_min`, `cumulative_highway_min`,
 * `cumulative_monotonous_min`, `driving_min_since_rest`) are FROZEN — held at
 * their pre-accept value, neither growing nor zeroing — for the ENTIRE
 * `recoveryActive` window (accept -> drive-to-spot -> dwell), then reset to 0
 * only at the `recoveryJustCompleted` (resume) edge. This deliberately does
 * NOT mirror `aica_transparent_hybrid_trigger_v1`'s continuous rebaseline —
 * see the module doc comment above `evaluate()` for why NRI's unbounded,
 * exposure-dominated score would collapse to near-zero if zeroed at
 * accept-time instead of frozen.
 */
describe('nri_fatigue_score_v1 freeze-then-reset-at-resume during recovery (bugfix 2026-08-04)', () => {
  it('freezes all four accumulators at their pre-accept value through the entire recovery window (MOVING approach and STOPPED dwell), then resets to 0 and re-accumulates fresh on resume', () => {
    // Build up real pre-accept exposure so a regression in either direction
    // (still climbing, or wrongly zeroed) is visibly detectable.
    const r1 = evaluate(ctx(signals({ isTrafficJam: true, segmentType: 'highway', motionState: 'MOVING' }), { simTime: 60.0 }))
    let state = r1.next_package_runtime_state as Record<string, unknown>
    const preAcceptJam = state.cumulative_jam_min as number
    const preAcceptHw = state.cumulative_highway_min as number
    const preAcceptMono = state.cumulative_monotonous_min as number
    const preAcceptDriving = state.driving_min_since_rest as number
    expect(preAcceptJam).toBeGreaterThan(0.0)
    expect(preAcceptHw).toBeGreaterThan(0.0)
    expect(preAcceptMono).toBeGreaterThan(0.0)
    expect(preAcceptDriving).toBeGreaterThan(0.0)
    const preAcceptSTotal = (r1 as unknown as { scores: { s_total: number } }).scores.s_total
    expect(preAcceptSTotal).toBeGreaterThan(0.0)

    // Accept-tick and several more MOVING ticks while recoveryPhase is set —
    // the drive-to-spot leg. Every accumulator must stay EXACTLY at its
    // pre-accept value (frozen), not grow and not drop to 0.
    let t = 120.0
    for (let i = 0; i < 5; i++) {
      const r = evaluate(ctx(
        signals({ isTrafficJam: true, segmentType: 'highway', motionState: 'MOVING', recoveryPhase: 'driving_to_spot' }),
        { prevState: state, simTime: t },
      ))
      const ns = r.next_package_runtime_state as Record<string, unknown>
      expect(ns.cumulative_jam_min).toBeCloseTo(preAcceptJam, 10)
      expect(ns.cumulative_highway_min).toBeCloseTo(preAcceptHw, 10)
      expect(ns.cumulative_monotonous_min).toBeCloseTo(preAcceptMono, 10)
      expect(ns.driving_min_since_rest).toBeCloseTo(preAcceptDriving, 10)
      const scores = (r as unknown as { scores: { s_total: number } }).scores
      expect(scores.s_total).toBeCloseTo(preAcceptSTotal, 10)
      expect(r.fire_control.suppressed).toBe(true)
      expect(r.fire_control.reason).toBe('recovery_after_accept')
      state = ns
      t += 60.0
    }

    // Now the STOPPED dwell — same freeze, via the pre-existing isMoving gate
    // (accrue is false either way, but the accumulators must still read the
    // SAME frozen value, not 0).
    for (let i = 0; i < 3; i++) {
      const r = evaluate(ctx(
        signals({ isTrafficJam: true, segmentType: 'highway', motionState: 'STOPPED', recoveryPhase: 'resting' }),
        { prevState: state, simTime: t },
      ))
      const ns = r.next_package_runtime_state as Record<string, unknown>
      expect(ns.cumulative_jam_min).toBeCloseTo(preAcceptJam, 10)
      expect(ns.cumulative_highway_min).toBeCloseTo(preAcceptHw, 10)
      expect(ns.cumulative_monotonous_min).toBeCloseTo(preAcceptMono, 10)
      expect(ns.driving_min_since_rest).toBeCloseTo(preAcceptDriving, 10)
      const scores = (r as unknown as { scores: { s_total: number } }).scores
      expect(scores.s_total).toBeCloseTo(preAcceptSTotal, 10)
      state = ns
      t += 60.0
    }

    // Resume (recoveryPhase null again): resets to 0 and starts re-accumulating
    // fresh. In THIS setup the pre-accept state was also produced by a single
    // first tick (prevState={}), so the resumed accumulators land back at the
    // SAME "one fresh tick" value (1.0 each) — the reset is a genuine restart
    // from 0, not merely "a smaller number than before".
    const rResume = evaluate(ctx(
      signals({ isTrafficJam: true, segmentType: 'highway', motionState: 'MOVING' }),
      { prevState: state, simTime: t },
    ))
    const nsResume = rResume.next_package_runtime_state as Record<string, unknown>
    expect(nsResume.cumulative_jam_min as number).toBeCloseTo(1.0, 10)
    expect(nsResume.cumulative_highway_min as number).toBeCloseTo(1.0, 10)
    expect(nsResume.cumulative_monotonous_min as number).toBeCloseTo(1.0, 10)
    expect(nsResume.driving_min_since_rest as number).toBeCloseTo(1.0, 10)
    expect((rResume as unknown as { scores: { s_total: number } }).scores.s_total).toBeCloseTo(preAcceptSTotal, 10)

    // Crucially, this is a real reset-then-regrow, not a no-op freeze that
    // happened to coincide with 1.0: confirm one MORE tick after resume grows
    // past the frozen plateau, proving accumulation resumed from 0 and not
    // from the (much larger, after 8 held ticks) frozen total.
    const rAfterResume = evaluate(ctx(
      signals({ isTrafficJam: true, segmentType: 'highway', motionState: 'MOVING' }),
      { prevState: nsResume, simTime: t + 60.0 },
    ))
    expect((rAfterResume.next_package_runtime_state as Record<string, unknown>).cumulative_jam_min).toBeCloseTo(2.0, 10)
  })

  it('does not drop the score at accept-time — only at the resume edge', () => {
    const r1 = evaluate(ctx(
      signals({ isTrafficJam: true, segmentType: 'highway', motionState: 'MOVING', drowsiness: 90.0, fatigue: 0.0 }),
      { simTime: 60.0 },
    ))
    let state = r1.next_package_runtime_state as Record<string, unknown>
    const preAcceptSTotal = (r1 as unknown as { scores: { s_total: number } }).scores.s_total
    const preAcceptSBase = (r1 as unknown as { scores: { s_base: number } }).scores.s_base
    const preAcceptSEnv = (r1 as unknown as { scores: { s_env: number } }).scores.s_env

    // First recovery tick — still MOVING (drive-to-spot), same drowsiness.
    // s_base and s_env must stay FROZEN at their pre-accept values (the
    // accumulators did not grow, did not zero); s_realtime is untouched by
    // recovery. The total must stay approximately equal to the pre-accept
    // total — NOT drop.
    let t = 120.0
    let r2 = evaluate(ctx(
      signals({
        isTrafficJam: true, segmentType: 'highway', motionState: 'MOVING',
        drowsiness: 90.0, fatigue: 0.0, recoveryPhase: 'driving_to_spot',
      }),
      { prevState: state, simTime: t },
    ))
    let scores2 = (r2 as unknown as { scores: { s_base: number; s_env: number; s_total: number } }).scores
    expect(scores2.s_base).toBeCloseTo(preAcceptSBase, 10)
    expect(scores2.s_env).toBeCloseTo(preAcceptSEnv, 10)
    expect(scores2.s_total).toBeCloseTo(preAcceptSTotal, 10)
    state = r2.next_package_runtime_state as Record<string, unknown>
    t += 60.0

    // Several more approach ticks and a dwell tick: still flat, still no drop.
    for (let i = 0; i < 3; i++) {
      r2 = evaluate(ctx(
        signals({
          isTrafficJam: true, segmentType: 'highway', motionState: 'MOVING',
          drowsiness: 90.0, fatigue: 0.0, recoveryPhase: 'driving_to_spot',
        }),
        { prevState: state, simTime: t },
      ))
      expect((r2 as unknown as { scores: { s_total: number } }).scores.s_total).toBeCloseTo(preAcceptSTotal, 10)
      state = r2.next_package_runtime_state as Record<string, unknown>
      t += 60.0
    }

    const rDwell = evaluate(ctx(
      signals({
        isTrafficJam: true, segmentType: 'highway', motionState: 'STOPPED',
        drowsiness: 90.0, fatigue: 0.0, recoveryPhase: 'resting',
      }),
      { prevState: state, simTime: t },
    ))
    expect((rDwell as unknown as { scores: { s_total: number } }).scores.s_total).toBeCloseTo(preAcceptSTotal, 10)
    state = rDwell.next_package_runtime_state as Record<string, unknown>
    t += 60.0

    // Resume edge: accumulators reset to 0, so s_base/s_env collapse and the
    // total DOES drop, leaving only this tick's fresh contribution. Use a
    // jam-free/non-monotonous resume segment so s_env visibly drops (rather
    // than coincidentally re-accumulating the same value).
    const rResume = evaluate(ctx(
      signals({
        isTrafficJam: false, segmentType: 'mountain_road', motionState: 'MOVING',
        drowsiness: 90.0, fatigue: 0.0,
      }),
      { prevState: state, simTime: t },
    ))
    const resumeScores = (rResume as unknown as { scores: { s_base: number; s_env: number; s_realtime: number; s_total: number } }).scores
    // s_base is a FRESH one-tick total (driving_min_since_rest reset to 0,
    // then this MOVING tick added 1 min) — numerically equal to the
    // pre-accept tick's s_base (also a fresh first tick), NOT smaller. s_env,
    // however, resets to (near) 0 since the resume signal is jam-free/
    // non-monotonous, so it drops well below the pre-accept accumulated
    // total. That drop is what makes s_total fall relative to the flat
    // plateau held throughout the whole recovery window.
    expect(resumeScores.s_base).toBeCloseTo(preAcceptSBase, 10)
    expect(resumeScores.s_env).toBeLessThan(preAcceptSEnv)
    expect(resumeScores.s_total).toBeLessThan(preAcceptSTotal)
    expect(resumeScores.s_total).toBeCloseTo(resumeScores.s_base + resumeScores.s_env + resumeScores.s_realtime, 10)
  })
})
