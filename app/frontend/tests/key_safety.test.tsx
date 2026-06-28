/**
 * T016 — Frontend key safety: SET_MAPS_KEY must never write to localStorage or sessionStorage.
 */
import React from 'react'
import { act } from '@testing-library/react'
import { renderHook } from '@testing-library/react'
import { describe, it, expect, beforeEach } from 'vitest'
import { RunStoreProvider, useRunStore } from '../src/state/runStore'

const SENTINEL = 'SENTINEL_KEY_DO_NOT_LEAK_FE'

describe('Maps key safety — frontend (T016)', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
  })

  it('SET_MAPS_KEY never writes the key to localStorage or sessionStorage', () => {
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(RunStoreProvider, null, children)
    const { result } = renderHook(() => useRunStore(), { wrapper })

    act(() => result.current.dispatch({ type: 'SET_MAPS_KEY', key: SENTINEL }))

    // Key is in store (in-memory)
    expect(result.current.state.mapsKey).toBe(SENTINEL)

    // Key is NOT in web storage
    const lsStr = JSON.stringify(Object.fromEntries(Object.entries({ ...localStorage })))
    const ssStr = JSON.stringify(Object.fromEntries(Object.entries({ ...sessionStorage })))
    expect(lsStr).not.toContain(SENTINEL)
    expect(ssStr).not.toContain(SENTINEL)
  })

  it('RESET clears the key from the store and it was never in web storage', () => {
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(RunStoreProvider, null, children)
    const { result } = renderHook(() => useRunStore(), { wrapper })

    act(() => result.current.dispatch({ type: 'SET_MAPS_KEY', key: SENTINEL }))
    act(() => result.current.dispatch({ type: 'RESET' }))

    expect(result.current.state.mapsKey).toBe('')
    expect(localStorage.length).toBe(0)
    expect(sessionStorage.length).toBe(0)
  })
})
