/**
 * proposal_preset_picker_grouping (PresetPicker `<optgroup>` grouping
 * follow-up) — `PresetSummary` gained `category`/`journey` fields so the
 * ~27-preset picker can be organized into `<optgroup>`s instead of one long
 * flat list. This test proves:
 *
 *   (a) optgroups render in the fixed order: journeys first (ordered by the
 *       MINIMUM `preset_id` in each group), then standalone categories in
 *       the fixed order situation → preference → history → baseline;
 *   (b) within a journey group, options are ordered by `journey.step`
 *       ascending — even though the mocked `getPresets` response returns
 *       steps out of order, to prove the component sorts rather than just
 *       trusting fetch order;
 *   (c) the pre-existing select/brief-blurb behavior (select → autoload full
 *       preset → dispatch LOAD_PRESET → render bilingual brief) still works,
 *       unchanged by the grouping.
 *
 * Mirrors `proposal_preset_picker.test.tsx`'s mocking pattern (mock
 * `getPresets`/`getPreset` from `api/proposalClient`, render inside
 * `ProposalStoreProvider`).
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ProposalStoreProvider } from '../src/state/proposalStore'
import PresetPicker from '../src/components/proposal/PresetPicker'
import type { World, Preset, PresetSummary } from '../src/api/proposalClient'

vi.mock('../src/api/proposalClient', async () => {
  const actual = await vi.importActual<typeof import('../src/api/proposalClient')>('../src/api/proposalClient')
  return {
    ...actual,
    getPresets: vi.fn(),
    getPreset: vi.fn(),
  }
})

import { getPresets, getPreset } from '../src/api/proposalClient'

function fullWorld(): World {
  return {
    control_inputs: {
      trigger_purpose: 'rest_recommended',
      lifecycle_stage: 'after_rest_before_restart',
      motion_state: 'stopped',
      matrix_version: 'v1',
      dataset_id: 'soundcharts-grounded-spotify-compatible-demonstration-seed-1042',
    },
    situation: {
      drowsiness_level: 62,
      fatigue_level: 48,
      traffic_state: 'normal',
      road_type: 'highway',
      night_state: 'night',
      monotony_level: 70,
      route_tags: ['coastal'],
      destination_tags: ['resort'],
      child_present: false,
      multiple_passengers: false,
      motion_state: 'stopped',
      estimated_min_until_rest_spot: null,
      rest_spot_type: 'unknown',
      active_service: null,
      recent_service_rejections: [],
    },
    driver_profile: {
      oshi_registered: true,
      oshi_mode: 'on',
      oshi_artists: [],
      oshi_tags: [],
      age_band: '30s',
      gender: 'unspecified',
      hobby_interest_tags: [],
      service_usage_level: {},
      service_recency_state: {},
      scene_service_usage_level: {},
      catalog_item_usage_level: {},
      catalog_item_recency_state: {},
      content_tag_usage_level: {},
      content_tag_recency_state: {},
      scene_content_tag_usage_level: {},
      played_items: [],
      skipped_items: [],
      changed_from_items: [],
      cancelled_content_plans: [],
      completed_items: [],
      manually_selected_items: [],
      repeated_items: [],
      service_proposal_acceptance_rate: {},
      service_recovery_rate: {},
      content_proposal_acceptance_rate: {},
      content_recovery_rate: {},
      service_proposal_acceptance_confidence: {},
      service_recovery_confidence: {},
      content_proposal_acceptance_confidence: {},
      content_recovery_confidence: {},
      scheduled_event_type: null,
      scheduled_event_timing: null,
      scheduled_event_tags: [],
      genre_affinity_v1_enabled: false,
      usage_by_genre: null,
      scene_genre_usage: null,
    },
    catalog_ref: {
      dataset_id: 'soundcharts-grounded-spotify-compatible-demonstration-seed-1042',
      dataset_version: {
        schema_version: '1.0.0',
        spotify_track_reference_version: '1.0.0',
        spotify_audio_features_reference_version: '1.0.0',
      },
      dataset_hash: 'sha256:83d8079c7a81bc6afbd01cdba65fe2330de66b900a113723814fa938fce516cd',
    },
  }
}

function brief(en: string): { ja: string; en: string } {
  return { ja: en, en }
}

/** Journey B's own step 2 is listed BEFORE its step 1 in the mocked response
 * (and before journey A's presets too), to prove the component re-sorts
 * rather than trusting fetch order — both for journey-group ordering
 * (by minimum preset_id) and step ordering within a group. */
