import { useRunStore } from '../../state/runStore'
import type { TraceEntry } from '../../api/types'
import type { ReplayTick } from '../../replay/replaySource'

export default function RouteTimeline({ replayTick }: { replayTick?: ReplayTick | null } = {}) {
  const { state } = useRunStore()
  const { runState, trace } = state

  // ── REPLAY MODE — use recorded route_fraction directly ─────────────────────
  if (replayTick != null) {
    const positionPct = `${Math.round(replayTick.route_fraction * 100)}%`
    const proposalFired =
      replayTick.decision.fire_control.fired && replayTick.decision.proposal != null
    const proposalFraction = proposalFired ? replayTick.route_fraction : null

    return (
      <div
        style={{
          position: 'relative',
          height: '48px',
          background: '#e0e0e0',
          borderRadius: '4px',
          margin: '12px 0',
        }}
      >
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
          }}
          aria-label={`Route position: ${positionPct}`}
        />
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

  // ── LIVE MODE — unchanged ───────────────────────────────────────────────────
  const ep = runState?.event_plan as { ticks?: Array<{ route_fraction: number }> } | undefined
  // Use the last trace entry's tick_index (the evaluated tick) so the car position
  // matches the evidence log, not the post-increment current_tick.
  const lastEntry = trace.length > 0 ? trace[trace.length - 1] : null
  const currentFraction = ep?.ticks?.[lastEntry?.tick_index ?? 0]?.route_fraction ?? 0
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
