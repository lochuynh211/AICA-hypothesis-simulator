import { useEffect, useState } from 'react'
import { useRunStore } from '../../state/runStore'
import { getPackage } from '../../api/client'
import type { ParameterDef, SetupValue } from '../../api/types'

/**
 * ParameterEditor (T024) — renders the selected package's setup-time parameter
 * defs as editable controls:
 *   - band → dropdown of band_values (default pre-selected)
 *   - bool → checkbox
 *
 * Edits dispatch SET_PARAMETER.  When the package declares no parameters, the
 * component renders nothing.
 */
export default function ParameterEditor() {
  const { state, dispatch } = useRunStore()
  const { selectedPackageId, editedParameters } = state
  const [defs, setDefs] = useState<ParameterDef[]>([])

  useEffect(() => {
    if (!selectedPackageId) {
      setDefs([])
      return
    }
    let cancelled = false
    getPackage(selectedPackageId)
      .then((pkg) => {
        if (!cancelled) setDefs(pkg.parameters ?? [])
      })
      .catch(() => {
        if (!cancelled) setDefs([])
      })
    return () => {
      cancelled = true
    }
  }, [selectedPackageId])

  function effectiveValue(def: ParameterDef): SetupValue {
    const edited = editedParameters[def.key]
    return edited !== undefined ? edited : (def.default as SetupValue)
  }

  if (!selectedPackageId || defs.length === 0) return null

  return (
    <div data-testid="parameter-editor" style={{ marginBottom: '8px' }}>
      <h3 style={{ fontSize: '0.75em', fontWeight: 600, color: '#666', margin: '8px 0 4px' }}>
        Parameters
      </h3>
      {defs.map((def) => {
        const value = effectiveValue(def)
        const inputId = `param-${def.key}`
        return (
          <div key={def.key} style={{ marginBottom: '6px' }}>
            <label htmlFor={inputId} style={{ display: 'block', fontSize: '0.75em', color: '#555' }}>
              {def.label.en}
            </label>
            {def.kind === 'band' && (
              <select
                id={inputId}
                value={String(value)}
                onChange={(e) =>
                  dispatch({ type: 'SET_PARAMETER', key: def.key, value: e.target.value })
                }
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
                onChange={(e) =>
                  dispatch({ type: 'SET_PARAMETER', key: def.key, value: e.target.checked })
                }
              />
            )}
          </div>
        )
      })}
    </div>
  )
}
