/**
 * feature 019 — proposal store: explanationProvider flag (default off, 3-way).
 */
import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import React from 'react'
import { ProposalStoreProvider, useProposalStore, proposalReducer } from '../src/state/proposalStore'

function wrapper({ children }: { children: React.ReactNode }) {
  return React.createElement(ProposalStoreProvider, null, children)
}

describe('explanationProvider store flag', () => {
  it('defaults to off', () => {
    const { result } = renderHook(() => useProposalStore(), { wrapper })
    expect(result.current.state.explanationProvider).toBe('off')
  })

  it('SET_EXPLANATION_PROVIDER updates the flag (backend, then browser)', () => {
    const { result } = renderHook(() => useProposalStore(), { wrapper })

    act(() => result.current.dispatch({ type: 'SET_EXPLANATION_PROVIDER', provider: 'backend' }))
    expect(result.current.state.explanationProvider).toBe('backend')

    act(() => result.current.dispatch({ type: 'SET_EXPLANATION_PROVIDER', provider: 'browser' }))
    expect(result.current.state.explanationProvider).toBe('browser')
  })

  it('reducer sets the flag without touching other state', () => {
    const before = { explanationProvider: 'off', uiLanguage: 'ja' } as never
    const after = proposalReducer(before, { type: 'SET_EXPLANATION_PROVIDER', provider: 'backend' })
    expect(after.explanationProvider).toBe('backend')
    // unrelated field preserved
    expect((after as { uiLanguage: string }).uiLanguage).toBe('ja')
  })
})
