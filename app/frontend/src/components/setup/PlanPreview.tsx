import { useRunStore } from '../../state/runStore'
import { routesAnalyze, createRunPlan, regenerateRunPlan, createRun } from '../../api/client'
import type { RouteFacts, DisplayRoute } from '../../api/types'

/**
 * PlanPreview (T024 / M4) — orchestrates the setup flow:
 *   1. Preview  → routes/analyze + run-plans → draft summary (PLAN_DRAFTED)
 *   2. Regenerate → run-plans/{plan_id}/regenerate (same plan_id)
 *   3. Start    → runs {plan_id} (RUN_CREATED)
 *
 * M4 migration: routesAnalyze now returns a RouteEnvelope.
 * - If alternatives are already in the store (set by MapKeyAndRouteInput for the
 *   maps path), the Preview step skips the analyze call and uses the selected alt.
 * - Otherwise (local path): calls routesAnalyze({ scenarioId }) → auto-selects
 *   the single local alternative.
 * - createRunPlan always receives the route selection fields from the alt.
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
    alternatives,
    selectedRouteId,
    routeSource,
  } = state

  const hasActiveRun = runState !== null && runState.status !== 'completed'
  const hasValidationErrors = validationErrors.length > 0
  const ready = Boolean(selectedPackageId && selectedScenarioId)
  const canPreview = ready && !hasValidationErrors && !hasActiveRun

  async function handlePreview() {
    if (!selectedPackageId || !selectedScenarioId || hasValidationErrors) return
    dispatch({ type: 'SET_SETUP_ERROR', message: null })

    try {
      // ── Resolve the route alternative to use ──────────────────────────────
      let resolvedRouteId: string
      let resolvedRouteSource: string
      let resolvedRouteFacts: RouteFacts | null = null
      let resolvedDisplay: DisplayRoute | null = null

      if (alternatives.length > 0 && selectedRouteId) {
        // Maps path: alternatives already loaded by MapKeyAndRouteInput.
        const alt = alternatives.find((a) => a.route_id === selectedRouteId)
        if (!alt) throw new Error(`Selected route "${selectedRouteId}" not found in alternatives`)
        resolvedRouteId = alt.route_id
        resolvedRouteSource = routeSource
        resolvedRouteFacts = alt.route_facts
        resolvedDisplay = alt.display
      } else {
        // Local path: call routesAnalyze and auto-select the single local alternative.
        const envelope = await routesAnalyze({ scenarioId: selectedScenarioId })
        dispatch({ type: 'SET_ALTERNATIVES', envelope })
        if (envelope.alternatives.length === 0) {
          throw new Error('No route alternatives returned from analyze')
        }
        const alt = envelope.alternatives[0]
        dispatch({ type: 'SELECT_ROUTE', routeId: alt.route_id })
        resolvedRouteId = alt.route_id
        resolvedRouteSource = envelope.route_source
        resolvedRouteFacts = alt.route_facts
        resolvedDisplay = alt.display
      }

      const resp = await createRunPlan({
        packageId: selectedPackageId,
        scenarioId: selectedScenarioId,
        parameters: editedParameters,
        hyperparameters: editedHyperparameters,
        runMode: 'standard',
        routeId: resolvedRouteId,
        routeSource: resolvedRouteSource,
        routeFacts: resolvedRouteFacts,
        displayRoute: resolvedDisplay,
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
