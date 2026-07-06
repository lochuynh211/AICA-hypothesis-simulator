/**
 * Driver signal generator (feature 009, renamed from driver_model) — bit-parity
 * port of `app/api/aica_api/services/behavior/driver_signals.py`.
 *
 * Additive per-tick drowsiness/fatigue progression. Pure, deterministic.
 * The `attention` signal is RETIRED (feature 009) — this module advances ONLY
 * drowsiness and fatigue. All levels clamped [0, 100].
 *
 *   scale = tick_seconds / 60
 *   drowsiness += (base_growth + night_add·isNight + monotony_add·isMonotonous
 *                  + jam_add·isTrafficJam) · scale
 *   fatigue    += (base_growth + continuous_add·(continuous_min ≥ 60)
 *                  + mountain_add·isMountainRoad + jam_add·isTrafficJam) · scale
 *
 * Recovery is keyed by the activity performed (a recovery-option stage's
 * `content` — e.g. "sleep", "audio_karaoke", "stretch"), applied ONCE per
 * activity (caller invokes on activity entry). Unknown activity → no-op.
 */

// Model params mirror aica_api.models.profile (only the fields read here).
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

export type ActivityRecovery = {
  drowsiness: number
  fatigue: number
}

export type DriverSignalParams = {
  id: string
  drowsiness_model: DrowsinessModel
  fatigue_model: FatigueModel
  recovery_model: Record<string, ActivityRecovery>
}

export type DriverState = {
  drowsiness: number
  fatigue: number
}

export type DriverDelta = {
  drowsiness_base: number
  drowsiness_night: number
  drowsiness_monotony: number
  drowsiness_jam: number
  fatigue_base: number
  fatigue_continuous: number
  fatigue_mountain: number
  fatigue_jam: number
}

export type DriverUpdate = {
  previous: DriverState
  delta: DriverDelta
  next: DriverState
}

export type AdvanceDriverOptions = {
  isNight: boolean
  isMonotonous: boolean
  isTrafficJam: boolean
  isMountainRoad: boolean
  continuousDrivingMin: number
}

function clamp(value: number, lo = 0.0, hi = 100.0): number {
  return Math.max(lo, Math.min(hi, value))
}

export function advanceDriverState(
  params: DriverSignalParams,
  current: DriverState,
  tickSeconds: number,
  { isNight, isMonotonous, isTrafficJam, isMountainRoad, continuousDrivingMin }: AdvanceDriverOptions,
): DriverUpdate {
  const scale = tickSeconds / 60.0

  const dm = params.drowsiness_model
  const fm = params.fatigue_model

  const d_base = dm.base_growth_per_min * scale
  const d_night = isNight ? dm.night_add_per_min * scale : 0.0
  const d_monotony = isMonotonous ? dm.monotony_add_per_min * scale : 0.0
  const d_jam = isTrafficJam ? dm.traffic_jam_add_per_min * scale : 0.0

  const new_drowsiness = clamp(current.drowsiness + d_base + d_night + d_monotony + d_jam)

  const f_base = fm.base_growth_per_min * scale
  const f_continuous = continuousDrivingMin >= 60.0 ? fm.continuous_driving_add_per_min_after_60_min * scale : 0.0
  const f_mountain = isMountainRoad ? fm.mountain_road_add_per_min * scale : 0.0
  const f_jam = isTrafficJam ? fm.traffic_jam_add_per_min * scale : 0.0

  const new_fatigue = clamp(current.fatigue + f_base + f_continuous + f_mountain + f_jam)

  return {
    previous: current,
    delta: {
      drowsiness_base: d_base,
      drowsiness_night: d_night,
      drowsiness_monotony: d_monotony,
      drowsiness_jam: d_jam,
      fatigue_base: f_base,
      fatigue_continuous: f_continuous,
      fatigue_mountain: f_mountain,
      fatigue_jam: f_jam,
    },
    next: { drowsiness: new_drowsiness, fatigue: new_fatigue },
  }
}

export function applyRestRecovery(
  params: DriverSignalParams,
  current: DriverState,
  activity: string,
): DriverState {
  const rec = params.recovery_model[activity]
  if (rec == null) {
    return { drowsiness: current.drowsiness, fatigue: current.fatigue }
  }
  return {
    drowsiness: clamp(current.drowsiness - rec.drowsiness),
    fatigue: clamp(current.fatigue - rec.fatigue),
  }
}
