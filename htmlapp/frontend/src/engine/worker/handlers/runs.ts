import type {
  RunState,
  RunSummary,
  RunLog,
  TickResponse,
  RestSpot,
  InstantResult,
  RunConfig,
  Snapshot,
} from '../../../api/types'
import {
  createRun as engineCreateRun,
  tick as engineTick,
  action as engineAction,
  getRun as engineGetRun,
  resolveRunLog as engineResolveRunLog,
  getPriorTickState as engineGetPriorTickState,
  getScenario as engineGetScenario,
} from '../../run_manager'
import { runsStore } from '../../../storage/runs_store'
import { drainPreviewTicks, type PreviewLoopRestOption } from '../../services/preview_ticks'
import type { RouteFactsFull } from '../../services/route_analysis'

// Collision-resistant id; mirrors Python's run_<ts>_<hex>. Runs ONCE at creation,
// outside the deterministic tick loop, so determinism of ticks is unaffected.
function randHex(n: number): string {
  let s = ''
  for (let i = 0; i < n; i++) s += Math.floor(Math.random() * 16).toString(16)
  return s
}
export function makeRunId(): string {
  return `run_${Date.now().toString(36)}_${randHex(6)}`
}

export async function runsCreate(params: { planId: string }): Promise<RunState> {
  const runId = makeRunId()
  return engineCreateRun(params.planId, runId)
}

/**
 * Shapes TickOutcome into TickResponseSuccess | TickResponseError exactly as
 * runs.py's tick_endpoint does.
 */
export async function runsTick(params: { runId: string }): Promise<TickResponse> {
  const outcome = await engineTick(params.runId)

  const ts = outcome.tickState
  const routeFraction = ts ? ts.route_fraction : null
  const distanceKm = ts ? ts.distance_km : null
  const signals = (ts ? (ts as unknown as { signals?: Record<string, unknown> }).signals : {}) ?? {}
  const dyn = ((signals as Record<string, unknown>)['dynamic'] as Record<string, unknown> | undefined) ?? {}
  const speedKph = (dyn['speedKph'] as number | undefined) ?? null
  const motionState = (dyn['motionState'] as string | undefined) ?? null
  const recoveryPhase = (dyn['recoveryPhase'] as string | undefined) ?? null
  const activeContent = null
  const isTrafficJam = (dyn['isTrafficJam'] as boolean | undefined) ?? null
  const segmentType = (dyn['segmentType'] as string | undefined) ?? null

  const algorithmError = outcome.algorithmError
  if (algorithmError !== null) {
    const response = {
      run_state: outcome.runState,
      error: algorithmError,
      paused: outcome.paused,
      tick_index: outcome.evaluatedTickIndex,
      route_fraction: routeFraction,
      distance_km: distanceKm,
      speed_kph: speedKph,
      motion_state: motionState,
      recovery_phase: recoveryPhase,
      active_content: activeContent,
      is_traffic_jam: isTrafficJam,
      segment_type: segmentType,
    }
    return response as TickResponse
  }

  const response = {
    run_state: outcome.runState,
    decision: outcome.decision,
    paused: outcome.paused,
    completed: outcome.completed,
    tick_index: outcome.evaluatedTickIndex,
    route_fraction: routeFraction,
    distance_km: distanceKm,
    speed_kph: speedKph,
    motion_state: motionState,
    recovery_phase: recoveryPhase,
    active_content: activeContent,
    is_traffic_jam: isTrafficJam,
    segment_type: segmentType,
  }
  return response as TickResponse
}

export async function runsAct(
  params: { runId: string; action: string; opts?: { recovery_option_id?: string; rest_spot?: RestSpot } },
): Promise<RunState> {
  const opts = params.opts ?? {}
  return engineAction(params.runId, params.action, {
    recoveryOptionId: opts.recovery_option_id ?? null,
    restSpot: opts.rest_spot ?? null,
  })
}

const REST_SPOTS_MAX = 5
const REST_SPOTS_DEFAULT_MIN_DISTANCE_KM = 2.0
// How far AHEAD of the car the nearest offered spot must be. Mirrors
// `_REST_SPOTS_MIN_AHEAD_KM` in app/api/aica_api/routers/runs.py — a
// SIMULATION-EXPERIENCE rule, not a safety one: a spot 2 km away is reached
// before the reviewer can watch the proposal play out, so the journey to the
// rest stop — the thing being demonstrated — never happens. Distinct from
// REST_SPOTS_DEFAULT_MIN_DISTANCE_KM above, which spaces the spots from EACH
// OTHER.
const REST_SPOTS_MIN_AHEAD_KM = 1.0

