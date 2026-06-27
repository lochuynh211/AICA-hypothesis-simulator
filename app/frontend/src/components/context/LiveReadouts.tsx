import { useRunStore } from '../../state/runStore'

export default function LiveReadouts() {
  const { state } = useRunStore()
  const { runState, trace, latestDecision } = state

  if (!runState) {
    return (
      <div style={{ padding: '8px', fontSize: '0.85em' }}>
        <div>Position: —</div>
        <div>Tick: —</div>
        <div>Drowsiness: —</div>
        <div>Fatigue: —</div>
      </div>
    )
  }

  // Use the last trace entry's tick_index (the evaluated tick) so position and
  // tick display match the evidence log, not the post-increment current_tick.
  const lastEntry = trace.length > 0 ? trace[trace.length - 1] : null
  const ep = runState.event_plan as { ticks?: Array<{ route_fraction: number }> } | undefined
  const routeFraction = ep?.ticks?.[lastEntry?.tick_index ?? 0]?.route_fraction ?? 0
  const positionPct = `${Math.round(routeFraction * 100)}%`
  const displayTick = lastEntry?.tick_index ?? 0

  // Bands come from backend (latestDecision.features), never derived from animation
  const drowsiness = latestDecision?.features?.drowsiness_level ?? '—'
  const fatigue = latestDecision?.features?.fatigue_level ?? '—'

  return (
    <div style={{ padding: '8px', fontSize: '0.85em' }}>
      <div>Position: {positionPct}</div>
      <div>Tick: {displayTick}</div>
      <div>Drowsiness: {drowsiness}</div>
      <div>Fatigue: {fatigue}</div>
    </div>
  )
}
