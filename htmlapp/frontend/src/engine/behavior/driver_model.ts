/**
 * Driver behavior model — additive per-tick driver state progression.
 *
 * Ported from `app/api/aica_api/services/behavior/driver_model.py`
 * (behavior-of-record). Pure, deterministic, side-effect-free: same
 * (profile, state, tick args) → same DriverUpdate every call.
 *
 * Rate model (R1):
 *   drowsiness += (base_growth + night_add * is_night
 *                  + monotony_add * is_monotonous
 *                  + jam_add * is_traffic_jam) * tick_seconds / 60
 *   fatigue    += (base_growth + continuous_add * (continuous_min >= 60)
 *                  + mountain_add * is_mountain_road
 *                  + jam_add * is_traffic_jam) * tick_seconds / 60
 *   attention  += (base_recovery - monotony_drop * is_monotonous
 *                  - drowsiness_drop_factor * drowsiness / 100
 *                  + active_content_recovery * active_content) * tick_seconds / 60
 *
 * All levels clamped [0, 100]. Component deltas recorded in DriverDelta.
 *
 * Only the exported function identifiers (advanceDriverState, applyRestRecovery)
 * are camelCased. All object keys cross the parity boundary and are preserved
 * byte-for-byte from the Python (snake_case).
 *
 * The Python's keyword-only tick args (`is_night`, `is_monotonous`, ...) become
 * a trailing options object here, mirroring the same convention used for
 * recovery's `at_rest_spot` → `{ atRestSpot }`.
 */

// ---------------------------------------------------------------------------
// Public data types
// ---------------------------------------------------------------------------

/** Instantaneous numeric driver state (all in [0, 100] range). */
export type DriverState = {
  drowsiness: number
  fatigue: number
  attention: number
}

/** Component-level deltas for this tick (for the evidence trace). */
export type DriverDelta = {
  drowsiness_base: number
  drowsiness_night: number
  drowsiness_monotony: number
  drowsiness_jam: number

  fatigue_base: number
  fatigue_continuous: number
  fatigue_mountain: number
  fatigue_jam: number

  attention_base_recovery: number
  attention_monotony_drop: number
  attention_drowsiness_drop: number
  attention_active_content: number
}

/** Result of one tick: previous state, deltas, next state. */
export type DriverUpdate = {
  previous: DriverState
  delta: DriverDelta
  next: DriverState
}

// ---------------------------------------------------------------------------
// Profile types (mirror aica_api.models.profile; not present in api/types.ts)
// ---------------------------------------------------------------------------

export type DrowsinessModel = {
  base_growth_per_min: number
  night_add_per_min: number
  monotony_add_per_min: number
  traffic_jam_add_per_min: number
}

export type FatigueModel = {
  base_growth_per_min: number
  continuous_driving_add_per_min_after_60_min: number
  mountain_road_add_per_min: number
  traffic_jam_add_per_min: number
}

export type AttentionModel = {
  base_recovery_per_min: number
  monotony_drop_per_min: number
  drowsiness_drop_factor: number
  active_content_recovery_per_min: number
}

export type RecoveryModel = {
  short_rest_drowsiness_recovery: number
  short_rest_fatigue_recovery: number
  long_rest_drowsiness_recovery: number
  long_rest_fatigue_recovery: number
}

export type DriverModelProfile = {
  id: string
  drowsiness_model: DrowsinessModel
  fatigue_model: FatigueModel
  attention_model: AttentionModel
  recovery_model: RecoveryModel
}

