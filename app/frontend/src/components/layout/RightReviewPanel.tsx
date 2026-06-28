import { useRunStore } from '../../state/runStore'
import DecisionTracePanel from '../trace/DecisionTracePanel'
import RunLogViewer from '../runs/RunLogViewer'
import FeedbackForm from '../feedback/FeedbackForm'
import EvidencePanel from '../evidence/EvidencePanel'

export default function RightReviewPanel() {
  const { state } = useRunStore()
  const { completed } = state

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
      {/* Top: live decision trace (scrollable) */}
      <div style={{ flex: '1 1 60%', overflowY: 'auto', minHeight: 0 }}>
        <DecisionTracePanel />
      </div>

      {/* Divider */}
      <div style={{ height: '1px', background: '#2a2a2a', flexShrink: 0 }} />

      {/* Bottom: persisted run log viewer (static display) */}
      <div style={{ flex: '1 1 40%', overflowY: 'auto', minHeight: 0 }}>
        <RunLogViewer />
      </div>

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
          <div
            data-testid="evidence-export-section"
            style={{ flexShrink: 0, padding: '8px' }}
          >
            <EvidencePanel />
          </div>
        </>
      )}
    </div>
  )
}
