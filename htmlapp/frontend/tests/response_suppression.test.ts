import { describe, it, expect } from 'vitest'
import { deriveResponseSuppression, SAME_CATEGORY_RELEASE_SEC } from '../src/engine/proposal_history'

/**
 * Mirrors `app/api/tests/test_run_manager_response_suppression.py`'s §7.1
 * unit-test block for `_derive_response_suppression`, ported to exercise
 * `deriveResponseSuppression` directly. See
 * `docs/fixbug-0804-trigger-dedup-plan.md` §5 for the state-machine table.
 *
 * Recovery-semantics refactor (2026-08-08, owner review): the acknowledge
 * branch used to suppress monotony_prevention INDEFINITELY, released only
 * when some REST_PROPOSAL happened to fire afterward. CDC-SU slide 34
 * permits only two fire-control levers (提案間隔 / 単位時間あたり提案回数)
 * and slide 81 prescribes re-checking the threshold after a set time
 * (一定時間後に再度閾値チェック) — an indefinite latch is neither.
 * Acknowledge now uses the SAME bounded `SAME_CATEGORY_RELEASE_SEC` (2700s —
 * the later of the 1800s decline cooldown and the 2700s same-category
 * window) as decline/postpone/accept, and ANY answered proposal (including
 * an accept) opens that window, not just a rejection. This file was
 * re-ported from the Python test suite's OWN post-refactor rewrite
 * (`test_monotony_acknowledge_suppresses_monotony_for_the_cooldown_window` /
 * `test_monotony_acknowledge_no_longer_released_early_by_a_rest_proposal` /
 * the 2700s boundary tests) rather than left encoding the retired
 * pre-refactor behavior.
 */

function firedTickEvent(tickIndex: number, elapsedSeconds: number, category: string) {
  return {
    kind: 'tick' as const,
    tick_index: tickIndex,
    trace: {
      tick_index: tickIndex,
      decision_result: {
        selected_category: category,
        proposal: { id: `${category}_proposal`, message: { ja: 'x', en: 'x' }, options: ['accept_rest', 'postpone', 'decline', 'acknowledge'] },
        fire_control: { fired: true, suppressed: false, override: false, reason: null },
      },
    },
    tick_state: { elapsed_seconds: elapsedSeconds },
  }
}

function actionEvent(tickIndex: number, action: string) {
  return { kind: 'action' as const, tick_index: tickIndex, action, resulting_status: 'playing' }
}

describe('deriveResponseSuppression (parity with Python _derive_response_suppression)', () => {
  it('monotony_acknowledge suppresses monotony for the cooldown window (no longer indefinite)', () => {
    const events = [
      firedTickEvent(0, 0, 'monotony_prevention'),
      actionEvent(0, 'acknowledge'),
    ]
    // 15 minutes later — still inside the window.
    const inside = deriveResponseSuppression(events, 900.0, 180.0)
    expect(inside.monotony_prevention).toBe(true)
    expect(inside.rest_required).toBe(false)

    // Long after the window: unlike the old indefinite latch, it must
    // release even though no REST_PROPOSAL has fired since.
    const outside = deriveResponseSuppression(events, 10_000.0, 180.0)
    expect(outside.monotony_prevention).toBe(false)
  })

  it('monotony_acknowledge is no longer released early by a rest proposal firing', () => {
    const events = [
      firedTickEvent(0, 0, 'monotony_prevention'),
      actionEvent(0, 'acknowledge'),
      firedTickEvent(5, 900, 'rest_required'),
    ]
    // Still inside the acknowledge's own cooldown window (started at t=0) —
    // the intervening REST_PROPOSAL at t=900 does not release it.
    const stillSuppressed = deriveResponseSuppression(events, 900.0, 180.0)
    expect(stillSuppressed.monotony_prevention).toBe(true)

    // It releases at the window boundary, same as any other acknowledge.
    const released = deriveResponseSuppression(events, SAME_CATEGORY_RELEASE_SEC, 180.0)
    expect(released.monotony_prevention).toBe(false)
  })

  it('monotony decline suppresses for the cooldown window', () => {
    const events = [
      firedTickEvent(0, 0, 'monotony_prevention'),
      actionEvent(0, 'decline'),
    ]
    const result = deriveResponseSuppression(events, 900.0, 180.0)
    expect(result.monotony_prevention).toBe(true)
  })

  it('monotony decline released at the window boundary (2700s, not 1800s)', () => {
    const events = [
      firedTickEvent(0, 0, 'monotony_prevention'),
      actionEvent(0, 'decline'),
    ]
    const justInside = deriveResponseSuppression(events, SAME_CATEGORY_RELEASE_SEC - 1.0, 180.0)
    expect(justInside.monotony_prevention).toBe(true)

    const atBoundary = deriveResponseSuppression(events, SAME_CATEGORY_RELEASE_SEC, 180.0)
    expect(atBoundary.monotony_prevention).toBe(false)
  })

  it('rest decline suppresses rest for the cooldown window', () => {
    const events = [
      firedTickEvent(0, 0, 'rest_required'),
      actionEvent(0, 'decline'),
    ]
    const result = deriveResponseSuppression(events, 900.0, 180.0)
    expect(result.rest_required).toBe(true)
  })

  it('rest decline does not block monotony (per-category independence)', () => {
    const events = [
      firedTickEvent(0, 0, 'rest_required'),
      actionEvent(0, 'decline'),
    ]
    const result = deriveResponseSuppression(events, 900.0, 180.0)
    expect(result.rest_required).toBe(true)
    expect(result.monotony_prevention).toBe(false)
  })

  it('monotony decline does not block rest escalation', () => {
    const events = [
      firedTickEvent(0, 0, 'monotony_prevention'),
      actionEvent(0, 'decline'),
    ]
    const result = deriveResponseSuppression(events, 900.0, 180.0)
    expect(result.monotony_prevention).toBe(true)
    expect(result.rest_required).toBe(false)
  })

  it('postpone rest -> cooldown window, released at the boundary (2700s)', () => {
    const events = [
      firedTickEvent(0, 0, 'rest_required'),
      actionEvent(0, 'postpone'),
    ]
    const insideWindow = deriveResponseSuppression(events, 900.0, 180.0)
    expect(insideWindow.rest_required).toBe(true)

    const afterWindow = deriveResponseSuppression(events, SAME_CATEGORY_RELEASE_SEC, 180.0)
    expect(afterWindow.rest_required).toBe(false)
  })

  it('no actions -> no suppression', () => {
    const events = [
      firedTickEvent(0, 0, 'monotony_prevention'),
      firedTickEvent(5, 900, 'rest_required'),
    ]
    const result = deriveResponseSuppression(events, 1000.0, 180.0)
    expect(result.monotony_prevention).toBe(false)
    expect(result.rest_required).toBe(false)
  })
})
