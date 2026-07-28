import { deriveCheckpoints } from '../src/lib/review/checkpoints'
import type { MergedInstantResult } from '../src/api/mergedClient'

const fire = (category: string, tick: number, timeMin: number) =>
  ({ category, strength: 'clear', tick, time_min: timeMin, proposal: null, proposal_error: null }) as never

const result = (fires: unknown[]) => ({ fires } as unknown as MergedInstantResult)

describe('deriveCheckpoints', () => {
  it('takes the FIRST fire of each in-scope category', () => {
    const cps = deriveCheckpoints(result([
      fire('rest_required', 10, 12), fire('rest_required', 40, 48), fire('monotony_prevention', 60, 70),
    ]))
    expect(cps.map((c) => c.category)).toEqual(['rest_required', 'monotony_prevention'])
    expect(cps[0].tick).toBe(10)
  })

  it('orders checkpoints by time, not by category', () => {
    const cps = deriveCheckpoints(result([
      fire('monotony_prevention', 20, 25), fire('rest_required', 50, 60),
    ]))
    expect(cps.map((c) => c.category)).toEqual(['monotony_prevention', 'rest_required'])
  })

  it('ignores every out-of-scope category', () => {
    expect(deriveCheckpoints(result([fire('route_music', 10, 12)]))).toEqual([])
  })

  it('returns an empty rail for a run that never fires', () => {
    // C-01 is the control case: nothing firing is the POINT, not an error.
    expect(deriveCheckpoints(result([]))).toEqual([])
  })

  it('returns an empty rail before any run exists', () => {
    expect(deriveCheckpoints(null)).toEqual([])
  })

  it('keeps the fire index so the proposal can be found', () => {
    const cps = deriveCheckpoints(result([fire('monotony_prevention', 20, 25), fire('rest_required', 50, 60)]))
    expect(cps.find((c) => c.category === 'rest_required')!.fireIndex).toBe(1)
  })

  it('gives every checkpoint a stable id and a bilingual label', () => {
    const cps = deriveCheckpoints(result([fire('rest_required', 10, 12)]))
    expect(cps[0].id).toBe('rest_required')
    expect(cps[0].label.ja).not.toBe(cps[0].label.en)
  })
})
