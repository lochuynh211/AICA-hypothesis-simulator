/**
 * ServiceResultOverlay / ContentResultOverlay (020 Task 10) — the docked
 * proposal result views for the Combined Simulator, extracted from the
 * RESULT regions of ServiceProposalPanel / ContentProposalPanel. Pure
 * presentational components (props only, no store coupling).
 */
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { ServiceResultOverlay } from '../src/components/merged/ServiceResultOverlay'
import { ContentResultOverlay } from '../src/components/merged/ContentResultOverlay'
import type { RankedCandidate, CompletePlan } from '../src/api/proposalClient'

function candidates(): RankedCandidate[] {
  return [
    {
      rank: 1,
      candidate_id: 'live_viewing',
      score: 0.77,
      rationale: ['一位の理由', 'Top rank rationale'],
      supporting_feature_ids: [],
      opposing_feature_ids: [],
      uncertainty: null,
      feature_contributions: [],
    },
    {
      rank: 2,
      candidate_id: 'stretch_video',
      score: 0.45,
      rationale: ['二位の理由', 'Second rank rationale'],
      supporting_feature_ids: [],
      opposing_feature_ids: [],
      uncertainty: null,
      feature_contributions: [],
    },
  ]
}

function plan(): CompletePlan {
  return {
    decision_type: 'complete_plan',
    selected_service_id: 'music_playlist',
    requested_item_count: 3,
    returned_item_count: 3,
    ordered_items: [
      {
        position: 1,
        item_id: 'track-1',
        item_fit: 0.81,
        trait_values: null,
        feature_contributions: [],
        rationale: ['一曲目', 'first track'],
      },
      {
        position: 2,
        item_id: 'track-2',
        item_fit: 0.74,
        trait_values: null,
        feature_contributions: [],
        rationale: ['二曲目', 'second track'],
      },
      {
        position: 3,
        item_id: 'track-3',
        item_fit: 0.6,
        trait_values: null,
        feature_contributions: [],
        rationale: ['三曲目', 'third track'],
      },
    ],
    mode: {
      service_id: 'music_playlist',
      mode_kind: 'playlist',
      chorus_only: null,
      guide_vocal: null,
      driving_lyrics: null,
      fixed_segment_sec: null,
      stopped_only: null,
      simulated_queue: null,
    },
    expected_duration_sec: 900,
    lighting_configuration: null,
    approval_policy: 'explicit_opt_in',
    completion_rule: 'plan_exhausted',
    next_transition_policy: 'await_user',
    excluded_items: [],
    unused_available_features: [],
    missing_features: [],
    algorithm_provenance: {},
  }
}

describe('ServiceResultOverlay', () => {
  it('renders both ranked candidates; Choose is live only for a service V1 supports', () => {
    const onChoose = vi.fn()
    render(
      <ServiceResultOverlay
        output={{ decision_type: 'ranked_candidates', ranked_candidates: candidates() }}
        eligibleCandidates={[]}
        activeServiceId={null}
        choosingId={null}
        onChoose={onChoose}
        explanationProvider="off"
        lang="en"
      />,
    )

    // Every candidate is still shown and still explains itself — a reviewer
    // needs to see why an unsupported service ranked where it did.
    expect(screen.getByTestId('candidate-card-live_viewing')).toBeInTheDocument()
    expect(screen.getByTestId('candidate-card-stretch_video')).toBeInTheDocument()

    // …but only music_playlist / humming_karaoke / full_karaoke can be chosen
    // in V1; neither of these is one of them.
    expect(screen.getByTestId('choose-candidate-stretch_video')).toBeDisabled()
    fireEvent.click(screen.getByTestId('choose-candidate-stretch_video'))
    expect(onChoose).not.toHaveBeenCalled()
    expect(screen.getByTestId('out-of-scope-stretch_video')).toHaveTextContent('not supported in V1')
  })

  it('lets a supported service be chosen', () => {
    const onChoose = vi.fn()
    const supported = candidates()
    supported[0].candidate_id = 'music_playlist'
    render(
      <ServiceResultOverlay
        output={{ decision_type: 'ranked_candidates', ranked_candidates: supported }}
        eligibleCandidates={[]}
        activeServiceId={null}
        choosingId={null}
        onChoose={onChoose}
        explanationProvider="off"
        lang="en"
      />,
    )

    fireEvent.click(screen.getByTestId('choose-candidate-music_playlist'))
    expect(onChoose).toHaveBeenCalledWith('music_playlist')
  })

  it('shows the eligible services as one row of tags, with no excluded list', () => {
    render(
      <ServiceResultOverlay
        output={{ decision_type: 'ranked_candidates', ranked_candidates: candidates() }}
        eligibleCandidates={[{ candidate_id: 'music_playlist' }, { candidate_id: 'full_karaoke' }]}
        activeServiceId={null}
        choosingId={null}
        onChoose={() => {}}
        explanationProvider="off"
        lang="en"
      />,
    )

    expect(screen.getByTestId('eligible-music_playlist')).toBeInTheDocument()
    expect(screen.getByTestId('eligible-full_karaoke')).toBeInTheDocument()
    expect(screen.queryByTestId('excluded-list')).not.toBeInTheDocument()
  })
})

