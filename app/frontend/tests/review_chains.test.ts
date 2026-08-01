import { triggerOptions, serviceOptions, contentOptions, TRIGGER_THRESHOLD_OPTION_ID } from '../src/lib/review/chains'
import type { ProposalRunLog, AlgorithmEvidence } from '../src/api/proposalClient'

const chainRow = (feature_id: string, value: number, weight: number) => ({
  feature_id, value, band: null, weight, contribution: value * weight,
})

const fireWith = (chain: unknown) => ({ feature_contributions: chain, criteria: {} }) as never

describe('triggerOptions', () => {
  const fire = fireWith({
    rest_required: { score: 0.72, clamped: false, gates: [], rows: [chainRow('fatigue', 0.8, 0.2)] },
    monotony_prevention: { score: 0.55, clamped: false, gates: [], rows: [chainRow('monotony', 0.9, 0.4)] },
  })

  it('returns BOTH categories as comparable options', () => {
    const options = triggerOptions(fire)
    expect(Array.isArray(options)).toBe(true)
    expect((options as { id: string }[]).map((o) => o.id).sort())
      .toEqual(['monotony_prevention', 'rest_required'])
  })

  it('uses the RECORDED score, not the sum of contributions', () => {
    const options = triggerOptions(fire) as { id: string; score: number }[]
    expect(options.find((o) => o.id === 'rest_required')!.score).toBe(0.72)
  })

  it('sets r=1, since the trigger has no response coefficient', () => {
    const options = triggerOptions(fire) as { rows: { r: number }[] }[]
    expect(options[0].rows[0].r).toBe(1)
  })

  it('propagates the clamped flag so the panel can say shares will not reconcile', () => {
    const clamped = fireWith({
      rest_required: { score: 1.0, clamped: true, gates: [], rows: [chainRow('fatigue', 1, 1.5)] },
      monotony_prevention: { score: 0.1, clamped: false, gates: [], rows: [] },
    })
    const options = triggerOptions(clamped) as { id: string; clamped?: boolean }[]
    expect(options.find((o) => o.id === 'rest_required')!.clamped).toBe(true)
  })

  it('is unavailable when the package recorded no contributions', () => {
    expect(triggerOptions(fireWith({}))).toMatchObject({ available: false })
  })

  it('is unavailable when the fire predates the recording change', () => {
    expect(triggerOptions({} as never)).toMatchObject({ available: false })
  })
})