function round1(n: number): number {
  return Math.round(n * 10) / 10
}

/** (position_km, name) candidate pairs, named source preferred over generic positions. */
function buildRestSpotCandidates(routeFacts: RouteFactsFull): [number, string][] {
  const named = routeFacts.named_rest_spots ?? []
  if (named.length > 0) {
    const realNamed = named.filter((s) => !s.synthetic)
    return realNamed.map((s) => [s.position_km, s.name])
  }
  return (routeFacts.rest_spot_positions ?? []).map((pos, i) => [pos, `Rest stop ${i + 1}`])
}

export async function runsRestSpots(params: {
  runId: string
  mapsKey?: string
  drowsinessCeiling?: number
  minDistanceKm?: number
}): Promise<{ rest_spots: RestSpot[]; notice?: string | null }> {
  void params.mapsKey

  const rs = engineGetRun(params.runId)
  if (rs === null) {
    throw new Error(`Run '${params.runId}' not found`)
  }

  const routeFacts = rs.route_facts as RouteFactsFull
  const totalKm = routeFacts.total_route_distance_km || 120.0

  const priorTick = engineGetPriorTickState(params.runId)
  let currentDistanceKm = 0.0
  let currentDrowsiness = 0.0
  let currentSpeedKph = 0.0
  if (priorTick !== null) {
    currentDistanceKm = priorTick.distance_km ?? 0.0
    const signals = ((priorTick as unknown as { signals?: Record<string, unknown> }).signals ?? {}) as Record<string, unknown>
    const sim = (signals['simulated'] as Record<string, unknown> | undefined) ?? {}
    const dyn = (signals['dynamic'] as Record<string, unknown> | undefined) ?? {}
    currentDrowsiness = Number(sim['drowsiness'] ?? 0)
    currentSpeedKph = Number(dyn['speedKph'] ?? 0)
  }

  const scenario = engineGetScenario(params.runId)
  let baseGrowthPerMin = 0.0
  let ceiling = params.drowsinessCeiling ?? 100.0
  const driverSignalParams = scenario != null
    ? (scenario as unknown as Record<string, unknown>)['driver_signal_params']
    : null
  if (driverSignalParams != null) {
    const dsp = driverSignalParams as { drowsiness_model: { base_growth_per_min: number } }
    baseGrowthPerMin = dsp.drowsiness_model.base_growth_per_min
    ceiling = params.drowsinessCeiling ?? (scenario as { rest_drowsiness_ceiling?: number })!.rest_drowsiness_ceiling ?? 100.0
  }

  const effectiveMinDistanceKm = params.minDistanceKm ?? REST_SPOTS_DEFAULT_MIN_DISTANCE_KM
  const candidates = buildRestSpotCandidates(routeFacts)

  // ── Filter to spots far enough ahead of the current position ─────────────
  // Two-stage selection mirroring routers/runs.py's rest_spots_endpoint:
  // stage 1 prefers candidates more than REST_SPOTS_MIN_AHEAD_KM ahead; falls
  // back to "anything ahead" only when stage 1 yields nothing, so a driver
  // near the end of the route is never left with no option at all — an empty
  // list reads as "no rest possible", which is a different claim.
  let ahead = candidates.filter(([pos]) => pos > currentDistanceKm + REST_SPOTS_MIN_AHEAD_KM)
  if (ahead.length === 0) {
    ahead = candidates.filter(([pos]) => pos > currentDistanceKm)
  }
  ahead.sort((a, b) => a[0] - b[0])

  const spaced: [number, string][] = []
  let lastTakenKm: number | null = null
  for (const [posKm, name] of ahead) {
    if (lastTakenKm === null || posKm - lastTakenKm >= effectiveMinDistanceKm) {
      spaced.push([posKm, name])
      lastTakenKm = posKm
      if (spaced.length >= REST_SPOTS_MAX) break
    }
  }

  const spots: RestSpot[] = spaced.map(([posKm, name], i) => {
    const routeFraction = Math.min(1.0, posKm / totalKm)
    const spotDistanceKm = round1(Math.max(0.0, posKm - currentDistanceKm))

    let etaMin: number | null
    let reachable: boolean
    if (currentSpeedKph <= 0) {
      etaMin = null
      reachable = false
    } else {
      const rawEta = (spotDistanceKm / currentSpeedKph) * 60.0
      etaMin = round1(rawEta)
      const projectedDrowsiness = currentDrowsiness + baseGrowthPerMin * rawEta
      reachable = projectedDrowsiness <= ceiling
    }

    return {
      id: `rest_${i}`,
      label: { ja: name, en: name },
      route_fraction: routeFraction,
      distance_km: spotDistanceKm,
      eta_min: etaMin,
      reachable,
    }
  })

  // ── Never strand the driver ───────────────────────────────────────────────
  // The ceiling exists to rule out spots the driver cannot safely REACH. Once
  // current drowsiness is already at or above it, every projection fails (even
  // a zero-minute ETA), so the whole list comes back unreachable and the driver
  // can only decline — the outcome the ceiling was meant to prevent. When
  // nothing qualifies, keep the CLOSEST spot selectable: it is strictly the
  // best available choice, and stopping slightly past the ceiling beats not
  // stopping at all. `spots` is ordered ascending by position, so [0] is nearest.
  if (spots.length > 0 && !spots.some((s) => s.reachable)) {
    spots[0].reachable = true
    spots[0].reachable_fallback = true
  }

  const notice = spots.length === 0 ? 'no_rest_stops_found' : null
  return { rest_spots: spots, notice }
}

