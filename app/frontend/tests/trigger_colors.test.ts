/**
 * The marker palette itself (`lib/review/triggerColors`).
 *
 * Every existing colour assertion in the suite compares a rendered attribute
 * against the CONSTANT — `expect(dot.getAttribute('fill')).toBe(REST_SPOT_COLOR)`
 * — which proves the surfaces agree with the table but says nothing about what
 * the table should contain. Those tests pass for any value at all, so a change
 * to the encoding itself is invisible to them. This file pins the encoding.
 *
 * The rules being pinned (owner decision):
 *   - a rest LOCATION is drawn in the same red as a rest-required FIRE, so the
 *     two read as being about the same thing;
 *   - shape is what separates them (circle = a decision that fired, square = a
 *     place on the route) — which means colour alone can no longer do it, and
 *     any surface drawing both MUST keep the shapes different;
 *   - monotony stays a different hue, because rest-vs-monotony is the one
 *     distinction that still has to survive on colour.
 */
import { describe, it, expect } from 'vitest'
import {
  TRIGGER_REST_COLOR,
  TRIGGER_MONOTONY_COLOR,
  REST_SPOT_COLOR,
  triggerColor,
  isRestCategory,
} from '../src/lib/review/triggerColors'

describe('trigger marker palette', () => {
  it('draws a rest LOCATION in the same red as a rest FIRE', () => {
    // The owner's requirement: the rest-spot square is coherent with the red
    // rest circle. Written as an identity rather than a literal so retuning the
    // rest hue keeps them together instead of silently splitting them apart.
    expect(REST_SPOT_COLOR).toBe(TRIGGER_REST_COLOR)
  })

  it('no longer reuses the amber that was indistinguishable from monotony', () => {
    // #f59e0b sat ΔE 4.2 from the monotony orange, on markers sharing one route
    // line. This is the regression guard for reintroducing it.
    expect(REST_SPOT_COLOR).not.toBe('#f59e0b')
    expect(REST_SPOT_COLOR).not.toBe(TRIGGER_MONOTONY_COLOR)
  })

  it('keeps rest and monotony on visibly different hues', () => {
    // The only pair left that has to survive on colour alone.
    expect(TRIGGER_REST_COLOR).not.toBe(TRIGGER_MONOTONY_COLOR)
  })

  it('maps categories to hues, treating an unknown category as monotony', () => {
    expect(triggerColor('rest_required')).toBe(TRIGGER_REST_COLOR)
    expect(triggerColor('monotony_prevention')).toBe(TRIGGER_MONOTONY_COLOR)
    // A null/unknown category must not be mislabelled as a rest proposal — the
    // more consequential of the two.
    expect(triggerColor(null)).toBe(TRIGGER_MONOTONY_COLOR)
    expect(triggerColor(undefined)).toBe(TRIGGER_MONOTONY_COLOR)
    expect(isRestCategory(null)).toBe(false)
    expect(isRestCategory('rest_required')).toBe(true)
  })
})
