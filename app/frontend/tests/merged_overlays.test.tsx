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
  it('renders both ranked candidates with a Choose button; clicking one calls onChoose with its candidate_id', () => {
    const onChoose = vi.fn()
    render(
      <ServiceResultOverlay
        output={{ decision_type: 'ranked_candidates', ranked_candidates: candidates() }}
        eligibleCandidates={[]}
        excludedCandidates={[]}
        activeServiceId={null}
        choosingId={null}
        onChoose={onChoose}
        explanationProvider="off"
        lang="en"
      />,
    )

    expect(screen.getByTestId('candidate-card-live_viewing')).toBeInTheDocument()
    expect(screen.getByTestId('candidate-card-stretch_video')).toBeInTheDocument()
    expect(screen.getByTestId('choose-candidate-live_viewing')).toBeInTheDocument()
    expect(screen.getByTestId('choose-candidate-stretch_video')).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('choose-candidate-stretch_video'))
    expect(onChoose).toHaveBeenCalledWith('stretch_video')
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
