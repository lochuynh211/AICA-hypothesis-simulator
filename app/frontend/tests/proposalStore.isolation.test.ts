import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import React from 'react'
import proposalStoreSource from '../src/state/proposalStore.ts?raw'
import { ProposalStoreProvider, useProposalStore } from '../src/state/proposalStore'
import { RunStoreProvider, useRunStore } from '../src/state/runStore'
import type { Situation, DriverProfile } from '../src/api/proposalClient'

/** A full baseline Situation for a fictional case, distinct from the store's
 * own DEFAULT_SITUATION on every field the LOAD_CASE_WORLD assertions check. */
const CASE_SITUATION: Situation = {
  drowsiness_level: 10,
  fatigue_level: 15,
  traffic_state: 'congested',
  road_type: 'local',
  night_state: 'day',
  monotony_level: 5,
  route_tags: ['scenic'],
  destination_tags: ['home'],
  child_present: true,
  multiple_passengers: true,
  motion_state: 'driving',
  estimated_min_until_rest_spot: 12,
  rest_spot_type: 'convenience_store',
  active_service: null,
  recent_service_rejections: [],
}

/** A full baseline DriverProfile for the same fictional case. */
const CASE_DRIVER_PROFILE: DriverProfile = {
  oshi_registered: false,
  oshi_mode: 'off',
  oshi_artists: [],
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
}

