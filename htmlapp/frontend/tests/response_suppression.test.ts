import { describe, it, expect } from 'vitest'
import { deriveResponseSuppression } from '../src/engine/proposal_history'

/**
 * Mirrors `app/api/tests/test_run_manager_response_suppression.py`'s §7.1
 * unit-test block for `_derive_response_suppression`, ported to exercise
 * `deriveResponseSuppression` directly. See
 * `docs/fixbug-0804-trigger-dedup-plan.md` §5 for the state-machine table.
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
  it('monotony_acknowledge suppresses monotony until rest fires', () => {
    const events = [
      firedTickEvent(0, 0, 'monotony_prevention'),
      actionEvent(0, 'acknowledge'),
    ]
    const result = deriveResponseSuppression(events, 10_000.0, 180.0)
    expect(result.monotony_prevention).toBe(true)
    expect(result.rest_required).toBe(false)
  })

  it('monotony_acknowledge released when a rest proposal fires afterward', () => {
    const events = [
      firedTickEvent(0, 0, 'monotony_prevention'),
      actionEvent(0, 'acknowledge'),
      firedTickEvent(5, 900, 'rest_required'),
    ]
    const result = deriveResponseSuppression(events, 900.0, 180.0)
    expect(result.monotony_prevention).toBe(false)
  })

  it('monotony decline suppresses for 30 min', () => {
    const events = [
      firedTickEvent(0, 0, 'monotony_prevention'),
      actionEvent(0, 'decline'),
    ]
    const result = deriveResponseSuppression(events, 900.0, 180.0)
    expect(result.monotony_prevention).toBe(true)
  })

  it('monotony decline released after 30 min (boundary)', () => {
    const events = [
      firedTickEvent(0, 0, 'monotony_prevention'),
      actionEvent(0, 'decline'),
    ]
    const justInside = deriveResponseSuppression(events, 1799.0, 180.0)
    expect(justInside.monotony_prevention).toBe(true)

    const atBoundary = deriveResponseSuppression(events, 1800.0, 180.0)
    expect(atBoundary.monotony_prevention).toBe(false)
  })

  it('rest decline suppresses rest for 30 min', () => {
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

  it('postpone rest -> 30-min cooldown', () => {
    const events = [
      firedTickEvent(0, 0, 'rest_required'),
      actionEvent(0, 'postpone'),
    ]
    const insideWindow = deriveResponseSuppression(events, 900.0, 180.0)
    expect(insideWindow.rest_required).toBe(true)

    const afterWindow = deriveResponseSuppression(events, 1800.0, 180.0)
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
