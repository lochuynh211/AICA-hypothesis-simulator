/**
 * TickSecondsEditor — setup-time tick duration control.
 *
 * Prefills from the selected scenario's `tick_seconds`. The user may override it
 * with any positive integer. Editing dispatches SET_TICK_SECONDS; resetting
 * clears the override (back to null) so the scenario default is used.
 *
 * Only rendered once a scenario is selected and its def has loaded.
 * Mirrors the ProfileEditor lifecycle for SELECT_SCENARIO / RESET.
 */

import { useState, useEffect } from 'react'
import { useRunStore } from '../../state/runStore'
import { getScenario } from '../../api/client'
import { t } from '../../i18n/t'

export default function TickSecondsEditor() {
  const { state, dispatch } = useRunStore()
  const { selectedScenarioId, uiLanguage } = state

  // Scenario default loaded from the API; null while loading / no scenario.
  const [scenarioDefault, setScenarioDefault] = useState<number | null>(null)
  // The value shown in the input. Tracks both the prefill and user edits.
  const [inputValue, setInputValue] = useState<number | null>(null)

  // Fetch scenario def and prefill when scenario changes.
  useEffect(() => {
    if (!selectedScenarioId) {
      setScenarioDefault(null)
      setInputValue(null)
      dispatch({ type: 'SET_TICK_SECONDS', seconds: null })
      return
    }

    let cancelled = false
    getScenario(selectedScenarioId)
      .then((def) => {
        if (cancelled) return
        setScenarioDefault(def.tick_seconds)
        setInputValue(def.tick_seconds)
        // Scenario switched — always clear any prior override.
        dispatch({ type: 'SET_TICK_SECONDS', seconds: null })
      })
      .catch(() => {
        if (!cancelled) {
          setScenarioDefault(null)
          setInputValue(null)
        }
      })

    return () => {
      cancelled = true
    }
  }, [selectedScenarioId, dispatch])

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value
    const parsed = parseInt(raw, 10)
    // Allow the input to show the raw value (including empty / in-progress edit)
    // but only update the store override when the value is valid (> 0).
    if (raw === '') {
      setInputValue(null)
      dispatch({ type: 'SET_TICK_SECONDS', seconds: null })
      return
    }
    setInputValue(isNaN(parsed) ? null : parsed)
    if (!isNaN(parsed) && parsed > 0 && parsed !== scenarioDefault) {
      dispatch({ type: 'SET_TICK_SECONDS', seconds: parsed })
    } else {
      // Value is same as default, zero, negative, or non-integer → no override.
      dispatch({ type: 'SET_TICK_SECONDS', seconds: null })
    }
  }

  function handleReset() {
    setInputValue(scenarioDefault)
    dispatch({ type: 'SET_TICK_SECONDS', seconds: null })
  }

  // Don't render until a scenario is selected and its def is loaded.
  if (!selectedScenarioId || scenarioDefault === null) return null

  const label = t({ ja: 'ティック秒数', en: 'Tick seconds' }, uiLanguage)
  const resetLabel = t({ ja: 'デフォルトに戻す', en: 'Reset to default' }, uiLanguage)
  const hint = `${t({ ja: 'シナリオのデフォルト', en: 'Scenario default' }, uiLanguage)}: ${scenarioDefault}s`

  return (
    <div
      data-testid="tick-seconds-editor"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        padding: '6px 0',
        fontSize: '0.8em',
      }}
    >
      <label
        htmlFor="tick-seconds-input"
        style={{ color: '#374151', flexShrink: 0 }}
      >
        {label}
      </label>
      <input
        id="tick-seconds-input"
        data-testid="tick-seconds-input"
        type="number"
        min={1}
        step={1}
        value={inputValue ?? ''}
        onChange={handleChange}
        style={{
          width: '80px',
          padding: '3px 6px',
          border: '1px solid #d1d5db',
          borderRadius: '4px',
          fontSize: '0.9em',
          color: '#1f2937',
        }}
      />
      <span style={{ color: '#9ca3af', fontSize: '0.85em' }}>{hint}</span>
      <button
        data-testid="tick-seconds-reset"
        onClick={handleReset}
        title={resetLabel}
        style={{
          fontSize: '0.75em',
          padding: '2px 8px',
          border: '1px solid #d1d5db',
          borderRadius: '4px',
          background: '#f9fafb',
          color: '#6b7280',
          cursor: 'pointer',
          flexShrink: 0,
        }}
      >
        {resetLabel}
      </button>
    </div>
  )
}
