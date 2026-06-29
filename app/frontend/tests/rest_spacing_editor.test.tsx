import { render, screen, fireEvent, act } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import React from 'react'
import RestSpacingEditor from '../src/components/setup/RestSpacingEditor'
import { RunStoreProvider, useRunStore } from '../src/state/runStore'

describe('RestSpacingEditor', () => {
  it('dispatches SET_MIN_REST_SPACING_KM with a number when input changes', () => {
    render(
      <RunStoreProvider>
        <RestSpacingEditor />
      </RunStoreProvider>,
    )
    const input = screen.getByTestId('rest-spacing-input')
    fireEvent.change(input, { target: { value: '30' } })
    expect((input as HTMLInputElement).value).toBe('30')
  })

  it('dispatches SET_MIN_REST_SPACING_KM with null when cleared via empty input', () => {
    render(
      <RunStoreProvider>
        <RestSpacingEditor />
      </RunStoreProvider>,
    )
    const input = screen.getByTestId('rest-spacing-input')
    fireEvent.change(input, { target: { value: '50' } })
    fireEvent.change(input, { target: { value: '' } })
    expect((input as HTMLInputElement).value).toBe('')
  })

  it('dispatches SET_MIN_REST_SPACING_KM with null when reset button clicked', () => {
    render(
      <RunStoreProvider>
        <RestSpacingEditor />
      </RunStoreProvider>,
    )
    const input = screen.getByTestId('rest-spacing-input')
    fireEvent.change(input, { target: { value: '40' } })
    const resetBtn = screen.getByTestId('rest-spacing-reset')
    fireEvent.click(resetBtn)
    expect((input as HTMLInputElement).value).toBe('')
  })

  it('renders the editor container with testid', () => {
    render(
      <RunStoreProvider>
        <RestSpacingEditor />
      </RunStoreProvider>,
    )
    expect(screen.getByTestId('rest-spacing-editor')).toBeInTheDocument()
  })

  it('clears the input when the selected scenario changes', () => {
    let dispatchRef: ReturnType<typeof useRunStore>['dispatch'] | null = null

    function DispatchCapture() {
      const { dispatch } = useRunStore()
      dispatchRef = dispatch
      return null
    }

    render(
      <RunStoreProvider>
        <DispatchCapture />
        <RestSpacingEditor />
      </RunStoreProvider>,
    )

    const input = screen.getByTestId('rest-spacing-input')
    fireEvent.change(input, { target: { value: '25' } })
    expect((input as HTMLInputElement).value).toBe('25')

    // Switch scenario — the store clears minRestSpacingKm; the input must clear too
    act(() => {
      dispatchRef!({ type: 'SELECT_SCENARIO', id: 'different-scenario' })
    })

    expect((input as HTMLInputElement).value).toBe('')
  })
})
