import type {
  RunState,
  RunSummary,
  RunLog,
  TickResponse,
  RestSpot,
  InstantResult,
  RunConfig,
  RouteFacts,
  DisplayRoute,
  PackageManifest,
  ScenarioDef,
  ValidationError,
  DecisionResult,
  RecoveryStateT,
  FirePoint,
  ScoreSeriesPoint,
  SpikePoint,
  PreviewSegment,
  PreviewRestSpot,
  PreviewRestOption,
  PreviewError,
  PreviewOverrideEntry,
  ProgressPoint,
  PreviewTrafficJam,
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
import { packageRegistry } from '../../services/package_registry'
import { scenarioRegistry } from '../../services/scenario_registry'
import {
  createDraft,
  type PackageManifestM2,
} from '../../run_plan'
import type { ScenarioDefM2 } from '../../event_plan'
import { advanceTick, buildAdapterContext, type TickState } from '../../tick_engine'
import { deriveProposalHistory } from '../../proposal_history'
import { evaluate as evaluateAlgorithm } from '../../algorithms/adapter'
import { AlgorithmAdapterError } from '../../algorithms/errors'
import { startRecovery } from '../../recovery'
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
const REST_SPOTS_DEFAULT_MIN_DISTANCE_KM = 20.0

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
  const ahead = candidates.filter(([pos]) => pos > currentDistanceKm)
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

// ── Preview helpers ─────────────────────────────────────────────────────────

/** Loose stand-in for Python's `!r` repr formatting, scoped to preview errors. */
function pyPreviewRepr(value: unknown): string {
  if (typeof value === 'string') return `'${value}'`
  return String(value)
}

const _VALID_PREVIEW_CONTEXT_OVERRIDE_KEYS = ['child_passenger', 'familiar_route', 'is_night', 'weather_risk']

function validatePreviewContextOverrides(contextOverrides: Record<string, unknown>): ValidationError[] {
  const errors: ValidationError[] = []
  const sortedKeys = [..._VALID_PREVIEW_CONTEXT_OVERRIDE_KEYS].sort()
  for (const [key, value] of Object.entries(contextOverrides)) {
    if (!_VALID_PREVIEW_CONTEXT_OVERRIDE_KEYS.includes(key)) {
      errors.push({
        field: `context_overrides.${key}`,
        message: `Unknown context key ${pyPreviewRepr(key)}. Valid keys: [${sortedKeys.map((k) => pyPreviewRepr(k)).join(', ')}]`,
      })
    } else if (key === 'weather_risk') {
      if (typeof value !== 'number' || Number.isNaN(value)) {
        errors.push({
          field: `context_overrides.${key}`,
          message: `context_overrides.${key} must be a number in [0, 100]; got ${pyPreviewRepr(value)}`,
        })
      } else if (!(value >= 0 && value <= 100)) {
        errors.push({
          field: `context_overrides.${key}`,
          message: `context_overrides.${key} must be in [0, 100]; got ${pyPreviewRepr(value)}`,
        })
      }
    } else if (typeof value !== 'boolean') {
      errors.push({
        field: `context_overrides.${key}`,
        message: `context_overrides.${key} must be a boolean; got ${pyPreviewRepr(value)}`,
      })
    }
  }
  return errors
}

function pickPreviewRestSpot(routeFacts: RouteFactsFull, currentDistanceKm: number): RestSpot | null {
  const totalKm = routeFacts.total_route_distance_km || 120.0

  const named = (routeFacts.named_rest_spots ?? []).filter((s) => !s.synthetic)
  const candidates: [number, string][] = named.length > 0
    ? named.map((s): [number, string] => [s.position_km, s.name])
    : (routeFacts.rest_spot_positions ?? []).map((posKm, i): [number, string] => [posKm, `Rest stop ${i + 1}`])

  const ahead = candidates
    .filter(([km]) => km > currentDistanceKm)
    .sort(([kmA, nameA], [kmB, nameB]) => (kmA !== kmB ? kmA - kmB : nameA < nameB ? -1 : nameA > nameB ? 1 : 0))
  if (ahead.length === 0) return null

  const [km, name] = ahead[0]
  const routeFraction = totalKm ? Math.min(1.0, km / totalKm) : 1.0
  return { id: 'preview_auto_rest', label: { ja: name, en: name }, route_fraction: routeFraction }
}

/** In-memory-only event shape fed to derivePreviewHistory — never persisted. */
type PreviewEvent =
  | { kind: 'tick'; tick_index: number; trace: { tick_index: number; decision_result: DecisionResult } }
  | { kind: 'action'; tick_index: number; action: string; resulting_status: string }


const _MAX_PREVIEW_TICKS = 2000

export async function runsPreview(params: { config: RunConfig; restOptionId?: string | null }): Promise<InstantResult> {
  const { config, restOptionId } = params
  const overrides: Record<string, unknown> = { ...(config.hyperparameter_overrides ?? {}) }

  let pkgManifest: PackageManifest
  try {
    pkgManifest = await packageRegistry.get(config.package_id)
  } catch {
    throw new Error(`Package ${pyPreviewRepr(config.package_id)} not found or invalid`)
  }

  let scenario: ScenarioDef
  try {
    scenario = await scenarioRegistry.get(config.scenario_id)
  } catch {
    throw new Error(
      `Scenario ${pyPreviewRepr(config.scenario_id)} not found or invalid (unknown id, or incompatible `
        + 'old-shape scenario — re-author with driver_signal_params and anomaly_signal_params).',
    )
  }

  if (!packageRegistry.isCompatible(pkgManifest, scenario)) {
    throw new Error(
      `Package ${pyPreviewRepr(config.package_id)} is not compatible with scenario `
        + `${pyPreviewRepr(config.scenario_id)} (type=${pyPreviewRepr(scenario.type)})`,
    )
  }

  const contextOverrides = (config.context_overrides ?? null) as Record<string, unknown> | null
  if (contextOverrides && Object.keys(contextOverrides).length > 0) {
    const ctxErrors = validatePreviewContextOverrides(contextOverrides)
    if (ctxErrors.length > 0) {
      throw new Error(
        'Invalid context overrides: ' + ctxErrors.map((e) => `${e.field}: ${e.message}`).join('; '),
      )
    }
  }

  const routeSource: 'maps' | 'local' = config.route_source === 'maps' && config.route_facts != null ? 'maps' : 'local'
  const selectedRouteFacts: RouteFacts | null = routeSource === 'maps' ? (config.route_facts as RouteFacts) : null
  const selectedDisplayRoute: DisplayRoute | null = routeSource === 'maps' ? (config.display_route ?? null) : null

  const routeKey = routeSource === 'maps'
    ? ((selectedRouteFacts as unknown as { route_source?: string } | null)?.route_source ?? 'maps')
    : 'local'
  const planId = `preview_${config.package_id}_${config.scenario_id}_${config.run_seed}_${routeKey}`

  const { draft, package: draftPkg, scenario: effectiveScenario } = createDraft({
    planId,
    package: pkgManifest as unknown as PackageManifestM2,
    scenario: scenario as unknown as ScenarioDefM2,
    presets: {},
    parameters: {},
    hyperparameters: overrides,
    runMode: 'standard',
    routeFacts: selectedRouteFacts,
    routeSource,
    displayRoute: selectedDisplayRoute,
    profiles: (config.profiles ?? null) as Record<string, unknown> | null,
    contextOverrides,
  })

  if (draft.validation_errors.length > 0) {
    throw new Error(
      'Invalid setup overrides: ' + draft.validation_errors.map((e) => `${e.field}: ${e.message}`).join('; '),
    )
  }

  const pkgM2 = draftPkg as unknown as PackageManifestM2
  const routeFacts = draft.route_facts as RouteFactsFull
  const eventPlan = draft.draft_event_plan

  const defaultHps: Record<string, unknown> = Object.fromEntries(pkgM2.hyperparameters.map((hp) => [hp.key, hp.default]))
  const hyperparameters: Record<string, unknown> = { ...defaultHps, ...overrides }
  const parameters: Record<string, unknown> = Object.fromEntries(pkgM2.parameters.map((p) => [p.key, p.default]))

  const overridesOut: PreviewOverrideEntry[] = []
  for (const [key, value] of Object.entries(overrides)) {
    if (key in defaultHps && defaultHps[key] !== value) {
      overridesOut.push({ key, default: defaultHps[key], value })
    }
  }

  let priorTickState: TickState | null = null
  let packageRuntimeState: Record<string, unknown> = {}
  let recovery: RecoveryStateT | null = null
  const events: PreviewEvent[] = []

  let firedAt: FirePoint | null = null
  const fires: FirePoint[] = []
  // The category of the episode currently in progress, or null when nothing
  // actionable is in flight. Holding the CATEGORY (not just a bool) is what
  // lets a monotony -> rest escalation on consecutive ticks split into two
  // (mirrors app/api/aica_api/services/preview.py's `fire_active: str | None`).
  let fireActive: string | null = null
  let peakScore = 0.0
  let threshold: number | null = null
  const scoreSeries: ScoreSeriesPoint[] = []
  const spikes: SpikePoint[] = []
  const monotonySeries: ScoreSeriesPoint[] = []
  let monotonyThreshold: number | null = null

  const segments: PreviewSegment[] = []
  let segType: string | null = null
  const progress: ProgressPoint[] = []
  // traffic_jams are derived from event_plan.traffic_events (not ticks) — built after the loop
  let segStartMin = 0.0
  let lastElapsedMin = 0.0

  let completedMin: number | null = null
  let errorOut: PreviewError | null = null
  const restSpotsOut: PreviewRestSpot[] = []
  const restOptionsOut: PreviewRestOption[] = []

  for (let tickIndex = 0; tickIndex < _MAX_PREVIEW_TICKS; tickIndex++) {
    const tickState = advanceTick({
      priorState: priorTickState,
      tickIndex,
      eventPlan,
      routeFacts,
      scenario: effectiveScenario,
      recovery,
      runSeed: config.run_seed,
    })
    const recNext = tickState._recovery_next

    const dynamic = ((tickState.signals as { dynamic?: Record<string, unknown> })?.dynamic) ?? {}
    const elapsedMin = tickState.elapsed_seconds / 60.0

    if (recovery !== null && recovery.active && dynamic['motionState'] === 'STOPPED' && restOptionsOut.length > 0) {
      const cur = restOptionsOut[restOptionsOut.length - 1]
      if (cur.recovery_from_min === null) cur.recovery_from_min = elapsedMin
      cur.to_min = elapsedMin
    }

    if (recNext !== undefined) {
      recovery = recNext.active ? recNext : null
    }

    const curSegType = (dynamic['segmentType'] as string | undefined) ?? null
    if (segType === null) {
      segType = curSegType
      segStartMin = 0.0
    } else if (curSegType !== segType) {
      segments.push({ type: segType, from_min: segStartMin, to_min: lastElapsedMin })
      segType = curSegType
      segStartMin = lastElapsedMin
    }
    lastElapsedMin = elapsedMin

    if (tickState.completed && !(recovery && recovery.active)) {
      completedMin = elapsedMin
      break
    }

    const context = buildAdapterContext(tickState)
    context['simulation_time_sec'] = Number(tickState.elapsed_seconds)
    const [proposalHistory, userActionHistory] = deriveProposalHistory(
      events,
      Number(eventPlan.tick_seconds),
      Number(tickState.elapsed_seconds),
    )
    context['proposal_history'] = proposalHistory
    context['user_action_history'] = userActionHistory
    context['recovery_active'] = Boolean(recovery && recovery.active)

    let decision: DecisionResult
    try {
      decision = evaluateAlgorithm({
        manifest: pkgM2,
        context,
        parameters,
        hyperparameters,
        history: [],
        packageRuntimeState,
      })
    } catch (exc) {
      if (!(exc instanceof AlgorithmAdapterError)) throw exc
      const detail = exc.detail as { error_type?: string } | undefined
      const errorType = detail?.error_type ?? 'unknown_error'
      const prefix = `${errorType}: `
      const cleanMessage = exc.message.startsWith(prefix) ? exc.message.slice(prefix.length) : exc.message
      errorOut = { tick_index: tickIndex, error_type: errorType, message: cleanMessage }
      break
    }

    packageRuntimeState = decision.next_package_runtime_state

    events.push({
      kind: 'tick',
      tick_index: tickIndex,
      trace: { tick_index: tickIndex, decision_result: decision },
    })

    const scoresRec = decision.scores as Record<string, unknown>
    let scoreRaw = scoresRec['rest_required_score']
    if (scoreRaw == null) scoreRaw = decision.score ?? 0.0
    const score = Number(scoreRaw)
    scoreSeries.push({ t: tickIndex, score })
    peakScore = Math.max(peakScore, score)

    // Feature 020: per-tick route-progress (distance axis alignment).
    // Mirrors Python: route_fraction = min(1, max(0, distance_km / total_km)); frac clipped.
    const totalKmForProgress = routeFacts.total_route_distance_km || 120.0
    const fracForProgress = totalKmForProgress > 0
      ? Math.min(1.0, Math.max(0.0, (tickState.distance_km ?? 0.0) / totalKmForProgress))
      : 0.0
    progress.push({ t: tickIndex, min: elapsedMin, frac: fracForProgress })

    if ((tickState.anomaly_events ?? []).includes(tickIndex)) {
      spikes.push({ t: tickIndex, time_min: elapsedMin })
    }

    const critRec = decision.criteria as Record<string, unknown>
    let critThreshold = critRec['rest_required_threshold']
    if (critThreshold == null) critThreshold = critRec['threshold_suggest'] ?? critRec['threshold_fire']
    if (critThreshold != null) threshold = Number(critThreshold)

    // ── Monotony threshold — read INDEPENDENTLY of the curve ────────────────
    // This used to be nested inside the `monoScoreRaw != null` branch, which
    // silently assumed a monotony threshold only exists where a monotony
    // CURVE does. NRI breaks that assumption by design: it bands ONE score
    // with two thresholds (rest above, monotony below), so it publishes a
    // monotony threshold and no second curve — emitting one would just draw a
    // duplicate of the rest curve on top of itself. Nested, its rule was
    // dropped and the strip showed a monotony fire with nothing to fire
    // against (mirrors app/api/aica_api/services/preview.py's fix).
    const monoScoreRaw = scoresRec['monotony_prevention_score']
    if (monoScoreRaw != null) {
      monotonySeries.push({ t: tickIndex, score: Number(monoScoreRaw) })
    }
    const monoCrit = critRec['monotony_suggest_threshold']
    if (monoCrit != null) monotonyThreshold = Number(monoCrit)

    const proposalFired = decision.fire_control.fired && decision.proposal !== null
    let proposalIsActionable = proposalFired
      && decision.proposal!.options.some((opt) => effectiveScenario.allowed_actions.includes(opt))
    const recoveryActiveNow = Boolean(recovery && recovery.active)
    if (recoveryActiveNow && proposalIsActionable && decision.result_type === 'REST_PROPOSAL') {
      proposalIsActionable = false
    }

    // Trigger capture — one marker per actionable EPISODE, matching the
    // Review timeline where the run pauses once per proposal then resumes.
    // An episode starts on a rising edge (nothing actionable -> actionable)
    // OR when the fired CATEGORY changes, so a long route shows a handful of
    // triggers rather than one per tick.
    //
    // The category clause is load-bearing: this used to be purely
    // category-agnostic (`fireActive: boolean`), and a run that escalates
    // monotony -> rest on CONSECUTIVE ticks (the normal shape now that both
    // packages fire two categories) was collapsed into a single monotony
    // marker. The rest proposal — the consequential one — never appeared on
    // the strip at all (mirrors app/api/aica_api/services/preview.py's fix).
    if (proposalIsActionable) {
      if (decision.selected_category !== fireActive) {
        const strength = decision.candidates.find((c) => c.category === decision.selected_category)?.strength ?? null
        const fire: FirePoint = {
          category: decision.selected_category,
          strength,
          tick: tickIndex,
          time_min: elapsedMin,
          feature_contributions: decision.feature_contributions ?? {},
          criteria: decision.criteria,
        }
        fires.push(fire)
        if (firedAt === null) firedAt = fire
      }
      fireActive = decision.selected_category
    } else {
      fireActive = null
    }

    if (proposalIsActionable) {
      const canAccept = !(recovery && recovery.active)
        && decision.selected_category === 'rest_required'
        && Boolean(effectiveScenario.recovery_options && effectiveScenario.recovery_options.length > 0)
        && decision.proposal!.options.includes('accept_rest')

      if (canAccept) {
        const recoveryOptions = effectiveScenario.recovery_options!
        let option = restOptionId ? (recoveryOptions.find((o) => o.id === restOptionId) ?? null) : null
        if (option === null) option = recoveryOptions[0]

        const spot = pickPreviewRestSpot(routeFacts, tickState.distance_km ?? 0.0)
        if (spot !== null) {
          const totalKm = routeFacts.total_route_distance_km || 120.0
          restSpotsOut.push({
            at_km: spot.route_fraction * totalKm,
            eta_min: (dynamic['nextRestSpotMin'] as number | undefined) ?? null,
          })
          restOptionsOut.push({ id: option.id, auto_chosen: true, recovery_from_min: null, to_min: null })
          recovery = startRecovery(option, spot)
          events.push({ kind: 'action', tick_index: tickIndex, action: 'accept_rest', resulting_status: 'playing' })
        } else {
          const decline = decision.proposal!.options.includes('decline') ? 'decline' : decision.proposal!.options[0]
          events.push({ kind: 'action', tick_index: tickIndex, action: decline, resulting_status: 'playing' })
        }
      } else if (
        !(effectiveScenario.recovery_options && effectiveScenario.recovery_options.length > 0)
        && decision.proposal!.options.includes('accept_rest')
        && restOptionsOut.length === 0
        && decision.selected_category === 'rest_required'
      ) {
        completedMin = elapsedMin
        events.push({ kind: 'action', tick_index: tickIndex, action: 'accept_rest', resulting_status: 'completed' })
        break
      } else {
        const decline = decision.proposal!.options.includes('decline') ? 'decline' : decision.proposal!.options[0]
        events.push({ kind: 'action', tick_index: tickIndex, action: decline, resulting_status: 'playing' })
      }
    }

    priorTickState = tickState
  }

  if (segType !== null) {
    segments.push({ type: segType, from_min: segStartMin, to_min: lastElapsedMin })
  }

  // Feature 020: traffic-jam ranges derived from event_plan.traffic_events (same axis as segments).
  const trafficJams: PreviewTrafficJam[] = (
    (eventPlan as unknown as { traffic_events?: { start_min: number; duration_min: number }[] }).traffic_events ?? []
  ).map((ev) => ({ from_min: ev.start_min, to_min: ev.start_min + ev.duration_min }))

  const fired = firedAt !== null && errorOut === null

  return {
    fired,
    fire: fired ? firedAt : null,
    fires: errorOut === null ? fires : [],
    peak_score: peakScore,
    threshold,
    score_series: scoreSeries,
    progress: progress,
    spikes: errorOut === null ? spikes : [],
    monotony_series: monotonySeries,
    monotony_threshold: monotonyThreshold,
    segments,
    traffic_jams: trafficJams,
    rest_spot: restSpotsOut.length > 0 ? restSpotsOut[0] : null,
    rest_option: restOptionsOut.length > 0 ? restOptionsOut[0] : null,
    rest_spots: restSpotsOut,
    rest_options: restOptionsOut,
    completed_min: completedMin,
    seed: config.run_seed,
    overrides: overridesOut,
    error: errorOut,
  }
}
