import { useRunStore } from '../../state/runStore'
import { routesAnalyze, createRunPlan, regenerateRunPlan, createRun } from '../../api/client'

/**
 * PlanPreview (T024) — orchestrates the M2 setup flow:
 *   1. Preview  → routes/analyze + run-plans → draft summary (PLAN_DRAFTED)
 *   2. Regenerate → run-plans/{plan_id}/regenerate (same plan_id)
 *   3. Start    → runs {plan_id} (RUN_CREATED)
 *
 * Validation errors (client-side numeric range or a 400 from the server) and
 * request failures are surfaced via role="alert"; an invalid setup can never
 * reach a run (Preview/Start are blocked while errors exist or no plan exists).
 */
export default function PlanPreview() {
  const { state, dispatch } = useRunStore()
  const {
    selectedPackageId,
    selectedScenarioId,
    editedParameters,
    editedHyperparameters,
    planId,
    effectiveSetup,
    validationErrors,
    setupError,
    runError,
    runState,
  } = state

  const hasActiveRun = runState !== null && runState.status !== 'completed'
  const hasValidationErrors = validationErrors.length > 0
  const ready = Boolean(selectedPackageId && selectedScenarioId)
  const canPreview = ready && !hasValidationErrors && !hasActiveRun

  async function handlePreview() {
    if (!selectedPackageId || !selectedScenarioId || hasValidationErrors) return
    dispatch({ type: 'SET_SETUP_ERROR', message: null })
    try {
      // Local route analysis (M2; Google Maps is M4).
      await routesAnalyze(selectedScenarioId)
      const resp = await createRunPlan({
        packageId: selectedPackageId,
        scenarioId: selectedScenarioId,
        parameters: editedParameters,
        hyperparameters: editedHyperparameters,
        runMode: 'standard',
      })
      dispatch({
        type: 'PLAN_DRAFTED',
        planId: resp.plan_id,
        draftPlan: resp.draft_plan,
        effectiveSetup: resp.effective_setup,
      })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to build run plan'
      dispatch({ type: 'SET_SETUP_ERROR', message })
    }
  }

  async function handleRegenerate() {
    if (!planId) return
    dispatch({ type: 'SET_SETUP_ERROR', message: null })
    try {
      const resp = await regenerateRunPlan(planId, {
        parameters: editedParameters,
        hyperparameters: editedHyperparameters,
      })
      dispatch({
        type: 'PLAN_DRAFTED',
        planId: resp.plan_id,
        draftPlan: resp.draft_plan,
        effectiveSetup: resp.effective_setup,
      })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to regenerate run plan'
      dispatch({ type: 'SET_SETUP_ERROR', message })
    }
  }

  async function handleStart() {
    if (!planId) return
    try {
      const rs = await createRun(planId)
      dispatch({ type: 'RUN_CREATED', runState: rs })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to start run'
      dispatch({ type: 'SET_RUN_ERROR', message })
    }
  }

  return (
    <div data-testid="plan-preview" style={{ marginTop: '8px' }}>
      <button
        onClick={handlePreview}
        disabled={!canPreview}
        style={{ width: '100%', padding: '6px' }}
      >
        Preview Plan
      </button>

      {planId && effectiveSetup && (
        <div data-testid="plan-summary" style={{ marginTop: '8px' }}>
          <p style={{ fontSize: '0.75em', color: '#444', margin: '0 0 4px' }}>
            Plan ready: <code>{planId}</code>
          </p>
          <pre
            data-testid="effective-setup"
            style={{ fontSize: '0.7em', background: '#f6f6f6', padding: '6px', overflow: 'auto', maxHeight: '160px' }}
          >
            {JSON.stringify(effectiveSetup, null, 2)}
          </pre>
          <div style={{ display: 'flex', gap: '6px' }}>
            <button onClick={handleRegenerate} style={{ flex: 1, padding: '6px' }}>
              Regenerate
            </button>
            <button
              onClick={handleStart}
              disabled={hasActiveRun}
              style={{ flex: 1, padding: '6px' }}
            >
              Start Run
            </button>
          </div>
        </div>
      )}

      {hasValidationErrors && (
        <p
          role="alert"
          data-testid="setup-validation-error"
          style={{ color: '#c00', fontSize: '0.75em', marginTop: '4px' }}
        >
          {validationErrors.length} invalid value(s) — fix before previewing
        </p>
      )}
      {setupError && (
        <p
          role="alert"
          data-testid="setup-error"
          style={{ color: '#c00', fontSize: '0.75em', marginTop: '4px' }}
        >
          {setupError}
        </p>
      )}
      {runError && (
        <p
          role="alert"
          data-testid="run-creation-error"
          style={{ color: '#c00', fontSize: '0.75em', marginTop: '4px' }}
        >
          {runError}
        </p>
      )}
    </div>
  )
}