// ── NRI degenerate-tie synthetic threshold option (feature 025, S7) ─────────
//
// NRI publishes ONE score banded by TWO thresholds, so its two categories
// always carry the IDENTICAL score — a real category-vs-category margin is
// vacuous there. `triggerOptions` appends a synthetic THRESHOLD option in
// that case; the hybrid package's two categories genuinely differ, so it
// never appears for a hybrid fire.
describe('triggerOptions — NRI degenerate-tie threshold option', () => {
  it('appends a synthetic THRESHOLD option, scored at the fired category’s own line, when both categories tie', () => {
    const tied = {
      category: 'rest_required',
      criteria: { threshold_fire: 100, threshold_monotony: 60 },
      feature_contributions: {
        rest_required: { score: 105, clamped: false, gates: [], rows: [chainRow('fatigue', 0.8, 0.2)] },
        monotony_prevention: { score: 105, clamped: false, gates: [], rows: [chainRow('monotony', 0.9, 0.4)] },
      },
    } as never
    const options = triggerOptions(tied) as { id: string; score: number; rows: unknown[] }[]
    expect(options.map((o) => o.id).sort()).toEqual(
      ['monotony_prevention', 'rest_required', TRIGGER_THRESHOLD_OPTION_ID].sort(),
    )
    const threshold = options.find((o) => o.id === TRIGGER_THRESHOLD_OPTION_ID)!
    // `category` is `rest_required`, so the REST threshold key wins, not the
    // monotony one — a raw-score fire must never be compared against the
    // wrong category's line.
    expect(threshold.score).toBe(100)
    expect(threshold.rows).toEqual([])
  })

  it('reads the monotony threshold key when the MONOTONY category fired', () => {
    const tied = {
      category: 'monotony_prevention',
      criteria: { threshold_fire: 100, threshold_monotony: 60 },
      feature_contributions: {
        rest_required: { score: 70, clamped: false, gates: [], rows: [] },
        monotony_prevention: { score: 70, clamped: false, gates: [], rows: [] },
      },
    } as never
    const options = triggerOptions(tied) as { id: string; score: number }[]
    expect(options.find((o) => o.id === TRIGGER_THRESHOLD_OPTION_ID)!.score).toBe(60)
  })

  it('does NOT append a threshold option when the two categories genuinely differ (hybrid)', () => {
    const hybrid = {
      category: 'rest_required',
      criteria: { threshold_suggest: 0.7, monotony_suggest_threshold: 0.5 },
      feature_contributions: {
        rest_required: { score: 0.82, clamped: false, gates: [], rows: [chainRow('fatigue', 0.8, 0.3)] },
        monotony_prevention: { score: 0.4, clamped: false, gates: [], rows: [chainRow('monotony', 0.5, 0.4)] },
      },
    } as never
    const options = triggerOptions(hybrid) as { id: string }[]
    expect(options).toHaveLength(2)
    expect(options.find((o) => o.id === TRIGGER_THRESHOLD_OPTION_ID)).toBeUndefined()
  })

  it('skips the synthetic option when tied scores carry no recorded threshold criteria', () => {
    const tiedNoCriteria = fireWith({
      rest_required: { score: 50, clamped: false, gates: [], rows: [] },
      monotony_prevention: { score: 50, clamped: false, gates: [], rows: [] },
    })
    const options = triggerOptions(tiedNoCriteria) as { id: string }[]
    expect(options).toHaveLength(2)
  })
})

