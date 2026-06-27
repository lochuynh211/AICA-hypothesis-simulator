import { useRunStore } from '../../state/runStore'
import { createRun } from '../../api/client'

export default function StartRunButton() {
  const { state, dispatch } = useRunStore()
  const { selectedPackageId, selectedScenarioId, runState, runError } = state

  const ready = Boolean(selectedPackageId && selectedScenarioId)
  const hasActiveRun = runState !== null && runState.status !== 'completed'

  async function handleStart() {
    if (!selectedPackageId || !selectedScenarioId) return
    try {
      const rs = await createRun(selectedPackageId, selectedScenarioId)
      dispatch({ type: 'RUN_CREATED', runState: rs })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to start run'
      dispatch({ type: 'SET_RUN_ERROR', message })
    }
  }

  return (
    <div>
      <button
        disabled={!ready || hasActiveRun}
        onClick={handleStart}
        style={{ width: '100%', padding: '6px', marginTop: '8px' }}
      >
        Start Run
      </button>
      {runError && (
        <p role="alert" data-testid="run-creation-error" style={{ color: '#c00', fontSize: '0.75em', marginTop: '4px' }}>
          {runError}
        </p>
      )}
    </div>
  )
}
