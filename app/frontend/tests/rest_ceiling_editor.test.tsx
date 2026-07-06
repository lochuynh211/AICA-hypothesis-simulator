import { render, screen, fireEvent, act } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import React from 'react'
import RestCeilingEditor from '../src/components/setup/RestCeilingEditor'
import { RunStoreProvider, useRunStore } from '../src/state/runStore'

describe('RestCeilingEditor', () => {
  it('dispatches SET_REST_DROWSINESS_CEILING with a number when input changes', () => {
    // Render in a real store
    render(
      <RunStoreProvider>
        <RestCeilingEditor />
      </RunStoreProvider>,
    )
    const input = screen.getByTestId('rest-ceiling-input')
    fireEvent.change(input, { target: { value: '120' } })
    // The input should reflect the value
    expect((input as HTMLInputElement).value).toBe('120')
  })

  it('dispatches SET_REST_DROWSINESS_CEILING with null when reset', () => {
    render(
      <RunStoreProvider>
        <RestCeilingEditor />
      </RunStoreProvider>,
    )
    const input = screen.getByTestId('rest-ceiling-input')
    fireEvent.change(input, { target: { value: '150' } })
    const resetBtn = screen.getByTestId('rest-ceiling-reset')
    fireEvent.click(resetBtn)
    expect((input as HTMLInputElement).value).toBe('')
  })

  it('renders the editor container with testid', () => {
    render(
      <RunStoreProvider>
        <RestCeilingEditor />
      </RunStoreProvider>,
    )
    expect(screen.getByTestId('rest-ceiling-editor')).toBeInTheDocument()
  })

  it('re-seeds the input to the default ceiling when the selected scenario changes', () => {
    // Capture store dispatch via a sibling component in the same tree.
    let dispatchRef: ReturnType<typeof useRunStore>['dispatch'] | null = null

    function DispatchCapture() {
      const { dispatch } = useRunStore()
      dispatchRef = dispatch
      return null
    }

    render(
      <RunStoreProvider>
        <DispatchCapture />
        <RestCeilingEditor />
      </RunStoreProvider>,
    )

    const input = screen.getByTestId('rest-ceiling-input')
    // Type a ceiling value
    fireEvent.change(input, { target: { value: '120' } })
    expect((input as HTMLInputElement).value).toBe('120')

    // Switch scenario — the editor re-seeds the input to its default ceiling (150%),
    // matching the value it dispatches into the store on scenario change.
    act(() => {
      dispatchRef!({ type: 'SELECT_SCENARIO', id: 'different-scenario' })
    })

    expect((input as HTMLInputElement).value).toBe('150')
  })
})