describe('serviceOptions', () => {
  it('is unavailable when no service evidence was recorded', () => {
    expect(serviceOptions(null)).toMatchObject({ available: false })
  })

  // Real recorded output shape — the numeric fields are copied verbatim from
  // the backend's own P5 §14 contract fixture
  // (app/api/tests/proposal/test_p5_contract_extension.py::_full_feature_contribution
  // / _full_ranked_candidate), not hand-authored plausible-looking numbers.
  function serviceEvidence(): AlgorithmEvidence {
    return {
      step: 'service',
      package_id: 'aica_transparent_service_selector_v1',
      contract_version: '1.0.0',
      schema_version: '1.0.0',
      matrix_version: 'v1',
      input_snapshot: {
        eligible_candidates: [{ candidate_id: 'humming_karaoke' }, { candidate_id: 'music_playlist' }],
        excluded_candidates: [],
      },
      output: {
        decision_type: 'ranked_candidates',
        ranked_candidates: [
          {
            rank: 1,
            candidate_id: 'humming_karaoke',
            score: 0.772349,
            rationale: ['日本語の理由', 'English rationale'],
            supporting_feature_ids: ['drowsiness_level'],
            opposing_feature_ids: [],
            uncertainty: null,
            feature_contributions: [
              {
                feature_id: 'drowsiness_level',
                feature_value: 80,
                response_coefficient: 1.0,
                weight: 0.254551,
                contribution: 0.203641,
              },
            ],
          },
          {
            rank: 2,
            candidate_id: 'music_playlist',
            score: 0.45,
            rationale: ['二位の理由', 'Second rank rationale'],
            supporting_feature_ids: [],
            opposing_feature_ids: [],
            uncertainty: null,
            feature_contributions: [
              {
                feature_id: 'drowsiness_level',
                feature_value: 80,
                response_coefficient: 0.6,
                weight: 0.254551,
                contribution: 0.152731,
              },
            ],
          },
        ],
        excluded_candidates: [],
        unused_available_features: [],
        missing_features: [],
        next_package_runtime_state: {},
        algorithm_provenance: {},
      },
      error: null,
      used_feature_ids: ['drowsiness_level'],
      unused_available_features: [],
      missing_features: [],
    }
  }

  function baseProposalLog(overrides: Partial<ProposalRunLog> = {}): ProposalRunLog {
    return {
      run_id: 'prun_20260718-000000_abcdef',
      created_at: '2026-07-18T00:00:00Z',
      opportunity: {
        opportunity_id: 'op_1',
        trigger_purpose: 'inattentive_driving_prevention_recovery',
        lifecycle_stage: 'active_driving_content',
        allowed_service_ids: ['humming_karaoke', 'music_playlist'],
        simulation_time: 45,
        run_seed: '7',
      },
      matrix_version: 'v1',
      world_snapshot: {},
      service_package_id: 'aica_transparent_service_selector_v1',
      content_package_id: 'aica_transparent_content_selector_v1',
      parameters: {},
      hyperparameters: {},
      journey_state: {
        lifecycle_stage: 'active_driving_content',
        motion_state: 'driving',
        active_service_id: null,
        active_plan_id: null,
      },
      events: [],
      evidence: [],
      status: 'created',
      ...overrides,
    } as unknown as ProposalRunLog
  }

  it('returns one option per ranked candidate, in recorded order', () => {
    const log = baseProposalLog({ evidence: [serviceEvidence()] })
    const options = serviceOptions(log) as { id: string; score: number; rows: unknown[] }[]
    expect(Array.isArray(options)).toBe(true)
    expect(options.map((o) => o.id)).toEqual(['humming_karaoke', 'music_playlist'])
  })

  it('mirrors ServiceResultOverlay/serviceRows field mapping exactly', () => {
    const log = baseProposalLog({ evidence: [serviceEvidence()] })
    const options = serviceOptions(log) as {
      id: string
      score: number
      rows: { featureId: string; value: unknown; r: number; w: number; contribution: number }[]
    }[]
    const top = options.find((o) => o.id === 'humming_karaoke')!
    expect(top.score).toBe(0.772349)
    expect(top.rows).toEqual([
      { featureId: 'drowsiness_level', value: 80, band: null, r: 1.0, w: 0.254551, contribution: 0.203641 },
    ])
  })

  it('is unavailable when the recorded evidence carries an algorithm_error', () => {
    const log = baseProposalLog({
      evidence: [
        {
          step: 'service',
          package_id: 'aica_transparent_service_selector_v1',
          contract_version: '1.0.0',
          schema_version: '1.0.0',
          matrix_version: 'v1',
          input_snapshot: {},
          output: null,
          error: { category: 'algorithm_error', message: 'boom' },
          used_feature_ids: [],
          unused_available_features: [],
          missing_features: [],
        },
      ],
    })
    expect(serviceOptions(log)).toMatchObject({ available: false })
  })

  // Finding 1 (task-11 review) — an all-LLM-shaped ranked_candidates array
  // filters down to []; that would silently read as "the algorithm produced
  // nothing" (a false statement) instead of "these could not be compared".
  it('is unavailable when every recorded candidate is LLM-shaped (score is null)', () => {
    const log = baseProposalLog({
      evidence: [
        {
          step: 'service',
          package_id: 'mock_llm_service_selector_v1',
          contract_version: '1.0.0',
          schema_version: '1.0.0',
          matrix_version: 'v1',
          input_snapshot: {},
          output: {
            decision_type: 'ranked_candidates',
            ranked_candidates: [
              {
                rank: 1,
                candidate_id: 'humming_karaoke',
                score: null,
                rationale: ['LLM の理由', 'LLM rationale'],
                supporting_feature_ids: [],
                opposing_feature_ids: [],
                uncertainty: null,
                feature_contributions: [],
              },
            ],
            excluded_candidates: [],
            unused_available_features: [],
            missing_features: [],
            next_package_runtime_state: {},
            algorithm_provenance: {},
          },
          error: null,
          used_feature_ids: [],
          unused_available_features: [],
          missing_features: [],
        },
      ],
    })
    expect(serviceOptions(log)).toMatchObject({ available: false })
  })
})

