import { useRunStore } from '../../state/runStore'

export default function LiveReadouts() {
  const { state } = useRunStore()
  const { runState, latestDecision } = state

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

  const ep = runState.event_plan as { ticks?: Array<{ route_fraction: number }> } | undefined
  const routeFraction = ep?.ticks?.[runState.current_tick]?.route_fraction ?? 0
  const positionPct = `${Math.round(routeFraction * 100)}%`

  // Bands come from backend (latestDecision.features), never derived from animation
  const drowsiness = latestDecision?.features?.drowsiness_level ?? '—'
  const fatigue = latestDecision?.features?.fatigue_level ?? '—'

  return (
    <div style={{ padding: '8px', fontSize: '0.85em' }}>
      <div>Position: {positionPct}</div>
      <div>Tick: {runState.current_tick}</div>
      <div>Drowsiness: {drowsiness}</div>
      <div>Fatigue: {fatigue}</div>
    </div>
  )
}
