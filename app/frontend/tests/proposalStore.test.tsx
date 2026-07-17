import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import React from 'react'
import { ProposalStoreProvider, useProposalStore } from '../src/state/proposalStore'
import type { World, AlgorithmConfigOverrides } from '../src/api/proposalClient'

function wrapper({ children }: { children: React.ReactNode }) {
  return React.createElement(ProposalStoreProvider, null, children)
}

/** A minimal-but-fully-typed World fixture for LOAD_PRESET reducer tests
 * (feature 018) — deliberately DIFFERENT from proposalStore's DEFAULT_WORLD
 * on every field the reducer is asserted to copy, so a passing assertion
 * can't be an accidental match against the initial state. */
function presetWorld(): World {
  return {
    control_inputs: {
      trigger_purpose: 'route_music',
      lifecycle_stage: 'active_driving_content',
      motion_state: 'driving',
      matrix_version: 'v1',
      dataset_id: 'soundcharts-grounded-spotify-compatible-demonstration-seed-1042',
    },
    situation: {
      drowsiness_level: 10,
      fatigue_level: 5,
      traffic_state: 'congested',
      road_type: 'mountain',
      night_state: 'day',
      monotony_level: 15,
      route_tags: ['mountain'],
      destination_tags: ['nature'],
      child_present: true,
      multiple_passengers: true,
      motion_state: 'driving',
      estimated_min_until_rest_spot: null,
      rest_spot_type: 'unknown',
      active_service: null,
      recent_service_rejections: [],
    },
    driver_profile: {
      oshi_registered: true,
      oshi_mode: 'on',
      oshi_id: 'synthetic-artist-preset',
      oshi_type: 'artist',
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

describe('proposalStore', () => {
  it('defaults uiLanguage to "en"', () => {
    const { result } = renderHook(() => useProposalStore(), { wrapper })
    expect(result.current.state.uiLanguage).toBe('en')
  })

  it('dispatching SET_LANGUAGE updates uiLanguage', () => {
    const { result } = renderHook(() => useProposalStore(), { wrapper })

    act(() => {
      result.current.dispatch({ type: 'SET_LANGUAGE', lang: 'en' })
    })

    expect(result.current.state.uiLanguage).toBe('en')

    act(() => {
      result.current.dispatch({ type: 'SET_LANGUAGE', lang: 'ja' })
    })

    expect(result.current.state.uiLanguage).toBe('ja')
  })

  it('throws when used outside a ProposalStoreProvider', () => {
    // Swallow the expected React error-boundary console noise for this call.
    const { result } = renderHook(() => {
      try {
        return useProposalStore()
      } catch (e) {
        return e
      }
    })
    expect(result.current).toBeInstanceOf(Error)
  })

  // feature 018 (US1) — LOAD_PRESET must be ATOMIC: one dispatch sets the
  // whole world (situation + driver_profile + control_inputs together),
  // the three selected-* ids, and stashes the preset's overrides — never a
  // partial/inconsistent intermediate state.
  describe('LOAD_PRESET', () => {
    it('atomically sets world.situation + world.driver_profile + world.control_inputs, the selected-* ids, and presetOverrides', () => {
      const { result } = renderHook(() => useProposalStore(), { wrapper })
      const world = presetWorld()
      const overrides: AlgorithmConfigOverrides = {
        content: { directional_hypothesis: 'keep_alert' },
        service: null,
      }

      act(() => {
        result.current.dispatch({
          type: 'LOAD_PRESET',
          presetId: 'preset-monotone-highway-energize',
          world,
          overrides,
        })
      })

      const { state } = result.current
      // The whole world was replaced in one shot (situation + driver_profile
      // + control_inputs + catalog_ref together — mirrors LOAD_SEED).
      expect(state.world).toEqual(world)
      expect(state.world.situation).toEqual(world.situation)
      expect(state.world.driver_profile).toEqual(world.driver_profile)
      expect(state.world.control_inputs).toEqual(world.control_inputs)

      // Top-level mirrors of control_inputs stay in sync (same invariant as
      // LOAD_SEED — other panels read these top-level fields).
      expect(state.triggerPurpose).toBe('route_music')
      expect(state.lifecycleStage).toBe('active_driving_content')
      expect(state.motionState).toBe('driving')

      // Selected-id bookkeeping: the preset is recorded, and any prior
      // seed/profile selection is superseded (a preset is its own
      // self-contained world, not "the seed" or "the profile").
      expect(state.selectedPresetId).toBe('preset-monotone-highway-energize')
      expect(state.selectedSeedId).toBeNull()
      expect(state.selectedProfileId).toBeNull()

      // The preset's algorithm_config_overrides are stashed for whatever
      // dispatches the next run/recompute to merge in.
      expect(state.presetOverrides).toEqual(overrides)

      // Loading a preset re-validates from scratch.
      expect(state.worldValidationIssues).toEqual([])
    })

    it('clears a previously-loaded seed/profile selection', () => {
      const { result } = renderHook(() => useProposalStore(), { wrapper })

      act(() => {
        result.current.dispatch({ type: 'LOAD_SEED', seedId: 'seed-a', world: presetWorld() })
      })
      expect(result.current.state.selectedSeedId).toBe('seed-a')

      act(() => {
        result.current.dispatch({
          type: 'LOAD_PRESET',
          presetId: 'preset-x',
          world: presetWorld(),
          overrides: null,
        })
      })

      expect(result.current.state.selectedSeedId).toBeNull()
      expect(result.current.state.selectedPresetId).toBe('preset-x')
    })

    it('accepts null overrides (a preset with no algorithm_config_overrides)', () => {
      const { result } = renderHook(() => useProposalStore(), { wrapper })

      act(() => {
        result.current.dispatch({
          type: 'LOAD_PRESET',
          presetId: 'preset-baseline',
          world: presetWorld(),
          overrides: null,
        })
      })

      expect(result.current.state.presetOverrides).toBeNull()
    })
  })

  it('dispatching SET_PRESETS populates the presets cache', () => {
    const { result } = renderHook(() => useProposalStore(), { wrapper })
    const presets = [
      {
        preset_id: 'preset-monotone-highway-energize',
        label: { ja: '単調な高速・活性化', en: 'Monotone highway — energize' },
        brief: { ja: '説明', en: 'Boredom without fatigue → an energizing oshi track should top content.' },
        family: 'mood_coherence' as const,
        contrast_with: 'preset-late-night-winddown',
        hypothesis: 'coherent high-arousal signals + oshi + genre highway→j-rock lift an upbeat track to the top',
      },
    ]

    act(() => {
      result.current.dispatch({ type: 'SET_PRESETS', presets })
    })

    expect(result.current.state.presets).toEqual(presets)
  })
})
