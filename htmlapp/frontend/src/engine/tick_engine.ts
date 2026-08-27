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
 * Position uses `speedKph` (jam speed when jammed, else the segment's profile
 * speed); `nextRestSpotMin` integrates that SAME speed rule forward over the
 * planned profile (`etaMinToKm`) instead of dividing the remaining distance by
 * the momentary speed — see that function for the bug it fixes.
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

import type { ContentContext, ContentReliefState, RecoveryOption, RecoveryStateT, RouteFacts } from '../api/types'
import { binContext, buildFeatureGroups, binDrowsinessLevel, binFatigueLevel } from './binning'
import type { EventPlan, ScenarioDefM2 } from './event_plan'
import { advanceRecovery, currentStage } from './recovery'
import type { DriverSignalParams, DriverState } from './behavior/driver_signals'
import {
  advanceDriverState,
  applyRestRecoveryRateCapped,
  applyStageRecoveryTick,
  applyStimulusRelief,
} from './behavior/driver_signals'
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
  _content_relief_next?: ContentReliefState
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
  /** Recovery-semantics refactor: the content episode playing this tick
   * (service + purpose), or null. Selects the `<service>@<purpose>`
   * recovery_model entry. Independent of `recovery` — content can play
   * while driving to a rest spot. */
  content?: ContentContext | null
  /** Recovery-semantics refactor: accrual carried from the previous tick of
   * the SAME episode. Reset automatically when `content`'s recovery key
   * differs from `contentRelief.content_key`. */
  contentRelief?: ContentReliefState | null
}

