import { useEffect } from 'react'
import { useRunStore } from '../../state/runStore'
import { listScenarios } from '../../api/client'

export default function ScenarioSelector() {
  const { state, dispatch } = useRunStore()
  const { scenarios, selectedScenarioId } = state

  useEffect(() => {
    listScenarios()
      .then(({ scenarios }) => dispatch({ type: 'LOAD_SCENARIOS', scenarios }))
      .catch(() => {})
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
    </div>
  )
}
