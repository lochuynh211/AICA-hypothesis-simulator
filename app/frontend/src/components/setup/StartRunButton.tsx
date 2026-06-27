import { useRunStore } from '../../state/runStore'
import { createRun } from '../../api/client'

export default function StartRunButton() {
  const { state, dispatch } = useRunStore()
  const { selectedPackageId, selectedScenarioId, runState } = state

  const ready = Boolean(selectedPackageId && selectedScenarioId)
  const hasActiveRun = runState !== null && runState.status !== 'completed'

  async function handleStart() {
    if (!selectedPackageId || !selectedScenarioId) return
    const rs = await createRun(selectedPackageId, selectedScenarioId)
    dispatch({ type: 'RUN_CREATED', runState: rs })
  }

  return (
    <button
      disabled={!ready || hasActiveRun}
      onClick={handleStart}
      style={{ width: '100%', padding: '6px', marginTop: '8px' }}
    >
      Start Run
    </button>
  )
}
