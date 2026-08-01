/**
 * useCaseSelection (task-17 review, Finding 1 + 2) — the glue that resolves
 * an experience test case into the scoped run/proposal stores.
 *
 * Covers what the review found untested:
 *   - `run` actions dispatch in `caseDispatches`' order (SELECT_SCENARIO
 *     before the pins it would otherwise clear);
 *   - LOAD_PROFILE carries a resolved `{ profileId, profile }` object, not
 *     just the id `caseDispatches` itself knows;
 *   - THE RACE: selecting case A then case B before A's `getPreset` fetch
 *     resolves must leave the proposal store on B, never a stale mix of A's
 *     profile with B's selection;
 *   - a failed `getPreset` surfaces `caseError` and does not half-apply the
 *     proposal actions.
 *
 * Only `api/proposalClient`'s `getPreset` is mocked — `resolveCase`/
 * `caseDispatches` run for real over the two committed test cases
 * (`case-c01-alert-daytime-control`, `case-c03-monotonous-highway`), and the
 * real `runStore`/`proposalStore`/`reviewStore` reducers apply the dispatches.
 */
import { render, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { LanguageProvider } from '../src/state/language'
import { RunStoreProvider, useRunStore } from '../src/state/runStore'
import { ProposalStoreProvider, useProposalStore } from '../src/state/proposalStore'
import { ReviewStoreProvider } from '../src/state/reviewStore'
import { useCaseSelection } from '../src/components/merged/useCaseSelection'
import type { CaseSelection } from '../src/components/merged/useCaseSelection'
import type { Preset, World, DriverProfile } from '../src/api/proposalClient'

vi.mock('../src/api/proposalClient', async () => {
  const actual = await vi.importActual<typeof import('../src/api/proposalClient')>('../src/api/proposalClient')
  return { ...actual, getPreset: vi.fn() }
})

import { getPreset } from '../src/api/proposalClient'

const CASE_A = 'case-c01-alert-daytime-control' // profile_ref: preset-journey-a-1-cruising-fresh
const CASE_B = 'case-c03-monotonous-highway' // profile_ref: preset-journey-a-2-monotony-building
const PROFILE_A = 'preset-journey-a-1-cruising-fresh'
const PROFILE_B = 'preset-journey-a-2-monotony-building'

function fullWorld(oshiMarker: string): World {
  return {
    control_inputs: {
      trigger_purpose: 'rest_recommended',
      lifecycle_stage: 'before_rest_until_stop',
      motion_state: 'driving',
      matrix_version: 'v1',
      dataset_id: 'soundcharts-grounded-spotify-compatible-demonstration-seed-1042',
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
      motion_state: 'driving',
      estimated_min_until_rest_spot: null,
      rest_spot_type: 'unknown',
      active_service: null,
      recent_service_rejections: [],
    },
    driver_profile: fakeProfile(oshiMarker),
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

// A minimal, valid DriverProfile — the single `oshi_artists` entry's
// `artist_id` carries a marker so a test can tell which of the two mocked
// profiles actually landed in the store.
function fakeProfile(oshiMarker: string): DriverProfile {
  return {
    oshi_registered: true,
    oshi_mode: 'on',
    oshi_artists: [{ artist_id: oshiMarker, oshi_type: 'artist', enthusiasm: 1.0 }],
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
  }
}

function fullPreset(profileRef: string, oshiMarker: string): Preset {
  return {
    preset_id: profileRef,
    schema_version: '1.0.0',
    label: { ja: profileRef, en: profileRef },
    brief: { ja: '', en: '' },
    category: 'baseline',
    family: 'baseline',
    journey: null,
    contrast_with: null,
    world: fullWorld(oshiMarker),
    algorithm_config_overrides: null,
    expectation: {
      hypothesis: 'n/a',
      expected_top: {},
      top_fit_min: 0,
      gradient: 'none',
      expected_service: { top_should_be_in: [] },
      override_required: false,
    },
  }
}

type Harness = {
  runRef: { current: ReturnType<typeof useRunStore> | null }
  proposalRef: { current: ReturnType<typeof useProposalStore> | null }
  selectionRef: { current: CaseSelection | null }
}

function renderHarness(): Harness {
  const runRef: Harness['runRef'] = { current: null }
  const proposalRef: Harness['proposalRef'] = { current: null }
  const selectionRef: Harness['selectionRef'] = { current: null }

  function Capture() {
    runRef.current = useRunStore()
    proposalRef.current = useProposalStore()
    selectionRef.current = useCaseSelection()
    return null
  }

  render(
    <LanguageProvider initialLanguage="en">
      <RunStoreProvider>
        <ProposalStoreProvider>
          <ReviewStoreProvider>
            <Capture />
          </ReviewStoreProvider>
        </ProposalStoreProvider>
      </RunStoreProvider>
    </LanguageProvider>,
  )

  return { runRef, proposalRef, selectionRef }
}

describe('useCaseSelection', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('dispatches the run actions in caseDispatches order — SELECT_SCENARIO before the pins it clears', async () => {
    vi.mocked(getPreset).mockResolvedValue(fullPreset(PROFILE_B, 'marker-b'))
    const { runRef, selectionRef } = renderHarness()

    // case-c03-monotonous-highway pins is_night/child_passenger (via
    // SET_CONTEXT_OVERRIDE) and initial drowsiness/fatigue. `runStore`'s real
    // SELECT_SCENARIO reducer case CLEARS contextOverrides/initial signals —
    // so these pins surviving in the final state is only possible if
    // SELECT_SCENARIO ran BEFORE them, exactly as `caseDispatches` orders its
    // `run` array. If the order were ever reversed, this assertion would see
    // the pins wiped back to their scenario defaults.
    await act(async () => {
      await selectionRef.current!.handleSelectCase(CASE_B)
    })

    expect(runRef.current!.state.selectedScenarioId).toBe('uc02_monotony_v0_1')
    expect(runRef.current!.state.contextOverrides.is_night).toBe(false)
    expect(runRef.current!.state.contextOverrides.child_passenger).toBe(false)
    expect(runRef.current!.state.initialDrowsiness).toBe(15)
    expect(runRef.current!.state.initialFatigue).toBe(18)
  })

  it('LOAD_PROFILE carries a resolved { profileId, profile } object, not just the id', async () => {
    const preset = fullPreset(PROFILE_A, 'marker-a')
    vi.mocked(getPreset).mockResolvedValue(preset)
    const { proposalRef, selectionRef } = renderHarness()

    await act(async () => {
      await selectionRef.current!.handleSelectCase(CASE_A)
    })

    expect(vi.mocked(getPreset)).toHaveBeenCalledWith(PROFILE_A)
    expect(proposalRef.current!.state.selectedProfileId).toBe(PROFILE_A)
    // Not just the id — the actual resolved DriverProfile object landed in
    // the world (identifiable via the marker planted in oshi_artists[0]).
    expect(proposalRef.current!.state.world.driver_profile.oshi_artists[0]?.artist_id).toBe('marker-a')
  })

  it('closes the race: selecting A then B before A resolves leaves the proposal store on B, not a stale mix', async () => {
    let resolveA!: (preset: Preset) => void
    const pendingA = new Promise<Preset>((resolve) => {
      resolveA = resolve
    })
    vi.mocked(getPreset).mockImplementation((profileRef: string) => {
      if (profileRef === PROFILE_A) return pendingA
      return Promise.resolve(fullPreset(PROFILE_B, 'marker-b'))
    })

    const { proposalRef, selectionRef } = renderHarness()

    // Select A — its getPreset(PROFILE_A) call is now pending (never awaited
    // to completion here).
    let selectAPromise!: Promise<void>
    act(() => {
      selectAPromise = selectionRef.current!.handleSelectCase(CASE_A)
    })

    // Select B before A resolves — B's getPreset resolves immediately.
    await act(async () => {
      await selectionRef.current!.handleSelectCase(CASE_B)
    })

    expect(proposalRef.current!.state.selectedProfileId).toBe(PROFILE_B)
    expect(proposalRef.current!.state.world.driver_profile.oshi_artists[0]?.artist_id).toBe('marker-b')

    // NOW resolve A's stale fetch — it must be discarded, not overwrite B.
    await act(async () => {
      resolveA(fullPreset(PROFILE_A, 'marker-a'))
      await selectAPromise
    })

    expect(proposalRef.current!.state.selectedProfileId).toBe(PROFILE_B)
    expect(proposalRef.current!.state.world.driver_profile.oshi_artists[0]?.artist_id).toBe('marker-b')
    // The review/run stores already agreed on B before A's stale fetch
    // landed — the proposal store must match them, not A.
    expect(proposalRef.current!.state.servicePackageId).toBe('aica_transparent_service_selector_v1')
  })

  it(
    'closes the race for Reset too: re-selecting A (what MergedSetupPanel\'s ' +
      'Reset button does — calling handleSelectCase with the ALREADY-selected ' +
      'id) then picking B before the reset\'s fetch resolves leaves the ' +
      'proposal store on B (task-18 review Finding 2)',
    async () => {
      // First, a normal completed selection of A.
      vi.mocked(getPreset).mockResolvedValueOnce(fullPreset(PROFILE_A, 'marker-a'))
      const { proposalRef, selectionRef } = renderHarness()
      await act(async () => {
        await selectionRef.current!.handleSelectCase(CASE_A)
      })
      expect(proposalRef.current!.state.world.driver_profile.oshi_artists[0]?.artist_id).toBe('marker-a')

      // Now simulate clicking "Reset" while still on case A — MergedSetupPanel's
      // `onResetToCase` calls `handleSelectCase(selectedCaseId)` again with the
      // SAME id. Its getPreset(PROFILE_A) call is pending.
      let resolveReset!: (preset: Preset) => void
      const pendingReset = new Promise<Preset>((resolve) => {
        resolveReset = resolve
      })
      vi.mocked(getPreset).mockImplementation((profileRef: string) => {
        if (profileRef === PROFILE_A) return pendingReset
        return Promise.resolve(fullPreset(PROFILE_B, 'marker-b'))
      })

      let resetPromise!: Promise<void>
      act(() => {
        resetPromise = selectionRef.current!.handleSelectCase(CASE_A) // Reset(A)
      })

      // Before the reset's fetch resolves, the reviewer picks case B in the
      // picker (a separate control in the same left column).
      await act(async () => {
        await selectionRef.current!.handleSelectCase(CASE_B)
      })
      expect(proposalRef.current!.state.selectedProfileId).toBe(PROFILE_B)
      expect(proposalRef.current!.state.world.driver_profile.oshi_artists[0]?.artist_id).toBe('marker-b')

      // NOW resolve the stale Reset(A) fetch — it must be discarded, not
      // overwrite B. Before Finding 2 was fixed, MergedSetupPanel ran this
      // continuation through a bespoke LOCAL fetch with no generation guard
      // at all, so it would have landed unconditionally.
      await act(async () => {
        resolveReset(fullPreset(PROFILE_A, 'marker-a-reset'))
        await resetPromise
      })

      expect(proposalRef.current!.state.selectedProfileId).toBe(PROFILE_B)
      expect(proposalRef.current!.state.world.driver_profile.oshi_artists[0]?.artist_id).toBe('marker-b')
      expect(proposalRef.current!.state.servicePackageId).toBe('aica_transparent_service_selector_v1')
    },
  )

  it('a failed getPreset surfaces caseError and does not half-apply the proposal actions', async () => {
    vi.mocked(getPreset).mockRejectedValue(new Error('network down'))
    const { proposalRef, selectionRef } = renderHarness()

    await act(async () => {
      await selectionRef.current!.handleSelectCase(CASE_A)
    })

    expect(selectionRef.current!.caseError).toBeTruthy()
    // No half-applied setup: none of case A's proposal actions landed either
    // (selectedProfileId/servicePackageId/contentPackageId all stay whatever
    // they were before — null on a fresh store).
    expect(proposalRef.current!.state.selectedProfileId).toBeNull()
    expect(proposalRef.current!.state.servicePackageId).toBeNull()
    expect(proposalRef.current!.state.contentPackageId).toBeNull()
  })
})
