import { useEffect, useState } from 'react'
import { useRunStore } from '../../state/runStore'
import { getScenario } from '../../api/client'
import { t } from '../../i18n/t'
import type { BilingualLabel } from '../../i18n/t'

interface ContextFlag {
  key: string
  label: BilingualLabel
}

const CONTEXT_FLAGS: ContextFlag[] = [
  { key: 'child_passenger', label: { ja: '子供同乗', en: 'Child Passenger' } },
  { key: 'familiar_route', label: { ja: '慣れた道', en: 'Familiar Route' } },
]

export default function ScenarioContextEditor() {
  const { state, dispatch } = useRunStore()
  const { editedParameters, uiLanguage, selectedScenarioId } = state
  const [loaded, setLoaded] = useState(false)

  // Seed context flags from the scenario profile when scenario changes.
  useEffect(() => {
    if (!selectedScenarioId) {
      setLoaded(false)
      return
    }

    let cancelled = false
    getScenario(selectedScenarioId)
      .then((def) => {
        if (cancelled) return
        CONTEXT_FLAGS.forEach((f) => {
          const val = Boolean((def as Record<string, unknown>)[f.key] ?? false)
          dispatch({ type: 'SET_PARAMETER', key: f.key, value: val })
        })
        setLoaded(true)
      })
      .catch(() => {})

    return () => { cancelled = true }
  }, [selectedScenarioId, dispatch])

  if (!selectedScenarioId || !loaded) return null

  return (
    <div data-testid="scenario-context-editor" style={{ marginBottom: '8px' }}>
      {CONTEXT_FLAGS.map((flag) => {
        const value = Boolean(editedParameters[flag.key] ?? false)
        const inputId = `ctx-${flag.key}`
        return (
          <div key={flag.key} style={{ marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <input
              id={inputId}
              type="checkbox"
              checked={value}
              onChange={(e) =>
                dispatch({ type: 'SET_PARAMETER', key: flag.key, value: e.target.checked })
              }
            />
            <label htmlFor={inputId} style={{ fontSize: '0.75em', color: '#555', cursor: 'pointer' }}>
              {t(flag.label, uiLanguage)}
            </label>
          </div>
        )
      })}
    </div>
  )
}
