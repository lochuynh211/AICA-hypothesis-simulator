/**
 * Tick engine — M1 and M2 tick advancement.
 *
 * Ported from `app/api/aica_api/services/tick_engine.py` (behavior-of-record).
 * Pure, deterministic, side-effect-free. Same inputs -> same outputs every call.
 *
 * M1 API (stateless, reads from frozen per-tick plan):
 *   computeTickState(plan, tickIndex, scenario) -> TickState
 *   buildAdapterContext(tickState) -> context dict
 *
 * M2 API (stateful, profile-driven, no pre-computed per-tick plan):
 *   advanceTick({priorState, tickIndex, eventPlan, routeFacts, scenario, recovery?}) -> TickState
 *
 * The Python `advance_tick(prior_state, tick_index, event_plan, route_facts,
 * scenario, *, recovery=None)` signature is positional-plus-keyword-only; the
 * TS port collapses it into a single options object per the task contract.
 *
 * This module is RNG-free (mirrors the Python: no random draws anywhere in
 * the tick loop) and imports `./behavior/driver_model`, `./behavior/vehicle_model`,
 * and `./recovery` because `advance_tick` genuinely calls all three (confirmed
 * by reading the Python source, not assumed). It does NOT call the algorithm
 * adapter — that dispatch happens one layer up (run_manager, a later task).
 *
 * Only the exported function identifiers (computeTickState, buildAdapterContext,
 * advanceTick) are camelCased. All object keys and every ordinal/band/state
 * string value are preserved byte-for-byte from the Python (snake_case for
 * object keys; raw_state keys stay camelCase exactly as the Python emits them)
 * because they cross the parity boundary.
 */

import type { RecoveryOption, RecoveryStateT, RouteFacts } from '../api/types'
import { binContext, buildFeatureGroups, binDrowsinessLevel, binFatigueLevel } from './binning'
import type { EventPlan, ScenarioDefM2 } from './event_plan'
import { advanceRecovery, currentStage } from './recovery'
import type { DriverSignalParams, DriverState } from './behavior/driver_signals'
import { advanceDriverState, applyRestRecovery } from './behavior/driver_signals'
import type { AnomalySignalParams } from './behavior/anomaly_signal'
import { advanceAnomaly } from './behavior/anomaly_signal'

// ---------------------------------------------------------------------------
// Public types (mirror aica_api.models.run — genuinely absent from api/types.ts)
// ---------------------------------------------------------------------------

export type FeatureGroups = {
  normalized: Record<string, number>
  ordinal: Record<string, string>
}

export type TieredSignals = {
  fixed: Record<string, number | boolean | string>
  dynamic: Record<string, number | boolean | string | null>
  simulated: Record<string, number>
}

export type TickState = {
  tick_index: number
  elapsed_seconds: number
  route_fraction: number
  active_segment_id: string
  drowsiness_level: string
  fatigue_level: string
  signal_duration: string
  continuous_driving_time: string
  rest_spot_eta: string
  completed: boolean

  // M2 (feature 009): tiered signals replace the flat raw_state.
  signals: TieredSignals | Record<string, never>
  feature_groups: FeatureGroups
  distance_km: number | null
  continuous_driving_min: number | null
  anomaly_events: number[]
  above_weak_ticks: number

  // Feature 020 (Slice-3): simulator-owned monotony proxy 0–100. Accrues while
  // MOVING on a monotonous segment (highway/normal_road); decays at 2x the
  // accrual rate otherwise; night adds flat +20. Ported from Python tick_engine
  // (behavior-of-record). null on M1 / computeTickState path.
  monotony_accrued_min: number | null

  // Extra fields (Python model_config extra="allow") — carried tick-to-tick
  // and/or surfaced for the evidence trace.
  _driver_update?: Record<string, unknown>
  _recovery_next?: RecoveryStateT
}

/** SpeedProfile (mirrors aica_api.models.profile.SpeedProfile; not in api/types.ts). */
export type SpeedProfile = {
  normal_road_kph: number
  highway_kph: number
  mountain_road_kph: number
  sightseeing_road_kph: number
  traffic_jam_kph: number
}

