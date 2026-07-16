import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import React from 'react'
import proposalStoreSource from '../src/state/proposalStore.ts?raw'
import { ProposalStoreProvider, useProposalStore } from '../src/state/proposalStore'
import { RunStoreProvider, useRunStore } from '../src/state/runStore'

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

  it('dispatching a setup-edit action (SET_FEATURE_FIELD) on the proposal store does not mutate runStore state (FR-025)', () => {
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
      result.current.proposal.dispatch({ type: 'SET_FEATURE_FIELD', key: 'drowsiness_level', value: 91 })
    })

    expect(result.current.proposal.state.featureSnapshot.drowsiness_level).toBe(91)
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
      result.current.proposal.dispatch({ type: 'SET_FEATURE_FIELD', key: 'road_type', value: 'mountain' })
    })

    expect(result.current.proposal.state.triggerPurpose).toBe('route_music')
    expect(result.current.proposal.state.lifecycleStage).toBe('active_driving_content')
    expect(result.current.proposal.state.motionState).toBe('driving')
    expect(result.current.proposal.state.featureSnapshot.road_type).toBe('mountain')
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
})
