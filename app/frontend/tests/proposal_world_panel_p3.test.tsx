/**
 * proposal_world_panel_p3 (P3 T027) — WorldPanel as a REAL editor over the
 * typed World: loading a seed populates every group, preference/history
 * fields are real editable controls (not JSON dumps), profile save/load/
 * delete round-trips through the client, the genre_affinity_v1 toggle
 * shows/hides its controls without discarding entered values, and the
 * dataset provenance banner is read-only (no edit/import control). JA stays
 * the default language throughout.
 */
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ProposalStoreProvider, useProposalStore } from '../src/state/proposalStore'
import WorldPanel from '../src/components/proposal/panels/WorldPanel'
import type { World, DriverProfile, SeedWorld, DriverProfileRecord } from '../src/api/proposalClient'

vi.mock('../src/api/proposalClient', async () => {
  const actual = await vi.importActual<typeof import('../src/api/proposalClient')>('../src/api/proposalClient')
  return {
    ...actual,
    getDatasets: vi.fn(),
    getCatalog: vi.fn(),
    getSeeds: vi.fn(),
    getSeed: vi.fn(),
    listProfiles: vi.fn(),
    getProfile: vi.fn(),
    saveProfile: vi.fn(),
    deleteProfile: vi.fn(),
    validateWorld: vi.fn(),
  }
})

import {
  getDatasets,
  getCatalog,
  getSeeds,
  getSeed,
  listProfiles,
  getProfile,
  saveProfile,
  deleteProfile,
  validateWorld,
} from '../src/api/proposalClient'

const DATASET_PROVENANCE = {
  dataset_id: 'soundcharts-grounded-spotify-compatible-demonstration-seed-1042',
  dataset_version: {
    schema_version: '1.0.0',
    spotify_track_reference_version: '1.0.0',
    spotify_audio_features_reference_version: '1.0.0',
  },
  dataset_hash: 'sha256:83d8079c7a81bc6afbd01cdba65fe2330de66b900a113723814fa938fce516cd',
  tier: 'demonstration',
  provenance_note: 'P2 Soundcharts-grounded synthetic dataset',
}

function baseDriverProfile(overrides: Partial<DriverProfile> = {}): DriverProfile {
  return {
    oshi_registered: false,
    oshi_mode: 'off',
    oshi_id: null,
    oshi_type: null,
    oshi_tags: [],
    age_band: '20s',
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
    ...overrides,
  }
}

function seedWorld(): SeedWorld {
  const world: World = {
    control_inputs: {
      trigger_purpose: 'rest_recommended',
      lifecycle_stage: 'before_rest_until_stop',
      motion_state: 'driving',
      matrix_version: 'v1',
      dataset_id: DATASET_PROVENANCE.dataset_id,
    },
    situation: {
      drowsiness_level: 80,
      fatigue_level: 70,
      traffic_state: 'congested',
      road_type: 'highway',
      night_state: 'night',
      monotony_level: 90,
      route_tags: ['highway'],
      destination_tags: ['coast'],
      child_present: false,
      multiple_passengers: false,
      motion_state: 'driving',
      estimated_min_until_rest_spot: 8,
      rest_spot_type: 'sa_pa',
      active_service: null,
      recent_service_rejections: [],
    },
    driver_profile: baseDriverProfile({
      oshi_registered: true,
      oshi_mode: 'on',
      oshi_id: 'synthetic-artist-0001',
      age_band: '30s',
      service_usage_level: { music_playlist: 'high' },
    }),
    catalog_ref: {
      dataset_id: DATASET_PROVENANCE.dataset_id,
      dataset_version: DATASET_PROVENANCE.dataset_version,
      dataset_hash: DATASET_PROVENANCE.dataset_hash,
    },
  }
  return {
    seed_id: 'seed-night-highway-oshi',
    label: { ja: '夜間高速、休憩地点近く、推し ON', en: 'Night highway, rest nearby, oshi on' },
    description: { ja: '説明', en: 'description' },
    world,
  }
}

function setupDefaultMocks() {
  vi.mocked(getDatasets).mockResolvedValue({ datasets: [], errors: [] })
  vi.mocked(getCatalog).mockResolvedValue({ provenance: DATASET_PROVENANCE, total: 0, songs: [] })
  vi.mocked(getSeeds).mockResolvedValue({
    seeds: [{ seed_id: 'seed-night-highway-oshi', label: seedWorld().label, description: seedWorld().description }],
  })
  vi.mocked(getSeed).mockResolvedValue(seedWorld())
  vi.mocked(listProfiles).mockResolvedValue({
    profiles: [{ profile_id: 'profile-neutral-default', label: { ja: '標準', en: 'Neutral' }, builtin: true }],
  })
  vi.mocked(getProfile).mockResolvedValue({
    profile_id: 'profile-neutral-default',
    label: { ja: '標準', en: 'Neutral' },
    builtin: true,
    profile: baseDriverProfile(),
  })
  vi.mocked(validateWorld).mockResolvedValue({ valid: true, issues: [] })
}

