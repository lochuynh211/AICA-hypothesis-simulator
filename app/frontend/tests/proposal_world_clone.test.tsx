/**
 * proposal_world_clone (P3 T031) — contrast-clone frontend wiring:
 * choosing a preset (or a custom override) calls `cloneWorld`, the store's
 * `clones`/`activeClone` state updates, and `WorldDiffView` renders exactly
 * the changed field's before/after — deterministically on repeat.
 */
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ProposalStoreProvider, useProposalStore } from '../src/state/proposalStore'
import WorldClonePicker from '../src/components/proposal/WorldClonePicker'
import WorldDiffView from '../src/components/proposal/WorldDiffView'
import type { World, WorldClone } from '../src/api/proposalClient'

vi.mock('../src/api/proposalClient', async () => {
  const actual = await vi.importActual<typeof import('../src/api/proposalClient')>('../src/api/proposalClient')
  return {
    ...actual,
    getSeeds: vi.fn(),
    cloneWorld: vi.fn(),
  }
})

import { getSeeds, cloneWorld } from '../src/api/proposalClient'

const DATASET_ID = 'soundcharts-grounded-spotify-compatible-demonstration-seed-1042'

function baseWorld(): World {
  return {
    control_inputs: {
      trigger_purpose: 'rest_recommended',
      lifecycle_stage: 'before_rest_until_stop',
      motion_state: 'driving',
      matrix_version: 'v1',
      dataset_id: DATASET_ID,
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
    driver_profile: {
      oshi_registered: true,
      oshi_mode: 'on',
      oshi_id: 'synthetic-artist-0001',
      oshi_type: 'artist',
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
      dataset_id: DATASET_ID,
      dataset_version: {
        schema_version: '1.0.0',
        spotify_track_reference_version: '1.0.0',
        spotify_audio_features_reference_version: '1.0.0',
      },
      dataset_hash: 'sha256:83d8079c7a81bc6afbd01cdba65fe2330de66b900a113723814fa938fce516cd',
    },
  }
}

function cloneWithDrowsinessOverride(value: number): WorldClone {
  const world = baseWorld()
  world.situation = { ...world.situation, drowsiness_level: value }
  return {
    clone_id: 'wclone_20260716-100000_abcdef',
    base_seed_id: 'seed-night-highway-oshi',
    overrides: [{ path: 'situation.drowsiness_level', value }],
    world,
    diff: [{ path: 'situation.drowsiness_level', before: 80, after: value }],
  }
}

function setupDefaultMocks() {
  vi.mocked(getSeeds).mockResolvedValue({
    seeds: [
      {
        seed_id: 'seed-night-highway-oshi',
        label: { ja: '夜間高速', en: 'Night highway' },
        description: { ja: '説明', en: 'description' },
      },
    ],
  })
}

function renderPicker() {
  return render(
    <ProposalStoreProvider>
      <WorldClonePicker />
      <WorldDiffView />
    </ProposalStoreProvider>,
  )
}

describe('World contrast clone (P3 T031)', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    setupDefaultMocks()
  })

  it('choosing a preset and applying it calls cloneWorld with the base seed + override', async () => {
    vi.mocked(cloneWorld).mockResolvedValue(cloneWithDrowsinessOverride(10))
    renderPicker()

    await waitFor(() => expect(getSeeds).toHaveBeenCalled())
    await screen.findByTestId('clone-base-seed-select')

    fireEvent.change(screen.getByTestId('clone-preset-select'), { target: { value: 'drowsiness-low' } })
    fireEvent.click(screen.getByTestId('clone-preset-apply'))

    await waitFor(() => expect(cloneWorld).toHaveBeenCalledWith('seed-night-highway-oshi', [
      { path: 'situation.drowsiness_level', value: 10 },
    ]))
  })

  it('WorldDiffView renders exactly the changed field before/after, nothing else', async () => {
    vi.mocked(cloneWorld).mockResolvedValue(cloneWithDrowsinessOverride(5))
    renderPicker()

    await screen.findByTestId('clone-base-seed-select')
    fireEvent.change(screen.getByTestId('clone-preset-select'), { target: { value: 'drowsiness-low' } })
    fireEvent.click(screen.getByTestId('clone-preset-apply'))

    const diffTable = await screen.findByTestId('world-diff-table')
    const rows = within(diffTable).getAllByRole('row')
    // 1 header row + exactly 1 diff row.
    expect(rows.length).toBe(2)
    expect(screen.getByTestId('world-diff-before-situation.drowsiness_level')).toHaveTextContent('80')
    expect(screen.getByTestId('world-diff-after-situation.drowsiness_level')).toHaveTextContent('5')
  })

  it('applying a custom override calls cloneWorld with the typed path/value', async () => {
    const clone = cloneWithDrowsinessOverride(80)
    clone.overrides = [{ path: 'driver_profile.oshi_mode', value: 'off' }]
    clone.diff = [{ path: 'driver_profile.oshi_mode', before: 'on', after: 'off' }]
    vi.mocked(cloneWorld).mockResolvedValue(clone)
    renderPicker()

    await screen.findByTestId('clone-base-seed-select')
    fireEvent.change(screen.getByTestId('clone-custom-path'), { target: { value: 'driver_profile.oshi_mode' } })
    fireEvent.change(screen.getByTestId('clone-custom-value'), { target: { value: '"off"' } })
    fireEvent.click(screen.getByTestId('clone-custom-apply'))

    await waitFor(() =>
      expect(cloneWorld).toHaveBeenCalledWith('seed-night-highway-oshi', [
        { path: 'driver_profile.oshi_mode', value: 'off' },
      ]),
    )
    expect(await screen.findByTestId('world-diff-before-driver_profile.oshi_mode')).toHaveTextContent('on')
    expect(screen.getByTestId('world-diff-after-driver_profile.oshi_mode')).toHaveTextContent('off')
  })

  it('renders deterministically: cloning the same base+override twice yields the same diff render', async () => {
    vi.mocked(cloneWorld).mockResolvedValue(cloneWithDrowsinessOverride(12))
    renderPicker()

    await screen.findByTestId('clone-base-seed-select')
    fireEvent.change(screen.getByTestId('clone-preset-select'), { target: { value: 'drowsiness-low' } })
    fireEvent.click(screen.getByTestId('clone-preset-apply'))
    await screen.findByTestId('world-diff-table')
    const firstHtml = screen.getByTestId('world-diff-table').innerHTML

    fireEvent.click(screen.getByTestId('clone-preset-apply'))
    await waitFor(() => expect(cloneWorld).toHaveBeenCalledTimes(2))
    const secondHtml = screen.getByTestId('world-diff-table').innerHTML

    expect(secondHtml).toBe(firstHtml)
  })

  it('dispatches CLONE_CREATED into the store (world + selectedCloneId update)', async () => {
    vi.mocked(cloneWorld).mockResolvedValue(cloneWithDrowsinessOverride(3))

    function Probe() {
      const { state } = useProposalStore()
      return (
        <div>
          <span data-testid="probe-drowsiness">{state.world.situation.drowsiness_level}</span>
          <span data-testid="probe-clone-id">{String(state.selectedCloneId)}</span>
        </div>
      )
    }

    render(
      <ProposalStoreProvider>
        <WorldClonePicker />
        <WorldDiffView />
        <Probe />
      </ProposalStoreProvider>,
    )

    await screen.findByTestId('clone-base-seed-select')
    fireEvent.change(screen.getByTestId('clone-preset-select'), { target: { value: 'drowsiness-low' } })
    fireEvent.click(screen.getByTestId('clone-preset-apply'))

    await waitFor(() => expect(screen.getByTestId('probe-drowsiness').textContent).toBe('3'))
    expect(screen.getByTestId('probe-clone-id').textContent).toBe('wclone_20260716-100000_abcdef')
  })

  it('dismissing the diff view clears activeClone without discarding the cloned world', async () => {
    vi.mocked(cloneWorld).mockResolvedValue(cloneWithDrowsinessOverride(9))
    renderPicker()

    await screen.findByTestId('clone-base-seed-select')
    fireEvent.change(screen.getByTestId('clone-preset-select'), { target: { value: 'drowsiness-low' } })
    fireEvent.click(screen.getByTestId('clone-preset-apply'))
    await screen.findByTestId('world-diff-view')

    fireEvent.click(screen.getByTestId('world-diff-dismiss'))
    expect(screen.queryByTestId('world-diff-view')).not.toBeInTheDocument()
  })
})
