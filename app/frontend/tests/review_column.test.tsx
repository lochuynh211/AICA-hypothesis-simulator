import { render, screen, fireEvent, act } from '@testing-library/react'
import { vi, beforeEach } from 'vitest'
import React from 'react'
import ReviewColumn from '../src/components/review/ReviewColumn'
import { ReviewStoreProvider, useReviewStore } from '../src/state/reviewStore'
import type { ReviewAction } from '../src/state/reviewStore'
import { LanguageProvider } from '../src/state/language'
import { getCase } from '../src/lib/review/caseCatalog'
import type { MergedInstantResult } from '../src/api/mergedClient'

// Task 16 fix-round — the network boundary is mocked so persistence wiring
// (POST per judgement/assessment/comment, error surfacing, the no-run-yet
// no-op) can be proven without a real backend. Full replacement (not a
// partial `importOriginal` mock) mirrors `merged_center.test.tsx`'s own
// pattern — `ReviewColumn` only ever calls these two functions from the
// module at runtime; everything else it imports from here is type-only and
// erased, so nothing else needs a real implementation.
vi.mock('../src/api/mergedClient', () => ({
  postReviewFeedback: vi.fn(),
  getReviewFeedback: vi.fn(),
}))

import { postReviewFeedback, getReviewFeedback } from '../src/api/mergedClient'

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

// Same fire as `withFire`, plus a recorded service-selector step, so the
// SERVICE stage is available too (not just trigger) — needed to exercise a
// stage switch between two REAL stages rather than switching into/out of an
// always-unavailable one.
const withFireAndService = {
  fires: [{
    category: 'rest_required', strength: 'clear', tick: 20, time_min: 30,
    proposal: {
      evidence: [{
        step: 'service',
        output: {
          ranked_candidates: [
            { candidate_id: 'music_playlist', score: 0.9, feature_contributions: [
              { feature_id: 'oshi_affinity', feature_value: 1, response_coefficient: 1, weight: 1, contribution: 0.9 },
            ] },
            { candidate_id: 'radio_style', score: 0.4, feature_contributions: [
              { feature_id: 'oshi_affinity', feature_value: 0.4, response_coefficient: 1, weight: 1, contribution: 0.4 },
            ] },
          ],
        },
      }],
    },
    proposal_error: null,
    criteria: { threshold_suggest: 0.7 },
    feature_contributions: {
      rest_required: chain(0.72, [{ feature_id: 'fatigue', value: 0.8, weight: 0.3 }]),
      monotony_prevention: chain(0.55, [{ feature_id: 'monotony', value: 0.9, weight: 0.4 }]),
    },
  }],
} as unknown as MergedInstantResult

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

// ── Clear-on-switch invariant ────────────────────────────────────────────
//
// `SELECT_STAGE` (and `SELECT_CHECKPOINT`) must clear `compareLeftId`/
// `compareRightId`/`targetId` — a comparison chosen at one decision point is
// meaningless at another. This is named twice in the design constraints but,
// until now, rested entirely on code review with no regression test.

function DispatchCapture({ onReady }: { onReady: (dispatch: React.Dispatch<ReviewAction>) => void }) {
  const { dispatch } = useReviewStore()
  onReady(dispatch)
  return null
}

