import { guidedState, stepPosition, isMusicService } from '../src/components/merged/guidedSteps'
import type { ProposalRunLog } from '../src/api/proposalClient'

const log = (over: Record<string, unknown> = {}): ProposalRunLog =>
  ({
    opportunity: { opportunity_id: 'opp-1', trigger_purpose: 'rest_recommended' },
    journey_state: { lifecycle_stage: 'before_rest_until_stop', active_service_id: null },
    evidence: [],
    ...over,
  }) as unknown as ProposalRunLog

describe('guidedState — rest flow', () => {
  it('opens on the rest recommendation', () => {
    const s = guidedState({ proposalLog: log(), restDecided: false, hasContentPlan: false })
    expect(s.step).toBe('rest')
    expect(s.isRestFlow).toBe(true)
  })

  it('moves to the service proposal once the rest is decided', () => {
    const s = guidedState({ proposalLog: log(), restDecided: true, hasContentPlan: false })
    expect(s.step).toBe('service')
  })

  it('moves to the songs once a music service is running', () => {
    const s = guidedState({
      proposalLog: log({
        journey_state: { lifecycle_stage: 'before_rest_until_stop', active_service_id: 'music_playlist' },
      }),
      restDecided: true,
      hasContentPlan: true,
    })
    expect(s.step).toBe('content')
  })

  it('ends after a service that has no songs, instead of showing an empty list', () => {
    const s = guidedState({
      proposalLog: log({
        journey_state: { lifecycle_stage: 'before_rest_until_stop', active_service_id: 'quiz' },
      }),
      restDecided: true,
      hasContentPlan: true,
    })
    expect(s.step).toBe('done')
  })

  it('does not claim a content step before the plan is recorded', () => {
    // The overlay must never show a step the evidence does not support.
    const s = guidedState({
      proposalLog: log({
        journey_state: { lifecycle_stage: 'before_rest_until_stop', active_service_id: 'music_playlist' },
      }),
      restDecided: true,
      hasContentPlan: false,
    })
    expect(s.step).toBe('done')
  })
})

describe('guidedState — monotony flow', () => {
  const monotony = (activeServiceId: string | null) =>
    log({
      opportunity: { opportunity_id: 'opp-2', trigger_purpose: 'monotony_prevention' },
      journey_state: { lifecycle_stage: 'active_driving_content', active_service_id: activeServiceId },
    })

  it('has no rest step — it opens on the service', () => {
    const s = guidedState({ proposalLog: monotony(null), restDecided: false, hasContentPlan: false })
    expect(s.step).toBe('service')
    expect(s.isRestFlow).toBe(false)
  })

  it('then shows the content', () => {
    const s = guidedState({ proposalLog: monotony('music_playlist'), restDecided: false, hasContentPlan: true })
    expect(s.step).toBe('content')
  })
})

describe('guidedState — nothing to guide', () => {
  it('is done when no proposal has been recorded', () => {
    expect(guidedState({ proposalLog: null, restDecided: false, hasContentPlan: false }).step).toBe('done')
  })
})

describe('stepPosition', () => {
  it('counts three steps for a rest flow and two for a monotony one', () => {
    expect(stepPosition('rest', true)).toEqual({ index: 1, total: 3 })
    expect(stepPosition('content', true)).toEqual({ index: 3, total: 3 })
    expect(stepPosition('service', false)).toEqual({ index: 1, total: 2 })
    expect(stepPosition('content', false)).toEqual({ index: 2, total: 2 })
  })
})

describe('isMusicService', () => {
  it('covers exactly the three services V1 can deliver songs for', () => {
    expect(isMusicService('music_playlist')).toBe(true)
    expect(isMusicService('humming_karaoke')).toBe(true)
    expect(isMusicService('full_karaoke')).toBe(true)
    expect(isMusicService('quiz')).toBe(false)
    expect(isMusicService(null)).toBe(false)
  })
})
