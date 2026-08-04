import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import React from 'react'
import { RunStoreProvider, useRunStore } from '../src/state/runStore'

/**
 * TS port slice of `app/frontend/tests/runStore.test.tsx`'s SELECT_PACKAGE
 * same-id-preserve regression (mirrors app/frontend commit 40d2da5, "fix
 * bug"): a same-id re-select (e.g. committing a test case, which re-
 * dispatches SELECT_PACKAGE with the trigger package already in state) must
 * NOT wipe the reviewer's editedParameters/editedHyperparameters tuning.
 */

const wrapper = ({ children }: { children: React.ReactNode }) =>
  React.createElement(RunStoreProvider, null, children)

describe('runStore — SELECT_PACKAGE', () => {
  it('SELECT_PACKAGE with a NEW id clears editedParameters/editedHyperparameters', () => {
    const { result } = renderHook(() => useRunStore(), { wrapper })
    act(() => {
      result.current.dispatch({ type: 'SELECT_PACKAGE', id: 'rest_rule_based_v0_1' })
      result.current.dispatch({ type: 'SET_HYPERPARAMETER', key: 'w_drowsiness', value: 0.6 })
      result.current.dispatch({ type: 'SET_PARAMETER', key: 'some_param', value: 1 })
    })
    expect(result.current.state.editedHyperparameters).toEqual({ w_drowsiness: 0.6 })

    act(() => result.current.dispatch({ type: 'SELECT_PACKAGE', id: 'nri_fatigue_score_v1' }))

    expect(result.current.state.selectedPackageId).toBe('nri_fatigue_score_v1')
    expect(result.current.state.editedParameters).toEqual({})
    expect(result.current.state.editedHyperparameters).toEqual({})
  })

  it('SELECT_PACKAGE with the SAME id preserves editedHyperparameters (bug: test-case selection re-dispatches the same trigger package id)', () => {
    const { result } = renderHook(() => useRunStore(), { wrapper })
    act(() => {
      result.current.dispatch({ type: 'SELECT_PACKAGE', id: 'nri_fatigue_score_v1' })
      result.current.dispatch({ type: 'SET_HYPERPARAMETER', key: 'w_drowsiness', value: 0.6 })
    })
    expect(result.current.state.editedHyperparameters).toEqual({ w_drowsiness: 0.6 })

    // Re-selecting the SAME package id (what committing a test case does)
    // must preserve the reviewer's tuning, not reset it.
    act(() => result.current.dispatch({ type: 'SELECT_PACKAGE', id: 'nri_fatigue_score_v1' }))

    expect(result.current.state.selectedPackageId).toBe('nri_fatigue_score_v1')
    expect(result.current.state.editedHyperparameters).toEqual({ w_drowsiness: 0.6 })
  })
})