describe('ReviewColumn — clear-on-switch invariant', () => {
  it('reverts to the stage default rather than carrying an explicit comparison across a stage switch', () => {
    let dispatch: React.Dispatch<ReviewAction> | null = null
    render(
      <LanguageProvider initialLanguage="en">
        <ReviewStoreProvider>
          <DispatchCapture onReady={(d) => { dispatch = d }} />
          <ReviewColumn result={withFireAndService} />
        </ReviewStoreProvider>
      </LanguageProvider>,
    )

    // Sanity: the trigger stage opens on ITS default (the fired category
    // first, its counterpart second).
    expect((screen.getByTestId('compare-left') as HTMLSelectElement).value).toBe('rest_required')
    expect((screen.getByTestId('compare-right') as HTMLSelectElement).value).toBe('monotony_prevention')

    // Set an EXPLICIT, non-default comparison (the swapped order) directly
    // through the store, bypassing the picker — the trigger stage only ever
    // has these same two categories, so a UI-driven swap and a direct
    // dispatch land on the identical state.
    act(() => {
      dispatch!({ type: 'SET_COMPARISON', leftId: 'monotony_prevention', rightId: 'rest_required' })
    })
    expect((screen.getByTestId('compare-left') as HTMLSelectElement).value).toBe('monotony_prevention')

    // Switch to the (now available) service stage and back to trigger.
    fireEvent.click(screen.getByTestId('stage-tab-service'))
    fireEvent.click(screen.getByTestId('stage-tab-trigger'))

    // The comparison must have reverted to the trigger stage's OWN default —
    // not carried the swapped pair across either switch.
    expect((screen.getByTestId('compare-left') as HTMLSelectElement).value).toBe('rest_required')
    expect((screen.getByTestId('compare-right') as HTMLSelectElement).value).toBe('monotony_prevention')
  })
})

// ── Case-scoped empty-checkpoint outcome ─────────────────────────────────
//
// Nothing dispatches SELECT_CASE elsewhere in this suite, so the "this case
// is expected not to fire" branch (which interpolates the selected case's
// title into a sentence) was previously unexercised. `case-c01-alert-daytime
// -control` is the real committed control case that exists precisely to
// produce no fire (see `checkpoints.ts`'s own docstring).

describe('ReviewColumn — case-scoped empty checkpoints', () => {
  it('reads the empty rail as the expected outcome, naming the selected case, when one is picked', () => {
    const controlCase = getCase('case-c01-alert-daytime-control')
    // Guard the fixture itself: if the committed case file ever moves/renames,
    // this test must fail loudly here rather than silently asserting nothing.
    expect(controlCase).not.toBeNull()

    let dispatch: React.Dispatch<ReviewAction> | null = null
    render(
      <LanguageProvider initialLanguage="en">
        <ReviewStoreProvider>
          <DispatchCapture onReady={(d) => { dispatch = d }} />
          <ReviewColumn result={{ fires: [] } as unknown as MergedInstantResult} />
        </ReviewStoreProvider>
      </LanguageProvider>,
    )
    expect(screen.getByTestId('no-checkpoints')).toBeTruthy()

    act(() => {
      dispatch!({ type: 'SELECT_CASE', caseId: 'case-c01-alert-daytime-control' })
    })

    const message = screen.getByTestId('no-checkpoints')
    expect(message.textContent ?? '').toContain(controlCase!.title.en)
  })
})

// ── Persistence wiring (Task 16 fix round) ───────────────────────────────
//
// A failed POST must surface an error, never fail silently, and a comment
// must be committed on BLUR — not on every keystroke — since the
// review-feedback store is append-only (two records on the same field
// append rather than replace). `flush()` drains the microtask queue inside
// `act()` so the async continuation after `await postReviewFeedback(...)`
// (the `setPersistError` call) is applied before assertions run, with no
// stray "not wrapped in act(...)" warning.

const flush = () => act(async () => {
  await Promise.resolve()
  await Promise.resolve()
})

const mountWithRun = (mergedRunId: string | null) =>
  render(
    <LanguageProvider initialLanguage="en">
      <ReviewStoreProvider>
        <ReviewColumn result={withFire} mergedRunId={mergedRunId} />
      </ReviewStoreProvider>
    </LanguageProvider>,
  )

