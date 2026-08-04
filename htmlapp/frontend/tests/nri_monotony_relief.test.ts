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