describe('proposalStore isolation from runStore', () => {
  it('dispatching SET_LANGUAGE on the proposal store does not mutate runStore state', () => {
    function wrapper({ children }: { children: React.ReactNode }) {
      return React.createElement(
        RunStoreProvider,
        null,
        React.createElement(ProposalStoreProvider, null, children),
      )
    }

    const { result } = renderHook(
      () => ({ proposal: useProposalStore(), run: useRunStore() }),
      { wrapper },
    )

    const runStateBefore = result.current.run.state

    act(() => {
      result.current.proposal.dispatch({ type: 'SET_LANGUAGE', lang: 'en' })
    })

    expect(result.current.proposal.state.uiLanguage).toBe('en')
    // runStore's own uiLanguage (default 'en') and every other field are untouched —
    // same object reference, since no runStore action was ever dispatched.
    expect(result.current.run.state).toBe(runStateBefore)
  })

  it('dispatching a setup-edit action (SET_SITUATION_FIELD) on the proposal store does not mutate runStore state (FR-025)', () => {
    function wrapper({ children }: { children: React.ReactNode }) {
      return React.createElement(
        RunStoreProvider,
        null,
        React.createElement(ProposalStoreProvider, null, children),
      )
    }

    const { result } = renderHook(
      () => ({ proposal: useProposalStore(), run: useRunStore() }),
      { wrapper },
    )

    const runStateBefore = result.current.run.state

    act(() => {
      result.current.proposal.dispatch({ type: 'SET_SITUATION_FIELD', key: 'drowsiness_level', value: 91 })
    })

    expect(result.current.proposal.state.world.situation.drowsiness_level).toBe(91)
    // A world/situation setup edit is proposalStore-only — runStore is the
    // exact same object reference, never touched.
    expect(result.current.run.state).toBe(runStateBefore)
  })

  it('dispatching several proposal setup-edit actions in a row never mutates runStore state (FR-025)', () => {
    function wrapper({ children }: { children: React.ReactNode }) {
      return React.createElement(
        RunStoreProvider,
        null,
        React.createElement(ProposalStoreProvider, null, children),
      )
    }

    const { result } = renderHook(
      () => ({ proposal: useProposalStore(), run: useRunStore() }),
      { wrapper },
    )

    const runStateBefore = result.current.run.state

    act(() => {
      result.current.proposal.dispatch({ type: 'SET_TRIGGER_PURPOSE', purpose: 'route_music' })
      result.current.proposal.dispatch({ type: 'SET_LIFECYCLE_STAGE', stage: 'active_driving_content' })
      result.current.proposal.dispatch({ type: 'SET_MOTION_STATE', motionState: 'driving' })
      result.current.proposal.dispatch({ type: 'SET_SITUATION_FIELD', key: 'road_type', value: 'mountain' })
    })

    expect(result.current.proposal.state.triggerPurpose).toBe('route_music')
    expect(result.current.proposal.state.lifecycleStage).toBe('active_driving_content')
    expect(result.current.proposal.state.motionState).toBe('driving')
    expect(result.current.proposal.state.world.situation.road_type).toBe('mountain')
    expect(result.current.run.state).toBe(runStateBefore)
  })

  it('proposalStore module source does not import runStore', () => {
    // Only actual import/require statements matter — prose comments are free to
    // mention runStore.ts descriptively (e.g. "same pattern as runStore.ts").
    const importLines: string[] = proposalStoreSource
      .split('\n')
      .filter((line: string) => /^\s*import\b/.test(line) || /\brequire\(/.test(line))
    expect(importLines.some((line) => /runStore/.test(line))).toBe(false)
  })

  it('LOAD_CASE_WORLD replaces situation + driver_profile together, sets selectedProfileId, and syncs motion_state (bug 3) without mutating runStore', () => {
    function wrapper({ children }: { children: React.ReactNode }) {
      return React.createElement(
        RunStoreProvider,
        null,
        React.createElement(ProposalStoreProvider, null, children),
      )
    }

    const { result } = renderHook(
      () => ({ proposal: useProposalStore(), run: useRunStore() }),
      { wrapper },
    )

    // Dirty the situation first, the way a previously-selected case would
    // have left it — this is the stale-value scenario LOAD_CASE_WORLD exists
    // to clean up.
    act(() => {
      result.current.proposal.dispatch({ type: 'SET_SITUATION_FIELD', key: 'drowsiness_level', value: 91 })
      result.current.proposal.dispatch({ type: 'SET_SITUATION_FIELD', key: 'road_type', value: 'mountain' })
    })

    const runStateBefore = result.current.run.state

    act(() => {
      result.current.proposal.dispatch({
        type: 'LOAD_CASE_WORLD',
        profileId: 'case-b-profile',
        profile: CASE_DRIVER_PROFILE,
        situation: CASE_SITUATION,
      })
    })

    const { world, selectedProfileId, motionState } = result.current.proposal.state

    // The stale fields from the earlier dispatches are gone — situation is
    // the case's fresh baseline, not a merge with the old edits.
    expect(world.situation).toEqual(CASE_SITUATION)
    expect(world.driver_profile).toEqual(CASE_DRIVER_PROFILE)
    expect(selectedProfileId).toBe('case-b-profile')

    // motion_state double-write invariant: derived from
    // action.situation.motion_state ('driving'), synced into
    // control_inputs, situation, and the top-level mirror.
    expect(world.situation.motion_state).toBe('driving')
    expect(world.control_inputs.motion_state).toBe('driving')
    expect(motionState).toBe('driving')

    // Isolation — runStore is never touched by a proposalStore dispatch.
    expect(result.current.run.state).toBe(runStateBefore)
  })

  it('LOAD_CASE_WORLD falls back to the current motionState when the case situation omits motion_state', () => {
    function wrapper({ children }: { children: React.ReactNode }) {
      return React.createElement(
        RunStoreProvider,
        null,
        React.createElement(ProposalStoreProvider, null, children),
      )
    }

    const { result } = renderHook(
      () => ({ proposal: useProposalStore(), run: useRunStore() }),
      { wrapper },
    )

    act(() => {
      result.current.proposal.dispatch({ type: 'SET_MOTION_STATE', motionState: 'driving' })
    })

    // `motion_state` cast away via `unknown` to simulate a situation payload
    // that omits it (Situation types it as required, but the fallback exists
    // for real-world data that may not carry it).
    const { motion_state: _omitted, ...rest } = CASE_SITUATION
    const situationWithoutMotion = rest as unknown as Situation

    act(() => {
      result.current.proposal.dispatch({
        type: 'LOAD_CASE_WORLD',
        profileId: 'case-c-profile',
        profile: CASE_DRIVER_PROFILE,
        situation: situationWithoutMotion,
      })
    })

    const { world, motionState } = result.current.proposal.state
    expect(motionState).toBe('driving')
    expect(world.situation.motion_state).toBe('driving')
    expect(world.control_inputs.motion_state).toBe('driving')
  })
})