export type AdvanceTickArgs = {
  priorState: TickState | null
  tickIndex: number
  eventPlan: EventPlan
  routeFacts: RouteFacts
  scenario: ScenarioDefM2
  recovery?: RecoveryStateT | null
  /** Feature 009: deterministic seed for the anomaly generator. Defaults to
   * scenario.run_seed_default when not supplied. */
  runSeed?: number | null
}

// ---------------------------------------------------------------------------
// M1 Public API
// ---------------------------------------------------------------------------

/**
 * Compute the TickState for a given tick index from the frozen M1 plan.
 *
 * When tick_index >= len(plan.ticks) the returned state has completed=True,
 * route_fraction=1.0, and the last known segment.
 */
export function computeTickState(plan: EventPlan, tickIndex: number, scenario: ScenarioDefM2): TickState {
  const totalTicks = plan.ticks.length
  const initialState = scenario.initial_state
  const fatigueLevel = (initialState['fatigue_level'] as string | undefined) ?? 'low'
  const segments = scenario.route_intent.segments
  const lastSegmentId = segments.length > 0 ? segments[segments.length - 1].id : 'unknown'

  const emptyFeatureGroups: FeatureGroups = { normalized: {}, ordinal: {} }

  // ── Completed: past the last valid index ──────────────────────────────
  if (tickIndex >= totalTicks) {
    const elapsedSeconds = scenario.total_duration_seconds
    return {
      tick_index: tickIndex,
      elapsed_seconds: elapsedSeconds,
      route_fraction: 1.0,
      active_segment_id: lastSegmentId,
      drowsiness_level: lastDrowsiness(plan),
      fatigue_level: fatigueLevel,
      signal_duration: 'transient',
      continuous_driving_time: driveTimeBand(elapsedSeconds),
      rest_spot_eta: 'none',
      completed: true,
      signals: {},
      feature_groups: emptyFeatureGroups,
      distance_km: null,
      continuous_driving_min: null,
      monotony_accrued_min: null,
      anomaly_events: [],
      above_weak_ticks: 0,
    }
  }

  // ── Normal tick ───────────────────────────────────────────────────────
  const entry = plan.ticks[tickIndex]
  const extra = entry as unknown as Record<string, unknown>
  const elapsedSeconds = (extra['elapsed_seconds'] as number | undefined) ?? tickIndex * scenario.tick_seconds
  const continuousDrivingTime = (extra['continuous_driving_time'] as string | undefined) ?? driveTimeBand(elapsedSeconds)
  const activeSegmentId = (extra['active_segment_id'] as string | undefined) ?? lastSegmentId

  return {
    tick_index: tickIndex,
    elapsed_seconds: elapsedSeconds,
    route_fraction: entry.route_fraction,
    active_segment_id: activeSegmentId,
    drowsiness_level: entry.drowsiness_band,
    fatigue_level: fatigueLevel,
    signal_duration: entry.signal_duration,
    continuous_driving_time: continuousDrivingTime,
    rest_spot_eta: entry.rest_spot_eta,
    completed: false,
    signals: {},
    feature_groups: emptyFeatureGroups,
    distance_km: null,
    continuous_driving_min: null,
    monotony_accrued_min: null,
    anomaly_events: [],
    above_weak_ticks: 0,
  }
}

/**
 * Build the adapter context dict from a TickState.
 *
 * For M1 TickStates (no raw_state/feature_groups): returns a dict with only
 * ordinal-band string values (qualitative discipline preserved).
 *
 * For M2 TickStates (has raw_state/feature_groups): returns a dict with both
 * 'raw_state' and 'feature_groups' (plus the flat ordinal keys at the top
 * level for backward compat with declarative_rule's M1 code path).
 */