function renderWithStore() {
  return render(
    <ProposalStoreProvider>
      <WorldPanel />
    </ProposalStoreProvider>,
  )
}

describe('WorldPanel (P3 real editor)', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    setupDefaultMocks()
  })

  it('defaults to Japanese (JA) as the UI language', async () => {
    renderWithStore()
    await screen.findByTestId('dataset-provenance-banner')
    expect(screen.getByText('入力・世界')).toBeInTheDocument()
  })

  it('loading a seed populates control_inputs, situation, and driver_profile groups', async () => {
    function Probe() {
      const { state } = useProposalStore()
      return (
        <div>
          <span data-testid="probe-trigger">{state.triggerPurpose}</span>
          <span data-testid="probe-lifecycle">{state.lifecycleStage}</span>
          <span data-testid="probe-motion">{state.motionState}</span>
          <span data-testid="probe-drowsiness">{state.world.situation.drowsiness_level}</span>
          <span data-testid="probe-oshi">{String(state.world.driver_profile.oshi_registered)}</span>
          <span data-testid="probe-oshi-id">{String(state.world.driver_profile.oshi_id)}</span>
          <span data-testid="probe-seed-id">{String(state.selectedSeedId)}</span>
        </div>
      )
    }
    render(
      <ProposalStoreProvider>
        <WorldPanel />
        <Probe />
      </ProposalStoreProvider>,
    )
    await waitFor(() => expect(getSeeds).toHaveBeenCalled())
    await waitFor(() => expect(screen.getByTestId('seed-picker-select')).toBeInTheDocument())

    fireEvent.change(screen.getByTestId('seed-picker-select'), { target: { value: 'seed-night-highway-oshi' } })
    fireEvent.click(screen.getByTestId('seed-picker-load'))

    await waitFor(() => expect(getSeed).toHaveBeenCalledWith('seed-night-highway-oshi'))
    await waitFor(() => expect(screen.getByTestId('probe-seed-id').textContent).toBe('seed-night-highway-oshi'))

    expect(screen.getByTestId('probe-trigger').textContent).toBe('rest_recommended')
    expect(screen.getByTestId('probe-lifecycle').textContent).toBe('before_rest_until_stop')
    expect(screen.getByTestId('probe-motion').textContent).toBe('driving')
    expect(screen.getByTestId('probe-drowsiness').textContent).toBe('80')
    expect(screen.getByTestId('probe-oshi').textContent).toBe('true')
    expect(screen.getByTestId('probe-oshi-id').textContent).toBe('synthetic-artist-0001')
  })

  it('a preference/history field (service_usage_level) is a REAL editable control, not a JSON dump', async () => {
    renderWithStore()
    await screen.findByTestId('dataset-provenance-banner')
    const editor = screen.getByTestId('feature-field-service_usage_level')
    // Real editor: has an add-row control (select for the ServiceId key +
    // select for the UsageLevel value), not a <pre>/JSON.stringify text dump.
    expect(within(editor).getByTestId('feature-field-service_usage_level-draft-key')).toBeInTheDocument()
    expect(within(editor).getByTestId('feature-field-service_usage_level-draft-value')).toBeInTheDocument()
    expect(editor.textContent).not.toMatch(/[{[]/)
  })

  it('editing service_proposal_acceptance_rate (a History field) updates the store, not a dump', async () => {
    function Probe() {
      const { state } = useProposalStore()
      return (
        <span data-testid="probe-rate">
          {JSON.stringify(state.world.driver_profile.service_proposal_acceptance_rate)}
        </span>
      )
    }
    render(
      <ProposalStoreProvider>
        <WorldPanel />
        <Probe />
      </ProposalStoreProvider>,
    )
    await screen.findByTestId('dataset-provenance-banner')
    const editor = screen.getByTestId('feature-field-service_proposal_acceptance_rate')
    fireEvent.change(within(editor).getByTestId('feature-field-service_proposal_acceptance_rate-draft-key'), {
      target: { value: 'music_playlist' },
    })
    fireEvent.change(within(editor).getByTestId('feature-field-service_proposal_acceptance_rate-draft-value'), {
      target: { value: '77' },
    })
    fireEvent.click(within(editor).getByTestId('feature-field-service_proposal_acceptance_rate-add'))

    // The default world already seeds { music_playlist: 72, humming_karaoke: 55 }
    // (see proposalStore's DEFAULT_DRIVER_PROFILE) — editing music_playlist
    // in place overrides just that entry, leaving the other untouched.
    expect(screen.getByTestId('probe-rate').textContent).toBe('{"music_playlist":77,"humming_karaoke":55}')
  })

  it('saving the current driver profile calls saveProfile and the new profile appears in the picker', async () => {
    const saved: DriverProfileRecord = {
      profile_id: 'dprof_new_001',
      label: { ja: 'テストプロファイル', en: 'Test profile' },
      builtin: false,
      profile: baseDriverProfile(),
    }
    vi.mocked(saveProfile).mockResolvedValue(saved)
    vi.mocked(listProfiles)
      .mockResolvedValueOnce({
        profiles: [{ profile_id: 'profile-neutral-default', label: { ja: '標準', en: 'Neutral' }, builtin: true }],
      })
      .mockResolvedValueOnce({
        profiles: [
          { profile_id: 'profile-neutral-default', label: { ja: '標準', en: 'Neutral' }, builtin: true },
          { profile_id: 'dprof_new_001', label: saved.label, builtin: false },
        ],
      })

    renderWithStore()
    await waitFor(() => expect(listProfiles).toHaveBeenCalled())
    await screen.findByTestId('profile-picker-select')

    fireEvent.change(screen.getByTestId('profile-picker-label-ja'), { target: { value: 'テストプロファイル' } })
    fireEvent.change(screen.getByTestId('profile-picker-label-en'), { target: { value: 'Test profile' } })
    fireEvent.click(screen.getByTestId('profile-picker-save'))

    await waitFor(() => expect(saveProfile).toHaveBeenCalled())
    const [labelArg] = vi.mocked(saveProfile).mock.calls[0]
    expect(labelArg).toEqual({ ja: 'テストプロファイル', en: 'Test profile' })

    await waitFor(() => {
      const options = Array.from((screen.getByTestId('profile-picker-select') as HTMLSelectElement).options)
      expect(options.some((o) => o.value === 'dprof_new_001')).toBe(true)
    })
  })

  it('deleting a user (non-built-in) profile calls deleteProfile', async () => {
    vi.mocked(listProfiles).mockResolvedValue({
      profiles: [
        { profile_id: 'profile-neutral-default', label: { ja: '標準', en: 'Neutral' }, builtin: true },
        { profile_id: 'dprof_user_1', label: { ja: 'ユーザー', en: 'User' }, builtin: false },
      ],
    })
    vi.mocked(deleteProfile).mockResolvedValue(undefined)

    renderWithStore()
    await screen.findByTestId('profile-picker-select')
    fireEvent.change(screen.getByTestId('profile-picker-select'), { target: { value: 'dprof_user_1' } })
    fireEvent.click(screen.getByTestId('profile-picker-delete'))

    await waitFor(() => expect(deleteProfile).toHaveBeenCalledWith('dprof_user_1'))
  })

  it('the genre_affinity_v1 toggle shows/hides genre controls WITHOUT discarding entered values', async () => {
    renderWithStore()
    await screen.findByTestId('dataset-provenance-banner')

    expect(screen.queryByTestId('genre-fields')).not.toBeInTheDocument()

    fireEvent.change(screen.getByTestId('genre-affinity-toggle'), { target: { value: 'true' } })
    expect(screen.getByTestId('genre-fields')).toBeInTheDocument()

    // Enter a genre-usage value while the extension is on.
    fireEvent.change(screen.getByTestId('genre-usage-by-genre-anime'), { target: { value: 'high' } })
    expect((screen.getByTestId('genre-usage-by-genre-anime') as HTMLSelectElement).value).toBe('high')

    // Toggle off — the fields are hidden, not cleared.
    fireEvent.change(screen.getByTestId('genre-affinity-toggle'), { target: { value: 'false' } })
    expect(screen.queryByTestId('genre-fields')).not.toBeInTheDocument()

    // Toggle back on — the earlier value is still there.
    fireEvent.change(screen.getByTestId('genre-affinity-toggle'), { target: { value: 'true' } })
    expect((screen.getByTestId('genre-usage-by-genre-anime') as HTMLSelectElement).value).toBe('high')
  })

  it('the dataset provenance banner renders id/version/hash and offers no edit/import control', async () => {
    renderWithStore()
    await waitFor(() => expect(getCatalog).toHaveBeenCalled())
    const banner = await screen.findByTestId('dataset-provenance-banner')
    await waitFor(() => expect(within(banner).getByTestId('dataset-provenance-id')).toHaveTextContent(DATASET_PROVENANCE.dataset_id))
    expect(within(banner).getByTestId('dataset-provenance-hash')).toHaveTextContent(DATASET_PROVENANCE.dataset_hash)
    expect(banner.textContent).toMatch(/1\.0\.0/)
    // No edit/import affordance anywhere in the banner.
    expect(within(banner).queryAllByRole('button').length).toBe(0)
    expect(within(banner).queryAllByRole('textbox').length).toBe(0)
  })
})
