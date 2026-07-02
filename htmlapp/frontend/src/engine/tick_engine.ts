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

import type { RestSpot, RecoveryOption, RecoveryStateT, RouteFacts } from '../api/types'
import { binContext, buildFeatureGroups } from './binning'
import type { EventPlan, ScenarioDefM2 } from './event_plan'
import { advanceRecovery, currentStage } from './recovery'
import type { DriverModelProfile, DriverState } from './behavior/driver_model'
import { advanceDriverState, applyRestRecovery } from './behavior/driver_model'
import type { VehicleBehaviorProfile, VehicleEvent } from './behavior/vehicle_model'
import { advanceVehicleState } from './behavior/vehicle_model'

// ---------------------------------------------------------------------------
// Public types (mirror aica_api.models.run — genuinely absent from api/types.ts)
// ---------------------------------------------------------------------------

export type FeatureGroups = {
  normalized: Record<string, number>
  ordinal: Record<string, string>
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

  // M2 extensions
  raw_state: Record<string, number | boolean | string>
  feature_groups: FeatureGroups
  distance_km: number | null
  continuous_driving_min: number | null

  // Extra fields (Python model_config extra="allow") — carried tick-to-tick
  // and/or surfaced for the evidence trace.
  _vehicle_event_history?: VehicleEvent[]
  _driver_update?: Record<string, unknown>
  _vehicle_update?: Record<string, unknown>
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
      raw_state: {},
      feature_groups: emptyFeatureGroups,
      distance_km: null,
      continuous_driving_min: null,
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
    raw_state: {},
    feature_groups: emptyFeatureGroups,
    distance_km: null,
    continuous_driving_min: null,
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
  const hasRawState = tickState.raw_state && Object.keys(tickState.raw_state).length > 0
  const hasOrdinal = tickState.feature_groups.ordinal && Object.keys(tickState.feature_groups.ordinal).length > 0

  if (hasRawState && hasOrdinal) {
    const ordinal = tickState.feature_groups.ordinal
    return {
      raw_state: tickState.raw_state,
      feature_groups: {
        normalized: tickState.feature_groups.normalized,
        ordinal,
      },
      // Flat ordinal keys at top level for algorithms that access context directly
      ...ordinal,
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
 * Advance the simulation by one tick using the M2 profile-driven model.
 *
 * Returns a TickState with raw_state, feature_groups, distance_km,
 * continuous_driving_min, and M1 backward-compat ordinal fields.
 * completed=True when distance_km >= total_route_distance_km.
 */
export function advanceTick(args: AdvanceTickArgs): TickState {
  const { priorState, tickIndex, eventPlan, routeFacts, scenario, recovery = null } = args
  const tickSeconds = eventPlan.tick_seconds
  const totalKm = routeFacts.total_route_distance_km || 120.0
  const sp = scenario.speed_profile as unknown as SpeedProfile | undefined

  // ── Get prior numeric values ──────────────────────────────────────────
  let drowsiness: number
  let fatigue: number
  let attention: number
  let distanceKm: number
  let continuousDrivingMin: number
  let aboveWeak: number
  let vehicleEventHistory: VehicleEvent[]

  if (priorState === null || isEmpty(priorState.raw_state)) {
    // Tick 0: initialize from scenario.initial_state
    drowsiness = initialDrowsiness(scenario.initial_state['drowsiness_level'] ?? 'none')
    fatigue = initialFatigue(scenario.initial_state['fatigue_level'] ?? 'low')
    attention = 100.0
    distanceKm = 0.0
    continuousDrivingMin = 0.0
    aboveWeak = 0
    vehicleEventHistory = []
  } else {
    const raw = priorState.raw_state
    drowsiness = Number(raw['drowsinessLevel'])
    fatigue = Number(raw['fatigueLevel'])
    attention = Number(raw['attentionLevel'])
    distanceKm = priorState.distance_km ?? 0.0
    continuousDrivingMin = priorState.continuous_driving_min ?? 0.0
    aboveWeak = Math.trunc(Number(raw['drowsinessAboveWeakTicks'] ?? 0))
    vehicleEventHistory = priorState._vehicle_event_history ?? []
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
  let activeContent: string | null = null
  if (recovery !== null && recovery.active) {
    const option: RecoveryOption | null =
      (scenario.recovery_options ?? []).find((o) => o.id === recovery.option_id) ?? null
    if (option !== null) {
      const stage = currentStage(recovery, option)
      const restSpot: RestSpot | null = recovery.rest_spot
      const spotFrac = restSpot ? restSpot.route_fraction : 1.0
      const atSpot = newDistanceKm / totalKm >= spotFrac
      if (stage !== null && stage.motion === 'STOPPED') {
        // Hold position at the rest spot; do not advance distance.
        newDistanceKm = spotFrac * totalKm
        routeFraction = spotFrac
        completed = false
        motionState = 'STOPPED'
      }
      recoveryPhase = recovery.phase
      activeContent = stage !== null ? stage.content : null
      recoveryNext = advanceRecovery(recovery, option, { atRestSpot: atSpot })
    }
  }

  // ── Advance driver state ──────────────────────────────────────────────
  let newDrowsiness: number
  let newFatigue: number
  let newAttention: number
  let driverUpdateDict: Record<string, unknown> = {}
  if (scenario.driver_profile) {
    const profile = scenario.driver_profile as unknown as DriverModelProfile
    const driverState: DriverState = { drowsiness, fatigue, attention }
    const driverUpdate = advanceDriverState(profile, driverState, tickSeconds, {
      isNight,
      isMonotonous,
      isTrafficJam,
      isMountainRoad,
      continuousDrivingMin,
    })
    newDrowsiness = driverUpdate.next.drowsiness
    newFatigue = driverUpdate.next.fatigue
    newAttention = driverUpdate.next.attention
    driverUpdateDict = { previous: driverUpdate.previous, delta: driverUpdate.delta }
  } else {
    newDrowsiness = drowsiness
    newFatigue = fatigue
    newAttention = attention
  }

  // ── Recovery: apply rest recovery when STOPPED ────────────────────────
  if (recovery !== null && recovery.active && motionState === 'STOPPED' && scenario.driver_profile) {
    const recOption: RecoveryOption | null =
      (scenario.recovery_options ?? []).find((o) => o.id === recovery.option_id) ?? null
    const restType = recOption && recOption.rest_type ? recOption.rest_type : 'short'
    const recovered = applyRestRecovery(
      scenario.driver_profile as unknown as DriverModelProfile,
      { drowsiness, fatigue, attention },
      restType,
    )
    newDrowsiness = recovered.drowsiness
    newFatigue = recovered.fatigue
    newAttention = recovered.attention
  }

  // driver_update dict for the evidence trace uses the FINAL (possibly rest-
  // recovered) numbers for "next", matching Python's driver_update_dict.
  if (scenario.driver_profile) {
    driverUpdateDict = {
      ...driverUpdateDict,
      next: { drowsiness: newDrowsiness, fatigue: newFatigue, attention: newAttention },
    }
  }

  // ── Update drowsinessAboveWeakTicks counter ───────────────────────────
  const newAboveWeak = newDrowsiness >= 20.0 ? aboveWeak + 1 : 0

  // ── Advance vehicle state ─────────────────────────────────────────────
  let steering: number
  let pedal: number
  let laneDep: number
  let adasWarn: number
  let newVehicleHistory: VehicleEvent[]
  if (scenario.vehicle_profile) {
    const vProfile = scenario.vehicle_profile as unknown as VehicleBehaviorProfile
    const vehicleState = advanceVehicleState(
      vProfile,
      newDrowsiness,
      newFatigue,
      segmentType,
      isTrafficJam,
      tickIndex,
      tickSeconds,
      vehicleEventHistory,
    )
    steering = vehicleState.steering_instability_level
    pedal = vehicleState.pedal_abnormality_level
    laneDep = vehicleState.lane_departure_count
    adasWarn = vehicleState.adas_warning_count
    newVehicleHistory = vehicleState.event_history
  } else {
    steering = 0.0
    pedal = 0.0
    laneDep = 0
    adasWarn = 0
    newVehicleHistory = []
  }

  // ── Compute nextRestSpotMin ─────────────────────────────────────────────
  // Minutes to the next rest opportunity ahead, using the current effective
  // speed. Sentinel 9999.0 means no rest spot remains ahead (or speed == 0 —
  // unreachable in zero time).
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

  // ── Build raw_state ───────────────────────────────────────────────────
  const rawState: Record<string, number | boolean | string> = {
    drowsinessLevel: newDrowsiness,
    fatigueLevel: newFatigue,
    attentionLevel: newAttention,
    speedKph: effectiveSpeed,
    steeringInstabilityLevel: steering,
    pedalAbnormalityLevel: pedal,
    laneDepartureCount: laneDep,
    adasWarningCount: adasWarn,
    nextRestSpotMin: nextRestMin,
    routeFraction: routeFraction,
    continuousDrivingMin: newContinuousMin,
    isNight: isNight,
    weatherRiskLevel: 0.0,
    segmentType: segmentType,
    drowsinessAboveWeakTicks: newAboveWeak,
    motionState: motionState,
    isTrafficJam: isTrafficJam,
    childPassenger: scenario.child_passenger ?? false,
    familiarRoute: scenario.familiar_route ?? false,
  }
  if (recoveryPhase !== null) {
    rawState['recoveryPhase'] = recoveryPhase
  }
  if (activeContent !== null) {
    rawState['activeContent'] = activeContent
  }

  // ── Build feature_groups ──────────────────────────────────────────────
  const fgDict = buildFeatureGroups(rawState) as { normalized: Record<string, number>; ordinal: Record<string, string> }
  const featureGroups: FeatureGroups = { normalized: fgDict.normalized, ordinal: fgDict.ordinal }
  const ordinal = fgDict.ordinal

  // ── Active segment ID (for M1 compat field) ───────────────────────────
  const activeSegmentId = activeSegmentIdAt(routeFraction, scenario)

  // ── vehicle_update dict for the evidence trace ────────────────────────
  const vehicleUpdateDict = {
    steering_instability_level: steering,
    pedal_abnormality_level: pedal,
    lane_departure_count: laneDep,
    adas_warning_count: adasWarn,
  }

  const ts: TickState = {
    tick_index: tickIndex,
    elapsed_seconds: (tickIndex + 1) * tickSeconds,
    route_fraction: routeFraction,
    active_segment_id: activeSegmentId,
    drowsiness_level: ordinal['drowsiness_level'],
    fatigue_level: ordinal['fatigue_level'],
    signal_duration: ordinal['signal_duration'],
    continuous_driving_time: ordinal['continuous_driving_time'],
    rest_spot_eta: ordinal['rest_spot_eta'],
    completed,
    raw_state: rawState,
    feature_groups: featureGroups,
    distance_km: newDistanceKm,
    continuous_driving_min: newContinuousMin,
    _vehicle_event_history: newVehicleHistory,
    _driver_update: driverUpdateDict,
    _vehicle_update: vehicleUpdateDict,
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
