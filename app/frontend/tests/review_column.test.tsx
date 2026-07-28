import { render, screen, fireEvent } from '@testing-library/react'
import ReviewColumn from '../src/components/review/ReviewColumn'
import { ReviewStoreProvider } from '../src/state/reviewStore'
import { LanguageProvider } from '../src/state/language'
import type { MergedInstantResult } from '../src/api/mergedClient'

const chain = (score: number, rows: { feature_id: string; value: number; weight: number }[]) => ({
  score, clamped: false, gates: [],
  rows: rows.map((r) => ({ ...r, band: null, contribution: r.value * r.weight })),
})

const withFire = {
  fires: [{
    category: 'rest_required', strength: 'clear', tick: 20, time_min: 30,
    proposal: null, proposal_error: null,
    criteria: { threshold_suggest: 0.7 },
    feature_contributions: {
      rest_required: chain(0.72, [{ feature_id: 'fatigue', value: 0.8, weight: 0.3 }]),
      monotony_prevention: chain(0.55, [{ feature_id: 'monotony', value: 0.9, weight: 0.4 }]),
    },
  }],
} as unknown as MergedInstantResult

const mount = (result: MergedInstantResult | null) =>
  render(
    <LanguageProvider>
      <ReviewStoreProvider>
        <ReviewColumn result={result} />
      </ReviewStoreProvider>
    </LanguageProvider>,
  )

describe('ReviewColumn', () => {
  it('offers the three stage tabs', () => {
    mount(withFire)
    expect(screen.getByTestId('stage-tab-trigger')).toBeTruthy()
    expect(screen.getByTestId('stage-tab-service')).toBeTruthy()
    expect(screen.getByTestId('stage-tab-content')).toBeTruthy()
  })

  it('opens on the trigger stage with both categories compared', () => {
    mount(withFire)
    expect(screen.getByTestId('margin-scale-bound')).toBeTruthy()
  })

  it('shows the firing threshold under the pickers', () => {
    mount(withFire)
    expect(screen.getByTestId('threshold-note')).toHaveTextContent('0.7')
  })

  it('disables a stage with no recorded evidence, and says why', () => {
    mount(withFire)   // this fire has no proposal at all
    const serviceTab = screen.getByTestId('stage-tab-service') as HTMLButtonElement
    expect(serviceTab.disabled).toBe(true)
    expect(serviceTab.title.length).toBeGreaterThan(0)
  })

  it('leaves a stage with recorded evidence enabled', () => {
    // Sibling to "disables a stage with no recorded evidence": without this,
    // an implementation that hard-codes every tab disabled would still pass
    // every other test in this file.
    mount(withFire)
    const triggerTab = screen.getByTestId('stage-tab-trigger') as HTMLButtonElement
    expect(triggerTab.disabled).toBe(false)
  })

  it('suppresses the consequence sections on the trigger stage', () => {
    mount(withFire)
    expect(screen.queryByTestId('different-setting')).toBeNull()
  })

  it('says so when the run produced no reviewable decision point', () => {
    mount({ fires: [] } as unknown as MergedInstantResult)
    expect(screen.getByTestId('no-checkpoints')).toBeTruthy()
  })

  it('says so before any run exists', () => {
    mount(null)
    expect(screen.getByTestId('no-checkpoints')).toBeTruthy()
  })

  it('reports the trigger stage unavailable when the package recorded no chain', () => {
    const bare = {
      fires: [{ category: 'rest_required', strength: null, tick: 1, time_min: 1,
                proposal: null, proposal_error: null, feature_contributions: {}, criteria: {} }],
    } as unknown as MergedInstantResult
    mount(bare)
    expect(screen.getByTestId('comparison-unavailable')).toBeTruthy()
  })

  it('keeps a judgement scoped to its decision point', () => {
    mount(withFire)
    fireEvent.change(screen.getByTestId('rationale-judge-fatigue'), { target: { value: 'too_strong' } })
    expect((screen.getByTestId('rationale-judge-fatigue') as HTMLSelectElement).value).toBe('too_strong')
  })
})

// ── Language coverage ────────────────────────────────────────────────────
//
// `LanguageProvider` defaults to Japanese. Every assertion above is
// testid/numeric-based and so passes in either language, which is exactly
// how the previous task's raw-English-in-JA regression slipped through 821
// green tests. These two tests pin actual rendered prose in each language.

describe('ReviewColumn — language coverage', () => {
  it('renders English stage-tab labels and threshold text under initialLanguage="en"', () => {
    render(
      <LanguageProvider initialLanguage="en">
        <ReviewStoreProvider>
          <ReviewColumn result={withFire} />
        </ReviewStoreProvider>
      </LanguageProvider>,
    )
    expect(screen.getByTestId('stage-tab-trigger')).toHaveTextContent('Trigger')
    expect(screen.getByTestId('stage-tab-service')).toHaveTextContent('Service')
    expect(screen.getByTestId('stage-tab-content')).toHaveTextContent('Content')
    expect(screen.getByTestId('threshold-note')).toHaveTextContent('Firing threshold')
  })

  it('renders no stray English prose in the Japanese UI', () => {
    render(
      <LanguageProvider initialLanguage="ja">
        <ReviewStoreProvider>
          <ReviewColumn result={withFire} />
        </ReviewStoreProvider>
      </LanguageProvider>,
    )
    // Stage tabs read in Japanese, not the English labels.
    expect(screen.getByTestId('stage-tab-trigger')).toHaveTextContent('トリガー')
    expect(screen.getByTestId('threshold-note')).toHaveTextContent('発火しきい値')
    // No two consecutive lowercase English words (>=4 letters each) anywhere
    // in the column — the shape raw embedded English prose takes, as opposed
    // to a lone feature id or CSS-safe token.
    const column = screen.getByTestId('review-column')
    expect(column.textContent ?? '').not.toMatch(/[a-z]{4,}\s+[a-z]{4,}/)
  })

  it('states the unavailable reason in Japanese, not the raw English literal, under JA', () => {
    const bare = {
      fires: [{ category: 'rest_required', strength: null, tick: 1, time_min: 1,
                proposal: null, proposal_error: null, feature_contributions: {}, criteria: {} }],
    } as unknown as MergedInstantResult
    render(
      <LanguageProvider initialLanguage="ja">
        <ReviewStoreProvider>
          <ReviewColumn result={bare} />
        </ReviewStoreProvider>
      </LanguageProvider>,
    )
    const unavailable = screen.getByTestId('comparison-unavailable')
    expect(unavailable.textContent ?? '').not.toContain('this trigger package recorded no per-feature contributions')
  })
})
