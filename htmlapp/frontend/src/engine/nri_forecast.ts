/**
 * Committed-state continuation forecast for NRI (design §8–§10).
 *
 * Port of `app/api/aica_api/services/nri_forecast.py`.
 *
 * A NON-PERSISTING projection: it copies the post-current-tick state and steps
 * the deterministic tick/adapter loop forward, CONTINUING the already-committed
 * intervention but ACCEPTING NO projected-future proposal, to answer one
 * question — when the score next crosses threshold_fire, will a rest facility be
 * actionable there? It never touches the live run, never appends events, never
 * advances the real tick.
 *
 * Object keys are snake_case, byte-for-byte with the Python dict, because this
 * block crosses the parity boundary into `context['nri_forecast']` and is read
 * by nri_fatigue_score_v1's evaluate().
 */
import type { ContentContext, ContentReliefState, DecisionResult, RouteFacts } from '../api/types'
import type { EventPlan, ScenarioDefM2 } from './event_plan'
import {
  advanceTick,
  restSpotActionability,
  type SpeedProfile,
  type TickState,
} from './tick_engine'

/** Caller-supplied projection evaluate — the TS `evaluate()` already returns a
 * plain object (no `.model_dump()` step needed, unlike Python). */
export type EvaluateFn = (ts: TickState, runtimeState: Record<string, unknown>) => DecisionResult

/** The `context['nri_forecast']` block shape. Loose null-unions mirror the
 * Python dict, which the algorithm reads with `.get(...) or {}` fallbacks. */
export type NriForecastBlock = {
  evaluated: boolean
  error: string | null
  threshold_order_valid: boolean
  forecast_mode: string
  forecast_start: { content_active: boolean; service_id: string | null; content_remaining_min: number } | null
  future_fire: {
    found: boolean
    tick_index: number | null
    elapsed_min: number | null
    distance_km: number | null
    route_fraction: number | null
    s_total: number | null
  } | null
  forecast_rest_spot: {
    exists: boolean
    position_km: number | null
    eta_from_fire_min: number | null
    eta_to_destination_min: number | null
    actionable: boolean
  } | null
  forecast_future_rest_unactionable: boolean | null
  forecast_rest_unactionable_reason: string | null
  current_rest_spot: {
    exists: boolean
    position_km: number | null
    eta_from_current_min: number | null
    eta_to_destination_min: number | null
    actionable: boolean
    unactionable_reason: string | null
  } | null
}

const MAX_FORECAST_TICKS = 2000

function unavailable(error: string | null, thresholdOrderValid = true): NriForecastBlock {
  return {
    evaluated: false,
    error,
    threshold_order_valid: thresholdOrderValid,
    forecast_mode: 'committed_state_continuation',
    forecast_start: { content_active: false, service_id: null, content_remaining_min: 0.0 },
    future_fire: {
      found: false,
      tick_index: null,
      elapsed_min: null,
      distance_km: null,
      route_fraction: null,
      s_total: null,
    },
    forecast_rest_spot: {
      exists: false,
      position_km: null,
      eta_from_fire_min: null,
      eta_to_destination_min: null,
      actionable: false,
    },
    forecast_future_rest_unactionable: false,
    forecast_rest_unactionable_reason: null,
    current_rest_spot: {
      exists: false,
      position_km: null,
      eta_from_current_min: null,
      eta_to_destination_min: null,
      actionable: false,
      unactionable_reason: null,
    },
  }
}

