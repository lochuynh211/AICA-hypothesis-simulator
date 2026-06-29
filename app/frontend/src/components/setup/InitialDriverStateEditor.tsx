/**
 * InitialDriverStateEditor — setup-time control for the driver's starting
 * drowsiness and fatigue levels.
 *
 * Prefills from the selected scenario's `initial_state` field, converting band
 * strings to numeric values using the same maps as the backend tick engine.
 * The prefill is DISPLAY-ONLY: the store override stays null until the user
 * explicitly types a value (so unedited = scenario default, and `initial_state`
 * is omitted from the run-plan body).
 *
 * Only rendered once a scenario is selected and its def has loaded.
 * Mirrors the TickSecondsEditor lifecycle for SELECT_SCENARIO / RESET.
 */

import { useState, useEffect } from 'react'
import { useRunStore } from '../../state/runStore'
import { getScenario } from '../../api/client'
import { t } from '../../i18n/t'

// Mirrors backend tick_engine._initial_drowsiness band→number mapping.
const DROWSINESS_BAND_TO_NUM: Record<string, number> = {
  none: 0,
  weak: 20,
  moderate: 40,
  strong: 60,
  severe: 80,
}

// Mirrors backend tick_engine._initial_fatigue band→number mapping.
const FATIGUE_BAND_TO_NUM: Record<string, number> = {
  low: 0,
  medium: 30,
  high: 60,
}

function bandToNum(raw: unknown, map: Record<string, number>): number | null {
  if (typeof raw === 'number') return raw
  if (typeof raw === 'string' && raw in map) return map[raw]
  return null
}

export default function InitialDriverStateEditor() {
  const { state, dispatch } = useRunStore()
  const { selectedScenarioId, uiLanguage } = state

  // Whether the scenario def has been loaded successfully.
  const [loaded, setLoaded] = useState(false)
  // Displayed values in the inputs (null = empty / no prefill available).
  const [drowsinessValue, setDrowsinessValue] = useState<number | null>(null)
  const [fatigueValue, setFatigueValue] = useState<number | null>(null)

  // Fetch scenario def and prefill when scenario changes.
  useEffect(() => {
    if (!selectedScenarioId) {
      setLoaded(false)
      setDrowsinessValue(null)
      setFatigueValue(null)
      dispatch({ type: 'SET_INITIAL_DROWSINESS', value: null })
      dispatch({ type: 'SET_INITIAL_FATIGUE', value: null })
      return
    }

    let cancelled = false
    getScenario(selectedScenarioId)
      .then((def) => {
        if (cancelled) return
        const raw = def.initial_state ?? {}
        const d = bandToNum(raw.drowsiness_level, DROWSINESS_BAND_TO_NUM)
        const f = bandToNum(raw.fatigue_level, FATIGUE_BAND_TO_NUM)
        setDrowsinessValue(d)
        setFatigueValue(f)
        // Scenario switched — always clear any prior override (prefill is display-only).
        dispatch({ type: 'SET_INITIAL_DROWSINESS', value: null })
        dispatch({ type: 'SET_INITIAL_FATIGUE', value: null })
        setLoaded(true)
      })
      .catch(() => {
        if (!cancelled) {
          setDrowsinessValue(null)
          setFatigueValue(null)
          setLoaded(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [selectedScenarioId, dispatch])

  function handleDrowsinessChange(e: React.ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value
    if (raw === '') {
      setDrowsinessValue(null)
      dispatch({ type: 'SET_INITIAL_DROWSINESS', value: null })
      return
    }
    const parsed = parseInt(raw, 10)
    if (isNaN(parsed)) return
    setDrowsinessValue(parsed)
    dispatch({ type: 'SET_INITIAL_DROWSINESS', value: parsed })
  }

  function handleFatigueChange(e: React.ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value
    if (raw === '') {
      setFatigueValue(null)
      dispatch({ type: 'SET_INITIAL_FATIGUE', value: null })
      return
    }
    const parsed = parseInt(raw, 10)
    if (isNaN(parsed)) return
    setFatigueValue(parsed)
    dispatch({ type: 'SET_INITIAL_FATIGUE', value: parsed })
  }

  // Don't render until a scenario is selected and its def is loaded.
  if (!selectedScenarioId || !loaded) return null

  const drowsinessLabel = t({ ja: '初期眠気 (0–100)', en: 'Initial drowsiness (0–100)' }, uiLanguage)
  const fatigueLabel = t({ ja: '初期疲労 (0–100)', en: 'Initial fatigue (0–100)' }, uiLanguage)
  const helperNote = t(
    {
      ja: '運転開始時の状態 (0=覚醒, 100=深刻)。空欄でシナリオ既定値を使用。',
      en: 'Starting driver state (0 = alert, 100 = severe). Leave blank to use the scenario default.',
    },
    uiLanguage,
  )

  const inputStyle: React.CSSProperties = {
    width: '80px',
    padding: '3px 6px',
    border: '1px solid #d1d5db',
    borderRadius: '4px',
    fontSize: '0.9em',
    color: '#1f2937',
  }

  const labelStyle: React.CSSProperties = {
    color: '#374151',
    flexShrink: 0,
  }

  return (
    <div
      data-testid="initial-driver-state-editor"
      style={{ fontSize: '0.8em', padding: '6px 0' }}
    >
      {/* Drowsiness row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
        <label htmlFor="initial-drowsiness-input" style={labelStyle}>
          {drowsinessLabel}
        </label>
        <input
          id="initial-drowsiness-input"
          data-testid="initial-drowsiness-input"
          type="number"
          min={0}
          max={100}
          step={5}
          value={drowsinessValue ?? ''}
          onChange={handleDrowsinessChange}
          style={inputStyle}
        />
      </div>

      {/* Fatigue row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
        <label htmlFor="initial-fatigue-input" style={labelStyle}>
          {fatigueLabel}
        </label>
        <input
          id="initial-fatigue-input"
          data-testid="initial-fatigue-input"
          type="number"
          min={0}
          max={100}
          step={5}
          value={fatigueValue ?? ''}
          onChange={handleFatigueChange}
          style={inputStyle}
        />
      </div>

      {/* Helper note */}
      <span style={{ color: '#9ca3af', fontSize: '0.85em' }}>{helperNote}</span>
    </div>
  )
}
