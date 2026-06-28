/**
 * RecoveryPicker — option + rest-spot selection overlay for UC-01 rest proposals.
 *
 * Rendered when the run is paused on a REST_PROPOSAL
 * (state.paused && state.latestDecision?.proposal).  Reads the scenario's
 * recovery_options via getScenario() and fetches candidate rest spots via
 * getRestSpots().  The reviewer selects a spot (required for non-postpone
 * options) then clicks an option to confirm; postpone/decline need no spot.
 *
 * On confirm:
 *   actRun(runId, opt.postpone ? 'postpone' : 'accept_rest',
 *          opt.postpone ? {} : { recovery_option_id: opt.id, rest_spot })
 * then dispatches ACTION_APPLIED so the store reflects the resumed state.
 */

import { useEffect, useState } from 'react'
import { useRunStore } from '../../state/runStore'
import { getScenario, getRestSpots, actRun } from '../../api/client'
import type { RecoveryOption, RestSpot } from '../../api/types'
import { t } from '../../i18n/t'

export default function RecoveryPicker() {
  const { state, dispatch } = useRunStore()
  const { runState, selectedScenarioId, mapsKey, uiLanguage, paused, latestDecision } = state

  const [options, setOptions] = useState<RecoveryOption[]>([])
  const [spots, setSpots] = useState<RestSpot[]>([])
  const [selectedSpot, setSelectedSpot] = useState<RestSpot | null>(null)
  const [loading, setLoading] = useState(false)
  const [fetchError, setFetchError] = useState<string | null>(null)

  useEffect(() => {
    if (!selectedScenarioId || !runState) return

    const runId = runState.run_id
    setLoading(true)
    setFetchError(null)
    setSelectedSpot(null)

    Promise.all([
      getScenario(selectedScenarioId),
      getRestSpots(runId, mapsKey || undefined),
    ])
      .then(([scenario, spotsResp]) => {
        setOptions(scenario.recovery_options ?? [])
        setSpots(spotsResp.rest_spots)
      })
      .catch((err: unknown) => {
        setFetchError(err instanceof Error ? err.message : 'Failed to load recovery options')
      })
      .finally(() => setLoading(false))
  }, [selectedScenarioId, runState?.run_id, mapsKey])

  // Only visible when the run is paused on an active REST_PROPOSAL
  if (!paused || !latestDecision?.proposal || !runState) return null

  const runId = runState.run_id
  const allowedActions = runState.allowed_actions ?? []

  async function handleOption(opt: RecoveryOption) {
    // Non-postpone options require a rest spot selection
    if (!opt.postpone && selectedSpot === null) return

    const action = opt.postpone ? 'postpone' : 'accept_rest'
    const opts = opt.postpone
      ? {}
      : { recovery_option_id: opt.id, rest_spot: selectedSpot! }

    try {
      const newRunState = await actRun(runId, action, opts)
      dispatch({ type: 'ACTION_APPLIED', runState: newRunState, action })
    } catch (err: unknown) {
      dispatch({
        type: 'SET_RUN_ERROR',
        message: err instanceof Error ? err.message : 'Action failed',
      })
    }
  }

  async function handleDecline() {
    try {
      const newRunState = await actRun(runId, 'decline')
      dispatch({ type: 'ACTION_APPLIED', runState: newRunState, action: 'decline' })
    } catch (err: unknown) {
      dispatch({
        type: 'SET_RUN_ERROR',
        message: err instanceof Error ? err.message : 'Action failed',
      })
    }
  }

  if (loading) {
    return (
      <div data-testid="recovery-picker" style={{ padding: '16px' }}>
        {t({ ja: '読み込み中…', en: 'Loading…' }, uiLanguage)}
      </div>
    )
  }

  if (fetchError) {
    return (
      <div data-testid="recovery-picker" style={{ padding: '16px', color: '#c00' }}>
        {fetchError}
      </div>
    )
  }

  return (
    <div
      data-testid="recovery-picker"
      style={{
        padding: '16px',
        border: '2px solid #5bc0be',
        borderRadius: '8px',
        background: '#f0fbff',
      }}
    >
      <h3 style={{ marginBottom: '12px', fontSize: '1em', fontWeight: 700 }}>
        {t({ ja: '休憩オプションを選択', en: 'Choose a Rest Option' }, uiLanguage)}
      </h3>

      {/* Rest spot list */}
      {spots.length > 0 && (
        <div style={{ marginBottom: '16px' }}>
          <p
            style={{ fontSize: '0.85em', fontWeight: 600, marginBottom: '8px', color: '#555' }}
          >
            {t({ ja: '休憩場所', en: 'Rest Spot' }, uiLanguage)}
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
            {spots.map((spot) => {
              const selected = selectedSpot?.id === spot.id
              return (
                <button
                  key={spot.id}
                  data-testid={`rest-spot-${spot.id}`}
                  onClick={() => setSelectedSpot(spot)}
                  style={{
                    padding: '6px 12px',
                    border: selected ? '2px solid #0ea5e9' : '1px solid #ccc',
                    borderRadius: '4px',
                    background: selected ? '#e0f2fe' : '#fff',
                    cursor: 'pointer',
                    fontWeight: selected ? 700 : 400,
                  }}
                >
                  {t(spot.label, uiLanguage)}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Recovery option cards */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
        {options.map((opt) => {
          const needsSpot = !opt.postpone
          const disabled = needsSpot && selectedSpot === null
          return (
            <button
              key={opt.id}
              data-testid={`recovery-option-${opt.id}`}
              onClick={() => handleOption(opt)}
              disabled={disabled}
              style={{
                padding: '8px 16px',
                border: `1px solid ${disabled ? '#ccc' : '#5bc0be'}`,
                borderRadius: '4px',
                background: disabled ? '#eee' : '#0ea5e9',
                color: disabled ? '#888' : '#fff',
                cursor: disabled ? 'not-allowed' : 'pointer',
                fontWeight: 600,
              }}
            >
              {t(opt.label, uiLanguage)}
            </button>
          )
        })}

        {/* Decline — only when the backend allows it */}
        {allowedActions.includes('decline') && (
          <button
            data-testid="recovery-option-decline"
            onClick={handleDecline}
            style={{
              padding: '8px 16px',
              border: '1px solid #e57373',
              borderRadius: '4px',
              background: '#fff',
              color: '#e57373',
              cursor: 'pointer',
              fontWeight: 600,
            }}
          >
            {t({ ja: '断る', en: 'Decline' }, uiLanguage)}
          </button>
        )}
      </div>
    </div>
  )
}