describe('ContentResultOverlay', () => {
  it('renders all 3 ordered plan items with their song names', () => {
    render(
      <ContentResultOverlay
        plan={plan()}
        songNames={{ 'track-1': 'Jessica', 'track-2': 'Nightfall', 'track-3': 'Horizon' }}
        explanationProvider="off"
        lang="en"
      />,
    )

    expect(screen.getByTestId('plan-item-track-1')).toHaveTextContent('Jessica')
    expect(screen.getByTestId('plan-item-track-2')).toHaveTextContent('Nightfall')
    expect(screen.getByTestId('plan-item-track-3')).toHaveTextContent('Horizon')
  })
})

// ── Card section order (owner review) ───────────────────────────────────────
// Subtotals → feature trace → why. The "why" disclosure is the row a reviewer
// picks AFTER seeing the numbers, so it must come last; it used to be first.
describe('card section order', () => {
  function orderOf(card: HTMLElement, testids: string[]): string[] {
    const found = testids
      .map((id) => ({ id, el: card.querySelector(`[data-testid="${id}"]`) }))
      .filter((x): x is { id: string; el: Element } => x.el !== null)
    // Sort by document position within the card.
    return found
      .sort((a, b) =>
        a.el.compareDocumentPosition(b.el) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1,
      )
      .map((x) => x.id)
  }

  it('service card: explainability (subtotals + trace) before the why disclosure', () => {
    const enriched = candidates()
    enriched[0].situation_fit = 0.5
    enriched[0].preference_fit = 0.2
    enriched[0].history_fit = 0.1
    render(
      <ServiceResultOverlay
        output={{ decision_type: 'ranked_candidates', ranked_candidates: enriched }}
        eligibleCandidates={[]}
        activeServiceId={null}
        choosingId={null}
        onChoose={() => {}}
        explanationProvider="off"
        lang="en"
      />,
    )

    const card = screen.getByTestId('candidate-card-live_viewing')
    expect(orderOf(card, ['reason-summary', 'service-explainability'])).toEqual([
      'service-explainability',
      'reason-summary',
    ])
    // And the safety-priority readout is gone for good.
    expect(card.querySelector('[data-testid="service-dominance"]')).toBeNull()
  })

  it('content card: explainability before the why disclosure', () => {
    const enrichedPlan = plan()
    enrichedPlan.ordered_items[0].situation_fit = 0.4
    enrichedPlan.ordered_items[0].preference_fit = 0.3
    enrichedPlan.ordered_items[0].history_fit = 0.2
    render(
      <ContentResultOverlay
        plan={enrichedPlan}
        songNames={{}}
        explanationProvider="off"
        lang="en"
      />,
    )

    const card = screen.getByTestId('plan-item-track-1')
    expect(orderOf(card, ['reason-summary', 'content-explainability'])).toEqual([
      'content-explainability',
      'reason-summary',
    ])
  })

  it('content card: the raw fit shows 3 decimals and no 0-100 band', () => {
    render(
      <ContentResultOverlay plan={plan()} songNames={{}} explanationProvider="off" lang="en" />,
    )
    const card = screen.getByTestId('plan-item-track-1')
    expect(card.textContent).toContain('+0.810')
    expect(card.querySelector('[data-testid="fit-band-track-1"]')).toBeNull()
    expect(card.textContent).not.toMatch(/\/100/)
  })
})
