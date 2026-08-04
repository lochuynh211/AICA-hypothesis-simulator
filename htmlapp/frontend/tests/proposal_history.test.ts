import { describe, it, expect } from 'vitest'
import { deriveProposalHistory } from '../src/engine/proposal_history'

/**
 * Mirrors `app/api/tests/test_python_module.py`'s `_derive_history` test
 * block (`# --- Test 6 — _derive_history (T005) ---` and the later
 * "must use the tick's REAL elapsed time, not tick_index x cadence" block),
 * ported to exercise `deriveProposalHistory` directly.
 *
 * Bugfix (2026-08-04): `deriveProposalHistory` used to recompute a fired
 * proposal's sim-time as `tick_index * tickSeconds` unconditionally — correct
 * for M1, but the M2 tick engine stamps a tick's real elapsed time as
 * `(tick_index + 1) * tick_seconds`, so every M2 proposal was back-dated by
 * exactly one tick (discovered via a `mono_intervention_handled_sec` parity
 * mismatch of exactly one tick_seconds in `evidence.test.ts`, tracing back to
 * this function never having received the fix Python's `_derive_history`
 * got in commit 5becf9f "fix bug", 2026-07-29). These tests are the TS-side
 * regression coverage that fix never had.
 */

function firedTickEvent(tickIndex: number, elapsedSeconds?: number) {
  return {
    kind: 'tick' as const,
    tick_index: tickIndex,
    trace: {
      tick_index: tickIndex,
      decision_result: {
        selected_category: 'rest_required',
        proposal: { id: 'rest_guidance', message: { ja: '休憩', en: 'Rest' }, options: ['accept_rest', 'postpone'] },
        fire_control: { fired: true, suppressed: false, override: false, reason: 'test' },
      },
    },
    ...(elapsedSeconds !== undefined ? { tick_state: { elapsed_seconds: elapsedSeconds } } : {}),
  }
}

function noTriggerTickEvent(tickIndex: number) {
  return {
    kind: 'tick' as const,
    tick_index: tickIndex,
    trace: {
      tick_index: tickIndex,
      decision_result: {
        selected_category: null,
        proposal: null,
        fire_control: { fired: false, suppressed: false, override: false, reason: 'below_threshold' },
      },
    },
  }
}

function actionEvent(tickIndex: number, action: string) {
  return { kind: 'action' as const, tick_index: tickIndex, action, resulting_status: 'playing' }
}

describe('deriveProposalHistory (parity with Python _derive_history)', () => {
  it('empty events -> all-null/0/0.0 proposal_history, empty user_action_history', () => {
    const [ph, uah] = deriveProposalHistory([], 60.0, 0.0)
    expect(ph).toEqual({
      lastProposalTimeSec: null,
      lastProposalCategory: null,
      lastProposalResult: null,
      proposalCountLast30Min: 0,
      acceptanceRateRecent: 0.0,
    })
    expect(uah).toEqual([])
  })

  it('one fired proposal followed by a decline action -> correct history (M1-style: no tick_state, falls back to tick_index * tickSeconds)', () => {
    const events = [firedTickEvent(2), actionEvent(3, 'decline')]
    const [ph, uah] = deriveProposalHistory(events, 60.0, 180.0)

    // tick 2 x 60 = 120 sec — the fallback proposal time (no tick_state present)
    expect(ph.lastProposalTimeSec).toBe(120.0)
    expect(ph.lastProposalCategory).toBe('rest_required')
    expect(ph.lastProposalResult).toBe('decline')
    expect(ph.proposalCountLast30Min).toBe(1)
    expect(ph.acceptanceRateRecent).toBe(0.0)
    expect(uah).toEqual([{ tick_index: 3, action: 'decline' }])
  })

  it('one fired proposal followed by accept_rest -> acceptanceRateRecent = 1.0', () => {
    const events = [firedTickEvent(1), actionEvent(2, 'accept_rest')]
    const [ph] = deriveProposalHistory(events, 60.0, 120.0)

    expect(ph.lastProposalCategory).toBe('rest_required')
    expect(ph.lastProposalResult).toBe('accept_rest')
    expect(ph.acceptanceRateRecent).toBe(1.0)
  })

  it('proposal older than 30 min not counted in proposalCountLast30Min', () => {
    const events = [firedTickEvent(0)]
    const [ph] = deriveProposalHistory(events, 60.0, 2000.0)
    expect(ph.proposalCountLast30Min).toBe(0)
  })

  it('non-firing tick events do not affect proposal_history', () => {
    const events = [noTriggerTickEvent(0), noTriggerTickEvent(1), noTriggerTickEvent(2)]
    const [ph, uah] = deriveProposalHistory(events, 60.0, 180.0)
    expect(ph).toEqual({
      lastProposalTimeSec: null,
      lastProposalCategory: null,
      lastProposalResult: null,
      proposalCountLast30Min: 0,
      acceptanceRateRecent: 0.0,
    })
    expect(uah).toEqual([])
  })

  it('user_action_history preserves event order', () => {
    const events = [
      firedTickEvent(0),
      actionEvent(1, 'postpone'),
      firedTickEvent(2),
      actionEvent(3, 'accept_rest'),
    ]
    const [, uah] = deriveProposalHistory(events, 60.0, 200.0)
    expect(uah).toEqual([
      { tick_index: 1, action: 'postpone' },
      { tick_index: 3, action: 'accept_rest' },
    ])
  })

  // -------------------------------------------------------------------------
  // deriveProposalHistory must use the tick's REAL elapsed time, not
  // tick_index * cadence (bugfix 2026-08-04 — see file header).
  // -------------------------------------------------------------------------

  it('a proposal is timestamped when it actually happened, not one tick earlier (M2 tick_state.elapsed_seconds)', () => {
    // Tick 19 of a 180 s cadence, stamped the way the M2 tick engine stamps
    // it: elapsed_seconds = (tick_index + 1) * tick_seconds = 3600.
    const events = [firedTickEvent(19, 20 * 180)]
    const [ph] = deriveProposalHistory(events, 180.0, 4320.0)
    expect(ph.lastProposalTimeSec).toBe(3600.0)
  })

  it('cooldown delta is not inflated by one tick (regression for C-05)', () => {
    const events = [firedTickEvent(19, 20 * 180)]
    const now = 20 * 180.0 + 720.0 // 720 sec after the fire at 3600 sec
    const [ph] = deriveProposalHistory(events, 180.0, now)
    expect(now - (ph.lastProposalTimeSec as number)).toBe(720.0)
  })

  it('the 30-minute window ages proposals out on real time, not tick_index', () => {
    // Fires at real 3600 s and 4320 s; "now" = 5400 s -> window starts at 3600 s.
    const events = [firedTickEvent(19, 20 * 180), firedTickEvent(23, 24 * 180)]
    const [ph] = deriveProposalHistory(events, 180.0, 5400.0)
    expect(ph.proposalCountLast30Min).toBe(2)

    // One tick later the 3600 s fire falls out of the window.
    const [ph2] = deriveProposalHistory(events, 180.0, 5580.0)
    expect(ph2.proposalCountLast30Min).toBe(1)
  })
})
