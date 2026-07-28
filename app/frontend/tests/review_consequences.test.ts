// app/frontend/tests/review_consequences.test.ts
import { necessity, flipDistance, playedNoPart } from '../src/lib/review/reviewMath'
import type { ReviewOption } from '../src/lib/review/types'

const row = (featureId: string, w: number, value: number) => ({
  featureId, value, band: null, r: 1, w, contribution: w * value,
})

const opt = (id: string, rows: ReturnType<typeof row>[]): ReviewOption => ({
  id, label: id, score: rows.reduce((a, r) => a + r.contribution, 0), rows,
})

// Winner leans on fatigue; runner-up leans on monotony.
const winner = opt('rest_required', [row('fatigue', 0.5, 1.0), row('monotony', 0.1, 0.2)])
const runnerUp = opt('monotony_prevention', [row('monotony', 0.4, 0.9), row('fatigue', 0.1, 0.1)])

describe('necessity', () => {
  it('reports the alternative winning when the decisive feature is removed', () => {
    const result = necessity(winner, runnerUp, 'fatigue')
    expect('available' in result).toBe(false)
    expect(result).toMatchObject({ winnerId: 'monotony_prevention', changed: true })
  })

  it('reports the same winner when a minor feature is removed', () => {
    expect(necessity(winner, runnerUp, 'monotony')).toMatchObject({
      winnerId: 'rest_required', changed: false,
    })
  })

  it('redistributes the masked weight rather than shrinking the option', () => {
    // With fatigue masked, its 0.5 weight spreads over monotony, whose value is
    // 0.2 — so the option keeps a score instead of collapsing to nothing.
    const single = opt('a', [row('x', 0.5, 1.0), row('y', 0.5, 0.4)])
    const other = opt('b', [row('z', 0.5, 0.5)])
    expect(necessity(single, other, 'x')).toMatchObject({ winnerId: 'a' })
  })

  it('is unavailable for a feature that is not in the chain', () => {
    expect(necessity(winner, runnerUp, 'nonexistent')).toMatchObject({ available: false })
  })

  it('is unavailable when the option has no other feature to absorb the weight', () => {
    const lonely = opt('a', [row('only', 0.5, 1.0)])
    expect(necessity(lonely, runnerUp, 'only')).toMatchObject({ available: false })
  })
})

describe('flipDistance', () => {
  it('finds the factor at which the outcome changes', () => {
    // Boosting monotony on the runner-up eventually overtakes the winner.
    const result = flipDistance(winner, runnerUp, 'monotony')
    expect(result).not.toBeNull()
    expect((result as { factor: number }).factor).toBeGreaterThan(1)
  })

  it('re-scores BOTH sides, since a feature can appear on each', () => {
    // monotony sits on both options, so a naive one-sided rescale would report
    // a flip that cannot happen.
    const result = flipDistance(winner, runnerUp, 'monotony') as { factor: number }
    const scaled = (o: ReviewOption, f: number) =>
      o.rows.reduce((a, r) => a + (r.featureId === 'monotony' ? r.contribution * f : r.contribution), 0)
    expect(scaled(runnerUp, result.factor)).toBeGreaterThanOrEqual(scaled(winner, result.factor) - 1e-3)
  })

  it('returns null when no flip exists in the bounded range', () => {
    const dominant = opt('a', [row('x', 0.9, 1.0), row('tiny', 0.001, 0.001)])
    const weak = opt('b', [row('y', 0.05, 0.1)])
    expect(flipDistance(dominant, weak, 'tiny')).toBeNull()
  })

  it('is unavailable for a feature absent from both chains', () => {
    expect(flipDistance(winner, runnerUp, 'nope')).toMatchObject({ available: false })
  })
})

describe('playedNoPart', () => {
  it('names inputs below the 2 percent realized share', () => {
    const rows = [row('big', 1.0, 1.0), row('trace', 0.001, 0.001), row('zero', 0.5, 0)]
    expect(playedNoPart(rows).sort()).toEqual(['trace', 'zero'])
  })

  it('excludes a feature at or above the threshold', () => {
    expect(playedNoPart([row('a', 1, 1), row('b', 1, 0.5)])).toEqual([])
  })

  it('names every input when nothing contributed at all', () => {
    expect(playedNoPart([row('a', 1, 0), row('b', 1, 0)]).sort()).toEqual(['a', 'b'])
  })

  it('honours an explicit threshold', () => {
    const rows = [row('a', 1, 1), row('b', 1, 0.05)]
    expect(playedNoPart(rows, 0.1)).toEqual(['b'])
  })
})