const PRESETS: PresetSummary[] = [
  {
    preset_id: 'preset-journey-b-2',
    label: brief('B · 2/2 — Resume'),
    brief: brief('Journey B step 2 brief'),
    category: 'situation',
    family: 'mood_coherence',
    journey: { id: 'journey-b', step: 2, of: 2, label: brief('Journey B · Wind-down') },
    contrast_with: null,
    hypothesis: 'b2',
  },
  {
    preset_id: 'preset-baseline-1',
    label: brief('Baseline default'),
    brief: brief('Baseline brief'),
    category: 'baseline',
    family: 'baseline',
    journey: null,
    contrast_with: null,
    hypothesis: 'baseline',
  },
  {
    preset_id: 'preset-journey-a-2',
    label: brief('A · 2/2 — Rest recommended'),
    brief: brief('Journey A step 2 brief'),
    category: 'situation',
    family: 'mood_coherence',
    journey: { id: 'journey-a', step: 2, of: 2, label: brief('Journey A · Rest & recovery') },
    contrast_with: null,
    hypothesis: 'a2',
  },
  {
    preset_id: 'preset-history-1',
    label: brief('Frequent skipper'),
    brief: brief('History brief'),
    category: 'history',
    family: 'history_mechanics',
    journey: null,
    contrast_with: null,
    hypothesis: 'history',
  },
  {
    preset_id: 'preset-journey-a-1',
    label: brief('A · 1/2 — Driving'),
    brief: brief('Journey A step 1 brief'),
    category: 'situation',
    family: 'mood_coherence',
    journey: { id: 'journey-a', step: 1, of: 2, label: brief('Journey A · Rest & recovery') },
    contrast_with: null,
    hypothesis: 'a1',
  },
  {
    preset_id: 'preset-preference-1',
    label: brief('Oshi lover'),
    brief: brief('Preference brief'),
    category: 'preference',
    family: 'oshi_personalization',
    journey: null,
    contrast_with: null,
    hypothesis: 'preference',
  },
  {
    preset_id: 'preset-journey-b-1',
    label: brief('B · 1/2 — Approaching rest'),
    brief: brief('Journey B step 1 brief'),
    category: 'situation',
    family: 'mood_coherence',
    journey: { id: 'journey-b', step: 1, of: 2, label: brief('Journey B · Wind-down') },
    contrast_with: null,
    hypothesis: 'b1',
  },
  {
    preset_id: 'preset-situation-1',
    label: brief('Monotone highway'),
    brief: brief('Situation brief'),
    category: 'situation',
    family: 'mood_coherence',
    journey: null,
    contrast_with: null,
    hypothesis: 'situation',
  },
]

function presetFor(id: string): Preset {
  const summary = PRESETS.find((p) => p.preset_id === id) as PresetSummary
  return {
    preset_id: summary.preset_id,
    schema_version: '1.0.0',
    label: summary.label,
    brief: summary.brief,
    category: summary.category,
    family: summary.family,
    journey: summary.journey,
    contrast_with: summary.contrast_with,
    world: fullWorld(),
    algorithm_config_overrides: null,
    expectation: {
      hypothesis: summary.hypothesis,
      expected_top: { must_be_oshi: false, track_id: null, genre: null, arousal_band: null },
      top_fit_min: 0.4,
      gradient: 'none',
      expected_service: { top_should_be_in: ['music_playlist'] },
      override_required: false,
    },
  }
}

describe('PresetPicker — optgroup grouping', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(getPresets).mockResolvedValue({ presets: PRESETS })
    vi.mocked(getPreset).mockImplementation((id: string) => Promise.resolve(presetFor(id)))
  })

  it('renders optgroups in order [journey A, journey B, Situation, Preference, History, Baseline]', async () => {
    render(
      <ProposalStoreProvider>
        <PresetPicker />
      </ProposalStoreProvider>,
    )

    await waitFor(() => expect(getPresets).toHaveBeenCalled())
    const select = (await screen.findByTestId('preset-picker-select')) as HTMLSelectElement

    const groups = Array.from(select.querySelectorAll('optgroup'))
    const groupLabels = groups.map((g) => g.label)

    expect(groupLabels).toEqual([
      'Journey A · Rest & recovery',
      'Journey B · Wind-down',
      'Situation — the drive decides',
      'Preference — the driver’s taste',
      'History — past behavior',
      'Baseline',
    ])
  })

  it('orders options within a journey group by step ascending, regardless of fetch order', async () => {
    render(
      <ProposalStoreProvider>
        <PresetPicker />
      </ProposalStoreProvider>,
    )

    await waitFor(() => expect(getPresets).toHaveBeenCalled())
    const select = (await screen.findByTestId('preset-picker-select')) as HTMLSelectElement

    const journeyAGroup = Array.from(select.querySelectorAll('optgroup')).find(
      (g) => g.label === 'Journey A · Rest & recovery',
    ) as HTMLOptGroupElement
    const journeyAOptionTexts = Array.from(journeyAGroup.querySelectorAll('option')).map((o) => o.textContent)
    expect(journeyAOptionTexts).toEqual(['A · 1/2 — Driving', 'A · 2/2 — Rest recommended'])

    const journeyBGroup = Array.from(select.querySelectorAll('optgroup')).find(
      (g) => g.label === 'Journey B · Wind-down',
    ) as HTMLOptGroupElement
    const journeyBOptionTexts = Array.from(journeyBGroup.querySelectorAll('option')).map((o) => o.textContent)
    expect(journeyBOptionTexts).toEqual(['B · 1/2 — Approaching rest', 'B · 2/2 — Resume'])
  })

  it('still supports selecting a preset, autoloading it, and showing the bilingual brief', async () => {
    render(
      <ProposalStoreProvider>
        <PresetPicker />
      </ProposalStoreProvider>,
    )

    await waitFor(() => expect(getPresets).toHaveBeenCalled())
    await screen.findByTestId('preset-picker-select')

    fireEvent.change(screen.getByTestId('preset-picker-select'), {
      target: { value: 'preset-preference-1' },
    })

    await waitFor(() => expect(getPreset).toHaveBeenCalledWith('preset-preference-1'))

    const brief = await screen.findByTestId('preset-brief')
    expect(brief.textContent).toContain('Preference brief')
    expect(screen.getByTestId('preset-brief-hypothesis').textContent).toContain('preference')
    expect((screen.getByTestId('preset-picker-select') as HTMLSelectElement).value).toBe('preset-preference-1')
  })
})
