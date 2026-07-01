import { useRunStore } from '../../state/runStore'
import DecisionTracePanel from '../trace/DecisionTracePanel'
import FeedbackForm from '../feedback/FeedbackForm'
import EvidencePanel from '../evidence/EvidencePanel'

const sectionHeaderStyle = {
  padding: '4px 8px',
  background: '#1a1a1a',
  fontWeight: 700,
  fontSize: '0.8em',
  letterSpacing: '0.05em',
  color: '#aaa',
  borderBottom: '1px solid #333',
  marginBottom: '6px',
} as const

/**
 * RightReviewPanel — right column of the Review screen.
 *
 * Main: the single streaming event log (DecisionTracePanel) — live decisions +
 *       algorithm errors appended every tick, with per-decision feedback.
 * Bottom: run-level feedback (on completion) + evidence export.
 */
export default function RightReviewPanel() {
  const { state } = useRunStore()
  const { completed, paused, latestDecision, runState } = state

  // Proposal feedback is offered here (right panel), not in the middle cockpit,
  // while a proposal is awaiting the driver's choice.
  const proposalTarget =
    paused && latestDecision?.proposal && runState
      ? {
          scope: 'proposal' as const,
          tick_index: runState.current_tick,
          proposal_id: latestDecision.proposal.id,
        }
      : null

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        background: '#111',
        color: '#ddd',
        overflow: 'hidden',
      }}
    >
      {/* Main: live streaming event log */}
      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        <DecisionTracePanel />
      </div>

      {/* Proposal feedback — shown here (not the middle) while a proposal awaits a choice */}
      {proposalTarget && (
        <>
          <div style={{ height: '1px', background: '#2a2a2a', flexShrink: 0 }} />
          <div
            data-testid="proposal-feedback-section"
            style={{ flexShrink: 0, padding: '8px', overflowY: 'auto', maxHeight: '240px' }}
          >
            <div style={sectionHeaderStyle}>PROPOSAL FEEDBACK</div>
            <FeedbackForm target={proposalTarget} />
          </div>
        </>
      )}

      {/* Run-level feedback — visible when the run has completed */}
      {completed && (
        <>
          <div style={{ height: '1px', background: '#2a2a2a', flexShrink: 0 }} />
          <div
            data-testid="run-feedback-section"
            style={{ flexShrink: 0, padding: '8px', overflowY: 'auto', maxHeight: '240px' }}
          >
            <div
              style={{
                padding: '4px 8px',
                background: '#1a1a1a',
                fontWeight: 700,
                fontSize: '0.8em',
                letterSpacing: '0.05em',
                color: '#aaa',
                borderBottom: '1px solid #333',
                marginBottom: '6px',
              }}
            >
              RUN FEEDBACK
            </div>
            <FeedbackForm target={{ scope: 'run' }} />
          </div>
        </>
      )}

      {/* Evidence export — visible whenever a run is active (active or completed) */}
      {state.runState && (
        <>
          <div style={{ height: '1px', background: '#2a2a2a', flexShrink: 0 }} />
          <div data-testid="evidence-export-section" style={{ flexShrink: 0, padding: '8px' }}>
            <EvidencePanel />
          </div>
        </>
      )}
    </div>
  )
}
