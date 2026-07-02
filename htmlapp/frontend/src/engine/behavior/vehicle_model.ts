/**
 * Vehicle behavior model — per-tick vehicle signal computation.
 *
 * Ported from `app/api/aica_api/services/behavior/vehicle_model.py`
 * (behavior-of-record). Pure, deterministic, side-effect-free: same
 * (profile, driver_state, context, event_history) → same VehicleState every call.
 *
 * Signal model (R1):
 *   steeringInstabilityLevel = max(0,
 *       base + drowsiness_factor * drowsiness
 *            + fatigue_factor * fatigue
 *            + mountain_road_add * is_mountain
 *            - traffic_jam_reduce * is_jam)
 *
 *   pedalAbnormalityLevel = max(0,
 *       base + fatigue_factor * fatigue
 *            + traffic_jam_add * is_jam
 *            + mountain_road_add * is_mountain)
 *
 * Rolling-window event counts (default 300 s):
 *   laneDepartureCount  — events within the last rolling_window_seconds
 *   adasWarningCount    — ditto
 *
 * Lane departure event generated when:
 *   segment_type in LaneDepartureProfile.enabled_on AND
 *   (drowsiness >= drowsiness_threshold OR fatigue >= fatigue_threshold)
 *
 * ADAS warning event generated when:
 *   new lane departure count (incl. current tick) >= lane_departure_warning_threshold  OR
 *   steering_instability_level >= steering_instability_warning_threshold
 *
 * Only the exported function identifier (advanceVehicleState) is camelCased.
 * All object keys and event_type string values cross the parity boundary and
 * are preserved byte-for-byte from the Python (snake_case).
 */

// ─── Public data types ────────────────────────────────────────────────────

/** A discrete event (lane departure or ADAS warning) at a specific tick. */
export type VehicleEvent = {
  tick_index: number
  event_type: string // "lane_departure" | "adas_warning"
}

/** Computed vehicle signal state for a single tick. */
export type VehicleState = {
  steering_instability_level: number
  pedal_abnormality_level: number
  lane_departure_count: number
  adas_warning_count: number

  // Full event list (historic + new) after rolling-window pruning.
  // Pass this back in as event_history for the next tick.
  event_history: VehicleEvent[]
}

// ─── Profile types (mirror aica_api.models.profile; not in api/types.ts) ──

export type SteeringInstabilityProfile = {
  base_level: number
  drowsiness_factor: number
  fatigue_factor: number
  mountain_road_add: number
  traffic_jam_reduce: number
}

export type LaneDepartureProfile = {
  enabled_on: string[]
  drowsiness_threshold: number
  fatigue_threshold: number
  count_when_threshold_exceeded: number
}

export type PedalAbnormalityProfile = {
  base_level: number
  fatigue_factor: number
  traffic_jam_add: number
  mountain_road_add: number
}

export type AdasWarningProfile = {
  lane_departure_warning_threshold: number
  steering_instability_warning_threshold: number
}

export type VehicleBehaviorProfile = {
  rolling_window_seconds: number
  steering_instability: SteeringInstabilityProfile
  lane_departure: LaneDepartureProfile
  pedal_abnormality: PedalAbnormalityProfile
  adas_warning: AdasWarningProfile
}

// ─── Public API ─────────────────────────────────────────────────────────────

/** Compute vehicle state for the current tick. */
export function advanceVehicleState(
  profile: VehicleBehaviorProfile,
  drowsiness: number,
  fatigue: number,
  segmentType: string,
  isTrafficJam: boolean,
  tickIndex: number,
  tickSeconds: number,
  eventHistory: VehicleEvent[],
): VehicleState {
  const isMountain = segmentType === 'mountain_road'

  // ── Steering instability ────────────────────────────────────────────────
  const si = profile.steering_instability
  const steeringLevel = Math.max(
    0.0,
    si.base_level
      + si.drowsiness_factor * drowsiness
      + si.fatigue_factor * fatigue
      + (isMountain ? si.mountain_road_add : 0.0)
      - (isTrafficJam ? si.traffic_jam_reduce : 0.0),
  )

  // ── Pedal abnormality ───────────────────────────────────────────────────
  const pa = profile.pedal_abnormality
  const pedalLevel = Math.max(
    0.0,
    pa.base_level
      + pa.fatigue_factor * fatigue
      + (isTrafficJam ? pa.traffic_jam_add : 0.0)
      + (isMountain ? pa.mountain_road_add : 0.0),
  )

  // ── Lane departure event this tick? ─────────────────────────────────────
  const ld = profile.lane_departure
  const newEvents: VehicleEvent[] = []

  const laneDepTriggered = ld.enabled_on.includes(segmentType)
    && (drowsiness >= ld.drowsiness_threshold || fatigue >= ld.fatigue_threshold)
  if (laneDepTriggered) {
    for (let i = 0; i < ld.count_when_threshold_exceeded; i++) {
      newEvents.push({ tick_index: tickIndex, event_type: 'lane_departure' })
    }
  }

  // ── Prune history to rolling window ─────────────────────────────────────
  const currentTime = tickIndex * tickSeconds
  const window = profile.rolling_window_seconds
  const pruned = eventHistory.filter(
    (e) => currentTime - e.tick_index * tickSeconds < window,
  )

  // Combine pruned history with new lane departure events (before ADAS check)
  const combined = [...pruned, ...newEvents.filter((e) => e.event_type === 'lane_departure')]

  // Count lane departures within rolling window (including this tick)
  const laneDepCount = combined.filter((e) => e.event_type === 'lane_departure').length

  // ── ADAS warning event this tick? ───────────────────────────────────────
  const aw = profile.adas_warning
  const adasTriggered = laneDepCount >= aw.lane_departure_warning_threshold
    || steeringLevel >= aw.steering_instability_warning_threshold
  if (adasTriggered) {
    newEvents.push({ tick_index: tickIndex, event_type: 'adas_warning' })
  }

  // Final event history (pruned + all new events)
  const finalHistory = [...pruned, ...newEvents]

  // Count rolling-window totals from final history
  const adasCount = finalHistory.filter((e) => e.event_type === 'adas_warning').length
  const finalLaneDepCount = finalHistory.filter((e) => e.event_type === 'lane_departure').length

  return {
    steering_instability_level: steeringLevel,
    pedal_abnormality_level: pedalLevel,
    lane_departure_count: finalLaneDepCount,
    adas_warning_count: adasCount,
    event_history: finalHistory,
  }
}
