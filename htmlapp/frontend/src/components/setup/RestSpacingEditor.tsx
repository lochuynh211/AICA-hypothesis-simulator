/**
 * RestSpacingEditor — setup-time minimum distance between rest spots control.
 *
 * Sets the minimum spacing (km) between rest spots returned by GET /rest-spots.
 * Empty input → null (backend uses the default 20 km spacing).
 */
import { useState, useEffect } from 'react'
import { useRunStore } from '../../state/runStore'
import { t } from '../../i18n/t'

export default function RestSpacingEditor() {
  const { state, dispatch } = useRunStore()
  const { uiLanguage, selectedScenarioId } = state
  const [inputValue, setInputValue] = useState<number | null>(null)

  // Re-sync the displayed input when the scenario changes: the store clears
  // minRestSpacingKm on SELECT_SCENARIO, so the input must clear too
  // (otherwise a stale typed value would be shown while the override is null).
  useEffect(() => {
    setInputValue(null)
  }, [selectedScenarioId])

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value
    if (raw === '') {
      setInputValue(null)
      dispatch({ type: 'SET_MIN_REST_SPACING_KM', value: null })
      return
    }
    const parsed = parseFloat(raw)
    if (!isNaN(parsed) && parsed >= 1) {
      setInputValue(parsed)
      dispatch({ type: 'SET_MIN_REST_SPACING_KM', value: parsed })
    } else {
      setInputValue(null)
      dispatch({ type: 'SET_MIN_REST_SPACING_KM', value: null })
    }
  }

  function handleReset() {
    setInputValue(null)
    dispatch({ type: 'SET_MIN_REST_SPACING_KM', value: null })
  }

  const label = t(
    { ja: '休憩場所間の最小距離（km）', en: 'Min. distance between rest spots (km)' },
    uiLanguage,
  )
  const hint = t(
    { ja: '（デフォルト: 20 km）', en: '(default 20 km)' },
    uiLanguage,
  )
  const resetLabel = t({ ja: 'クリア', en: 'Clear' }, uiLanguage)

  return (
    <div
      data-testid="rest-spacing-editor"
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
        <label htmlFor="rest-spacing-input" style={{ color: '#374151', flexShrink: 0 }}>
          {label}
        </label>
        <input
          id="rest-spacing-input"
          data-testid="rest-spacing-input"
          type="number"
          min={1}
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
          data-testid="rest-spacing-reset"
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