export function runForecast(args: {
  startTickState: TickState
  startTickIndex: number
  currentElapsedMin: number
  currentDistanceKm: number
  eventPlan: EventPlan
  routeFacts: RouteFacts
  scenario: ScenarioDefM2
  runSeed: number
  packageRuntimeState: Record<string, unknown>
  committedContent?: ContentContext | null
  committedContentRemainingMin?: number
  committedContentRelief?: ContentReliefState | null
  evaluate: EvaluateFn
  thresholdFire: number
  thresholdForecastRest: number
  thresholdMonotony: number
  etaFilterMin: number
}): NriForecastBlock {
  const {
    startTickState,
    startTickIndex,
    currentElapsedMin,
    currentDistanceKm,
    eventPlan,
    routeFacts,
    scenario,
    runSeed,
    packageRuntimeState,
    committedContent = null,
    committedContentRemainingMin = 0.0,
    committedContentRelief = null,
    evaluate,
    thresholdFire,
    etaFilterMin,
  } = args
  // thresholdForecastRest / thresholdMonotony are accepted for signature parity
  // with the Python service (its callers pass them); the projection itself gates
  // only on thresholdFire — the (forecast, fire) band check lives in the algorithm.
  void args.thresholdForecastRest
  void args.thresholdMonotony

  const sp = scenario.speed_profile as unknown as SpeedProfile | undefined
  const tickSeconds = eventPlan.tick_seconds

  // Current rest spot (design §10) — always computable from the actual tick.
  const current = restSpotActionability({
    fromKm: currentDistanceKm,
    fromElapsedMin: currentElapsedMin,
    routeFacts,
    eventPlan,
    sp,
    etaFilterMin,
  })
  const currentBlock = {
    exists: current.exists,
    position_km: current.positionKm,
    eta_from_current_min: current.exists ? current.etaFromPositionMin : null,
    eta_to_destination_min: current.etaToDestinationMin,
    actionable: current.actionable,
    unactionable_reason: current.unactionableReason,
  }

  const startBlock = {
    content_active: committedContent !== null,
    service_id: committedContent?.service_id ?? null,
    content_remaining_min: Number(committedContentRemainingMin || 0.0),
  }

  // ── Project forward, continuing committed state, accepting no proposal ──
  let prior: TickState = startTickState
  let state: Record<string, unknown> = { ...packageRuntimeState }
  let fire: NriForecastBlock['future_fire'] | null = null
  try {
    for (let step = 1; step <= MAX_FORECAST_TICKS; step++) {
      const idx = startTickIndex + step - 1
      const projectedElapsedFromStartMin = ((step - 1) * tickSeconds) / 60.0
      const contentPlaying = committedContent !== null && projectedElapsedFromStartMin < committedContentRemainingMin
      const content = contentPlaying ? committedContent : null
      const relief = contentPlaying ? committedContentRelief : null

      const ts = advanceTick({
        priorState: prior,
        tickIndex: idx,
        eventPlan,
        routeFacts,
        scenario,
        recovery: null, // §8.2 item 10 — never start recovery
        runSeed,
        content,
        contentRelief: relief,
      })
      const decision = evaluate(ts, state) // §8.2 items 6-9 — ignore its proposal/fire
      state = { ...decision.next_package_runtime_state }
      const sTotal = Number((decision.scores as Record<string, unknown>)['s_total'])

      if (sTotal >= thresholdFire) {
        fire = {
          found: true,
          tick_index: idx,
          elapsed_min: (idx * tickSeconds) / 60.0,
          distance_km: ts.distance_km,
          route_fraction: ts.route_fraction,
          s_total: sTotal,
        }
        break
      }
      if (ts.completed) break
      prior = ts
    }
  } catch (exc) {
    // §18 — fail open; forecast is advisory
    const block = unavailable(`forecast_error: ${String(exc)}`)
    block.current_rest_spot = currentBlock
    block.forecast_start = startBlock
    return block
  }

  // ── No crossing before destination → future rest is not unactionable ──
  if (fire === null) {
    const block = unavailable(null)
    block.evaluated = true
    block.current_rest_spot = currentBlock
    block.forecast_start = startBlock
    return block
  }

  // ── Future rest spot at the crossing (design §9) ──
  const fspot = restSpotActionability({
    fromKm: fire.distance_km ?? 0.0,
    fromElapsedMin: fire.elapsed_min ?? 0.0,
    routeFacts,
    eventPlan,
    sp,
    etaFilterMin,
  })
  // Map the shared reason to the forecast-spot reason vocabulary (§9/§13/§18):
  const reasonMap: Record<string, string> = { rest_spot_eta_over_limit: 'eta_over_30_min' }
  const forecastRestSpot = {
    exists: fspot.exists,
    position_km: fspot.positionKm,
    eta_from_fire_min: fspot.exists ? fspot.etaFromPositionMin : null,
    eta_to_destination_min: fspot.etaToDestinationMin,
    actionable: fspot.actionable,
  }
  const futureUnactionable = !fspot.actionable
  const futureReason = futureUnactionable
    ? (fspot.unactionableReason !== null
        ? (reasonMap[fspot.unactionableReason] ?? fspot.unactionableReason)
        : null)
    : null

  return {
    evaluated: true,
    error: null,
    threshold_order_valid: true,
    forecast_mode: 'committed_state_continuation',
    forecast_start: startBlock,
    future_fire: fire,
    forecast_rest_spot: forecastRestSpot,
    forecast_future_rest_unactionable: futureUnactionable,
    forecast_rest_unactionable_reason: futureReason,
    current_rest_spot: currentBlock,
  }
}
