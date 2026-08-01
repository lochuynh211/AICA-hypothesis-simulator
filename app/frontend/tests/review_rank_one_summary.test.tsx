/**
 * RankOneSummary (feature 025, slice S7) — the RIGHT panel's "why this won"
 * sentence for all three review tabs, mounted through `ReviewColumn` (an
 * integration test, matching `tests/review_column.test.tsx`'s own pattern)
 * since the summary is wired through the column's stage/comparison state,
 * not a standalone prop surface.
 *
 * `postReviewFeedback`/`getReviewFeedback` are stubbed exactly like
 * `review_column.test.tsx` does — this file never exercises feedback
 * persistence, only the summary block and the trigger comparison fix.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import ReviewColumn from '../src/components/review/ReviewColumn'
import { ReviewStoreProvider } from '../src/state/reviewStore'
import { LanguageProvider } from '../src/state/language'
import type { MergedInstantResult } from '../src/api/mergedClient'
import { TRIGGER_THRESHOLD_OPTION_ID } from '../src/lib/review/chains'
import { __clearExplanationCache } from '../src/components/proposal/useExplanation'

vi.mock('../src/api/mergedClient', () => ({
  postReviewFeedback: vi.fn(),
  getReviewFeedback: vi.fn(),
}))

// `explainInline` (service/content's own "identical contract" path) is
// stubbed alongside `explainTrigger` — not because these tests care about its
// AI output, but so a 'backend'/'browser' provider never makes a REAL
// `fetch()` to a relative URL (unsupported outside a browser document) while
// exercising the always-visible BAKED rationale underneath. It resolves to
// the SAME text the baked `rationale` already carries, so whichever of the
// two branches `RationaleText` is currently in (loading → ready), the
// asserted text converges to one value instead of racing a transient
// "generating…" placeholder.
vi.mock('../src/api/proposalClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/api/proposalClient')>()
  return { ...actual, explainTrigger: vi.fn(), explainInline: vi.fn() }
})

import { explainTrigger, explainInline } from '../src/api/proposalClient'
const explainTriggerMock = explainTrigger as unknown as ReturnType<typeof vi.fn>
const explainInlineMock = explainInline as unknown as ReturnType<typeof vi.fn>

const chain = (score: number, rows: { feature_id: string; value: number; weight: number }[]) => ({
  score, clamped: false, gates: [],
  rows: rows.map((r) => ({ ...r, band: null, contribution: r.value * r.weight })),
})

const mount = (result: MergedInstantResult | null, explanationProvider?: 'off' | 'backend' | 'browser') =>
  render(
    <LanguageProvider initialLanguage="en">
      <ReviewStoreProvider>
        <ReviewColumn result={result} explanationProvider={explanationProvider} />
      </ReviewStoreProvider>
    </LanguageProvider>,
  )

/** One fire wired for all three tabs: trigger evidence, plus a service and a
 *  content step (each with a rank-1 candidate/item carrying a baked
 *  `rationale`, exactly the shape `RankedCandidate`/`OrderedItem` records). */
const FULL_FIRE = {
  category: 'rest_required',
  strength: 'clear',
  tick: 20,
  time_min: 30,
  criteria: { threshold_fire: 100, threshold_monotony: 60 },
  feature_contributions: {
    rest_required: chain(105, [{ feature_id: 'fatigue', value: 0.8, weight: 0.3 }]),
    monotony_prevention: chain(105, [{ feature_id: 'monotony', value: 0.9, weight: 0.4 }]),
  },
  proposal_error: null,
  proposal: {
    run_id: 'prun-full-1',
    evidence: [
      {
        step: 'service',
        output: {
          ranked_candidates: [
            {
              candidate_id: 'music_playlist',
              score: 0.9,
              rationale: ['一位のテンプレ理由', 'Top-rank template rationale'],
              feature_contributions: [
                { feature_id: 'oshi_affinity', feature_value: 1, response_coefficient: 1, weight: 1, contribution: 0.9 },
              ],
            },
            {
              candidate_id: 'radio_style',
              score: 0.4,
              rationale: ['二位のテンプレ理由', 'Second-rank template rationale'],
              feature_contributions: [
                { feature_id: 'oshi_affinity', feature_value: 0.4, response_coefficient: 1, weight: 1, contribution: 0.4 },
              ],
            },
          ],
        },
      },
      {
        step: 'content',
        output: {
          ordered_items: [
            {
              item_id: 'track-1',
              item_fit: 0.81,
              rationale: ['一曲目のテンプレ理由', 'First-track template rationale'],
              feature_contributions: [
                { feature_id: 'song_arousal', e_i: 0.7, a_i: 1, effective_weight: 1, contribution: 0.7 },
              ],
            },
            {
              item_id: 'track-2',
              item_fit: 0.62,
              rationale: ['二曲目のテンプレ理由', 'Second-track template rationale'],
              feature_contributions: [
                { feature_id: 'song_arousal', e_i: 0.5, a_i: 1, effective_weight: 1, contribution: 0.5 },
              ],
            },
          ],
        },
      },
    ],
  },
}

