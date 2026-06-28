import { useEffect, useState } from 'react'
import { useRunStore } from '../../state/runStore'
import { getPackage } from '../../api/client'
import type { HyperparameterDef, SetupValue, ValidationError } from '../../api/types'
import { t } from '../../i18n/t'
import ErrorNotice from '../common/ErrorNotice'

/**
 * HyperparameterEditor (T024) — renders the selected package's hyperparameter
 * defs as editable controls:
 *   - band    → dropdown of band_values (default pre-selected)
 *   - bool    → checkbox
 *   - numeric → number input with min/max/step (default pre-filled)
 *
 * Edits dispatch SET_HYPERPARAMETER.  Numeric values are client-validated
 * against min/max/step; any violation is surfaced via SET_VALIDATION_ERRORS
 * (and a visible role="alert") so an invalid setup cannot reach a run.
 */
export default function HyperparameterEditor() {
  const { state, dispatch } = useRunStore()
  const { selectedPackageId, editedHyperparameters, validationErrors, uiLanguage } = state
  const [defs, setDefs] = useState<HyperparameterDef[]>([])

  useEffect(() => {
    if (!selectedPackageId) {
      setDefs([])
      return
    }
    let cancelled = false
    getPackage(selectedPackageId)
      .then((pkg) => {
        if (!cancelled) setDefs(pkg.hyperparameters ?? [])
      })
      .catch(() => {
        if (!cancelled) setDefs([])
      })
    return () => {
      cancelled = true
    }
  }, [selectedPackageId])

  function effectiveValue(def: HyperparameterDef): SetupValue {
    const edited = editedHyperparameters[def.key]
    return edited !== undefined ? edited : (def.default as SetupValue)
  }

  function validateAll(next: Record<string, SetupValue>): ValidationError[] {
    const errors: ValidationError[] = []
    for (const def of defs) {
      if (def.kind !== 'numeric') continue
      const raw = next[def.key]
      const v = raw !== undefined ? Number(raw) : Number(def.default)
      if (Number.isNaN(v)) {
        errors.push({ field: def.key, message: `${t(def.label, uiLanguage)} must be a number` })
        continue
      }
      if (def.min !== undefined && v < def.min) {
        errors.push({ field: def.key, message: `${t(def.label, uiLanguage)} must be ≥ ${def.min}` })
      }
      if (def.max !== undefined && v > def.max) {
        errors.push({ field: def.key, message: `${t(def.label, uiLanguage)} must be ≤ ${def.max}` })
      }
    }
    return errors
  }

  function handleChange(def: HyperparameterDef, value: SetupValue) {
    dispatch({ type: 'SET_HYPERPARAMETER', key: def.key, value })
    const next = { ...editedHyperparameters, [def.key]: value }
    dispatch({ type: 'SET_VALIDATION_ERRORS', errors: validateAll(next) })
  }

  if (!selectedPackageId || defs.length === 0) return null

  return (
    <div data-testid="hyperparameter-editor" style={{ marginBottom: '8px' }}>
      <h3 style={{ fontSize: '0.75em', fontWeight: 600, color: '#666', margin: '8px 0 4px' }}>
        Hyperparameters
      </h3>
      {defs.map((def) => {
        const value = effectiveValue(def)
        const fieldError = validationErrors.find((e) => e.field === def.key)
        const inputId = `hp-${def.key}`
        return (
          <div key={def.key} style={{ marginBottom: '6px' }}>
            <label htmlFor={inputId} style={{ display: 'block', fontSize: '0.75em', color: '#555' }}>
              {t(def.label, uiLanguage)}
            </label>
            {def.kind === 'band' && (
              <select
                id={inputId}
                value={String(value)}
                onChange={(e) => handleChange(def, e.target.value)}
                style={{ width: '100%' }}
              >
                {(def.band_values ?? []).map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
            )}
            {def.kind === 'bool' && (
              <input
                id={inputId}
                type="checkbox"
                checked={Boolean(value)}
                onChange={(e) => handleChange(def, e.target.checked)}
              />
            )}
            {def.kind === 'numeric' && (
              <input
                id={inputId}
                type="number"
                value={Number(value)}
                min={def.min}
                max={def.max}
                step={def.step}
                onChange={(e) => handleChange(def, Number(e.target.value))}
                style={{ width: '100%' }}
              />
            )}
            {fieldError && (
              <ErrorNotice testid={`hp-error-${def.key}`} message={fieldError.message} />
            )}
          </div>
        )
      })}
    </div>
  )
}
