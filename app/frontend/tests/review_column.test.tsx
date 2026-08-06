import { render, screen, fireEvent, act, cleanup } from '@testing-library/react'
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
// pattern — `ReviewColumn` only ever calls this function from the module at
// runtime; everything else it imports from here is type-only and erased, so
// nothing else needs a real implementation.
vi.mock('../src/api/mergedClient', () => ({
  postReviewFeedback: vi.fn(),
}))

import { postReviewFeedback } from '../src/api/mergedClient'

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

/** `showParameterRationale` is OFF in the app (owner review hid the per-input
 *  table) but the judgement wiring it drives is still live and still exported,
 *  so tests that exercise that wiring switch it on explicitly. */
const mount = (result: MergedInstantResult | null, showParameterRationale = false) =>
  render(
    <LanguageProvider>
      <ReviewStoreProvider>
        <ReviewColumn result={result} showParameterRationale={showParameterRationale} />
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

/** A fire whose proposal recorded a CONTENT plan, so the content stage has two
 *  comparable items. */
const withFireAndContent = {
  fires: [{
    category: 'rest_required', strength: 'clear', tick: 20, time_min: 30,
    proposal: {
      evidence: [{
        step: 'content',
        output: {
          ordered_items: [
            { item_id: 'track-1', item_fit: 0.81, feature_contributions: [
              { feature_id: 'song_arousal', e_i: 0.7, a_i: 1, effective_weight: 1, contribution: 0.7 },
            ] },
            { item_id: 'track-2', item_fit: 0.62, feature_contributions: [
              { feature_id: 'song_arousal', e_i: 0.5, a_i: 1, effective_weight: 1, contribution: 0.5 },
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
    // The comparison itself is the evidence; the scale-bound and threshold
    // notes that used to prove this were removed as support info.
    expect(screen.getByTestId('what-decided-it')).toBeTruthy()
    expect(screen.getAllByTestId('margin-row').length).toBeGreaterThan(0)
  })

  it('shows no firing-threshold note', () => {
    mount(withFire)
    expect(screen.queryByTestId('threshold-note')).toBeNull()
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

  it('shows the verdict card — not an explanation — when the run produced no fire', () => {
    mount({ fires: [] } as unknown as MergedInstantResult)
    expect(screen.queryByTestId('no-checkpoints')).toBeNull()
    expect(screen.getByTestId('stage-feedback-panel')).toBeTruthy()
  })

  it('shows the verdict card before any run exists', () => {
    mount(null)
    expect(screen.queryByTestId('no-checkpoints')).toBeNull()
    expect(screen.getByTestId('stage-feedback-panel')).toBeTruthy()
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
    mount(withFire, true)
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
  it('renders English stage-tab and field labels under initialLanguage="en"', () => {
    render(
      <LanguageProvider initialLanguage="en">
        <ReviewStoreProvider>
          <ReviewColumn result={withFire} />
        </ReviewStoreProvider>
      </LanguageProvider>,
    )
    expect(screen.getByTestId('stage-tab-trigger')).toHaveTextContent('Firing decision')
    expect(screen.getByTestId('stage-tab-service')).toHaveTextContent('Service')
    expect(screen.getByTestId('stage-tab-content')).toHaveTextContent('Content')
    // Field labels are names now, not the raw variable ids or prose fragments.
    expect(screen.getByTestId('what-decided-it')).toHaveTextContent('Fatigue')
  })

  it('renders no stray English prose in the Japanese UI', () => {
    render(
      <LanguageProvider initialLanguage="ja">
        <ReviewStoreProvider>
          <ReviewColumn result={withFire} />
        </ReviewStoreProvider>
      </LanguageProvider>,
    )
    // Stage tabs read in Japanese, not the English labels — and in the
    // SPECIFICATION's Japanese: the decision event is 発火, never トリガー.
    expect(screen.getByTestId('stage-tab-trigger')).toHaveTextContent('発火判定')
    expect(screen.getByTestId('stage-tab-trigger')).not.toHaveTextContent('トリガー')
    expect(screen.getByTestId('what-decided-it')).toHaveTextContent('疲労')
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

// ── No fire is still reviewable ──────────────────────────────────────────
//
// `case-c01-alert-daytime-control` is the real committed control case that
// exists precisely to produce no fire (see `checkpoints.ts`'s own docstring).
// The reviewer still owes a verdict on it — was NOT firing the right call? —
// so the column shows the verdict card and NOTHING else: no evidence tabs
// (there is no decision to decompose), and no sentence from the app asserting
// what the absence of a fire means.

const mountNoFire = (result: MergedInstantResult | null, mergedRunId: string | null = null) =>
  render(
    <LanguageProvider initialLanguage="en">
      <ReviewStoreProvider>
        <SelectCase caseId="case-c01-alert-daytime-control" />
        <ReviewColumn result={result} mergedRunId={mergedRunId} />
      </ReviewStoreProvider>
    </LanguageProvider>,
  )

const noFireResult = { fires: [] } as unknown as MergedInstantResult

describe('ReviewColumn — no fire is still reviewable', () => {
  beforeEach(() => {
    vi.mocked(postReviewFeedback).mockReset().mockResolvedValue(undefined)
  })

  it('asserts nothing about what the empty rail means', () => {
    const controlCase = getCase('case-c01-alert-daytime-control')
    // Guard the fixture itself: if the committed case file ever moves/renames,
    // this test must fail loudly here rather than silently asserting nothing.
    expect(controlCase).not.toBeNull()

    mountNoFire(noFireResult)
    const column = screen.getByTestId('review-column')
    expect(column.textContent ?? '').not.toContain('expected outcome')
    expect(column.textContent ?? '').not.toContain('designed to produce no firing')
  })

  it('shows no evidence tabs when there is no decision to decompose', () => {
    mountNoFire(noFireResult)
    expect(screen.queryByTestId('stage-tab-trigger')).toBeNull()
    expect(screen.queryByTestId('compare-left')).toBeNull()
  })

  it('still names the case the verdict is filed against', () => {
    const controlCase = getCase('case-c01-alert-daytime-control')
    mountNoFire(noFireResult)
    expect(screen.getByTestId('feedback-case-name')).toHaveTextContent(controlCase!.title.en)
  })

  it('keeps the firing decision assessable, and only that one', () => {
    mountNoFire(noFireResult)
    expect(screen.getByTestId('verdicts-trigger')).toBeTruthy()
    expect(screen.getByTestId('assess-comment-trigger')).toBeTruthy()
    expect(screen.queryByTestId('verdicts-service')).toBeNull()
    expect(screen.queryByTestId('verdicts-content')).toBeNull()
    expect(screen.getByTestId('feedback-unavailable-service')).toBeTruthy()
    expect(screen.getByTestId('feedback-unavailable-content')).toBeTruthy()
  })

  it('records the no-fire verdict against a no_fire decision point', async () => {
    mountNoFire(noFireResult, 'mrun-nofire')
    fireEvent.click(screen.getByTestId('assess-trigger-not-appropriate'))
    await flush()
    expect(postReviewFeedback).toHaveBeenCalledWith(
      'mrun-nofire',
      expect.objectContaining({
        scope: 'review_decision',
        case_id: 'case-c01-alert-daytime-control',
        checkpoint_id: 'no_fire',
        stage: 'trigger',
        review_target: 'no_fire',
        labels: { assessment: 'not_appropriate' },
      }),
    )
  })

  it('leaves even the firing decision unassessable before any run exists', () => {
    // No run means nothing has been decided yet — an absent fire is not the
    // same fact as a run that produced none, and only the latter is judgeable.
    mountNoFire(null)
    expect(screen.queryByTestId('verdicts-trigger')).toBeNull()
    expect(screen.getByTestId('feedback-unavailable-trigger')).toBeTruthy()
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

/** Feedback is filed per test case, so a case must be selected for any of it to
 *  be recordable. Pass `caseId: null` to exercise the no-case gate. */
function SelectCase({ caseId }: { caseId: string | null }) {
  const { dispatch } = useReviewStore()
  const done = React.useRef(false)
  if (!done.current) {
    done.current = true
    if (caseId) dispatch({ type: 'SELECT_CASE', caseId })
  }
  return null
}

const mountWithRun = (
  mergedRunId: string | null,
  caseId: string | null = 'case-c01-alert-daytime-control',
  showParameterRationale = false,
) =>
  render(
    <LanguageProvider initialLanguage="en">
      <ReviewStoreProvider>
        <SelectCase caseId={caseId} />
        <ReviewColumn
          result={withFire}
          mergedRunId={mergedRunId}
          showParameterRationale={showParameterRationale}
        />
      </ReviewStoreProvider>
    </LanguageProvider>,
  )

describe('ReviewColumn — persistence', () => {
  beforeEach(() => {
    vi.mocked(postReviewFeedback).mockReset().mockResolvedValue(undefined)
  })

  it('posts exactly one review_input record per judgement', async () => {
    mountWithRun('mrun-1', 'case-c01-alert-daytime-control', true)
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
    fireEvent.click(screen.getByTestId('assess-trigger-appropriate'))
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
    const textarea = screen.getByTestId('assess-comment-trigger')
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
    const textarea = screen.getByTestId('assess-comment-trigger')
    fireEvent.focus(textarea)
    fireEvent.blur(textarea)
    await flush()
    expect(postReviewFeedback).not.toHaveBeenCalled()
  })

  it('renders the error notice when a POST is rejected', async () => {
    vi.mocked(postReviewFeedback).mockRejectedValueOnce(new Error('network down'))
    mountWithRun('mrun-1')
    fireEvent.click(screen.getByTestId('assess-trigger-appropriate'))
    await flush()
    expect(screen.getByTestId('review-feedback-error')).toBeTruthy()
    expect(screen.getByTestId('review-feedback-error').getAttribute('role')).toBe('alert')
  })

  it('clears a prior error once a later POST succeeds', async () => {
    vi.mocked(postReviewFeedback).mockRejectedValueOnce(new Error('network down'))
    mountWithRun('mrun-1')
    fireEvent.click(screen.getByTestId('assess-trigger-appropriate'))
    await flush()
    expect(screen.getByTestId('review-feedback-error')).toBeTruthy()

    fireEvent.click(screen.getByTestId('assess-trigger-not-sure'))
    await flush()
    expect(screen.queryByTestId('review-feedback-error')).toBeNull()
  })

  it('attempts no POST and shows the persistence-begins-later note when no merged run exists yet', async () => {
    mountWithRun(null)
    expect(screen.getByTestId('assess-no-run-yet')).toBeTruthy()
    fireEvent.click(screen.getByTestId('assess-trigger-appropriate'))
    await flush()
    expect(postReviewFeedback).not.toHaveBeenCalled()
  })
})

// ── All three stages judged at once (owner review) ──────────────────────────
// The verdict used to live under whichever stage tab was open, so recording an
// opinion about the service meant leaving the trigger's. A reviewer forms all
// three together; these assert they can be recorded that way.
describe('ReviewColumn — stage feedback panel', () => {
  beforeEach(() => {
    vi.mocked(postReviewFeedback).mockReset().mockResolvedValue(undefined)
  })

  it('sits ABOVE the stage tabs', () => {
    mountWithRun('mrun-1')
    const panel = screen.getByTestId('stage-feedback-panel')
    const tab = screen.getByTestId('stage-tab-trigger')
    // compareDocumentPosition: FOLLOWING means `tab` comes after `panel`.
    expect(panel.compareDocumentPosition(tab) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('offers a row per stage, each with the three verdicts', () => {
    mountWithRun('mrun-1')
    for (const stage of ['trigger', 'service', 'content']) {
      expect(screen.getByTestId(`feedback-row-${stage}`)).toBeTruthy()
    }
    // Trigger always has recorded evidence in this fixture.
    expect(screen.getByTestId('assess-trigger-appropriate')).toBeTruthy()
    expect(screen.getByTestId('assess-trigger-not-appropriate')).toBeTruthy()
    expect(screen.getByTestId('assess-trigger-not-sure')).toBeTruthy()
  })

  it('records each stage against its OWN target, without switching tabs', async () => {
    mountWithRun('mrun-1')

    fireEvent.click(screen.getByTestId('assess-trigger-appropriate'))
    await flush()
    fireEvent.click(screen.getByTestId('assess-trigger-not-appropriate'))
    await flush()

    // Two independent records, both for the trigger stage, and the second is
    // the changed verdict — not a duplicate of the first.
    expect(postReviewFeedback).toHaveBeenCalledTimes(2)
    expect(postReviewFeedback).toHaveBeenNthCalledWith(
      1, 'mrun-1',
      expect.objectContaining({ stage: 'trigger', labels: { assessment: 'appropriate' } }),
    )
    expect(postReviewFeedback).toHaveBeenNthCalledWith(
      2, 'mrun-1',
      expect.objectContaining({ stage: 'trigger', labels: { assessment: 'not_appropriate' } }),
    )
  })

  it('keeps each stage’s verdict separate — judging one leaves the others unset', async () => {
    mountWithRun('mrun-1')
    fireEvent.click(screen.getByTestId('assess-trigger-appropriate'))
    await flush()

    expect(screen.getByTestId('assess-trigger-appropriate').getAttribute('aria-pressed')).toBe('true')
    // A stage with no recorded evidence renders its reason instead of buttons;
    // either way it must NOT have inherited the trigger's verdict.
    const serviceRow = screen.getByTestId('feedback-row-service')
    const servicePressed = serviceRow.querySelectorAll('[aria-pressed="true"]')
    expect(servicePressed).toHaveLength(0)
  })

  it('says why a stage cannot be judged instead of offering buttons for nothing', () => {
    mountWithRun('mrun-1')
    // `withFire` carries no proposal, so service/content have no evidence.
    expect(screen.getByTestId('feedback-unavailable-service')).toBeTruthy()
    expect(screen.queryByTestId('assess-service-appropriate')).toBeNull()
  })
})

// ── Right-panel refinements (owner review) ──────────────────────────────────
describe('ReviewColumn — feedback panel refinements', () => {
  beforeEach(() => {
    vi.mocked(postReviewFeedback).mockReset().mockResolvedValue(undefined)
  })

  it('leaves the right column ONE scroll container', () => {
    // The panel used to be `position: sticky`, which read as a second scroller
    // over the evidence. `.right-panel` owns the scrolling; nothing inside the
    // review column may scroll on its own.
    mountWithRun('mrun-1')
    const panel = screen.getByTestId('stage-feedback-panel')
    expect(panel.style.position).not.toBe('sticky')
    expect(panel.style.position).not.toBe('fixed')

    const column = screen.getByTestId('review-column')
    const scrollers = Array.from(column.querySelectorAll<HTMLElement>('*')).filter(
      (el) => el.style.overflowY === 'auto' || el.style.overflowY === 'scroll',
    )
    expect(scrollers).toHaveLength(0)
  })

  it('gives the comment box room to write in', () => {
    mountWithRun('mrun-1')
    const textarea = screen.getByTestId('assess-comment-trigger') as HTMLTextAreaElement
    expect(textarea.rows).toBe(6)
  })

  it('right-aligns the three verdict buttons', () => {
    mountWithRun('mrun-1')
    expect(screen.getByTestId('verdicts-trigger').style.marginLeft).toBe('auto')
  })
})

describe('ReviewColumn — feedback needs a test case', () => {
  beforeEach(() => {
    vi.mocked(postReviewFeedback).mockReset().mockResolvedValue(undefined)
  })

  it('disables the verdicts and says a test case must be chosen', async () => {
    mountWithRun('mrun-1', null)
    expect(screen.getByTestId('feedback-needs-case')).toBeTruthy()
    expect(screen.getByTestId('assess-trigger-appropriate')).toBeDisabled()
    expect(screen.getByTestId('assess-comment-trigger')).toBeDisabled()

    fireEvent.click(screen.getByTestId('assess-trigger-appropriate'))
    await flush()
    expect(postReviewFeedback).not.toHaveBeenCalled()
  })
})

describe('ReviewColumn — per-case feedback summary + Markdown export', () => {
  beforeEach(() => {
    vi.mocked(postReviewFeedback).mockReset().mockResolvedValue(undefined)
  })

  it('opens a popup listing every test case and its feedback', () => {
    mountWithRun('mrun-1')
    fireEvent.click(screen.getByTestId('open-feedback-summary'))

    expect(screen.getByTestId('feedback-summary-modal')).toBeTruthy()
    // Every VISIBLE case is listed, covered or not (the C-cases are hidden from
    // the picker and the summary alike now — see caseCatalog's VISIBLE_CASE_ORDER).
    expect(screen.getByTestId('summary-case-case-uc01-01-oshikatsu-c')).toBeTruthy()
    expect(screen.getByTestId('summary-case-case-uc03-01-monotony-a')).toBeTruthy()
    expect(screen.getByTestId('summary-empty-case-uc01-01-oshikatsu-c')).toBeTruthy()
    expect(screen.getByTestId('feedback-coverage').textContent).toContain('0')
  })

  it('downloads the Markdown report when asked', () => {
    const createObjectURL = vi.fn().mockReturnValue('blob:report')
    const revokeObjectURL = vi.fn()
    // jsdom implements neither.
    Object.defineProperty(URL, 'createObjectURL', { value: createObjectURL, writable: true })
    Object.defineProperty(URL, 'revokeObjectURL', { value: revokeObjectURL, writable: true })
    const clicks: string[] = []
    const realClick = HTMLAnchorElement.prototype.click
    HTMLAnchorElement.prototype.click = function () { clicks.push(this.download) }

    try {
      mountWithRun('mrun-1')
      fireEvent.click(screen.getByTestId('export-review-markdown'))

      expect(createObjectURL).toHaveBeenCalledTimes(1)
      const blob = createObjectURL.mock.calls[0][0] as Blob
      expect(blob.type).toBe('text/markdown')
      expect(clicks).toEqual(['aica-review-feedback.md'])
      expect(revokeObjectURL).toHaveBeenCalledWith('blob:report')
    } finally {
      HTMLAnchorElement.prototype.click = realClick
    }
  })
})

// ── Right-panel round 2 (owner review) ──────────────────────────────────────
describe('ReviewColumn — panel header and editable summary', () => {
  // A VISIBLE case: this block records a verdict against the selected case and
  // then asserts its row appears in the summary popup, which lists only visible
  // cases (`listCases()`). A hidden C-case would record fine but never show a
  // popup row — see caseCatalog's VISIBLE_CASE_ORDER.
  const C1 = 'case-uc01-01-oshikatsu-c'

  beforeEach(() => {
    vi.mocked(postReviewFeedback).mockReset().mockResolvedValue(undefined)
  })

  it('names the test case the verdict is filed against, read-only', () => {
    mountWithRun('mrun-1', C1)
    const name = screen.getByTestId('feedback-case-name')
    expect(name.textContent).toBeTruthy()
    // Read-only: no control inside it.
    expect(name.querySelectorAll('button, input, select, textarea')).toHaveLength(0)
  })

  it('says no case is selected rather than showing a blank line', () => {
    mountWithRun('mrun-1', null)
    expect(screen.getByTestId('feedback-case-name').textContent).toContain('no test case selected')
  })

  it('drops the judged/total count from the rows', () => {
    mountWithRun('mrun-1', C1)
    expect(screen.queryByTestId('feedback-summary-trigger')).toBeNull()
    expect(screen.queryByTestId('feedback-summary-service')).toBeNull()
    expect(screen.queryByTestId('feedback-summary-content')).toBeNull()
  })

  it('lets a recorded verdict be changed from the popup', async () => {
    mountWithRun('mrun-1', C1)
    // Record something first, so the popup has a row to edit.
    fireEvent.click(screen.getByTestId('assess-trigger-appropriate'))
    await flush()
    vi.mocked(postReviewFeedback).mockClear()

    fireEvent.click(screen.getByTestId('open-feedback-summary'))
    fireEvent.click(screen.getByTestId(`summary-assess-${C1}-trigger-not_appropriate`))
    await flush()

    expect(postReviewFeedback).toHaveBeenCalledTimes(1)
    expect(postReviewFeedback).toHaveBeenCalledWith(
      'mrun-1',
      expect.objectContaining({
        case_id: C1,
        stage: 'trigger',
        labels: { assessment: 'not_appropriate' },
      }),
    )
    // The popup reflects the change without reopening.
    expect(screen.getByTestId(`summary-verdict-${C1}-trigger`).textContent).toContain('Not appropriate')
  })

  it('persists a popup comment ONCE on blur, never per keystroke', async () => {
    mountWithRun('mrun-1', C1)
    fireEvent.click(screen.getByTestId('assess-trigger-appropriate'))
    await flush()
    vi.mocked(postReviewFeedback).mockClear()

    fireEvent.click(screen.getByTestId('open-feedback-summary'))
    const box = screen.getByTestId(`summary-comment-${C1}-trigger`)
    fireEvent.focus(box)
    fireEvent.change(box, { target: { value: 'r' } })
    fireEvent.change(box, { target: { value: 're' } })
    fireEvent.change(box, { target: { value: 'rethought' } })
    await flush()
    // Still nothing posted — the store is append-only.
    expect(postReviewFeedback).not.toHaveBeenCalled()

    fireEvent.blur(box)
    await flush()
    expect(postReviewFeedback).toHaveBeenCalledTimes(1)
    expect(postReviewFeedback).toHaveBeenCalledWith(
      'mrun-1',
      expect.objectContaining({ case_id: C1, comment: 'rethought' }),
    )
  })

  it('offers no editing for a case with nothing recorded, and says why', () => {
    mountWithRun('mrun-1', C1)
    fireEvent.click(screen.getByTestId('open-feedback-summary'))

    const other = 'case-uc03-01-monotony-a'
    expect(screen.getByTestId(`summary-empty-${other}`).textContent).toContain('select this case')
    expect(screen.queryByTestId(`summary-assess-${other}-trigger-appropriate`)).toBeNull()
  })
})

// ── Prototype styling (owner review 1A/1C) ──────────────────────────────────
describe('ReviewColumn — prototype styling', () => {
  const C1 = 'case-c01-alert-daytime-control'

  it('gives each section the shared card + accent header', () => {
    mountWithRun('mrun-1', C1)
    expect(screen.getByTestId('stage-feedback-panel').className).toContain('review-card')
    expect(screen.getByTestId('what-decided-it').className).toContain('review-card')
    // The header class is what makes every section start the same way.
    const header = screen.getByTestId('what-decided-it').querySelector('.review-card-h')
    expect(header).not.toBeNull()
  })

  it('renders the stage tabs as one equal-width tab strip', () => {
    mountWithRun('mrun-1', C1)
    const strip = screen.getByTestId('stage-tab-trigger').parentElement!
    expect(strip.className).toContain('stage-tabs')
    // The active tab is marked by class, not by an ad-hoc inline border.
    expect(screen.getByTestId('stage-tab-trigger').className).toContain('on')
    expect(screen.getByTestId('stage-tab-service').className).not.toContain('on')
  })

  it('colour-codes the chosen verdict', () => {
    mountWithRun('mrun-1', C1)
    fireEvent.click(screen.getByTestId('assess-trigger-not-appropriate'))
    expect(screen.getByTestId('assess-trigger-not-appropriate').className).toContain('bad')
    expect(screen.getByTestId('assess-trigger-appropriate').className).not.toContain('good')
  })

  it('hides the parameter-rationale table by default, without removing it', () => {
    mountWithRun('mrun-1', C1)
    expect(screen.queryByTestId('parameter-rationale')).toBeNull()

    // Still fully functional behind the switch — this is a hidden view, not
    // deleted code.
    cleanup()
    mountWithRun('mrun-1', C1, true)
    expect(screen.getByTestId('parameter-rationale')).toBeTruthy()
  })
})

// ── Option labels read as names, not ids (owner review) ─────────────────────
describe('ReviewColumn — readable option labels', () => {
  it('names the service instead of showing its id', () => {
    render(
      <LanguageProvider initialLanguage="en">
        <ReviewStoreProvider>
          <ReviewColumn result={withFireAndService} />
        </ReviewStoreProvider>
      </LanguageProvider>,
    )
    fireEvent.click(screen.getByTestId('stage-tab-service'))
    const left = screen.getByTestId('compare-left') as HTMLSelectElement
    const labels = Array.from(left.options).map((o) => o.textContent)
    // The specification's own name for this service (CDC-SU_specplan Slides
    // 39/41/70: プレイリスト再生), not the catalog identifier.
    expect(labels.some((l) => l?.includes('Playlist playback'))).toBe(true)
    expect(labels.some((l) => l?.includes('music_playlist'))).toBe(false)
  })

  it('names the song, WITHOUT its catalog id, when song names are known', () => {
    render(
      <LanguageProvider initialLanguage="en">
        <ReviewStoreProvider>
          <ReviewColumn
            result={withFireAndContent}
            songNames={{ 'track-1': 'Jessica', 'track-2': 'Nightfall' }}
          />
        </ReviewStoreProvider>
      </LanguageProvider>,
    )
    fireEvent.click(screen.getByTestId('stage-tab-content'))
    const left = screen.getByTestId('compare-left') as HTMLSelectElement
    const labels = Array.from(left.options).map((o) => o.textContent)
    expect(labels).toContain('Jessica')
    // The catalog track id is the key the evidence is stored under, not a
    // name — it stays out of the label entirely.
    expect(labels.some((l) => l?.includes('track-1'))).toBe(false)
  })

  it('says the song is unnamed when the catalog does not know it', () => {
    // Better an honest "we have no name for this" than a name borrowed from
    // another dataset — and better than the raw catalog id, which is a
    // variable name the reviewer cannot act on.
    render(
      <LanguageProvider initialLanguage="en">
        <ReviewStoreProvider>
          <ReviewColumn result={withFireAndContent} songNames={{}} />
        </ReviewStoreProvider>
      </LanguageProvider>,
    )
    fireEvent.click(screen.getByTestId('stage-tab-content'))
    const left = screen.getByTestId('compare-left') as HTMLSelectElement
    const labels = Array.from(left.options).map((o) => o.textContent)
    expect(labels).toContain('Unnamed track')
    expect(labels.some((l) => l?.includes('track-1'))).toBe(false)
  })
})

describe('ReviewColumn — edited-case label', () => {
  const C1 = 'case-c01-alert-daytime-control'

  it('says the setup was edited, so a verdict is never filed against a case that only looks verbatim', () => {
    render(
      <LanguageProvider initialLanguage="en">
        <ReviewStoreProvider>
          <SelectCase caseId={C1} />
          <ReviewColumn result={withFire} mergedRunId="mrun-1" caseModified />
        </ReviewStoreProvider>
      </LanguageProvider>,
    )
    expect(screen.getByTestId('case-modified')).toHaveTextContent('setup edited')
  })

  it('shows no such label while the setup still matches the case', () => {
    render(
      <LanguageProvider initialLanguage="en">
        <ReviewStoreProvider>
          <SelectCase caseId={C1} />
          <ReviewColumn result={withFire} mergedRunId="mrun-1" />
        </ReviewStoreProvider>
      </LanguageProvider>,
    )
    expect(screen.queryByTestId('case-modified')).toBeNull()
  })
})