const fullResult = { fires: [FULL_FIRE] } as unknown as MergedInstantResult

const TEMPLATE_TRIGGER_RESPONSE = {
  step: 'trigger',
  target_id: 'rest_required',
  requested_provider: 'backend',
  rationale: ['休憩しきい値を超えて発火。', 'Fired above the rest threshold.'],
  provider_used: 'backend',
  model: 'qwen2.5:3b',
  fell_back: false,
  error: null,
  prompt: { messages: [], grounding: {} },
}

describe('RankOneSummary — a sentence on all three tabs', () => {
  beforeEach(() => {
    // `useExplanation`'s cache is a MODULE-level map (feature 019, deliberate
    // — it survives remounts within a session) — cleared here so one test's
    // resolved cache entry never short-circuits the NEXT test's `request()`
    // before it can reach the (freshly-reset) mock.
    __clearExplanationCache()
    explainTriggerMock.mockReset().mockResolvedValue(TEMPLATE_TRIGGER_RESPONSE)
    // The AI overlay is not what this describe block is testing for
    // service/content (the ALWAYS-VISIBLE baked template is) — a fast,
    // deterministic rejection settles the hook to 'error' quickly, so the
    // baked-rationale fallback is what's asserted on rather than racing the
    // transient "generating…" state.
    explainInlineMock.mockReset().mockRejectedValue(new Error('not exercised here'))
  })

  it('renders a rank-1 summary sentence for trigger, service and content', async () => {
    mount(fullResult, 'backend')

    // Trigger tab is the default; its sentence arrives async (a real fetch).
    await waitFor(() =>
      expect(screen.getByTestId('rank-one-summary-trigger')).toHaveTextContent('Fired above the rest threshold.'),
    )

    fireEvent.click(screen.getByTestId('stage-tab-service'))
    await waitFor(() =>
      expect(screen.getByTestId('rank-one-summary-service')).toHaveTextContent('Top-rank template rationale'),
    )

    fireEvent.click(screen.getByTestId('stage-tab-content'))
    await waitFor(() =>
      expect(screen.getByTestId('rank-one-summary-content')).toHaveTextContent('First-track template rationale'),
    )
  })

  it('calls the explain-trigger endpoint with the fire and the fired category', async () => {
    mount(fullResult, 'backend')
    await waitFor(() => expect(explainTriggerMock).toHaveBeenCalledTimes(1))
    const [firePassed, args] = explainTriggerMock.mock.calls[0]
    expect(firePassed).toMatchObject({ category: 'rest_required', tick: 20, time_min: 30 })
    expect(args).toEqual({ category: 'rest_required', provider: 'backend' })
  })

  it('shows the AI badge and a fell-back note for trigger, exactly as service/content do', async () => {
    explainTriggerMock.mockResolvedValue({
      ...TEMPLATE_TRIGGER_RESPONSE,
      rationale: ['既定文言', 'default wording'],
      provider_used: 'template',
      fell_back: true,
      error: 'unreachable',
    })
    mount(fullResult, 'backend')
    await waitFor(() => expect(screen.getByTestId('rank-one-summary-trigger')).toHaveTextContent('default wording'))
    const summary = screen.getByTestId('rank-one-summary-trigger')
    expect(summary.querySelector('[data-testid="ai-rationale-badge"]')).toBeTruthy()
    expect(summary.querySelector('[data-testid="ai-fellback-note"]')).toBeTruthy()
  })

  it('shows the deterministic template sentence for trigger when the provider is off, unbadged — feature 025 slice S11', async () => {
    // Trigger has no BAKED rationale of its own the way service/content do
    // (see the module docstring), so when the reviewer's explanation
    // provider is 'off' `useExplanation` requests the backend's template
    // DIRECTLY (`provider: 'template'`, never an LLM) instead of rendering
    // nothing — this is the exact gap the customer reported (SLICE S11).
    explainTriggerMock.mockResolvedValue({
      ...TEMPLATE_TRIGGER_RESPONSE,
      requested_provider: 'template',
      rationale: ['休憩しきい値を超えて発火。', 'Fired above the rest threshold.'],
      provider_used: 'template',
      fell_back: false,
      error: null,
    })
    mount(fullResult, 'off')
    await waitFor(() =>
      expect(screen.getByTestId('rank-one-summary-trigger')).toHaveTextContent('Fired above the rest threshold.'),
    )
    const summary = screen.getByTestId('rank-one-summary-trigger')
    // No AI badge/provenance chrome — this is the deterministic template, not
    // an AI-generated sentence, exactly like service/content's own baked
    // rationale renders unbadged when the provider is off (see the sibling
    // test just below).
    expect(summary.querySelector('[data-testid="ai-rationale-badge"]')).toBeNull()
    expect(summary.querySelector('[data-testid="ai-fellback-note"]')).toBeNull()
    expect(explainTriggerMock).toHaveBeenCalledWith(
      expect.objectContaining({ category: 'rest_required' }),
      { category: 'rest_required', provider: 'template' },
    )
  })

  it('still shows the baked template sentence for service/content, unbadged, when the provider is off', () => {
    mount(fullResult, 'off')
    fireEvent.click(screen.getByTestId('stage-tab-service'))
    const serviceSummary = screen.getByTestId('rank-one-summary-service')
    expect(serviceSummary).toHaveTextContent('Top-rank template rationale')
    expect(serviceSummary.querySelector('[data-testid="ai-rationale-badge"]')).toBeNull()

    fireEvent.click(screen.getByTestId('stage-tab-content'))
    const contentSummary = screen.getByTestId('rank-one-summary-content')
    expect(contentSummary).toHaveTextContent('First-track template rationale')
    expect(contentSummary.querySelector('[data-testid="ai-rationale-badge"]')).toBeNull()
  })

  it('does not repeat the per-feature rows — that stays WhatDecidedIt’s job', () => {
    mount(fullResult, 'off')
    fireEvent.click(screen.getByTestId('stage-tab-service'))
    const serviceSummary = screen.getByTestId('rank-one-summary-service')
    expect(serviceSummary.querySelector('[data-testid="margin-row"]')).toBeNull()
  })
})