describe('ReviewColumn — persistence', () => {
  beforeEach(() => {
    vi.mocked(postReviewFeedback).mockReset().mockResolvedValue(undefined)
    vi.mocked(getReviewFeedback).mockReset().mockResolvedValue({
      events: [],
      package_versions: {
        trigger: { id: null, version: null },
        service: { id: null, version: null },
        content: { id: null, version: null },
      },
    })
  })

  it('posts exactly one review_input record per judgement', async () => {
    mountWithRun('mrun-1')
    fireEvent.change(screen.getByTestId('rationale-judge-fatigue'), { target: { value: 'too_strong' } })
    await flush()
    expect(postReviewFeedback).toHaveBeenCalledTimes(1)
    expect(postReviewFeedback).toHaveBeenCalledWith(
      'mrun-1',
      expect.objectContaining({ scope: 'review_input', feature_id: 'fatigue', labels: { judgment: 'too_strong' } }),
    )
  })

  it('posts exactly one review_decision record per assessment click', async () => {
    mountWithRun('mrun-1')
    fireEvent.click(screen.getByTestId('assess-appropriate'))
    await flush()
    expect(postReviewFeedback).toHaveBeenCalledTimes(1)
    expect(postReviewFeedback).toHaveBeenCalledWith(
      'mrun-1',
      expect.objectContaining({ scope: 'review_decision', labels: { assessment: 'appropriate' } }),
    )
  })

  // The regression test for the per-keystroke bug: written to fail against
  // the pre-fix wiring (which called `persist()` from `onComment`, i.e. on
  // every `onChange`) and confirmed failing there (see task-16-report.md's
  // fix report for the RED run) before the blur-commit fix made it pass.
  it('posts exactly ONE review_decision record for a completed comment, never one per keystroke', async () => {
    mountWithRun('mrun-1')
    const textarea = screen.getByTestId('assess-comment')
    fireEvent.focus(textarea)
    fireEvent.change(textarea, { target: { value: 'e' } })
    fireEvent.change(textarea, { target: { value: 'ex' } })
    fireEvent.change(textarea, { target: { value: 'exp' } })
    fireEvent.change(textarea, { target: { value: 'expected rest' } })
    fireEvent.blur(textarea)
    await flush()
    expect(postReviewFeedback).toHaveBeenCalledTimes(1)
    expect(postReviewFeedback).toHaveBeenCalledWith(
      'mrun-1',
      expect.objectContaining({ scope: 'review_decision', comment: 'expected rest' }),
    )
  })

  it('does not post when the comment field is blurred without an edit', async () => {
    mountWithRun('mrun-1')
    const textarea = screen.getByTestId('assess-comment')
    fireEvent.focus(textarea)
    fireEvent.blur(textarea)
    await flush()
    expect(postReviewFeedback).not.toHaveBeenCalled()
  })

  it('renders the error notice when a POST is rejected', async () => {
    vi.mocked(postReviewFeedback).mockRejectedValueOnce(new Error('network down'))
    mountWithRun('mrun-1')
    fireEvent.click(screen.getByTestId('assess-appropriate'))
    await flush()
    expect(screen.getByTestId('review-feedback-error')).toBeTruthy()
    expect(screen.getByTestId('review-feedback-error').getAttribute('role')).toBe('alert')
  })

  it('clears a prior error once a later POST succeeds', async () => {
    vi.mocked(postReviewFeedback).mockRejectedValueOnce(new Error('network down'))
    mountWithRun('mrun-1')
    fireEvent.click(screen.getByTestId('assess-appropriate'))
    await flush()
    expect(screen.getByTestId('review-feedback-error')).toBeTruthy()

    fireEvent.click(screen.getByTestId('assess-not-sure'))
    await flush()
    expect(screen.queryByTestId('review-feedback-error')).toBeNull()
  })

  it('attempts no POST and shows the persistence-begins-later note when no merged run exists yet', async () => {
    mountWithRun(null)
    expect(screen.getByTestId('assess-no-run-yet')).toBeTruthy()
    fireEvent.click(screen.getByTestId('assess-appropriate'))
    await flush()
    expect(postReviewFeedback).not.toHaveBeenCalled()
  })
})