export function buildAdapterContext(tickState: TickState): Record<string, unknown> {
  // Feature 009: if tiered signals are populated (M2 path), return the
  // tiered-context shape exactly — no flattening, no removed keys.
  if (tickState.signals && Object.keys(tickState.signals).length > 0) {
    return {
      signals: tickState.signals,
      feature_groups: {
        normalized: tickState.feature_groups.normalized,
        ordinal: tickState.feature_groups.ordinal,
      },
    }
  }

  // M1: flat ordinal bands only
  return {
    drowsiness_level: tickState.drowsiness_level,
    fatigue_level: tickState.fatigue_level,
    signal_duration: tickState.signal_duration,
    continuous_driving_time: tickState.continuous_driving_time,
    rest_spot_eta: tickState.rest_spot_eta,
  }
}

// ---------------------------------------------------------------------------
// M2 Public API
// ---------------------------------------------------------------------------

/**
 * Advance the simulation by one tick using the M2 tiered-signal model (feature 009).
 *
 * Returns a TickState with tiered `signals` ({fixed, dynamic, simulated}),
 * feature_groups, distance_km, continuous_driving_min, anomaly_events,
 * above_weak_ticks, and M1 backward-compat ordinal fields.
 * completed=True when distance_km >= total_route_distance_km.
 */
