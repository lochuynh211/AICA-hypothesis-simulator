import { useRunStore } from '../../state/runStore'
import ProposalPanel from './ProposalPanel'
import FeedbackForm from '../feedback/FeedbackForm'

export default function CockpitView() {
  const { state } = useRunStore()
  const { paused, latestDecision, runState } = state

  if (paused && latestDecision?.proposal && runState) {
    const proposalTarget = {
      scope: 'proposal' as const,
      tick_index: runState.current_tick,
      proposal_id: latestDecision.proposal.id,
    }
    return (
      <div>
        <ProposalPanel
          proposal={latestDecision.proposal}
          runId={runState.run_id}
          reasonInputs={latestDecision.reason_inputs}
          explanation={latestDecision.explanation}
          allowedActions={runState.allowed_actions ?? []}
        />
        <div
          data-testid="proposal-feedback-section"
          style={{ marginTop: '12px', padding: '8px', border: '1px solid #333', borderRadius: '4px', background: '#0f0f0f' }}
        >
          <div style={{ fontSize: '0.75em', fontWeight: 700, color: '#aaa', marginBottom: '6px', letterSpacing: '0.05em' }}>
            PROPOSAL FEEDBACK
          </div>
          <FeedbackForm target={proposalTarget} />
        </div>
      </div>
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
