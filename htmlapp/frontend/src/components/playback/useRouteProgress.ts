/**
 * useRouteProgress — single source of truth for "where is the drive now".
 *
 * Centralizes the route-position derivation that the cockpit panels previously
 * each computed (and got subtly wrong). Returns everything the progress bar,
 * map, route status, and state cards need, so they always agree:
 *   - currentFraction  : evaluated tick's route_fraction (clamped to the plan)
 *   - tickIndex        : last evaluated tick index
 *   - elapsedSeconds   : tickIndex × tick_seconds
 *   - activeSegment    : segment whose `at` is the greatest ≤ currentFraction
 *   - proposalFraction : route_fraction of the first proposal that fired (or null)
 *   - restFraction     : route_fraction (`at`) of the rest-facility segment (or null)
 *   - boundaries       : each segment's `at` (divider ticks for the progress bar)
 *
 * Clamp note: at run completion the trace's tick_index can exceed the frozen
 * ticks[] length; clamping to the last entry keeps route_fraction at ~1.0
 * instead of falling back to 0 (the "60:00 but 0%" bug).
 */
import { useEffect, useState } from 'react'
import { useRunStore } from '../../state/runStore'
import { getScenario } from '../../api/client'
import type { RouteSegment, TraceEntry } from '../../api/types'

/**
 * A fired proposal's position on the route, plus WHICH trigger fired it.
 *
 * `category` is the decision's `selected_category` verbatim
 * (`rest_required` / `monotony_prevention` / null) — the map colors the marker
 * from it (see `lib/review/triggerColors`). Before this carried a category the
 * live map painted every marker the same red, so a monotony proposal during
 * playback was indistinguishable from a rest proposal.
 */
export type ProposalMarker = {
  fraction: number
  category: string | null
}

export type RouteProgress = {
  currentFraction: number
  tickIndex: number
  elapsedSeconds: number
  tickSeconds: number
  activeSegment: RouteSegment | null
  proposalFractions: ProposalMarker[]
  restFraction: number | null
  boundaries: number[]
  segments: RouteSegment[]
  hasRun: boolean
  /** route_fraction (0–1) at an arbitrary tick index (handles M1 + M2 plans). */
  fractionAtTick: (tick: number) => number
}

export function useRouteProgress(): RouteProgress {
  const { state } = useRunStore()
  const { runState, trace, selectedScenarioId, tickSecondsOverride, completed } = state
  const [segments, setSegments] = useState<RouteSegment[]>([])
  const [totalDuration, setTotalDuration] = useState<number | null>(null)

  useEffect(() => {
    if (!selectedScenarioId) {
      setSegments([])
      setTotalDuration(null)
      return
    }
    Promise.resolve(getScenario(selectedScenarioId))
      .then((def) => {
        setSegments(def?.route_intent?.segments ?? [])
        setTotalDuration(
          typeof def?.total_duration_seconds === 'number' ? def.total_duration_seconds : null,
        )
      })
      .catch(() => {
        setSegments([])
        setTotalDuration(null)
      })
  }, [selectedScenarioId])

  const ep = runState?.event_plan as
    | { ticks?: Array<{ route_fraction: number }>; tick_seconds?: number }
    | undefined
  const ticks = ep?.ticks ?? []

  const lastEntry = trace.length > 0 ? trace[trace.length - 1] : null
  const tickIndex = lastEntry?.tick_index ?? 0
  const tickSeconds = ep?.tick_seconds ?? tickSecondsOverride ?? 60
  const elapsedSeconds = tickIndex * tickSeconds

  // route_fraction source, best → worst:
  //   1. The backend route_fraction recorded on the trace entry for that tick
  //      (authoritative, speed-integrated) — looked up by tick_index.
  //   2. M1 per-tick ticks[] (clamped).
  //   3. Time-linear fallback (tickIndex × tick_seconds / total_duration).
  const traceFractionByTick = new Map<number, number>()
  for (const e of trace) {
    if (typeof e.route_fraction === 'number') traceFractionByTick.set(e.tick_index, e.route_fraction)
  }

  const fractionAtTick = (tick: number): number => {
    const recorded = traceFractionByTick.get(tick)
    if (typeof recorded === 'number') return recorded
    if (ticks.length > 0) {
      return ticks[Math.min(tick, ticks.length - 1)]?.route_fraction ?? 0
    }
    if (totalDuration && totalDuration > 0) {
      return Math.min(1, (tick * tickSeconds) / totalDuration)
    }
    return 0
  }

  // Current position: prefer the latest trace entry's recorded fraction.
  // Clamp to 1.0 on completion — the final tick may cover less than a full
  // tick_seconds interval (e.g. vehicle reaches destination mid-tick), leaving
  // route_fraction slightly below 1.0 on the last real tick response.
  const rawFraction =
    typeof lastEntry?.route_fraction === 'number'
      ? lastEntry.route_fraction
      : fractionAtTick(tickIndex)
  const currentFraction = completed ? 1 : rawFraction

  const proposalFractions: ProposalMarker[] = trace
    .filter((e: TraceEntry) => e.proposal !== null && e.proposal_paused === true)
    .map((e: TraceEntry) => ({
      fraction:
        typeof e.route_fraction === 'number' ? e.route_fraction : fractionAtTick(e.tick_index),
      category: e.selected_category ?? null,
    }))

  const restSeg = segments.find((s) => s.is_rest_facility)
  const restFraction = restSeg ? restSeg.at : null

  const activeSegment =
    [...segments].sort((a, b) => b.at - a.at).find((s) => s.at <= currentFraction) ?? null

  return {
    currentFraction,
    tickIndex,
    elapsedSeconds,
    tickSeconds,
    activeSegment,
    proposalFractions,
    restFraction,
    boundaries: segments.map((s) => s.at),
    segments,
    hasRun: runState != null,
    fractionAtTick,
  }
}
