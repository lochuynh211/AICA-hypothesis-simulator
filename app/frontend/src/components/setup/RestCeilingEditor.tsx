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
  // Raised 150 -> 300 (owner review, 2026-08-08). With the retuned content rates
  // the rest trigger fires later and drowsiness is often already near 100, so at
  // 150 the projected arrival value cleared the ceiling and spots came back
  // `reachable: false` — the picker greyed them out and the driver could not take
  // a rest at all. This gate is display-only advisory, deliberately separate from
  // the algorithm's firing threshold.
  const DEFAULT_CEILING = 300
  const [inputValue, setInputValue] = useState<number | null>(DEFAULT_CEILING)

  // Seed the store with the default value on first mount.
  useEffect(() => {
    dispatch({ type: 'SET_REST_DROWSINESS_CEILING', value: DEFAULT_CEILING })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Re-sync the displayed input when the scenario changes.
  useEffect(() => {
    setInputValue(DEFAULT_CEILING)
    dispatch({ type: 'SET_REST_DROWSINESS_CEILING', value: DEFAULT_CEILING })
  }, [selectedScenarioId, dispatch])

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
    { ja: '休憩場所到達限界（眠気%）', en: 'Rest-spot reachability ceiling (drowsiness %)' },
    uiLanguage,
  )
  const hint = t(
    { ja: '（アルゴリズムの発火閾値とは別。デフォルト300%。100超も可）', en: '(Separate from firing threshold; default 300%; may exceed 100)' },
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
