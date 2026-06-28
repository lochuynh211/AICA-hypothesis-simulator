/**
 * MotionBadge — compact badge showing the current vehicle motion state.
 *
 * Reads `motion_state` from the latest trace entry in the store.
 * Renders `data-testid="motion-badge"` with text "Driving" or "Stopped".
 * Returns null when the trace is empty or motion_state is not set.
 */

import { useRunStore } from '../../state/runStore'

export default function MotionBadge() {
  const { state } = useRunStore()
  const { trace } = state

  const latest = trace[trace.length - 1]
  const motionState = latest?.motion_state ?? null

  if (!motionState) return null

  const isStopped = motionState === 'STOPPED'
  const label = isStopped ? 'Stopped' : 'Driving'
  const bg = isStopped ? '#f59e0b' : '#10b981'

  return (
    <div
      data-testid="motion-badge"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: '2px 10px',
        borderRadius: '12px',
        background: bg,
        color: '#fff',
        fontSize: '0.76em',
        fontWeight: 700,
        letterSpacing: '0.03em',
      }}
    >
      {label}
    </div>
  )
}
