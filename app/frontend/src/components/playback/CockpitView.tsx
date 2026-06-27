import { useRunStore } from '../../state/runStore'
import ProposalPanel from './ProposalPanel'

export default function CockpitView() {
  const { state } = useRunStore()
  const { paused, latestDecision, runState } = state

  if (paused && latestDecision?.proposal && runState) {
    return (
      <ProposalPanel
        proposal={latestDecision.proposal}
        runId={runState.run_id}
        reasonInputs={latestDecision.reason_inputs}
        explanation={latestDecision.explanation}
        allowedActions={runState.allowed_actions ?? []}
      />
    )
  }

  return (
    <div data-testid="nav-view" style={{ padding: '16px' }}>
      <p style={{ color: '#888', marginBottom: '8px' }}>Navigation view</p>
      {latestDecision && (
        <span data-testid="decision-explanation" style={{ fontSize: '0.9em' }}>
          {latestDecision.explanation}
        </span>
      )}
    </div>
  )
}
