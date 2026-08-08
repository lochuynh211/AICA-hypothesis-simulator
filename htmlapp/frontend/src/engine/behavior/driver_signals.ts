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
 * Recovery-semantics refactor: the old one-shot `apply_rest_recovery` (fixed
 * amount granted once, on activity entry) is RETIRED. Recovery for a STOPPED
 * activity is now a per-tick CURVE across the stage's dwell (`stageRecoveryTotal`
 * + `applyStageRecoveryTick`) that totals to the same amount the one-shot model
 * granted. Driving content (a MOVING activity) additionally drains accumulated
 * monotonous-exposure minutes via `applyStimulusRelief`.
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
  drowsiness_per_min: number
  fatigue_per_min: number
  cap_drowsiness: number | null
  cap_fatigue: number | null
  // Recovery-semantics refactor: stimulus relief for DRIVING content.
  // `stimulus_relief_per_min` is accumulator-MINUTES drained per minute of
  // playback (1.2 => one minute of content removes 1.2 minutes of accumulated
  // monotonous exposure). `cap_stimulus` bounds the total drained across one
  // content episode, in accumulator-minutes. Both default to 0.0 / null so a
  // rest-activity entry (sleep/stretch) is unaffected.
  stimulus_relief_per_min: number
  cap_stimulus: number | null
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
  // When true, the monotony-sourced drowsiness growth term is zeroed for this
  // tick. Set by the tick engine while driving content is playing: the driver
  // is receiving stimulus, so boredom is not driving drowsiness upward
  // (CDC-SU slide 31, 刺激がない状態の継続). Every other growth component is
  // unaffected. Defaults to false.
  suppressMonotonyGrowth?: boolean
}

function clamp(value: number, lo = 0.0, hi = 100.0): number {
  return Math.max(lo, Math.min(hi, value))
}

