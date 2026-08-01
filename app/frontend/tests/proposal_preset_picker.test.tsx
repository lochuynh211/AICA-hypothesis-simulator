/**
 * proposal_preset_picker (feature 018, US1) — PresetPicker fetches the
 * committed preset list on mount, autoloads a full preset on selection
 * (dispatching LOAD_PRESET), and shows the bilingual brief blurb. Also
 * regression-tests the SeedPicker/DriverProfilePicker reflect-guard fix: a
 * preset-driven LOAD_PRESET must visibly reset both pickers' dropdowns even
 * after the user already picked a seed/profile directly.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ProposalStoreProvider, useProposalStore } from '../src/state/proposalStore'
import PresetPicker from '../src/components/proposal/PresetPicker'
import SeedPicker from '../src/components/proposal/SeedPicker'
import DriverProfilePicker from '../src/components/proposal/DriverProfilePicker'
import type { World, Preset, PresetSummary } from '../src/api/proposalClient'

vi.mock('../src/api/proposalClient', async () => {
  const actual = await vi.importActual<typeof import('../src/api/proposalClient')>('../src/api/proposalClient')
  return {
    ...actual,
    getPresets: vi.fn(),
    getPreset: vi.fn(),
    getSeeds: vi.fn(),
    getSeed: vi.fn(),
    listProfiles: vi.fn(),
    getProfile: vi.fn(),
    saveProfile: vi.fn(),
    deleteProfile: vi.fn(),
  }
})

import { getPresets, getPreset, getSeeds, getSeed, listProfiles, getProfile } from '../src/api/proposalClient'

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

const PRESET_SUMMARY: PresetSummary = {
  preset_id: 'preset-monotone-highway-energize',
  label: { ja: '単調な高速・活性化', en: 'Monotone highway — energize' },
  brief: {
    ja: '眠気なしの単調さ→活性系の推し曲がトップになるはず。',
    en: 'Boredom without fatigue → an energizing oshi track should top content.',
  },
  category: 'situation',
  family: 'mood_coherence',
  journey: null,
  contrast_with: 'preset-late-night-winddown',
  hypothesis: 'coherent high-arousal signals + oshi + genre highway→j-rock lift an upbeat track to the top',
}

function fullPreset(): Preset {
  return {
    preset_id: PRESET_SUMMARY.preset_id,
    schema_version: '1.0.0',
    label: PRESET_SUMMARY.label,
    brief: PRESET_SUMMARY.brief,
    category: PRESET_SUMMARY.category,
    family: PRESET_SUMMARY.family,
    journey: PRESET_SUMMARY.journey,
    contrast_with: PRESET_SUMMARY.contrast_with,
    world: fullWorld(),
    algorithm_config_overrides: null,
    expectation: {
      hypothesis: PRESET_SUMMARY.hypothesis,
      expected_top: { must_be_oshi: true, track_id: null, genre: null, arousal_band: null },
      top_fit_min: 0.4,
      gradient: 'arousal_up_implies_fit_up',
      expected_service: { top_should_be_in: ['music_playlist'] },
      override_required: false,
    },
  }
}

describe('PresetPicker', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('fetches the preset list on mount, autoloads the full preset on selection, and shows the bilingual brief', async () => {
    vi.mocked(getPresets).mockResolvedValue({ presets: [PRESET_SUMMARY] })
    vi.mocked(getPreset).mockResolvedValue(fullPreset())

    function Probe() {
      const { state } = useProposalStore()
      return (
        <div>
          <span data-testid="probe-preset-id">{String(state.selectedPresetId)}</span>
          <span data-testid="probe-seed-id">{String(state.selectedSeedId)}</span>
          <span data-testid="probe-profile-id">{String(state.selectedProfileId)}</span>
        </div>
      )
    }

    render(
      <ProposalStoreProvider>
        <PresetPicker />
        <Probe />
      </ProposalStoreProvider>,
    )

    await waitFor(() => expect(getPresets).toHaveBeenCalled())
    await screen.findByTestId('preset-picker-select')

    fireEvent.change(screen.getByTestId('preset-picker-select'), {
      target: { value: PRESET_SUMMARY.preset_id },
    })

    await waitFor(() => expect(getPreset).toHaveBeenCalledWith(PRESET_SUMMARY.preset_id))
    await waitFor(() => expect(screen.getByTestId('probe-preset-id').textContent).toBe(PRESET_SUMMARY.preset_id))

    // Brief blurb — both the brief text and the hypothesis are shown.
    const brief = await screen.findByTestId('preset-brief')
    expect(brief.textContent).toContain('Boredom without fatigue')
    expect(brief.textContent).toContain(PRESET_SUMMARY.hypothesis)

    // Selecting a preset supersedes any seed/profile selection.
    expect(screen.getByTestId('probe-seed-id').textContent).toBe('null')
    expect(screen.getByTestId('probe-profile-id').textContent).toBe('null')
  })

  it('surfaces a fetch error inline instead of crashing', async () => {
    vi.mocked(getPresets).mockRejectedValue(new Error('boom'))

    render(
      <ProposalStoreProvider>
        <PresetPicker />
      </ProposalStoreProvider>,
    )

    expect(await screen.findByRole('alert')).toHaveTextContent('boom')
  })
})

describe('SeedPicker / DriverProfilePicker reflect a preset-driven LOAD_PRESET', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(getSeeds).mockResolvedValue({
      seeds: [{ seed_id: 'seed-a', label: { ja: 'A', en: 'A' }, description: { ja: '', en: '' } }],
    })
    vi.mocked(getSeed).mockResolvedValue({
      seed_id: 'seed-a',
      label: { ja: 'A', en: 'A' },
      description: { ja: '', en: '' },
      world: fullWorld(),
    })
    vi.mocked(listProfiles).mockResolvedValue({
      profiles: [{ profile_id: 'profile-a', label: { ja: 'A', en: 'A' }, builtin: true }],
    })
    vi.mocked(getProfile).mockResolvedValue({
      profile_id: 'profile-a',
      label: { ja: 'A', en: 'A' },
      builtin: true,
      profile: fullWorld().driver_profile,
    })
  })

  function PresetDispatcher({ world }: { world: World }) {
    const { dispatch } = useProposalStore()
    return (
      <button
        type="button"
        data-testid="fire-load-preset"
        onClick={() => dispatch({ type: 'LOAD_PRESET', presetId: 'preset-x', world, overrides: null })}
      >
        load preset
      </button>
    )
  }

  it('resets both dropdowns to empty on LOAD_PRESET, even after the user already picked a seed/profile directly', async () => {
    render(
      <ProposalStoreProvider>
        <SeedPicker />
        <DriverProfilePicker />
        <PresetDispatcher world={fullWorld()} />
      </ProposalStoreProvider>,
    )

    await waitFor(() => expect(getSeeds).toHaveBeenCalled())
    await waitFor(() => expect(listProfiles).toHaveBeenCalled())

    // User directly picks a seed AND a profile.
    fireEvent.change(screen.getByTestId('seed-picker-select'), { target: { value: 'seed-a' } })
    await waitFor(() =>
      expect((screen.getByTestId('seed-picker-select') as HTMLSelectElement).value).toBe('seed-a'),
    )

    fireEvent.change(screen.getByTestId('profile-picker-select'), { target: { value: 'profile-a' } })
    await waitFor(() =>
      expect((screen.getByTestId('profile-picker-select') as HTMLSelectElement).value).toBe('profile-a'),
    )

    // An external LOAD_PRESET (as PresetPicker would dispatch) nulls both
    // selections — both pickers must reflect that, even though the user
    // already touched them.
    fireEvent.click(screen.getByTestId('fire-load-preset'))

    await waitFor(() => expect((screen.getByTestId('seed-picker-select') as HTMLSelectElement).value).toBe(''))
    await waitFor(() =>
      expect((screen.getByTestId('profile-picker-select') as HTMLSelectElement).value).toBe(''),
    )
  })

  it('still lets the user pick a seed directly again AFTER a LOAD_PRESET reset it (direct-selection behavior preserved)', async () => {
    render(
      <ProposalStoreProvider>
        <SeedPicker />
        <PresetDispatcher world={fullWorld()} />
      </ProposalStoreProvider>,
    )

    await waitFor(() => expect(getSeeds).toHaveBeenCalled())

    fireEvent.click(screen.getByTestId('fire-load-preset'))
    await waitFor(() => expect((screen.getByTestId('seed-picker-select') as HTMLSelectElement).value).toBe(''))

    fireEvent.change(screen.getByTestId('seed-picker-select'), { target: { value: 'seed-a' } })
    await waitFor(() => expect(getSeed).toHaveBeenCalledWith('seed-a'))
    await waitFor(() =>
      expect((screen.getByTestId('seed-picker-select') as HTMLSelectElement).value).toBe('seed-a'),
    )
  })
})