export async function runsList(): Promise<{ runs: RunSummary[] }> {
  const headers = await runsStore.listHeaders()
  const runs: RunSummary[] = headers
    .slice()
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((h) => {
      const snapshot = h['snapshot'] as Snapshot | undefined
      const active = engineGetRun(h.id)
      return {
        run_id: h.id,
        created_at: (h['created_at'] as string | undefined) ?? '',
        package_id: snapshot?.package.id ?? '',
        scenario_id: snapshot?.scenario.id ?? '',
        status: active?.status ?? h.status,
      }
    })
  return { runs }
}

export async function runsState(params: { runId: string }): Promise<RunState> {
  const runState = engineGetRun(params.runId)
  if (runState === null) {
    throw new Error(`Run '${params.runId}' not found`)
  }
  return runState
}

export async function runsLog(params: { runId: string }): Promise<RunLog> {
  return engineResolveRunLog(params.runId)
}

// ── Preview ──────────────────────────────────────────────────────────────
//
// The tick loop itself now lives in `../../services/preview_ticks.ts`
// (`iterPreviewTicks`/`drainPreviewTicks`) — extracted (feature 026, C4
// Task 4) so the merged simulator's quickview projection can hook a
// proposal at each fire without a second, independently-drifting copy of
// this loop. Mirrors Python's own `services/preview.py` structure exactly
// (`iter_preview_ticks` extracted from `evaluate_preview`). This function is
// now a thin drain-and-return wrapper, matching `evaluate_preview`'s own
// role — see that module's doc comment for the full extraction rationale
// and hazard pass (unchanged by this refactor, just relocated).

export async function runsPreview(params: { config: RunConfig; restOptionId?: string | null }): Promise<InstantResult> {
  const { config, restOptionId } = params

  // Pre-resolves routeSource/routeFacts itself (rather than letting
  // `iterPreviewTicks` raise when 'maps' has no route_facts) — preserves
  // this function's own PRE-EXISTING behavior unchanged (a caller that sets
  // route_source: 'maps' without route_facts silently gets 'local', not a
  // thrown error). A pre-existing, out-of-scope divergence from Python's own
  // `iter_preview_ticks` (which WOULD raise there) that this refactor does
  // not change — flagged in task-4-report.md, not fixed here.
  const routeSource: 'maps' | 'local' = config.route_source === 'maps' && config.route_facts != null ? 'maps' : 'local'

  const result = await drainPreviewTicks({
    packageId: config.package_id,
    scenarioId: config.scenario_id,
    hyperparameterOverrides: { ...(config.hyperparameter_overrides ?? {}) },
    runSeed: config.run_seed,
    restOptionId,
    profiles: (config.profiles ?? null) as Record<string, unknown> | null,
    contextOverrides: (config.context_overrides ?? null) as Record<string, unknown> | null,
    routeSource,
    routeFacts: routeSource === 'maps' ? config.route_facts : null,
    displayRoute: routeSource === 'maps' ? (config.display_route ?? null) : null,
  })

  // Strip the merged-quickview-only recovery-state stash so it never leaks
  // into the trigger-only InstantResult response (mirrors evaluate_preview's
  // own strip, services/preview.py:812-817 — "must NEVER reach the response,
  // the models are extra=allow").
  for (const opt of result.rest_options as PreviewLoopRestOption[]) {
    delete opt._post_rest_tick_state
  }
  return result as InstantResult
}