/** Keyword-only tick args from the Python signature, as a trailing options object. */
export type AdvanceDriverStateOptions = {
  isNight: boolean
  isMonotonous: boolean
  isTrafficJam: boolean
  isMountainRoad: boolean
  continuousDrivingMin: number
  activeContent?: boolean
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Advance driver state by one tick. */
export function advanceDriverState(
  profile: DriverModelProfile,
  current: DriverState,
  tickSeconds: number,
  options: AdvanceDriverStateOptions,
): DriverUpdate {
  const {
    isNight,
    isMonotonous,
    isTrafficJam,
    isMountainRoad,
    continuousDrivingMin,
    activeContent = false,
  } = options

  const scale = tickSeconds / 60.0 // per-minute rates → per-tick

  const dm = profile.drowsiness_model
  const fm = profile.fatigue_model
  const am = profile.attention_model

  // ── Drowsiness deltas ─────────────────────────────────────────────────
  const dBase = dm.base_growth_per_min * scale
  const dNight = isNight ? dm.night_add_per_min * scale : 0.0
  const dMonotony = isMonotonous ? dm.monotony_add_per_min * scale : 0.0
  const dJam = isTrafficJam ? dm.traffic_jam_add_per_min * scale : 0.0

  const newDrowsiness = clamp(current.drowsiness + dBase + dNight + dMonotony + dJam)

  // ── Fatigue deltas ────────────────────────────────────────────────────
  const fBase = fm.base_growth_per_min * scale
  const fContinuous = continuousDrivingMin >= 60.0
    ? fm.continuous_driving_add_per_min_after_60_min * scale
    : 0.0
  const fMountain = isMountainRoad ? fm.mountain_road_add_per_min * scale : 0.0
  const fJam = isTrafficJam ? fm.traffic_jam_add_per_min * scale : 0.0

  const newFatigue = clamp(current.fatigue + fBase + fContinuous + fMountain + fJam)

  // ── Attention deltas ──────────────────────────────────────────────────
  const aRecovery = am.base_recovery_per_min * scale
  const aMonotonyDrop = isMonotonous ? am.monotony_drop_per_min * scale : 0.0
  // drowsiness_drop_factor is applied to normalized drowsiness (0→1)
  const aDrowsinessDrop = am.drowsiness_drop_factor * (current.drowsiness / 100.0) * scale
  const aContent = activeContent ? am.active_content_recovery_per_min * scale : 0.0

  const newAttention = clamp(
    current.attention + aRecovery - aMonotonyDrop - aDrowsinessDrop + aContent,
  )

  const delta: DriverDelta = {
    drowsiness_base: dBase,
    drowsiness_night: dNight,
    drowsiness_monotony: dMonotony,
    drowsiness_jam: dJam,
    fatigue_base: fBase,
    fatigue_continuous: fContinuous,
    fatigue_mountain: fMountain,
    fatigue_jam: fJam,
    attention_base_recovery: aRecovery,
    attention_monotony_drop: -aMonotonyDrop,
    attention_drowsiness_drop: -aDrowsinessDrop,
    attention_active_content: aContent,
  }

  return {
    previous: current,
    delta,
    next: {
      drowsiness: newDrowsiness,
      fatigue: newFatigue,
      attention: newAttention,
    },
  }
}

/** Apply rest recovery to the current driver state. `restType`: "short" or "long". */
export function applyRestRecovery(
  profile: DriverModelProfile,
  current: DriverState,
  restType: string,
): DriverState {
  const rm = profile.recovery_model
  let dRec: number
  let fRec: number
  if (restType === 'long') {
    dRec = rm.long_rest_drowsiness_recovery
    fRec = rm.long_rest_fatigue_recovery
  } else {
    // "short" (default)
    dRec = rm.short_rest_drowsiness_recovery
    fRec = rm.short_rest_fatigue_recovery
  }

  return {
    drowsiness: clamp(current.drowsiness - dRec),
    fatigue: clamp(current.fatigue - fRec),
    // Attention improves proportionally to drowsiness recovery
    attention: clamp(current.attention + dRec * 0.5),
  }
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/** Clamp value to [lo, hi]. */
function clamp(value: number, lo = 0.0, hi = 100.0): number {
  return Math.max(lo, Math.min(hi, value))
}
