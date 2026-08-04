// htmlapp/frontend/tests/use_case_selection.test.tsx
/**
 * TS port of `app/frontend/tests/use_case_selection.test.tsx` (mirrors
 * app/frontend commit 40d2da5, "fix bug", bug 3 — store/wiring half):
 * selecting a test case must reset `world.situation` to the newly-fetched
 * case's baseline BEFORE its own pinned `SET_SITUATION_FIELD` overrides are
 * applied, so a previously selected case's situation fields never linger
 * into the next one.
 *
 * `getPreset` is mocked to return two DISTINCT worlds (distinct situation AND
 * driver_profile) keyed by `profile_ref`, so selecting case A then case B
 * proves the reset actually happened rather than merely observing a
 * coincidental value.
 */
import { renderHook, act, waitFor } from '@testing-library/react'
import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { World, Preset } from '../src/api/proposalClient'

vi.mock('../src/api/proposalClient', async (orig) => ({
  ...(await orig<typeof import('../src/api/proposalClient')>()),
  getPreset: vi.fn(),
}))

import { getPreset } from '../src/api/proposalClient'
import { useCaseSelection } from '../src/components/merged/useCaseSelection'
import { RunStoreProvider } from '../src/state/runStore'
import { ProposalStoreProvider, useProposalStore } from '../src/state/proposalStore'
import { ReviewStoreProvider } from '../src/state/reviewStore'
import { LanguageProvider } from '../src/state/language'

// Two real committed cases (combined_contracts/test_cases/) with DIFFERENT
// profile_ref values, so each resolves to its own `getPreset` fixture below.
const CASE_A_ID = 'case-c01-alert-daytime-control' // persona.profile_ref: preset-journey-a-1-cruising-fresh
const CASE_B_ID = 'case-c02-night-highway-drowsiness' // persona.profile_ref: preset-recently-played-fatigue

function fullWorld(overrides: { situation: Partial<World['situation']>; ageBand: string }): World {
  return {
    control_inputs: {
      trigger_purpose: 'rest_recommended',
      lifecycle_stage: 'after_rest_before_restart',
      motion_state: 'stopped',
      matrix_version: 'v1',
      dataset_id: 'ds-1',
    },
    situation: {
      drowsiness_level: 20,
      fatigue_level: 20,
      traffic_state: 'normal',
      road_type: 'highway',
      night_state: 'day',
      monotony_level: 10,
      route_tags: [],
      destination_tags: [],
      child_present: false,
      multiple_passengers: false,
      motion_state: 'stopped',
      estimated_min_until_rest_spot: null,
      rest_spot_type: 'unknown',
      active_service: null,
      recent_service_rejections: [],
      ...overrides.situation,
    },
    driver_profile: {
      oshi_registered: false,
      oshi_mode: 'off',
      oshi_artists: [],
      oshi_tags: [],
      age_band: overrides.ageBand as World['driver_profile']['age_band'],
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
      dataset_id: 'ds-1',
      dataset_version: {
        schema_version: '1.0.0',
        spotify_track_reference_version: '1.0.0',
        spotify_audio_features_reference_version: '1.0.0',
      },
      dataset_hash: 'sha256:abc',
    },
  }
}

function mkPreset(presetId: string, world: World): Preset {
  return {
    preset_id: presetId,
    schema_version: '1.0',
    label: { ja: presetId, en: presetId },
    brief: { ja: '', en: '' },
    category: 'baseline',
    family: 'baseline',
    journey: null,
    contrast_with: null,
    world,
    algorithm_config_overrides: null,
    expectation: {
      hypothesis: '',
      expected_top: {},
      top_fit_min: 0,
      gradient: 'none',
      expected_service: { top_should_be_in: [] },
      override_required: false,
    },
  }
}

// Case A's baseline situation — high drowsiness, coastal night route.
const WORLD_A = fullWorld({
  situation: { drowsiness_level: 75, road_type: 'mountain', route_tags: ['coastal', 'night'] },
  ageBand: '30s',
})

// Case B's baseline situation — deliberately DISTINCT from A on every field
// checked below (drowsiness, road_type, route_tags), so a leftover A value
// surviving into B's world is caught rather than papered over by a
// coincidental match.
const WORLD_B = fullWorld({
  situation: { drowsiness_level: 15, road_type: 'local', route_tags: [] },
  ageBand: '60plus',
})

