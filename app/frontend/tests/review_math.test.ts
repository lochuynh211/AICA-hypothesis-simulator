// app/frontend/tests/review_math.test.ts
import {
  scaleBound, marginRows, realizedShares, declaredShares, intentVsEffect,
} from '../src/lib/review/reviewMath'
import type { ReviewOption } from '../src/lib/review/types'

const row = (featureId: string, contribution: number, w = 0.5) => ({
  featureId, value: contribution / w, band: null, r: 1, w, contribution,
})

const opt = (id: string, rows: ReturnType<typeof row>[]): ReviewOption => ({
  id, label: id, score: rows.reduce((a, r) => a + r.contribution, 0), rows,
})

describe('scaleBound', () => {
  it('rounds up to the first readable value strictly above the largest magnitude', () => {
    expect(scaleBound([0.299, -0.1])).toBe(0.3)
    expect(scaleBound([0.11])).toBe(0.125)
  })

  it('is strictly above the magnitude even at an exact step value', () => {
    // 0.3 must NOT bound itself — a bar would touch the edge and read as clipped.
    // Pinned to the NEXT step, not merely "something bigger": toBeGreaterThan
    // alone would pass for a bound of 10, which would squash every bar flat.
    expect(scaleBound([0.3])).toBe(0.4)
  })

  it('uses absolute magnitude, so sign never changes the bound', () => {
    expect(scaleBound([-0.299])).toBe(scaleBound([0.299]))
  })

  it('returns a positive bound for an all-zero or empty input', () => {
    expect(scaleBound([])).toBeGreaterThan(0)
    expect(scaleBound([0, 0])).toBeGreaterThan(0)
  })
})

describe('marginRows', () => {
  const left = opt('rest_required', [row('fatigue', 0.30), row('monotony', 0.05)])
  const right = opt('monotony_prevention', [row('monotony', 0.25), row('fatigue', 0.00)])

  it('pairs each feature across both options', () => {
    const rows = marginRows(left, right)
    const fatigue = rows.find((r) => r.featureId === 'fatigue')!
    expect(fatigue.left).toBe(0.30)
    expect(fatigue.right).toBe(0.00)
    expect(fatigue.margin).toBeCloseTo(0.30)
    expect(fatigue.lean).toBe('left')
  })

  it('leans right when the right option gains more from the feature', () => {
    const monotony = marginRows(left, right).find((r) => r.featureId === 'monotony')!
    expect(monotony.margin).toBeCloseTo(-0.20)
    expect(monotony.lean).toBe('right')
  })

  it('includes a feature present on only one side, with zero on the other', () => {
    const rows = marginRows(opt('a', [row('solo', 0.4)]), opt('b', []))
    expect(rows).toHaveLength(1)
    expect(rows[0].right).toBe(0)
  })

  it('orders rows by descending absolute margin', () => {
    const rows = marginRows(left, right)
    expect(rows.map((r) => r.featureId)).toEqual(['fatigue', 'monotony'])
  })

  it('reports no lean when a feature contributes identically to both', () => {
    const rows = marginRows(opt('a', [row('x', 0.2)]), opt('b', [row('x', 0.2)]))
    expect(rows[0].lean).toBe('none')
  })
})

describe('realizedShares', () => {
  it('is the absolute share of total absolute contribution', () => {
    const shares = realizedShares([row('a', 0.3), row('b', -0.1)])
    expect(shares.a).toBeCloseTo(0.75)
    expect(shares.b).toBeCloseTo(0.25)
  })

  it('uses magnitude, so an opposing feature still shows its influence', () => {
    const shares = realizedShares([row('a', 0.2), row('b', -0.2)])
    expect(shares.a).toBeCloseTo(0.5)
    expect(shares.b).toBeCloseTo(0.5)
  })

  it('returns zero shares rather than NaN when nothing contributed', () => {
    const shares = realizedShares([row('a', 0), row('b', 0)])
    expect(shares.a).toBe(0)
    expect(shares.b).toBe(0)
  })

  it('represents a categorical value, which carries no derived band', () => {
    const categorical = { featureId: 'road_type', value: 'highway', band: null, r: 1, w: 0.2, contribution: 0.2 }
    expect(realizedShares([categorical]).road_type).toBe(1)
  })
})

describe('declaredShares', () => {
  it('normalizes declared weights to sum to 1', () => {
    const shares = declaredShares({ a: 0.3, b: 0.1 })
    expect(shares.a).toBeCloseTo(0.75)
    expect(shares.b).toBeCloseTo(0.25)
  })

  it('returns zero shares when every declared weight is zero', () => {
    expect(declaredShares({ a: 0, b: 0 })).toEqual({ a: 0, b: 0 })
  })
})

describe('intentVsEffect', () => {
  it('flags a feature whose evidence was unusually extreme here', () => {
    expect(intentVsEffect(0.6, 0.3)).toBe('up')
  })

  it('flags a feature that under-delivered against its declared share', () => {
    expect(intentVsEffect(0.1, 0.3)).toBe('down')
  })

  it('treats a small deviation as even', () => {
    expect(intentVsEffect(0.31, 0.30)).toBe('even')
  })

  it('is even when the declared share is zero and nothing was realized', () => {
    expect(intentVsEffect(0, 0)).toBe('even')
  })

  it('is up when something was realized from a zero declared share', () => {
    expect(intentVsEffect(0.2, 0)).toBe('up')
  })
})
