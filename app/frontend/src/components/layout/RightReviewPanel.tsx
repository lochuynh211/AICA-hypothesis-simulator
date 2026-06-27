import DecisionTracePanel from '../trace/DecisionTracePanel'
import RunLogViewer from '../runs/RunLogViewer'

export default function RightReviewPanel() {
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
    </div>
  )
}
