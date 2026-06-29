/**
 * RestCeilingEditor — setup-time rest-spot reachability ceiling control.
 *
 * Sets the drowsiness % ceiling used by GET /rest-spots to mark spots reachable.
 * This is SEPARATE from the algorithm's trigger threshold — it controls only the
 * display-only reachability advisory shown in the recovery picker.
 * A value above 100 is valid (lets the driver "overload").
 * Empty input → null (backend uses the scenario's rest_drowsiness_ceiling default).
 */
import { useState, useEffect } from 'react'
import { useRunStore } from '../../state/runStore'
import { t } from '../../i18n/t'

export default function RestCeilingEditor() {
  const { state, dispatch } = useRunStore()
  const { uiLanguage, selectedScenarioId } = state
  const [inputValue, setInputValue] = useState<number | null>(null)

  // Re-sync the displayed input when the scenario changes: the store clears
  // restDrowsinessCeiling on SELECT_SCENARIO, so the input must clear too
  // (otherwise a stale typed value would be shown while the override is null).
  useEffect(() => {
    setInputValue(null)
  }, [selectedScenarioId])

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value
    if (raw === '') {
      setInputValue(null)
      dispatch({ type: 'SET_REST_DROWSINESS_CEILING', value: null })
      return
    }
    const parsed = parseFloat(raw)
    if (!isNaN(parsed) && parsed >= 0) {
      setInputValue(parsed)
      dispatch({ type: 'SET_REST_DROWSINESS_CEILING', value: parsed })
    } else {
      setInputValue(null)
      dispatch({ type: 'SET_REST_DROWSINESS_CEILING', value: null })
    }
  }

  function handleReset() {
    setInputValue(null)
    dispatch({ type: 'SET_REST_DROWSINESS_CEILING', value: null })
  }

  const label = t(
    { ja: '休憩スポット到達限界 (眠気%)', en: 'Rest-spot reachability ceiling (drowsiness %)' },
    uiLanguage,
  )
  const hint = t(
    { ja: '(算法の発火閾値とは別。100超も可)', en: '(Separate from trigger threshold; may exceed 100)' },
    uiLanguage,
  )
  const resetLabel = t({ ja: 'クリア', en: 'Clear' }, uiLanguage)

  return (
    <div
      data-testid="rest-ceiling-editor"
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        flexDirection: 'column',
        gap: '4px',
        padding: '6px 0',
        fontSize: '0.8em',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <label htmlFor="rest-ceiling-input" style={{ color: '#374151', flexShrink: 0 }}>
          {label}
        </label>
        <input
          id="rest-ceiling-input"
          data-testid="rest-ceiling-input"
          type="number"
          min={0}
          max={200}
          step={5}
          value={inputValue ?? ''}
          onChange={handleChange}
          placeholder="—"
          style={{
            width: '80px',
            padding: '3px 6px',
            border: '1px solid #d1d5db',
            borderRadius: '4px',
            fontSize: '0.9em',
            color: '#1f2937',
          }}
        />
        <button
          data-testid="rest-ceiling-reset"
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
      <span style={{ color: '#9ca3af', fontSize: '0.85em' }}>{hint}</span>
    </div>
  )
}
