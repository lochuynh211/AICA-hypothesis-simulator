import { useRunStore } from '../../state/runStore'
import type { TraceEntry } from '../../api/types'

export default function RouteTimeline() {
  const { state } = useRunStore()
  const { runState, trace } = state

  const ep = runState?.event_plan as { ticks?: Array<{ route_fraction: number }> } | undefined
  const currentFraction = ep?.ticks?.[runState?.current_tick ?? 0]?.route_fraction ?? 0
  const positionPct = `${Math.round(currentFraction * 100)}%`

  const proposalEntry = trace.find((e: TraceEntry) => e.proposal !== null)
  const proposalFraction = proposalEntry
    ? ((runState?.event_plan as { ticks?: Array<{ route_fraction: number }> })?.ticks?.[proposalEntry.tick_index]?.route_fraction ?? null)
    : null

  return (
    <div style={{ position: 'relative', height: '48px', background: '#e0e0e0', borderRadius: '4px', margin: '12px 0' }}>
      {/* Car marker — CSS transition provides display-only animation */}
      <div
        data-testid="car-marker"
        style={{
          position: 'absolute',
          top: '50%',
          left: positionPct,
          transform: 'translate(-50%, -50%)',
          width: '20px',
          height: '20px',
          background: '#2563eb',
          borderRadius: '50%',
          transition: 'left 0.5s ease',
        }}
        aria-label={`Route position: ${positionPct}`}
      />
      {/* Fire marker at proposal position */}
      {proposalFraction !== null && (
        <div
          data-testid="fire-marker"
          style={{
            position: 'absolute',
            top: '0',
            left: `${Math.round(proposalFraction * 100)}%`,
            transform: 'translateX(-50%)',
            width: '4px',
            height: '100%',
            background: '#dc2626',
          }}
          aria-label="Proposal position"
        />
      )}
    </div>
  )
}