export function advanceDriverState(
  params: DriverSignalParams,
  current: DriverState,
  tickSeconds: number,
  {
    isNight,
    isMonotonous,
    isTrafficJam,
    isMountainRoad,
    continuousDrivingMin,
    suppressMonotonyGrowth = false,
  }: AdvanceDriverOptions,
): DriverUpdate {
  const scale = tickSeconds / 60.0

  const dm = params.drowsiness_model
  const fm = params.fatigue_model

  const d_base = dm.base_growth_per_min * scale
  const d_night = isNight ? dm.night_add_per_min * scale : 0.0
  const d_monotony = suppressMonotonyGrowth ? 0.0 : isMonotonous ? dm.monotony_add_per_min * scale : 0.0
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

/**
 * Total (drowsiness, fatigue) recovery a STOPPED stage of `minutes` grants.
 *
 * Exactly the amount the retired one-shot `apply_rest_recovery_minutes`
 * computed — `flat + min(cap, per_min * minutes)` per component, with the cap
 * applying only to the rate-derived portion. Kept as its own function so the
 * per-tick distribution in `applyStageRecoveryTick` is provably
 * calibration-preserving: same total, different shape.
 *
 * An unknown activity totals (0.0, 0.0).
 */
export function stageRecoveryTotal(params: DriverSignalParams, activity: string, minutes: number): [number, number] {
  const rec = params.recovery_model[activity]
  if (rec == null) {
    return [0.0, 0.0]
  }

  // `?? 0.0`: Pydantic fills these fields with their default (0.0) when a
  // recovery_model entry's raw JSON/fixture omits them; a plain JS object
  // passed in here carries no such validation step, so replicate the default
  // at the read site instead.
  let drowsiness_rate = (rec.drowsiness_per_min ?? 0.0) * minutes
  if (rec.cap_drowsiness != null) {
    drowsiness_rate = Math.min(drowsiness_rate, rec.cap_drowsiness)
  }

  let fatigue_rate = (rec.fatigue_per_min ?? 0.0) * minutes
  if (rec.cap_fatigue != null) {
    fatigue_rate = Math.min(fatigue_rate, rec.cap_fatigue)
  }

  return [(rec.drowsiness ?? 0.0) + drowsiness_rate, (rec.fatigue ?? 0.0) + fatigue_rate]
}

/**
 * Apply ONE tick's share of a STOPPED stage's recovery.
 *
 * The stage's whole-dwell total (`stageRecoveryTotal` over
 * `stageTicks * tickSeconds / 60` minutes) is divided evenly across
 * `stageTicks` and granted one share per call, bounded by the remaining
 * headroom under that total. So the driver recovers as a CURVE across the
 * dwell instead of in one step on the entry tick, while the total is
 * identical to the previous one-shot model.
 *
 * @param stageTicks         The stage's full dwell length in ticks (>= 1).
 * @param accruedDrowsiness  Total drowsiness recovery already granted THIS stage.
 * @param accruedFatigue     Total fatigue recovery already granted THIS stage.
 *
 * @returns `[newState, newAccruedDrowsiness, newAccruedFatigue]` — the accrued
 * totals INCLUDE this tick's share, for the caller to thread forward. Result
 * state is clamped >= 0. An unknown activity or `stageTicks <= 0` recovers
 * nothing.
 */
export function applyStageRecoveryTick(
  params: DriverSignalParams,
  current: DriverState,
  activity: string,
  stageTicks: number,
  tickSeconds: number,
  accruedDrowsiness: number,
  accruedFatigue: number,
): [DriverState, number, number] {
  if (stageTicks <= 0) {
    return [current, accruedDrowsiness, accruedFatigue]
  }

  const minutes = (stageTicks * tickSeconds) / 60.0
  const [totalDrowsiness, totalFatigue] = stageRecoveryTotal(params, activity, minutes)

  const drowsinessShare = Math.min(totalDrowsiness / stageTicks, Math.max(0.0, totalDrowsiness - accruedDrowsiness))
  const fatigueShare = Math.min(totalFatigue / stageTicks, Math.max(0.0, totalFatigue - accruedFatigue))

  const newState: DriverState = {
    drowsiness: clamp(current.drowsiness - drowsinessShare),
    fatigue: clamp(current.fatigue - fatigueShare),
  }
  return [newState, accruedDrowsiness + drowsinessShare, accruedFatigue + fatigueShare]
}

/**
 * Per-tick recovery accrual for a MOVING/en-route activity, with the
 * activity's cap enforced as an AGGREGATE ceiling across the whole en-route
 * stage instead of per call.
 *
 * Feature 020 (Slice-2 core, review fix). A naive per-tick rate call caps
 * each call independently, so invoking it every tick for N ticks can let
 * total recovery grow to `N * per_min * tick_minutes` with no ceiling across
 * the stage even when `cap_drowsiness`/`cap_fatigue` are set. This function
 * instead takes how much has already been recovered THIS stage
 * (`accruedDrowsiness` / `accruedFatigue` — threaded by the caller across
 * ticks) and only grants the remaining headroom under the cap this tick.
 *
 * @returns `[newState, newAccruedDrowsiness, newAccruedFatigue]` — the
 * accrued totals returned INCLUDE this tick's applied amount, for the caller
 * to thread into the next tick. An activity with no cap set for a component
 * keeps accruing without limit for that component. Result state is always
 * clamped >= 0. An unknown activity recovers nothing and returns the accrued
 * totals unchanged.
 */
export function applyRestRecoveryRateCapped(
  params: DriverSignalParams,
  current: DriverState,
  activity: string,
  tickMinutes: number,
  accruedDrowsiness: number,
  accruedFatigue: number,
): [DriverState, number, number] {
  const rec = params.recovery_model[activity]
  if (rec == null) {
    return [current, accruedDrowsiness, accruedFatigue]
  }

  let drowsinessAmount = (rec.drowsiness_per_min ?? 0.0) * tickMinutes
  if (rec.cap_drowsiness != null) {
    const remainingDrowsiness = Math.max(0.0, rec.cap_drowsiness - accruedDrowsiness)
    drowsinessAmount = Math.min(drowsinessAmount, remainingDrowsiness)
  }

  let fatigueAmount = (rec.fatigue_per_min ?? 0.0) * tickMinutes
  if (rec.cap_fatigue != null) {
    const remainingFatigue = Math.max(0.0, rec.cap_fatigue - accruedFatigue)
    fatigueAmount = Math.min(fatigueAmount, remainingFatigue)
  }

  const newState: DriverState = {
    drowsiness: clamp(current.drowsiness - drowsinessAmount),
    fatigue: clamp(current.fatigue - fatigueAmount),
  }
  return [newState, accruedDrowsiness + drowsinessAmount, accruedFatigue + fatigueAmount]
}

/**
 * Accumulator-minutes of monotonous exposure drained by one tick of content.
 *
 * Driving content is stimulus, so it interrupts 刺激がない状態の継続 (CDC-SU
 * slide 31). The FREEZE is the caller's job — this function supplies only the
 * additional DRAIN: `stimulus_relief_per_min * tickMinutes`, bounded by the
 * remaining headroom under `cap_stimulus` across the episode.
 *
 * @param activity        The `<service_id>@<purpose>` recovery-model key.
 * @param accruedStimulus Accumulator-minutes already drained THIS episode.
 *
 * @returns `[drainedMinutes, newAccruedStimulus]`. An unknown key or an entry
 * with no stimulus rate drains 0.0. With `cap_stimulus == null` the drain is
 * unbounded across the episode.
 */
export function applyStimulusRelief(
  params: DriverSignalParams,
  activity: string,
  tickMinutes: number,
  accruedStimulus: number,
): [number, number] {
  const rec = params.recovery_model[activity]
  if (rec == null) {
    return [0.0, accruedStimulus]
  }

  let drained = (rec.stimulus_relief_per_min ?? 0.0) * tickMinutes
  if (rec.cap_stimulus != null) {
    drained = Math.min(drained, Math.max(0.0, rec.cap_stimulus - accruedStimulus))
  }

  return [drained, accruedStimulus + drained]
}
