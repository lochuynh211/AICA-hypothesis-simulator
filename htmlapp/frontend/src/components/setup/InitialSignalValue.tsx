/**
 * InitialSignalValue — setup-time control for a Simulated tier-3 signal's
 * STARTING value (drowsiness or fatigue), rendered inline inside that signal's
 * block in SignalsPanel (so "initial drowsiness" lives in the drowsiness
 * section, "initial fatigue" in the fatigue section).
 *
 * Prefills from the selected scenario's `initial_state` (band string or number,
 * mapped with the same tables as the backend tick engine). The prefill is
 * DISPLAY-ONLY: the store override (initialDrowsiness / initialFatigue) stays
 * null until the user types a different value, so an unedited control leaves
 * `initial_state` out of the run body and the backend applies the scenario
 * default — same sparse "changed-from-default only" discipline as the tick /
 * weather / speed / hyperparameter controls.
 *
 * Styling mirrors the tick-duration and speed-profile fields (56px numeric box,
 * indigo highlight when overridden) so the left panel reads as one system.
 */

import { type ChangeEvent } from 'react'
import { useRunStore } from '../../state/runStore'
import type { ScenarioDef } from '../../api/types'
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

function bandToNum(raw: unknown, map: Record<string, number>): number {
  if (typeof raw === 'number') return raw
  if (typeof raw === 'string' && raw in map) return map[raw]
  return 0
}

export default function InitialSignalValue({
  signalKey,
  scenario,
}: {
  signalKey: 'drowsiness' | 'fatigue'
  scenario: ScenarioDef
}) {
  const { state, dispatch } = useRunStore()
  const { uiLanguage, initialDrowsiness, initialFatigue } = state

  const isDrowsiness = signalKey === 'drowsiness'
  const rawDefault = isDrowsiness
    ? scenario.initial_state?.drowsiness_level
    : scenario.initial_state?.fatigue_level
  const defaultValue = bandToNum(rawDefault, isDrowsiness ? DROWSINESS_BAND_TO_NUM : FATIGUE_BAND_TO_NUM)

  const override = isDrowsiness ? initialDrowsiness : initialFatigue
  const value = override ?? defaultValue
  const changed = override != null && override !== defaultValue
  const actionType = isDrowsiness ? 'SET_INITIAL_DROWSINESS' : 'SET_INITIAL_FATIGUE'

  function handleChange(e: ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value
    if (raw === '') {
      dispatch({ type: actionType, value: null })
      return
    }
    const num = Math.round(Number(raw))
    if (Number.isNaN(num)) return
    const clamped = Math.max(0, Math.min(100, num))
    // Reverting to the scenario default clears the override (sparse discipline).
    dispatch({ type: actionType, value: clamped === defaultValue ? null : clamped })
  }

  const label = t({ en: 'Initial value (0–100)', ja: '初期値 (0–100)' }, uiLanguage)

  return (
    <div
      data-testid={`initial-value-${signalKey}`}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '8px',
        fontSize: '0.78em',
        color: '#374151',
        marginTop: '4px',
      }}
    >
      <span>{label}</span>
      <input
        type="number"
        data-testid={`initial-value-input-${signalKey}`}
        aria-label={label}
        min={0}
        max={100}
        step={5}
        value={value}
        onChange={handleChange}
        style={{
          width: '56px',
          fontSize: '1em',
          textAlign: 'center',
          border: `1px solid ${changed ? '#6366f1' : '#d1d5db'}`,
          borderRadius: '3px',
          background: changed ? '#eef2ff' : '#fff',
        }}
      />
    </div>
  )
}
