/**
 * replaySource — pure RunLog projector (S7, T010).
 *
 * Takes a fetched RunLog and exposes recorded state at any tick_index.
 * NO engine, NO API call, NO side effects. Deterministic.
 */
import type { RunLog, TickEvent, DecisionResult } from '../api/types'

export type ReplayTick = {
  tick_index: number
  tick_state: Record<string, unknown>
  raw_state: Record<string, unknown>
  decision: DecisionResult
  route_fraction: number
}

export type ReplaySource = {
  tickCount: number
  minIndex: number
  maxIndex: number
  getAt(tickIndex: number): ReplayTick | null
}

export function createReplaySource(log: RunLog): ReplaySource {
  const tickEvents = log.events.filter((e): e is TickEvent => e.kind === 'tick')
  const byIndex = new Map<number, TickEvent>()
  for (const e of tickEvents) byIndex.set(e.tick_index, e)

  const indices = tickEvents.map((e) => e.tick_index).sort((a, b) => a - b)
  const minIndex = indices.length > 0 ? indices[0] : 0
  const maxIndex = indices.length > 0 ? indices[indices.length - 1] : 0
  const ep = log.event_plan as { ticks?: Array<{ route_fraction?: number }> } | null

  return {
    tickCount: tickEvents.length,
    minIndex,
    maxIndex,
    getAt(tickIndex: number): ReplayTick | null {
      const ev = byIndex.get(tickIndex) ?? null
      if (!ev) return null
      const route_fraction = ep?.ticks?.[tickIndex]?.route_fraction ?? 0
      return {
        tick_index: ev.tick_index,
        tick_state: ev.tick_state as Record<string, unknown>,
        // raw_state is present on the backend TickEvent but not in the frontend type;
        // cast through unknown to access it when serialised from JSON.
        raw_state:
          (ev as unknown as { raw_state?: Record<string, unknown> }).raw_state ?? {},
        decision: ev.trace.decision_result as unknown as DecisionResult,
        route_fraction,
      }
    },
  }
}
