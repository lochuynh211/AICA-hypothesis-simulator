import { useEffect } from 'react'
import { useRunStore } from '../../state/runStore'
import { listScenarios } from '../../api/client'

export default function ScenarioSelector() {
  const { state, dispatch } = useRunStore()
  const { scenarios, selectedScenarioId, scenarioErrors } = state

  useEffect(() => {
    listScenarios()
      .then(({ scenarios, errors }) =>
        dispatch({ type: 'LOAD_SCENARIOS', scenarios, errors })
      )
      .catch(() =>
        dispatch({ type: 'SET_RUN_ERROR', message: 'Failed to load scenarios from server' })
      )
  }, [dispatch])

  return (
    <div style={{ marginBottom: '8px' }}>
      <label htmlFor="scenario-select" style={{ display: 'block', fontSize: '0.8em', color: '#666', marginBottom: '2px' }}>
        Scenario
      </label>
      <select
        id="scenario-select"
        value={selectedScenarioId ?? ''}
        onChange={(e) => dispatch({ type: 'SELECT_SCENARIO', id: e.target.value })}
        disabled={scenarios.length === 0}
        style={{ width: '100%' }}
      >
        <option value="" disabled>
          {scenarios.length === 0 ? 'Loading…' : 'Select scenario'}
        </option>
        {scenarios.map((s) => (
          <option key={s.id} value={s.id}>
            {s.persona_label} — {s.review_focus}
          </option>
        ))}
      </select>
      {scenarioErrors.length > 0 && (
        <p role="alert" data-testid="scenario-registry-errors" style={{ color: '#c00', fontSize: '0.75em', marginTop: '4px' }}>
          {scenarioErrors.length} scenario(s) could not be loaded
        </p>
      )}
    </div>
  )
}