export function advanceTick(args: AdvanceTickArgs): TickState {
  const { priorState, tickIndex, eventPlan, routeFacts, scenario, recovery = null } = args
  const tickSeconds = eventPlan.tick_seconds
  const totalKm = routeFacts.total_route_distance_km || 120.0
  const sp = scenario.speed_profile as unknown as SpeedProfile | undefined
  const scen = scenario as unknown as {
    driver_signal_params?: DriverSignalParams | null
    anomaly_signal_params?: AnomalySignalParams | null
    weather_risk?: number
    run_seed_default?: number
  }
  const driverParams = scen.driver_signal_params ?? null
  const anomalyParams = scen.anomaly_signal_params ?? null
  const seed = args.runSeed != null ? args.runSeed : (scen.run_seed_default ?? 42)

  // ── Get prior numeric values ──────────────────────────────────────────
  let drowsiness: number
  let fatigue: number
  let distanceKm: number
  let continuousDrivingMin: number
  let monotonyAccruedMin: number
  let aboveWeak: number
  let anomalyEvents: number[]

  if (priorState === null || isEmpty(priorState.signals)) {
    // Tick 0: initialize from scenario.initial_state
    drowsiness = initialDrowsiness(scenario.initial_state['drowsiness_level'] ?? 'none')
    fatigue = initialFatigue(scenario.initial_state['fatigue_level'] ?? 'low')
    distanceKm = 0.0
    continuousDrivingMin = 0.0
    monotonyAccruedMin = 0.0
    aboveWeak = 0
    anomalyEvents = []
  } else {
    const simulated = (priorState.signals as TieredSignals).simulated ?? {}
    drowsiness = Number(simulated['drowsiness'] ?? 0.0)
    fatigue = Number(simulated['fatigue'] ?? 0.0)
    distanceKm = priorState.distance_km ?? 0.0
    continuousDrivingMin = priorState.continuous_driving_min ?? 0.0
    monotonyAccruedMin = priorState.monotony_accrued_min ?? 0.0
    aboveWeak = priorState.above_weak_ticks
    anomalyEvents = [...priorState.anomaly_events]
  }

  // ── Determine active segment type at current distance ─────────────────
  const segmentType = segmentTypeAt(distanceKm, routeFacts)

  // ── Check active events at this tick ──────────────────────────────────
  const elapsedMin = (tickIndex * tickSeconds) / 60.0
  const isTrafficJam = activeTrafficJam(elapsedMin, eventPlan)
  const isNight = scenario.is_night
  const isMonotonous = segmentType === 'highway' || segmentType === 'normal_road'
  const isMountainRoad = segmentType === 'mountain_road'

  // ── Advance position ──────────────────────────────────────────────────
  let effectiveSpeed: number
  if (isTrafficJam) {
    effectiveSpeed = sp ? Number(sp.traffic_jam_kph) : 20.0
  } else {
    const speedMap: Record<string, number> = {
      normal_road: sp ? Number(sp.normal_road_kph) : 60.0,
      highway: sp ? Number(sp.highway_kph) : 100.0,
      mountain_road: sp ? Number(sp.mountain_road_kph) : 40.0,
      sightseeing_road: sp ? Number(sp.sightseeing_road_kph) : 30.0,
    }
    effectiveSpeed = speedMap[segmentType] ?? 60.0
  }

  let newDistanceKm = distanceKm + (effectiveSpeed * tickSeconds) / 3600.0
  let routeFraction = Math.min(1.0, newDistanceKm / totalKm)
  let completed = newDistanceKm >= totalKm
  const newContinuousMin = continuousDrivingMin + tickSeconds / 60.0

  // ── Recovery override (Approach A) ────────────────────────────────────
  let recoveryNext: RecoveryStateT | null = null
  let motionState = 'MOVING'
  let recoveryPhase: string | null = null
  if (recovery !== null && recovery.active) {
    const option: RecoveryOption | null =
      (scenario.recovery_options ?? []).find((o) => o.id === recovery.option_id) ?? null
    if (option !== null) {
      const stage = currentStage(recovery, option)
      const spotFrac = recovery.rest_spot ? recovery.rest_spot.route_fraction : 1.0
      const atSpot = newDistanceKm / totalKm >= spotFrac
      if (stage !== null && stage.motion === 'STOPPED') {
        // Hold position at the rest spot; do not advance distance.
        newDistanceKm = spotFrac * totalKm
        routeFraction = spotFrac
        completed = false
        motionState = 'STOPPED'
      }
      recoveryPhase = recovery.phase
      recoveryNext = advanceRecovery(recovery, option, { atRestSpot: atSpot })
    }
  }

  // ── Monotony proxy (feature 020, Slice-3) ──────────────────────────────
  // Simulator-owned 0–100 signal. Accrues while MOVING on a monotonous segment
  // (highway/normal_road); decays at 2× the accrual rate otherwise; night adds
  // flat +20. Ported from Python tick_engine (behavior-of-record, feature 020).
  const _MONOTONOUS_SEGMENTS = new Set(['highway', 'normal_road'])
  let newMonotonyAccruedMin: number
  if (_MONOTONOUS_SEGMENTS.has(segmentType) && motionState === 'MOVING') {
    newMonotonyAccruedMin = monotonyAccruedMin + tickSeconds / 60.0
  } else {
    newMonotonyAccruedMin = Math.max(0.0, monotonyAccruedMin - 2.0 * tickSeconds / 60.0)
  }
  // monotony_level is a 0–100 derived signal used by the algorithm; it is NOT
  // stored on TickState (Python also only stores monotony_accrued_min on TS).

  // ── Advance driver signals (Tier 3a: drowsiness/fatigue) ───────────────
  let newDrowsiness: number
  let newFatigue: number
  let driverUpdateDict: Record<string, unknown> = {}
  if (driverParams) {
    const driverState: DriverState = { drowsiness, fatigue }
    const driverUpdate = advanceDriverState(driverParams, driverState, tickSeconds, {
      isNight,
      isMonotonous,
      isTrafficJam,
      isMountainRoad,
      continuousDrivingMin,
    })
    newDrowsiness = driverUpdate.next.drowsiness
    newFatigue = driverUpdate.next.fatigue
    driverUpdateDict = { previous: driverUpdate.previous, delta: driverUpdate.delta }
  } else {
    newDrowsiness = drowsiness
    newFatigue = fatigue
  }

  // ── Recovery: apply a rest activity's fixed recovery ONCE, on entry ────
  // The first STOPPED tick of a stage is the one where stage_ticks_remaining
  // still equals the stage's full `ticks` (decremented from this tick onward).
  if (recovery !== null && recovery.active && motionState === 'STOPPED' && driverParams) {
    const recOption: RecoveryOption | null =
      (scenario.recovery_options ?? []).find((o) => o.id === recovery.option_id) ?? null
    const stages = recOption?.stages ?? []
    const stage = recOption && recovery.stage_index >= 0 && recovery.stage_index < stages.length
      ? stages[recovery.stage_index]
      : null
    const isActivityEntry = stage !== null && recovery.stage_ticks_remaining === (stage.ticks ?? 0)
    if (stage !== null && isActivityEntry) {
      const recovered = applyRestRecovery(driverParams, { drowsiness: newDrowsiness, fatigue: newFatigue }, stage.content)
      newDrowsiness = recovered.drowsiness
      newFatigue = recovered.fatigue
    }
  }

  // driver_update dict for the evidence trace uses the FINAL (possibly rest-
  // recovered) numbers for "next", matching Python's driver_update_dict.
  if (driverParams) {
    driverUpdateDict = {
      ...driverUpdateDict,
      next: { drowsiness: newDrowsiness, fatigue: newFatigue },
    }
  }

  // ── Update drowsinessAboveWeakTicks counter ───────────────────────────
  const newAboveWeak = newDrowsiness >= 20.0 ? aboveWeak + 1 : 0

  // ── Advance anomaly signal (Tier 3b) — the ONLY source of randomness ───
  let anomalyRate: number
  let newAnomalyEvents: number[]
  if (anomalyParams) {
    const anomalyUpdate = advanceAnomaly(anomalyParams, { events: anomalyEvents }, {
      drowsiness: newDrowsiness,
      tickIndex,
      tickSeconds,
      runSeed: seed,
      isMoving: motionState === 'MOVING',
    })
    anomalyRate = anomalyUpdate.anomaly_rate
    newAnomalyEvents = anomalyUpdate.next.events
  } else {
    anomalyRate = 0
    newAnomalyEvents = anomalyEvents
  }

  // ── Compute nextRestSpotMin ─────────────────────────────────────────────
  const NO_REST_SENTINEL = 9999.0
  let nextRestMin = NO_REST_SENTINEL
  if (effectiveSpeed > 0) {
    const sortedRestPositions = [...routeFacts.rest_spot_positions].sort((a, b) => a - b)
    for (const posKm of sortedRestPositions) {
      if (posKm > newDistanceKm) {
        const distanceToNextRestKm = posKm - newDistanceKm
        nextRestMin = (distanceToNextRestKm / effectiveSpeed) * 60.0
        break
      }
    }
  }

  // ── Monotony level (0-100 derived, for signals.dynamic) ───────────────
  // Mirrors Python: min(100, (monotony_accrued_min / 30) * 80 + (20 if is_night else 0))
  // rounded to int. Used in signals.dynamic.monotonyLevel for the algorithm context.
  const monotonyLevel = Math.round(
    Math.min(100.0, (newMonotonyAccruedMin / 30.0) * 80.0 + (isNight ? 20.0 : 0.0))
  )

  // ── Build the tiered signals dict (feature 009 contract) ──────────────
  const signals: TieredSignals = {
    fixed: {
      isNight: isNight,
      familiarRoute: scenario.familiar_route ?? false,
      childPassenger: scenario.child_passenger ?? false,
      weatherRiskLevel: scen.weather_risk ?? 0.0,
    },
    dynamic: {
      segmentType: segmentType,
      motionState: motionState,
      continuousDrivingMin: newContinuousMin,
      speedKph: effectiveSpeed,
      routeFraction: routeFraction,
      nextRestSpotMin: nextRestMin,
      isTrafficJam: isTrafficJam,
      recoveryPhase: recoveryPhase,
      monotonyLevel: monotonyLevel,
    },
    simulated: {
      drowsiness: newDrowsiness,
      fatigue: newFatigue,
      anomaly_rate: anomalyRate,
    },
  }

  // ── Build feature_groups (route/context ordinal bands only) ───────────
  const fgDict = buildFeatureGroups({
    continuousDrivingMin: newContinuousMin,
    nextRestSpotMin: nextRestMin,
    drowsinessAboveWeakTicks: newAboveWeak,
  }) as { normalized: Record<string, number>; ordinal: Record<string, string> }
  const featureGroups: FeatureGroups = { normalized: fgDict.normalized, ordinal: fgDict.ordinal }
  const ordinal = fgDict.ordinal

  // ── Active segment ID (for M1 compat field) ───────────────────────────
  const activeSegmentId = activeSegmentIdAt(routeFraction, scenario)

  const ts: TickState = {
    tick_index: tickIndex,
    elapsed_seconds: (tickIndex + 1) * tickSeconds,
    route_fraction: routeFraction,
    active_segment_id: activeSegmentId,
    drowsiness_level: binDrowsinessLevel(newDrowsiness),
    fatigue_level: binFatigueLevel(newFatigue),
    signal_duration: ordinal['signal_duration'],
    continuous_driving_time: ordinal['continuous_driving_time'],
    rest_spot_eta: ordinal['rest_spot_eta'],
    completed,
    signals: signals,
    feature_groups: featureGroups,
    distance_km: newDistanceKm,
    continuous_driving_min: newContinuousMin,
    monotony_accrued_min: newMonotonyAccruedMin,
    anomaly_events: newAnomalyEvents,
    above_weak_ticks: newAboveWeak,
    _driver_update: driverUpdateDict,
  }
  if (recoveryNext !== null) {
    ts._recovery_next = recoveryNext
  }
  return ts
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/** Convert elapsed seconds to a continuous_driving_time band via binning. */
function driveTimeBand(elapsedSeconds: number): string {
  const banded = binContext({ travel_time_sec: elapsedSeconds })
  return banded['continuous_driving_time'] as string
}

/** Return the drowsiness band of the last tick in the plan. */
function lastDrowsiness(plan: EventPlan): string {
  if (plan.ticks.length > 0) {
    return plan.ticks[plan.ticks.length - 1].drowsiness_band
  }
  return 'none'
}

/**
 * Convert a drowsiness band label or numeric value to an initial float.
 * Accepts either a number (clamped to [0, 100]) or a band string.
 */
function initialDrowsiness(value: unknown): number {
  if (typeof value === 'number') {
    return Math.max(0.0, Math.min(100.0, value))
  }
  const bands: Record<string, number> = { none: 0.0, weak: 20.0, moderate: 40.0, strong: 60.0, severe: 80.0 }
  return bands[value as string] ?? 0.0
}

/**
 * Convert a fatigue band label or numeric value to an initial float.
 * Accepts either a number (clamped to [0, 100]) or a band string.
 */
function initialFatigue(value: unknown): number {
  if (typeof value === 'number') {
    return Math.max(0.0, Math.min(100.0, value))
  }
  const bands: Record<string, number> = { low: 0.0, medium: 30.0, high: 60.0 }
  return bands[value as string] ?? 0.0
}

/** Return the segment type at the given distance along the route. */
function segmentTypeAt(distanceKm: number, routeFacts: RouteFacts): string {
  let currentType = 'normal_road'
  for (const seg of routeFacts.route_segments) {
    if (seg.start_km <= distanceKm) {
      currentType = seg.segment_type
    }
  }
  return currentType
}

/** Check if a traffic jam event is active at elapsed_min. */
function activeTrafficJam(elapsedMin: number, eventPlan: EventPlan): boolean {
  for (const event of eventPlan.traffic_events) {
    if (event.start_min <= elapsedMin && elapsedMin < event.start_min + event.duration_min) {
      return true
    }
  }
  return false
}

/** Return the active segment ID for the given route_fraction. */
function activeSegmentIdAt(routeFraction: number, scenario: ScenarioDefM2): string {
  const segments = scenario.route_intent.segments
  let active = segments.length > 0 ? segments[0].id : 'unknown'
  for (const seg of segments) {
    if (seg.at <= routeFraction) {
      active = seg.id
    }
  }
  return active
}

/** True when a dict-like object is null/undefined or has no own keys (Python falsy-dict check). */
function isEmpty(o: Record<string, unknown> | undefined | null): boolean {
  return !o || Object.keys(o).length === 0
}
