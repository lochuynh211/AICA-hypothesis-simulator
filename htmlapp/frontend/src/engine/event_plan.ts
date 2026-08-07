/**
 * Event plan freeze service.
 *
 * Ported from `app/api/aica_api/services/event_plan.py` (behavior-of-record).
 * Pure, side-effect-free: same scenario -> same EventPlan every call.
 *
 * `freeze_event_plan` (M1) resolves a scenario's event_presets into a
 * per-tick schedule (ticks[]). `build_event_plan` (M2) builds the
 * event-level schedule (tick_seconds + traffic/weather/rest event lists)
 * consumed by the M2 tick engine; it does NOT populate ticks[].
 *
 * Only the exported function identifiers (freezeEventPlan, buildEventPlan)
 * are camelCased. All object keys and every band/event string value are
 * preserved byte-for-byte from the Python (snake_case) because they cross
 * the parity boundary.
 *
 * `freezeEventPlan` takes an optional second `seed` parameter that is
 * IGNORED: the Python `freeze_event_plan(scenario)` has no seed argument at
 * all (the engine is fully deterministic without RNG — see prng.ts). The
 * parameter exists only so this function's call signature matches the test
 * harness's `freezeEventPlan(fx.input.scenario, fx.input.seed)`.
 */

import type { RouteFacts, RouteSegment, ScenarioDef } from '../api/types'
import { binContext } from './binning'

// ---------------------------------------------------------------------------
// Public types (mirror aica_api.models.run — genuinely absent from api/types.ts)
// ---------------------------------------------------------------------------

export type TickPlanEntry = {
  tick_index: number
  drowsiness_band: string
  route_fraction: number
  signal_duration: string
  rest_spot_eta: string
  // Extra fields (Python model_config extra="allow"); always set by freezeEventPlan.
  elapsed_seconds: number
  continuous_driving_time: string
  active_segment_id: string
}

export type TrafficEvent = {
  id: string
  start_min: number
  duration_min: number
  affected_segment_id: string
  speed_kph: number
  // Optional POSITION-native km bounds (fixbug-0806). When present, the tick
  // engine gates congestion on distance_km instead of elapsed_min — the
  // correct axis, since routes are not time-linear in distance once segment
  // speeds and auto-rest stops are involved. See `activeTrafficJam` in
  // tick_engine.ts.
  start_km?: number | null
  end_km?: number | null
}

export type WeatherEvent = {
  id: string
  start_min: number
  duration_min: number
}

export type RestOpportunity = {
  id: string
  route_position_km: number
}

export type EventPlan = {
  // M1 — per-tick plan (populated by freezeEventPlan)
  ticks: TickPlanEntry[]
  // M2 — event-level schedule (populated by buildEventPlan)
  tick_seconds: number
  traffic_events: TrafficEvent[]
  weather_events: WeatherEvent[]
  rest_opportunities: RestOpportunity[]
  // Feature 009 — frozen run seed for the anomaly generator (Principle III).
  run_seed: number
}

/** Pydantic EventPlan() field defaults — used for error-path drafts in run_plan.ts. */
export function defaultEventPlan(): EventPlan {
  return { ticks: [], tick_seconds: 60, traffic_events: [], weather_events: [], rest_opportunities: [], run_seed: 42 }
}

/**
 * ScenarioDef fields consumed by the M2 engine (build_event_plan, tick_engine,
 * run_plan) that are genuinely absent from — or mistyped in — the synced
 * `../api/types.ts` ScenarioDef (which lags the Python model: no `presets`,
 * no `is_night`; `initial_state` is typed `Record<string,string>` but actual
 * scenario JSON carries numeric values). Declared here as a local extension;
 * `types.ts` itself is never edited. Both bundled scenarios always carry
 * `presets` and `is_night` (Python field defaults: `presets={}`, `is_night=False`).
 */
