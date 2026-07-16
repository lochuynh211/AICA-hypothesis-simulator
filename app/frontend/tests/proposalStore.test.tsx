import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import React from 'react'
import { ProposalStoreProvider, useProposalStore } from '../src/state/proposalStore'

function wrapper({ children }: { children: React.ReactNode }) {
  return React.createElement(ProposalStoreProvider, null, children)
}

describe('proposalStore', () => {
  it('defaults uiLanguage to "ja"', () => {
    const { result } = renderHook(() => useProposalStore(), { wrapper })
    expect(result.current.state.uiLanguage).toBe('ja')
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
})