/** Mirrors Python's `ContentContext.recovery_key` computed property. */
function contentRecoveryKey(content: ContentContext): string {
  return `${content.service_id}@${content.purpose}`
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
  const { priorState, tickIndex, eventPlan, routeFacts, scenario, recovery = null, content = null, contentRelief = null } = args
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
  const isTrafficJam = activeTrafficJam(elapsedMin, distanceKm, eventPlan)
  const isNight = scenario.is_night
  const isMonotonous = segmentType === 'highway' || segmentType === 'normal_road'
  const isMountainRoad = segmentType === 'mountain_road'

  // ── Advance position ──────────────────────────────────────────────────
  const effectiveSpeed = speedKph(segmentType, isTrafficJam, sp)

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
      // Snapping BACK to the spot is legitimate ONLY when the car overshot
      // it within THIS tick's own travel — that is the arrival clamp that
      // stops a one-step overshoot drawing a hook on the distance axis.
      // A larger gap means the spot is genuinely behind the driver, and
      // pulling them back would put a backward step in `progress` (observed
      // on uc04-01: a 26km jump that drew the rest dot behind the proposal
      // that caused it). A car cannot un-drive road.
      const tickFrac = totalKm ? (effectiveSpeed * tickSeconds) / 3600.0 / totalKm : 0.0
      const spotFrac = recovery.rest_spot ? recovery.rest_spot.route_fraction : 1.0
      const snap = (currentFrac: number): number => {
        if (spotFrac >= currentFrac) {
          return spotFrac // spot still ahead — clamp forward
        }
        if (currentFrac - spotFrac <= tickFrac + 1e-9) {
          return spotFrac // just overshot this tick — snap back
        }
        return currentFrac // genuinely behind — hold position
      }
      const atSpot = newDistanceKm / totalKm >= spotFrac
      if (stage !== null && stage.motion === 'STOPPED') {
        // Hold position at the rest spot; do not advance distance.
        // NEVER move BACKWARDS: a car cannot un-drive road. If the chosen
        // spot is behind the current position the driver is already past
        // it, so hold where they are rather than teleporting back. Without
        // this guard the `progress` series goes non-monotonic, and every
        // consumer that maps minutes onto route_fraction (the quickview
        // chart, the map markers) draws the rest dot BEHIND the proposal
        // that caused it (observed on uc04-01/NRI: 372min@0.9240 followed
        // by 375min@0.8718, a 26km jump backwards).
        const holdFrac = snap(routeFraction)
        newDistanceKm = holdFrac * totalKm
        routeFraction = holdFrac
        completed = false
        motionState = 'STOPPED'
      } else if (stage !== null && stage.motion === 'MOVING' && atSpot) {
        // fixbug-0806: the MOVING approach (wakefulness) stage drove the car
        // TOWARD the spot; on the tick it arrives (atSpot) it must CLAMP exactly
        // at the spot, not overshoot past it. Without this, the arrival tick's
        // route_fraction sat a step BEYOND spotFrac and the next (now STOPPED)
        // tick snapped it back — a non-monotonic forward-then-back blip that
        // drew as a hook on the distance-axis quickview score curve right at the
        // rest spot.
        // Never backwards (see the STOPPED branch): clamp forward to the spot
        // on arrival, but hold position if the car is already past it.
        const arriveFrac = snap(routeFraction)
        newDistanceKm = arriveFrac * totalKm
        routeFraction = arriveFrac
        completed = false
      } else if (stage === null) {
        // fixbug-0806: the one-tick "resuming" phase — every stage is done
        // (stage_index past the last stage) and recovery is about to go
        // inactive. The driver has JUST finished resting and has not pulled
        // away yet, so position must STILL be held at the spot; the car only
        // advances on the NEXT tick, once run_state.recovery is null. Without
        // this the resuming tick advanced a full tick past the spot (0.5 ->
        // 0.5083), and the merged auto-drive pauses on exactly this tick to
        // surface the after-rest proposal — so the animation parked the car one
        // tick BEYOND the gold rest-spot marker ("rested a bit past the rest
        // spot").
        // Never backwards: the driver has just finished resting and has not
        // pulled away yet, so hold where they ARE. Clamping blindly to
        // spotFrac moved the car back on the resuming tick whenever it had
        // been held ahead of the spot, which put a backward step in
        // `progress` at every "restart from rest".
        const resumeFrac = snap(routeFraction)
        newDistanceKm = resumeFrac * totalKm
        routeFraction = resumeFrac
        completed = false
      }
      recoveryPhase = recovery.phase
      recoveryNext = advanceRecovery(recovery, option, { atRestSpot: atSpot })
    }
  }

  // ── Monotony proxy (feature 020, Slice-3) ──────────────────────────────
  // Package-agnostic 0-100 signal derived purely from segmentType/motionState/
  // isNight; simulator-owned (this module), never reads/touches any package's
  // own internal monotony state. Accrues while driving a monotonous segment
  // (highway/normal_road) MOVING; decays (at twice the accrual rate)
  // otherwise; night adds a flat +20 bonus.
  const _MONOTONOUS_SEGMENTS = new Set(['highway', 'normal_road'])
  // Recovery-semantics refactor: driving content is stimulus, so
  // 刺激がない状態の継続 stops continuing (CDC-SU slide 31). Applies only while
  // MOVING — content at a rest spot is ご褒美, not a countermeasure (slide 38).
  const contentActive = content !== null
  const stimulusFrozen = contentActive && motionState === 'MOVING'
  let newMonotonyAccruedMin: number
  if (stimulusFrozen) {
    newMonotonyAccruedMin = monotonyAccruedMin
  } else if (_MONOTONOUS_SEGMENTS.has(segmentType) && motionState === 'MOVING') {
    newMonotonyAccruedMin = monotonyAccruedMin + tickSeconds / 60.0
  } else {
    newMonotonyAccruedMin = Math.max(0.0, monotonyAccruedMin - 2.0 * tickSeconds / 60.0)
  }

  // Drain on top of the freeze, bounded per episode. `stimulusReliefMin` is
  // published into `signals.dynamic` (below) so a PURE algorithm package can
  // apply the identical drain to its own accumulator (recovery-semantics
  // refactor — Design §6 case 1 specifies freeze+drain, not freeze alone;
  // algorithms have no clock/behavior imports, so the engine is the only
  // place this amount can be computed, and every consumer must read the SAME
  // number rather than re-derive it, or Hybrid/NRI drift apart).
  let contentReliefNext: ContentReliefState | null = null
  let stimulusReliefMin = 0.0
  if (content !== null) {
    const key = contentRecoveryKey(content)
    if (contentRelief !== null && contentRelief.content_key === key) {
      contentReliefNext = { ...contentRelief }
    } else {
      contentReliefNext = { content_key: key, accrued_drowsiness: 0.0, accrued_fatigue: 0.0, accrued_stimulus: 0.0 }
    }
    if (stimulusFrozen && driverParams) {
      const [drained, accruedStimulus] = applyStimulusRelief(
        driverParams,
        key,
        tickSeconds / 60.0,
        contentReliefNext.accrued_stimulus,
      )
      newMonotonyAccruedMin = Math.max(0.0, newMonotonyAccruedMin - drained)
      stimulusReliefMin = drained
      contentReliefNext = { ...contentReliefNext, accrued_stimulus: accruedStimulus }
    }
  }

  // Saturation span for the 0-100 monotony proxy. At the original 30 minutes the
  // display pinned at 100 after half an hour of monotonous driving, so on any
  // long run the whole second half read as a flat 100 — and content relief, which
  // genuinely drains the accumulator (Hybrid: 90 -> 70 min on uc04), was invisible
  // because the clamp swallowed it. 60 minutes is the middle ground: an hour of
  // monotonous driving reads ~80 instead of pinning at 100, so relief shows as a
  // real dip while the curve still occupies a share of the 0-100 band comparable
  // to the drowsiness/fatigue curves beside it (at 120 it sat in the bottom
  // quarter and looked negligible next to them).
  const _MONOTONY_SATURATION_MIN = 60.0

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
      suppressMonotonyGrowth: stimulusFrozen,
    })
    newDrowsiness = driverUpdate.next.drowsiness
    newFatigue = driverUpdate.next.fatigue
    driverUpdateDict = { previous: driverUpdate.previous, delta: driverUpdate.delta }
  } else {
    newDrowsiness = drowsiness
    newFatigue = fatigue
  }

  // ── Apply recovery ──────────────────────────────────────────────────────
  // Recovery-semantics refactor. TWO mechanisms, split by MOTION:
  //
  //   STOPPED + RecoveryState stage -> rest-activity recovery, per-tick curve
  //       across the dwell (applyStageRecoveryTick). Total is identical to
  //       the retired one-shot-on-entry model.
  //   MOVING + content playing      -> driving-content recovery, per-tick
  //       rate from the <service>@<purpose> entry, capped per episode.
  //
  // They are independent: a driver en route to a rest spot is MOVING with
  // content playing, so only the second applies until the wheels stop.
  if (driverParams) {
    if (motionState === 'STOPPED' && recovery !== null && recovery.active) {
      const recOption: RecoveryOption | null =
        (scenario.recovery_options ?? []).find((o) => o.id === recovery.option_id) ?? null
      const stages = recOption?.stages ?? []
      const stage = recOption && recovery.stage_index >= 0 && recovery.stage_index < stages.length
        ? stages[recovery.stage_index]
        : null
      if (stage !== null) {
        const [recovered, accDrowsiness, accFatigue] = applyStageRecoveryTick(
          driverParams,
          { drowsiness: newDrowsiness, fatigue: newFatigue },
          stage.content,
          stage.ticks ?? 0,
          tickSeconds,
          recovery.moving_recovery_accrued_drowsiness,
          recovery.moving_recovery_accrued_fatigue,
        )
        newDrowsiness = recovered.drowsiness
        newFatigue = recovered.fatigue
        if (recoveryNext !== null && recoveryNext.stage_index === recovery.stage_index) {
          recoveryNext = {
            ...recoveryNext,
            moving_recovery_accrued_drowsiness: accDrowsiness,
            moving_recovery_accrued_fatigue: accFatigue,
          }
        }
      }
    } else if (stimulusFrozen && contentReliefNext !== null && content !== null) {
      const [recovered, accDrowsiness, accFatigue] = applyRestRecoveryRateCapped(
        driverParams,
        { drowsiness: newDrowsiness, fatigue: newFatigue },
        contentRecoveryKey(content),
        tickSeconds / 60.0,
        contentReliefNext.accrued_drowsiness,
        contentReliefNext.accrued_fatigue,
      )
      newDrowsiness = recovered.drowsiness
      newFatigue = recovered.fatigue
      contentReliefNext = {
        ...contentReliefNext,
        accrued_drowsiness: accDrowsiness,
        accrued_fatigue: accFatigue,
      }
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
  // Minutes to the next rest opportunity ahead, integrated over the PLANNED
  // speed profile between here and that spot (see `etaMinToKm`) — NOT
  // `remainingKm / currentSpeed`. Sentinel 9999.0 still means "no rest spot
  // remains ahead", and nothing else: an unreachable-in-reasonable-time spot
  // returns a large but finite ETA, because the sentinel is what tells a
  // package there is nowhere to stop at all (`nri_fatigue_score_v1` FIRES on
  // it, deliberately).
  let nextRestMin = NO_REST_SENTINEL
  const sortedRestPositions = [...routeFacts.rest_spot_positions].sort((a, b) => a - b)
  for (const posKm of sortedRestPositions) {
    if (posKm > newDistanceKm) {
      nextRestMin = etaMinToKm({
        targetKm: posKm,
        fromKm: newDistanceKm,
        fromElapsedMin: elapsedMin + tickSeconds / 60.0,
        routeFacts,
        eventPlan,
        sp,
      })
      break
    }
  }

  // ── Monotony level (0-100 derived, for signals.dynamic) ───────────────
  // Mirrors Python: min(100, (monotony_accrued_min / _MONOTONY_SATURATION_MIN) * 80
  // + (20 if is_night else 0)) rounded to int. Used in signals.dynamic.monotonyLevel
  // for the algorithm context.
  const monotonyLevel = Math.round(
    Math.min(100.0, (newMonotonyAccruedMin / _MONOTONY_SATURATION_MIN) * 80.0 + (isNight ? 20.0 : 0.0))
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
      contentActive: contentActive,
      stimulusFrozen: stimulusFrozen,
      stimulusReliefMin: stimulusReliefMin,
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
  if (contentReliefNext !== null) {
    ts._content_relief_next = contentReliefNext
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

/**
 * Effective speed for a segment type, or the jam speed when jammed.
 *
 * The ONE definition of how fast the car moves at a point on the route: the
 * per-tick position advance and the `nextRestSpotMin` ETA integration below
 * both call it, so an ETA can never be computed against a speed model the
 * simulation itself does not use. `sp` is `scenario.speed_profile` (undefined
 * falls back to the same defaults this code has always used).
 */
function speedKph(segmentType: string, isTrafficJam: boolean, sp: SpeedProfile | undefined): number {
  if (isTrafficJam) {
    return sp ? Number(sp.traffic_jam_kph) : 20.0
  }
  const speedMap: Record<string, number> = {
    normal_road: sp ? Number(sp.normal_road_kph) : 60.0,
    highway: sp ? Number(sp.highway_kph) : 100.0,
    mountain_road: sp ? Number(sp.mountain_road_kph) : 40.0,
    sightseeing_road: sp ? Number(sp.sightseeing_road_kph) : 30.0,
  }
  return speedMap[segmentType] ?? 60.0
}

/** Sentinel for `nextRestSpotMin`: no rest spot remains ahead on this route. */
const NO_REST_SENTINEL = 9999.0

// Integration granularity / ceiling for `etaMinToKm`. The step is the
// resolution at which a jam or segment boundary is noticed (so the ETA error
// from a crossing is at most half a minute per boundary); the cap bounds the
// loop for a spot that is unreachably far at a crawl.
const ETA_STEP_MIN = 0.5
const ETA_CAP_MIN = 600.0

/**
 * Minutes to drive from `fromKm` to `targetKm` over the PLANNED speed profile.
 *
 * Forward-integrates the same speed rule the tick loop advances position with
 * (`speedKph` over `segmentTypeAt` / `activeTrafficJam`), rather than dividing
 * the remaining distance by the speed the car happens to be doing right now.
 *
 * Why (fixbug-0806, UC-01-02): the old `remainingKm / effectiveSpeed` presumed
 * the CURRENT condition held all the way to the spot. Sitting in a 5 km jam at
 * 10 kph with the next facility 18 km away, it reported 106 minutes for a drive
 * the frozen event plan says takes ~37 — the jam ends at a known kilometre and
 * the road past it is 80 kph highway. That inflated number is read by
 * `nri_fatigue_score_v1`'s rest-band ETA filter (`rest_spot_eta_filter_min`,
 * default 60), so an over-threshold REST proposal was withheld for the entire
 * jam and only fired once traffic cleared — kilometres later, with the driver's
 * score still climbing. The engine already knows where the jam ends; the ETA
 * now says so.
 *
 * A speed of 0 (a jam authored at 0 kph) advances time but not distance, so a
 * time-gated stop-dead jam still clears; a km-gated one runs out the cap.
 * Returns at most `ETA_CAP_MIN` — deliberately NOT `NO_REST_SENTINEL`, which
 * means "nowhere to stop ahead" and makes NRI fire.
 */
export function etaMinToKm(args: {
  targetKm: number
  fromKm: number
  fromElapsedMin: number
  routeFacts: RouteFacts
  eventPlan: EventPlan
  sp: SpeedProfile | undefined
}): number {
  const { targetKm, fromKm, fromElapsedMin, routeFacts, eventPlan, sp } = args
  let distanceKm = fromKm
  let elapsedMin = 0.0
  while (distanceKm < targetKm && elapsedMin < ETA_CAP_MIN) {
    const speed = speedKph(
      segmentTypeAt(distanceKm, routeFacts),
      activeTrafficJam(fromElapsedMin + elapsedMin, distanceKm, eventPlan),
      sp
    )
    if (speed <= 0) {
      elapsedMin += ETA_STEP_MIN
      continue
    }
    // The final step lands exactly on the spot, so a constant-speed run is
    // exact (no rounding up to the step) and terminates without overshoot.
    const stepMin = Math.min(ETA_STEP_MIN, ((targetKm - distanceKm) / speed) * 60.0)
    distanceKm += (speed * stepMin) / 60.0
    elapsedMin += stepMin
  }
  return Math.min(elapsedMin, ETA_CAP_MIN)
}

/**
 * Last-10-minutes destination no-trigger edge (matches the trip-edge guard).
 * A rest spot whose onward ETA to the destination is inside this edge is not
 * actionable — there is not enough trip left to be worth stopping.
 */
const END_EDGE_MIN = 10.0

/**
 * Actionability of the next rest spot ahead — the shared rule the trigger's
 * rest-band ETA filter and the forecast projection both consult.
 *
 * Mirrors app `services/tick_engine.rest_spot_actionability`: finds the first
 * rest-spot position strictly ahead of `fromKm`, integrates its ETA over the
 * planned speed profile (never `remainingKm / currentSpeed`), then integrates
 * the onward ETA from that spot to the destination. Reason precedence:
 *   no_spot_ahead  → nothing ahead
 *   rest_spot_eta_over_limit → ETA to the spot exceeds `etaFilterMin`
 *   inside_destination_edge  → onward ETA to destination < `endEdgeMin`
 *                              (or the destination distance is unknown)
 *   null           → actionable
 */
export type SpotActionability = {
  exists: boolean
  positionKm: number | null
  /** NO_REST_SENTINEL when no spot ahead. */
  etaFromPositionMin: number
  /** null when no spot ahead. */
  etaToDestinationMin: number | null
  actionable: boolean
  unactionableReason: 'no_spot_ahead' | 'rest_spot_eta_over_limit' | 'inside_destination_edge' | null
}

export function restSpotActionability(args: {
  fromKm: number
  fromElapsedMin: number
  routeFacts: RouteFacts
  eventPlan: EventPlan
  sp: SpeedProfile | undefined
  etaFilterMin: number
  endEdgeMin?: number
}): SpotActionability {
  const { fromKm, fromElapsedMin, routeFacts, eventPlan, sp, etaFilterMin } = args
  const endEdgeMin = args.endEdgeMin ?? END_EDGE_MIN
  const totalKmRaw = routeFacts.total_route_distance_km

  let nextPos: number | null = null
  for (const posKm of [...routeFacts.rest_spot_positions].sort((a, b) => a - b)) {
    if (posKm > fromKm) {
      nextPos = posKm
      break
    }
  }

  if (nextPos === null) {
    return {
      exists: false,
      positionKm: null,
      etaFromPositionMin: NO_REST_SENTINEL,
      etaToDestinationMin: null,
      actionable: false,
      unactionableReason: 'no_spot_ahead',
    }
  }

  const etaFrom = etaMinToKm({
    targetKm: nextPos,
    fromKm,
    fromElapsedMin,
    routeFacts,
    eventPlan,
    sp,
  })

  if (!totalKmRaw) {
    return {
      exists: true,
      positionKm: nextPos,
      etaFromPositionMin: etaFrom,
      etaToDestinationMin: null,
      actionable: false,
      unactionableReason: 'inside_destination_edge',
    }
  }

  const totalKm = totalKmRaw
  const etaToDest = etaMinToKm({
    targetKm: totalKm,
    fromKm: nextPos,
    fromElapsedMin: fromElapsedMin + etaFrom,
    routeFacts,
    eventPlan,
    sp,
  })

  let reason: SpotActionability['unactionableReason']
  const finiteAndNear = etaFrom <= etaFilterMin
  if (!finiteAndNear) {
    reason = 'rest_spot_eta_over_limit'
  } else if (etaToDest < endEdgeMin) {
    reason = 'inside_destination_edge'
  } else {
    reason = null
  }

  return {
    exists: true,
    positionKm: nextPos,
    etaFromPositionMin: etaFrom,
    etaToDestinationMin: etaToDest,
    actionable: reason === null,
    unactionableReason: reason,
  }
}

/**
 * Check if a traffic jam event is active at elapsedMin / distanceKm.
 *
 * Gates on POSITION (`start_km <= distanceKm < end_km`) when an event
 * carries both `start_km` and `end_km` — the correct axis for a km-painted
 * jam, since routes are not time-linear in distance. Falls back to the
 * original TIME gate (`start_min <= elapsedMin < start_min + duration_min`)
 * for events without km fields (back-compat with time-only jams, e.g. Maps
 * / route-preset jams that carry no km).
 */
function activeTrafficJam(elapsedMin: number, distanceKm: number, eventPlan: EventPlan): boolean {
  for (const event of eventPlan.traffic_events) {
    if (event.start_km != null && event.end_km != null) {
      if (event.start_km <= distanceKm && distanceKm < event.end_km) {
        return true
      }
    } else if (event.start_min <= elapsedMin && elapsedMin < event.start_min + event.duration_min) {
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