export type ScenarioDefM2 = Omit<ScenarioDef, 'initial_state'> & {
  presets: Record<string, unknown>
  is_night: boolean
  rest_drowsiness_ceiling?: number
  initial_state: Record<string, unknown>
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

type ScheduleEntry = { at: number; band: string }

/** Step-held schedule lookup: last entry whose at_key value <= fraction. */
function stepHold(
  schedule: ScheduleEntry[],
  fraction: number,
  atKey: keyof ScheduleEntry = 'at',
  valKey: keyof ScheduleEntry = 'band',
  defaultVal = '',
): string {
  let result: string = defaultVal
  for (const entry of schedule) {
    if (entry[atKey] as unknown as number <= fraction) {
      result = entry[valKey] as unknown as string
    }
  }
  return result
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Freeze a deterministic per-tick event plan for a run (M1).
 *
 * `seed` is IGNORED — see module docstring. Present only for test-harness
 * call-signature compatibility.
 */
export function freezeEventPlan(scenario: ScenarioDefM2, _seed?: number): EventPlan {
  const totalDuration = scenario.total_duration_seconds
  const tickSeconds = scenario.tick_seconds
  const nTicks = Math.floor(totalDuration / tickSeconds)

  // event_presets extra fields (Python model_config extra="allow"): not
  // declared on the synced EventPreset type, read via a loose cast.
  const eventPresetsExtra = scenario.event_presets as unknown as Record<string, unknown>
  const drowsinessSchedule = (eventPresetsExtra['drowsiness_schedule'] as ScheduleEntry[] | undefined) ?? []
  const signalDurationSchedule = eventPresetsExtra['signal_duration_schedule'] as ScheduleEntry[] | undefined
  const signalDurationAtTrigger: string = scenario.event_presets.signal_duration_at_trigger

  const restSpotEtaNearBefore: string | null = scenario.event_presets.rest_spot_eta_near_before ?? null
  const restSpotEtaSchedule = scenario.event_presets.rest_spot_eta_schedule as ScheduleEntry[] | undefined

  // Find the rest facility's at-fraction when using near_before logic.
  let restFacilityAt: number | null = null
  if (restSpotEtaNearBefore !== null) {
    for (const seg of scenario.route_intent.segments) {
      if (seg.id === restSpotEtaNearBefore) {
        restFacilityAt = seg.at
        break
      }
    }
  }

  const segments: RouteSegment[] = scenario.route_intent.segments

  const ticks: TickPlanEntry[] = []
  for (let i = 0; i < nTicks; i++) {
    const elapsedSeconds = i * tickSeconds
    const routeFraction = Math.min(1.0, elapsedSeconds / totalDuration)

    // Drowsiness band (step-held)
    const drowsinessBand = stepHold(drowsinessSchedule, routeFraction) || 'none'

    // Signal duration
    let signalDuration: string
    if (signalDurationSchedule && signalDurationSchedule.length > 0) {
      signalDuration = stepHold(signalDurationSchedule, routeFraction) || 'transient'
    } else {
      // Fallback: use signal_duration_at_trigger for all ticks
      signalDuration = signalDurationAtTrigger
    }

    // Rest spot ETA
    let restSpotEta: string
    if (restSpotEtaSchedule && restSpotEtaSchedule.length > 0) {
      restSpotEta = stepHold(restSpotEtaSchedule, routeFraction) || 'none'
    } else if (restFacilityAt !== null) {
      // near before the facility, none at/after
      restSpotEta = routeFraction < restFacilityAt ? 'near' : 'none'
    } else {
      restSpotEta = 'none'
    }

    // Continuous driving time via boundary-binning
    const continuousDrivingTime = driveTimeBand(elapsedSeconds)

    // Active segment (step-held by at)
    let activeSegmentId = segments[0].id
    for (const seg of segments) {
      if (seg.at <= routeFraction) {
        activeSegmentId = seg.id
      }
    }

    ticks.push({
      tick_index: i,
      drowsiness_band: drowsinessBand,
      route_fraction: routeFraction,
      signal_duration: signalDuration,
      rest_spot_eta: restSpotEta,
      elapsed_seconds: elapsedSeconds,
      continuous_driving_time: continuousDrivingTime,
      active_segment_id: activeSegmentId,
    })
  }

  // Python: EventPlan(ticks=ticks) — every other field takes its declared
  // model default (tick_seconds=60, empty event lists), regardless of the
  // scenario's own tick_seconds. Reproduced verbatim, not "fixed".
  return { ticks, tick_seconds: 60, traffic_events: [], weather_events: [], rest_opportunities: [], run_seed: 42 }
}

/**
 * Build the M2 EventPlan from RouteFacts and scenario presets.
 *
 * Returns an EventPlan with M2 fields (tick_seconds, traffic_events,
 * weather_events, rest_opportunities) and NO per-tick ticks[] entries.
 *
 * Caller-supplied `presets` are merged on top of `scenario.presets`
 * (caller wins on key conflict).
 */
export function buildEventPlan(
  routeFacts: RouteFacts,
  scenario: ScenarioDefM2,
  presets?: Record<string, unknown> | null,
  runSeed?: number | null,
): EventPlan {
  const mergedPresets: Record<string, unknown> = { ...(scenario.presets ?? {}) }
  if (presets) {
    Object.assign(mergedPresets, presets)
  }

  const tickSeconds = Number(mergedPresets['tick_seconds'] ?? scenario.tick_seconds)

  const trafficEvents: TrafficEvent[] = ((mergedPresets['traffic_events'] as Record<string, unknown>[] | undefined) ?? [])
    .map((raw) => raw as unknown as TrafficEvent)

  const weatherEvents: WeatherEvent[] = ((mergedPresets['weather_events'] as Record<string, unknown>[] | undefined) ?? [])
    .map((raw) => raw as unknown as WeatherEvent)

  const restOpportunities: RestOpportunity[] = routeFacts.rest_spot_positions.map((posKm, i) => ({
    id: `rest_${i}`,
    route_position_km: posKm,
  }))

  const frozenRunSeed = runSeed != null
    ? runSeed
    : (((scenario as unknown as Record<string, unknown>)['run_seed_default'] as number | undefined) ?? 42)

  return {
    ticks: [],
    tick_seconds: tickSeconds,
    traffic_events: trafficEvents,
    weather_events: weatherEvents,
    rest_opportunities: restOpportunities,
    run_seed: frozenRunSeed,
  }
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/** Convert elapsed seconds to a continuous_driving_time band via binning. */
function driveTimeBand(elapsedSeconds: number): string {
  const banded = binContext({ travel_time_sec: elapsedSeconds })
  return banded['continuous_driving_time'] as string
}