function wrapper({ children }: { children: React.ReactNode }) {
  return (
    <LanguageProvider initialLanguage="en">
      <RunStoreProvider>
        <ProposalStoreProvider>
          <ReviewStoreProvider>{children}</ReviewStoreProvider>
        </ProposalStoreProvider>
      </RunStoreProvider>
    </LanguageProvider>
  )
}

describe('useCaseSelection — LOAD_CASE_WORLD resets world.situation per case (bug 3)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getPreset).mockImplementation(async (presetId: string) => {
      if (presetId === 'preset-journey-a-1-cruising-fresh') return mkPreset(presetId, WORLD_A)
      if (presetId === 'preset-recently-played-fatigue') return mkPreset(presetId, WORLD_B)
      throw new Error(`unexpected preset id in test: ${presetId}`)
    })
  })

  it('selecting case A then case B leaves none of A’s situation fields in the store', async () => {
    const { result } = renderHook(
      () => ({ selection: useCaseSelection(), proposal: useProposalStore() }),
      { wrapper },
    )

    await act(async () => {
      await result.current.selection.handleSelectCase(CASE_A_ID)
    })

    await waitFor(() => {
      expect(result.current.proposal.state.world.situation.drowsiness_level).toBe(75)
    })
    expect(result.current.proposal.state.world.situation.road_type).toBe('mountain')
    expect(result.current.proposal.state.world.driver_profile.age_band).toBe('30s')

    await act(async () => {
      await result.current.selection.handleSelectCase(CASE_B_ID)
    })

    await waitFor(() => {
      expect(result.current.proposal.state.world.driver_profile.age_band).toBe('60plus')
    })
    const { situation } = result.current.proposal.state.world
    // B's own fresh baseline — not A's stale values.
    expect(situation.drowsiness_level).toBe(15)
    expect(situation.road_type).toBe('local')
    expect(situation.route_tags).toEqual([])
    expect(result.current.proposal.state.selectedProfileId).toBe('preset-recently-played-fatigue')
  })

  it('dispatches LOAD_CASE_WORLD (not a bare LOAD_PROFILE) carrying the fetched situation baseline', async () => {
    const { result } = renderHook(
      () => ({ selection: useCaseSelection(), proposal: useProposalStore() }),
      { wrapper },
    )

    await act(async () => {
      await result.current.selection.handleSelectCase(CASE_A_ID)
    })

    await waitFor(() => {
      expect(result.current.proposal.state.selectedProfileId).toBe('preset-journey-a-1-cruising-fresh')
    })
    // The baseline situation landed BEFORE any case-pinned SET_SITUATION_FIELD
    // overlay would run — asserted by checking a field the case does NOT pin
    // (drowsiness_level) still reflects the fetched WORLD_A baseline, not the
    // proposalStore's own hardcoded DEFAULT_SITUATION.
    expect(result.current.proposal.state.world.situation.drowsiness_level).toBe(75)
  })

  it('a later selection wins over a stale in-flight fetch (race guard preserved)', async () => {
    let resolveA: (() => void) | null = null
    vi.mocked(getPreset).mockImplementation(async (presetId: string) => {
      if (presetId === 'preset-journey-a-1-cruising-fresh') {
        await new Promise<void>((resolve) => {
          resolveA = resolve
        })
        return mkPreset(presetId, WORLD_A)
      }
      if (presetId === 'preset-recently-played-fatigue') return mkPreset(presetId, WORLD_B)
      throw new Error(`unexpected preset id in test: ${presetId}`)
    })

    const { result } = renderHook(
      () => ({ selection: useCaseSelection(), proposal: useProposalStore() }),
      { wrapper },
    )

    let pendingA: Promise<void>
    act(() => {
      pendingA = result.current.selection.handleSelectCase(CASE_A_ID)
    })

    await act(async () => {
      await result.current.selection.handleSelectCase(CASE_B_ID)
    })

    await waitFor(() => {
      expect(result.current.proposal.state.selectedProfileId).toBe('preset-recently-played-fatigue')
    })

    // Now let A's stale fetch resolve — it must NOT overwrite B's world.
    act(() => {
      resolveA?.()
    })
    await act(async () => {
      await pendingA
    })

    expect(result.current.proposal.state.selectedProfileId).toBe('preset-recently-played-fatigue')
    expect(result.current.proposal.state.world.situation.drowsiness_level).toBe(15)
  })
})