// ── NRI degenerate tie vs. the hybrid's genuine score gap ───────────────────
describe('RankOneSummary — the trigger comparison’s right-hand side', () => {
  it('compares the fired category against the THRESHOLD when NRI’s two categories tie in score', async () => {
    const tiedResult = {
      fires: [
        {
          category: 'rest_required',
          strength: 'clear',
          tick: 20,
          time_min: 30,
          proposal: null,
          proposal_error: null,
          criteria: { threshold_fire: 100, threshold_monotony: 60 },
          feature_contributions: {
            rest_required: chain(105, [{ feature_id: 'fatigue', value: 0.8, weight: 0.3 }]),
            monotony_prevention: chain(105, [{ feature_id: 'monotony', value: 0.9, weight: 0.4 }]),
          },
        },
      ],
    } as unknown as MergedInstantResult

    mount(tiedResult)
    expect((screen.getByTestId('compare-left') as HTMLSelectElement).value).toBe('rest_required')
    expect((screen.getByTestId('compare-right') as HTMLSelectElement).value).toBe(TRIGGER_THRESHOLD_OPTION_ID)
    // The threshold reads as product vocabulary, never the raw identifier.
    expect(screen.getByTestId('compare-right')).toHaveTextContent('Firing threshold')
    // This mount uses the default (unpassed) `explanationProvider`, i.e.
    // 'off' — which now still fires a (mocked) trigger fetch (feature 025,
    // slice S11). Flushed here purely so the resulting state update lands
    // inside `act(...)`, not because this test cares about its content.
    await waitFor(() => expect(explainTriggerMock).toHaveBeenCalled())
  })

  it('keeps comparing category vs. category when the hybrid fire’s two scores genuinely differ', async () => {
    const hybridResult = {
      fires: [
        {
          category: 'rest_required',
          strength: 'clear',
          tick: 5,
          time_min: 8,
          proposal: null,
          proposal_error: null,
          criteria: { threshold_suggest: 0.7, monotony_suggest_threshold: 0.5 },
          feature_contributions: {
            rest_required: chain(0.82, [{ feature_id: 'fatigue', value: 0.8, weight: 0.3 }]),
            monotony_prevention: chain(0.4, [{ feature_id: 'monotony', value: 0.5, weight: 0.4 }]),
          },
        },
      ],
    } as unknown as MergedInstantResult

    mount(hybridResult)
    expect((screen.getByTestId('compare-left') as HTMLSelectElement).value).toBe('rest_required')
    expect((screen.getByTestId('compare-right') as HTMLSelectElement).value).toBe('monotony_prevention')
    // Same flush as the sibling test above — the default 'off' provider
    // still fires a (mocked) trigger fetch now; wait for it to settle inside
    // `act(...)` rather than leaving it pending past the test body.
    await waitFor(() => expect(explainTriggerMock).toHaveBeenCalled())
  })
})