describe('contentOptions', () => {
  it('is unavailable when no content plan was recorded', () => {
    expect(contentOptions(null)).toMatchObject({ available: false })
  })

  // Numeric fields copied verbatim from the backend content contract fixture
  // (app/api/tests/proposal/test_content_output_contract.py::FEATURE_CONTRIBUTION
  // / ORDERED_ITEM_TRANSPARENT) — a scored_tail entry is added with the SAME
  // real contribution shape at a lower item_fit, mirroring B2's "runner-up".
  // `purpose_multiplier` (and so `effective_weight`) is changed from the
  // fixture's 1.0 to 0.6 — the real fixture's `a_i` and `effective_weight`
  // happen to coincide at 1.0, which would let an r/w field-swap bug pass
  // undetected; the formula (base_weight * purpose_multiplier * mask) still
  // holds, so this stays a realistic weight, just a distinguishable one.
  function contentEvidence(): AlgorithmEvidence {
    const featureContribution = {
      feature_id: 'driver_fatigue_level',
      e_i: 0.8,
      a_i: 1.0,
      alpha: 1.2,
      beta: 0.3,
      exact_match: null,
      response_provenance: 'cdc_su_explicit',
      r_i: 0.96,
      base_weight: 1.0,
      purpose_multiplier: 0.6,
      mask: 1,
      effective_weight: 0.6,
      contribution: 0.96,
      formula_version: 'content_algo_v1',
    }
    return {
      step: 'content',
      package_id: 'aica_transparent_content_selector_v1',
      contract_version: '1.0.0',
      schema_version: '1.0.0',
      matrix_version: 'v1',
      input_snapshot: {},
      output: {
        decision_type: 'complete_plan',
        selected_service_id: 'music_playlist',
        requested_item_count: 5,
        returned_item_count: 1,
        ordered_items: [
          {
            position: 1,
            item_id: 'synthetic-track-001',
            item_fit: 0.82,
            trait_values: null,
            feature_contributions: [featureContribution],
            rationale: ['high arousal match', 'good valence'],
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
        expected_duration_sec: 300,
        lighting_configuration: null,
        approval_policy: 'auto',
        completion_rule: 'end_of_queue',
        next_transition_policy: 'resume',
        excluded_items: [],
        scored_tail: [
          {
            item_id: 'synthetic-track-002',
            rank: 2,
            item_fit: 0.6,
            feature_contributions: [{ ...featureContribution, e_i: 0.5, contribution: 0.6 }],
          },
        ],
        cut_margin: 0.22,
        tail_truncated: false,
        unused_available_features: [],
        missing_features: [],
        algorithm_provenance: {},
      },
      error: null,
      used_feature_ids: ['driver_fatigue_level'],
      unused_available_features: [],
      missing_features: [],
    }
  }

  function baseProposalLog(overrides: Partial<ProposalRunLog> = {}): ProposalRunLog {
    return {
      run_id: 'prun_20260718-000000_abcdef',
      created_at: '2026-07-18T00:00:00Z',
      opportunity: {
        opportunity_id: 'op_1',
        trigger_purpose: 'inattentive_driving_prevention_recovery',
        lifecycle_stage: 'active_driving_content',
        allowed_service_ids: ['music_playlist'],
        simulation_time: 45,
        run_seed: '7',
      },
      matrix_version: 'v1',
      world_snapshot: {},
      service_package_id: 'aica_transparent_service_selector_v1',
      content_package_id: 'aica_transparent_content_selector_v1',
      parameters: {},
      hyperparameters: {},
      journey_state: {
        lifecycle_stage: 'active_driving_content',
        motion_state: 'driving',
        active_service_id: 'music_playlist',
        active_plan_id: null,
      },
      events: [],
      evidence: [],
      status: 'content_selected',
      ...overrides,
    } as unknown as ProposalRunLog
  }

  it('returns ordered_items.length + scored_tail.length options, ordered plan-first', () => {
    const log = baseProposalLog({ evidence: [contentEvidence()] })
    const { options } = contentOptions(log) as { options: { id: string }[]; tailTruncated: boolean }
    expect(options.length).toBe(2)
    expect(options.map((o) => o.id)).toEqual(['synthetic-track-001', 'synthetic-track-002'])
  })

  it('mirrors ContentResultOverlay/contentRows field mapping exactly', () => {
    const log = baseProposalLog({ evidence: [contentEvidence()] })
    const { options } = contentOptions(log) as {
      options: {
        id: string
        score: number
        rows: { featureId: string; value: unknown; r: number; w: number; contribution: number }[]
      }[]
      tailTruncated: boolean
    }
    const top = options[0]
    expect(top.score).toBe(0.82)
    expect(top.rows).toEqual([
      { featureId: 'driver_fatigue_level', value: 0.8, band: null, r: 1.0, w: 0.6, contribution: 0.96 },
    ])
  })

  it('gives every position below rank 1 a real runner-up from scored_tail', () => {
    const log = baseProposalLog({ evidence: [contentEvidence()] })
    const { options } = contentOptions(log) as { options: { id: string; score: number }[]; tailTruncated: boolean }
    expect(options[1].id).toBe('synthetic-track-002')
    expect(options[1].score).toBe(0.6)
  })

  it('reports tailTruncated: false when the recorded plan says the pool was not truncated', () => {
    const log = baseProposalLog({ evidence: [contentEvidence()] })
    const result = contentOptions(log) as { options: unknown[]; tailTruncated: boolean }
    expect(result.tailTruncated).toBe(false)
  })

  it('reports tailTruncated: true when the recorded plan says the tail was capped', () => {
    const evidence = contentEvidence()
    ;(evidence.output as { tail_truncated: boolean }).tail_truncated = true
    const log = baseProposalLog({ evidence: [evidence] })
    const result = contentOptions(log) as { options: unknown[]; tailTruncated: boolean }
    expect(result.tailTruncated).toBe(true)
  })

  // Finding 1 (task-11 review) — an all-LLM-shaped ordered_items array (with
  // no scored_tail) filters down to []; that would silently read as "the
  // algorithm produced nothing" instead of "these could not be compared".
  it('is unavailable when every recorded item is LLM-shaped (item_fit is null)', () => {
    const log = baseProposalLog({
      evidence: [
        {
          step: 'content',
          package_id: 'mock_llm_content_selector_v1',
          contract_version: '1.0.0',
          schema_version: '1.0.0',
          matrix_version: 'v1',
          input_snapshot: {},
          output: {
            decision_type: 'complete_plan',
            selected_service_id: 'music_playlist',
            requested_item_count: 1,
            returned_item_count: 1,
            ordered_items: [
              {
                position: 1,
                item_id: 'llm-track-001',
                item_fit: null,
                trait_values: null,
                feature_contributions: [],
                rationale: ['LLM の理由', 'LLM rationale'],
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
            expected_duration_sec: 300,
            lighting_configuration: null,
            approval_policy: 'auto',
            completion_rule: 'end_of_queue',
            next_transition_policy: 'resume',
            excluded_items: [],
            scored_tail: [],
            cut_margin: null,
            tail_truncated: false,
            unused_available_features: [],
            missing_features: [],
            algorithm_provenance: {},
          },
          error: null,
          used_feature_ids: [],
          unused_available_features: [],
          missing_features: [],
        },
      ],
    })
    expect(contentOptions(log)).toMatchObject({ available: false })
  })
})
