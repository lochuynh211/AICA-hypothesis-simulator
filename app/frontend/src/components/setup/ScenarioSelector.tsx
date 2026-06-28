import { useEffect } from 'react'
import { useRunStore } from '../../state/runStore'
import { listScenarios } from '../../api/client'
import ErrorNotice from '../common/ErrorNotice'

export default function ScenarioSelector() {
  const { state, dispatch } = useRunStore()
  const { scenarios, selectedScenarioId, scenarioErrors, packages, selectedPackageId } = state

  useEffect(() => {
    listScenarios()
      .then(({ scenarios, errors }) =>
        dispatch({ type: 'LOAD_SCENARIOS', scenarios, errors })
      )
      .catch(() =>
        dispatch({ type: 'SET_RUN_ERROR', message: 'Failed to load scenarios from server' })
      )
  }, [dispatch])

  // Compatibility filter: when a package is selected, show only scenarios whose
  // type is listed in the package's compatible_scenario_types.
  const selectedPackage = packages.find((p) => p.id === selectedPackageId) ?? null
  const filteredScenarios =
    selectedPackage != null
      ? scenarios.filter((s) => selectedPackage.compatible_scenario_types.includes(s.type))
      : scenarios

  return (
    <div style={{ marginBottom: '8px' }}>
      <label htmlFor="scenario-select" style={{ display: 'block', fontSize: '0.8em', color: '#666', marginBottom: '2px' }}>
        Scenario
      </label>
      <select
        id="scenario-select"
        value={selectedScenarioId ?? ''}
        onChange={(e) => dispatch({ type: 'SELECT_SCENARIO', id: e.target.value })}
        disabled={filteredScenarios.length === 0}
        style={{ width: '100%' }}
      >
        <option value="" disabled>
          {filteredScenarios.length === 0 ? 'Loading…' : 'Select scenario'}
        </option>
        {filteredScenarios.map((s) => (
          <option key={s.id} value={s.id}>
            {s.persona_label} — {s.review_focus}
          </option>
        ))}
      </select>
      {scenarioErrors.length > 0 && (
        <ErrorNotice testid="scenario-registry-errors" message={`${scenarioErrors.length} scenario(s) could not be loaded`} />
      )}
    </div>
  )
}
