/**
 * InitialSignalValue — per-signal setup-time "starting value" control that lives
 * inside the drowsiness / fatigue Simulated-signal block.
 *
 * Tests:
 * (1) Prefills from the scenario's initial_state (numeric) — display-only, so
 *     the store override stays null until the user edits.
 * (2) Prefills from a band string (severe→80) via the backend-mirrored map.
 * (3) Typing a value dispatches SET_INITIAL_FATIGUE for the fatigue control.
 * (4) Reverting to the scenario default clears the override back to null.
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { useEffect } from 'react'
import { RunStoreProvider, useRunStore } from '../src/state/runStore'
import InitialSignalValue from '../src/components/setup/InitialSignalValue'
import type { ScenarioDef } from '../src/api/types'

const scenario = {
  id: 'sc',
  initial_state: { drowsiness_level: 20, fatigue_level: 'high' },
} as unknown as ScenarioDef

/** Reads initialDrowsiness + initialFatigue from the store into refs. */
function makeStateCapture() {
  const drowsinessRef: { current: number | null } = { current: null }
  const fatigueRef: { current: number | null } = { current: null }
  function StateCapture() {
    const { state } = useRunStore()
    useEffect(() => {
      drowsinessRef.current = state.initialDrowsiness
      fatigueRef.current = state.initialFatigue
    })
    return null
  }
  return { drowsinessRef, fatigueRef, StateCapture }
}

function renderControl(node: React.ReactElement) {
  return render(<RunStoreProvider initialLanguage="en">{node}</RunStoreProvider>)
}

describe('InitialSignalValue', () => {
  it('(1) prefills drowsiness from numeric initial_state, store stays null', async () => {
    const { drowsinessRef, StateCapture } = makeStateCapture()
    renderControl(
      <>
        <StateCapture />
        <InitialSignalValue signalKey="drowsiness" scenario={scenario} />
      </>,
    )
    expect(screen.getByTestId('initial-value-input-drowsiness')).toHaveValue(20)
    await waitFor(() => expect(drowsinessRef.current).toBeNull())
  })

  it('(2) prefills fatigue from a band string (high→60)', () => {
    renderControl(<InitialSignalValue signalKey="fatigue" scenario={scenario} />)
    expect(screen.getByTestId('initial-value-input-fatigue')).toHaveValue(60)
  })

  it('(3) typing a fatigue value dispatches the override into the store', async () => {
    const { fatigueRef, StateCapture } = makeStateCapture()
    renderControl(
      <>
        <StateCapture />
        <InitialSignalValue signalKey="fatigue" scenario={scenario} />
      </>,
    )
    fireEvent.change(screen.getByTestId('initial-value-input-fatigue'), { target: { value: '75' } })
    await waitFor(() => expect(fatigueRef.current).toBe(75))
  })

  it('(4) reverting to the scenario default clears the override to null', async () => {
    const { fatigueRef, StateCapture } = makeStateCapture()
    renderControl(
      <>
        <StateCapture />
        <InitialSignalValue signalKey="fatigue" scenario={scenario} />
      </>,
    )
    const input = screen.getByTestId('initial-value-input-fatigue')
    fireEvent.change(input, { target: { value: '75' } })
    await waitFor(() => expect(fatigueRef.current).toBe(75))
    // Back to the default (band high → 60): override clears.
    fireEvent.change(input, { target: { value: '60' } })
    await waitFor(() => expect(fatigueRef.current).toBeNull())
  })
})
