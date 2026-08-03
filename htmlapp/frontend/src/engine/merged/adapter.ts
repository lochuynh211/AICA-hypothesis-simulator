/**
 * TriggerTickAdapter — TS port of `app/api/aica_api/services/merged_adapter.py`
 * (feature 026, htmlapp Combined export, slice C4 Task 2).
 *
 * Maps a trigger `TickState` (tiered `signals` = `{fixed, dynamic, simulated}`)
 * onto a proposal `World`. Every function here is pure — no IO, no
 * clock/random, no persistence — so the merged run coordinator (a later C4
 * task) can call it deterministically on every trigger fire.
 *
 * `mapTriggerPurpose`/`mapLifecycleStage`/`mapRoadType`/`buildWorldFromTick`
 * mirror Python's `map_trigger_purpose`/`map_lifecycle_stage`/`map_road_type`/
 * `build_world_from_tick` verbatim — see each function's doc comment for the
 * exact Python line(s) it reproduces.
 *
 * ── The load-bearing branch (see task-2-brief.md) ──────────────────────────
 * `mapTriggerPurpose` returns `null` for a `resultType` it does not
 * recognise (`SUPPRESSED`, `NO_PROPOSAL`, ... — anything other than the two
 * mapped keys). That `null` is what makes a merged fire point's `proposal`
 * AND `proposal_error` come back `null` together (see
 * `services/merged_quickview.py::_project_fire`, a later C4 task) — a real
 * three-state encoding this module's own tests must exercise directly, not
 * just the two mapped branches.
 *
 * ── Reuse, not rewrite ──────────────────────────────────────────────────────
 * `LifecycleStage` (all 4 members — this module's own return values are a
 * strict subset, `during_rest_stopped`/`before_rest_until_stop`/
 * `active_driving_content`) comes from the already-ported/reviewed C2
 * `engine/proposal/journey.ts`; `MotionState` from C2's `engine/proposal/
 * eligibility.ts`; `TickState` from the trigger-side `engine/tick_engine.ts`.
 * `TriggerPurpose`/`RoadType` have no existing shared declaration anywhere
 * else in this port (checked — only a PRIVATE, unexported `ROAD_TYPE` const
 * array lives in `engine/proposal/world_validation.ts`, used for a different
 * purpose), so they are declared fresh here, matching this codebase's
 * established per-module literal-union convention (see `engine/proposal/
 * enums.ts`'s own doc comment for when centralizing is/is not warranted).
 *
 * ── Divergence hazard pass (see task-2-report.md for the full per-site
 * table) ─────────────────────────────────────────────────────────────────
 * - Hazard 1 (banker's rounding): `build_world_from_tick` has FOUR bare
 *   `round()` calls (drowsiness, fatigue, monotonyLevel, nextRestSpotMin) —
 *   all four need `pyRound` below, not `Math.round`.
 * - Hazard 2 (`sorted()`/`.sort()`): not present in the Python source (the
 *   whole 172-LOC file was read in full; zero sort call sites).
 * - Hazard 3 (`//`/`%` floor division): not present (zero `//`/`%` in the
 *   Python source).
 * - Hazard 4 (dict/insertion order): `_RESULT_TYPE_TO_PURPOSE`/
 *   `_SEGMENT_TYPE_TO_ROAD_TYPE` are `.get()`-only lookup tables (order-
 *   independent). `build_world_from_tick`'s `situation_update`/
 *   `control_inputs` update dicts feed `model_copy(update=...)`, which
 *   overwrites fields on an ALREADY-existing model whose serialized key
 *   order is fixed by the Python class's field DECLARATION order, not by
 *   the update dict's insertion order — so the risk here is not "wrong
 *   order from an update dict" but "does a `{...base, ...patch}` spread
 *   preserve `base`'s original key order for keys that already exist in
 *   `base`". It does, by the ECMAScript spec (re-assigning an existing own
 *   property does not move its position) — the SAME structural guarantee
 *   `model_copy` relies on, not merely an incidental match. Proven directly
 *   in `tests/merged_adapter_port.test.ts` via an explicit
 *   `Object.keys(...)` order assertion against a real captured World's key
 *   order (not merely `expectParity`, which sorts keys before comparing).
 * - Hazard 5 (bare `str(float)`/f-string float interpolation): none — no
 *   f-strings in this module at all.
 * - Hazard 6 (`neumaierSum`): no `sum()` call over floats.
 * - Hazard 7 (`pyFixed`/`:.Nf`): no format-spec float formatting.
 * - Hazard 8 (`isinstance(x, (int, float))` accepting `bool`): no
 *   `isinstance` call anywhere in the Python source (verified — zero hits
 *   reading the full 172 LOC).
 *
 * A genuine (unnumbered) None-vs-absent nuance, found while porting: Python
 * `dict.get(key, default)` returns the STORED value — including an explicit
 * `None` — whenever `key` is present, and only substitutes `default` when
 * `key` is wholly ABSENT. JS's `??` fires on BOTH `undefined` (absent) AND
 * `null` (explicitly stored). This only matters for a field whose declared
 * type permits an explicit `null` — `dynamic.recoveryPhase` is the one
 * `TieredSignals` field typed `| null` that this module's Python reads with
 * `.get(..., default)`, but `build_world_from_tick` never reads
 * `recoveryPhase` at all (`map_lifecycle_stage`'s `recovery_phase` argument
 * comes from the CALLER, never from a tick's own signals — see that
 * function's own doc comment), so this nuance has no live call site in this
 * module today. Flagged here rather than silently assumed safe, per the
 * task brief's "prove, don't assume" instruction — `fixed.isNight` /
 * `dynamic.isTrafficJam` / `dynamic.segmentType` / `dynamic.nextRestSpotMin`
 * are all typed WITHOUT `| null` in their `TieredSignals` slice
 * (`fixed: Record<string, number|boolean|string>`) or, for the `dynamic`
 * ones, are never actually emitted as an explicit `null` by the real
 * `tick_engine.py` (`segmentType` is always one of 4 literal strings;
 * `nextRestSpotMin` uses a `9999.0` sentinel, never `None`; `isTrafficJam`
 * is always a real `bool`) — confirmed by reading `tick_engine.py`'s
 * `advance_tick` signal-assembly block directly, not inferred.
 */
import type { LifecycleStage } from '../proposal/journey'
import type { MotionState } from '../proposal/eligibility'
import type { TickState, TieredSignals } from '../tick_engine'

// ---------------------------------------------------------------------------
// mapTriggerPurpose
// ---------------------------------------------------------------------------

export type TriggerPurpose = 'rest_recommended' | 'inattentive_driving_prevention_recovery'

/** Mirrors Python's `_RESULT_TYPE_TO_PURPOSE` dict verbatim (2 entries;
 * `.get()`-only lookup, so its own iteration order never feeds output —
 * hazard 4 does not apply here). */
const RESULT_TYPE_TO_PURPOSE: Record<string, TriggerPurpose> = {
  REST_PROPOSAL: 'rest_recommended',
  MONOTONY_PROPOSAL: 'inattentive_driving_prevention_recovery',
}

/**
 * Mirrors `map_trigger_purpose` (merged_adapter.py:49-56).
 *
 * `REST_PROPOSAL` -> `rest_recommended`; `MONOTONY_PROPOSAL` ->
 * `inattentive_driving_prevention_recovery`; anything else (`SUPPRESSED`,
 * `NO_PROPOSAL`, or any other string a `python_module` package might emit —
 * `result_type` is an unconstrained `str` in Python, not a closed enum) ->
 * `null` (no proposal run should be spawned/updated). See this module's own
 * doc comment above for why that `null` is load-bearing.
 */
export function mapTriggerPurpose(resultType: string): TriggerPurpose | null {
  return RESULT_TYPE_TO_PURPOSE[resultType] ?? null
}

// ---------------------------------------------------------------------------
// mapLifecycleStage
// ---------------------------------------------------------------------------

export type MapLifecycleStageArgs = {
  fired: boolean
  resultType: string
  recoveryPhase: string | null
}

/**
 * Mirrors `map_lifecycle_stage` (merged_adapter.py:64-77) — all three
 * Python arguments are keyword-only there, mirrored here as one options
 * object so no positional-argument order can be mixed up at a call site.
 *
 * Slice-1 rule (Python's own docstring: later slices add
 * `after_rest_before_restart` and richer recovery-phase handling):
 *   - `recoveryPhase` set (vehicle stopped and recovering) ->
 *     `during_rest_stopped`
 *   - fired and a REST proposal -> `before_rest_until_stop`
 *   - else -> `active_driving_content`
 */
export function mapLifecycleStage({ fired, resultType, recoveryPhase }: MapLifecycleStageArgs): LifecycleStage {
  if (recoveryPhase !== null) return 'during_rest_stopped'
  if (fired && resultType === 'REST_PROPOSAL') return 'before_rest_until_stop'
  return 'active_driving_content'
}

// ---------------------------------------------------------------------------
// mapRoadType
// ---------------------------------------------------------------------------

export type RoadType = 'highway' | 'local' | 'mountain' | 'parking'

/** Mirrors Python's `_SEGMENT_TYPE_TO_ROAD_TYPE` dict verbatim (5 entries;
 * `.get(segment_type, "parking")`-only lookup — hazard 4 does not apply). */
const SEGMENT_TYPE_TO_ROAD_TYPE: Record<string, RoadType> = {
  highway: 'highway',
  normal_road: 'local',
  mountain_road: 'mountain',
  sightseeing_road: 'local',
  rest: 'parking',
}

/**
 * Mirrors `map_road_type` (merged_adapter.py:93-101).
 *
 * `null`/`undefined` (the real `tick_engine.py` never emits either for
 * `segmentType`, but a caller — or an older persisted tick — could) and
 * `"rest"` both -> `parking` (no proposal-side "rest area" road type
 * exists; parking is the closest fit and matches a stopped vehicle). Any
 * OTHER unrecognised string also falls back to `parking` via the dict
 * `.get(..., "parking")` default — a DIFFERENT code path from the
 * `segmentType == null` early return even though both produce the same
 * output; see the port's test file for why both are exercised separately.
 */
export function mapRoadType(segmentType: string | null | undefined): RoadType {
  if (segmentType === null || segmentType === undefined) return 'parking'
  return SEGMENT_TYPE_TO_ROAD_TYPE[segmentType] ?? 'parking'
}

// ---------------------------------------------------------------------------
// buildWorldFromTick
// ---------------------------------------------------------------------------

/** A proposal `World` document, treated as a loosely-typed plain object —
 * matches this port's established convention elsewhere (`engine/proposal/
 * run_manager.ts`'s `World`, `engine/proposal/world_overrides.ts`'s
 * `WorldDoc`) rather than a fully-typed pydantic mirror. The two nested
 * objects this module actually reads/writes are typed narrowly enough to
 * support the `model_copy(update=...)`-style shallow merge below. */
export type World = Record<string, unknown> & {
  situation: Record<string, unknown>
  control_inputs: Record<string, unknown>
}

export type BuildWorldFromTickArgs = {
  triggerPurpose: string
  lifecycleStage: string
}

/** Python `round()` — round HALF TO EVEN (banker's rounding), NOT
 * `Math.round`'s half-up (divergence hazard 1). Per-module copy — the same
 * small, independently-reviewable one-liner already duplicated at
 * `engine/behavior/anomaly_signal.ts`'s own `pyRound` (this codebase's
 * established convention for a genuinely trivial Python-mirroring helper;
 * see `engine/proposal/py_repr.ts`'s doc comment for when centralizing
 * instead is, and is not, warranted — this is the "not" case). Correct for
 * negative inputs too (floor-based, not `x - 0.5` trick), even though every
 * real call site in `buildWorldFromTick` below is non-negative in practice
 * (drowsiness/fatigue/monotonyLevel are 0-100 gauges; `nextRestSpotMin` is
 * either a positive minute count or a `9999.0` "none ahead" sentinel — see
 * `tick_engine.py`'s `advance_tick`, read directly, not assumed). */
function pyRound(x: number): number {
  const floor = Math.floor(x)
  const diff = x - floor
  if (diff < 0.5) return floor
  if (diff > 0.5) return floor + 1
  return floor % 2 === 0 ? floor : floor + 1
}

/**
 * Mirrors `build_world_from_tick` (merged_adapter.py:109-172).
 *
 * Overwrites GENERATED situation/control fields from `tickState` onto the
 * INLINE `worldTemplate`. GENERATED (overwritten every fire):
 * drowsiness_level, fatigue_level, traffic_state, road_type, night_state,
 * motion_state (BOTH `situation.motion_state` AND
 * `control_inputs.motion_state` — the two-field-sync gotcha from prior
 * proposal work), estimated_min_until_rest_spot, monotony_level.
 * `rest_spot_type` and every other Situation/DriverProfile field are left
 * as-is from the template (INLINE — reviewer/preset-owned).
 *
 * Never mutates `worldTemplate` — always returns a new object (matches
 * Python's `model_copy`, which never mutates the receiver either).
 */
export function buildWorldFromTick(
  worldTemplate: World,
  tickState: Pick<TickState, 'signals'>,
  { triggerPurpose, lifecycleStage }: BuildWorldFromTickArgs,
): World {
  const signals = (tickState.signals ?? {}) as Partial<TieredSignals>
  const fixed = signals.fixed ?? {}
  const dynamic = signals.dynamic ?? {}
  const simulated = signals.simulated ?? {}

  // Mirrors `fixed.get("isNight", False)` / `dynamic.get("isTrafficJam", False)`
  // — `??` is safe here specifically because neither field's declared
  // TieredSignals type permits an explicit `null` (see module doc comment).
  const isNight = fixed.isNight ?? false
  const isTrafficJam = dynamic.isTrafficJam ?? false
  // Mirrors `dynamic.get("segmentType")` / `dynamic.get("nextRestSpotMin")`
  // — both default to Python `None` when the key is absent; `?? null`
  // normalizes a missing/`undefined` TS property to `null` the same way.
  const segmentType = (dynamic.segmentType as string | null | undefined) ?? null
  const nextRestSpotMin = (dynamic.nextRestSpotMin as number | null | undefined) ?? null

  // "tick_engine always emits both (defaults to 0.0 itself when a prior
  // tick's signals are missing them) — mirror that same default here."
  const drowsiness = simulated.drowsiness ?? 0.0
  const fatigue = simulated.fatigue ?? 0.0

  const motion: MotionState = dynamic.motionState === 'STOPPED' ? 'stopped' : 'driving'

  const situationUpdate: Record<string, unknown> = {
    drowsiness_level: pyRound(drowsiness),
    fatigue_level: pyRound(fatigue),
    traffic_state: isTrafficJam ? 'congested' : 'normal',
    road_type: mapRoadType(segmentType),
    night_state: isNight ? 'night' : 'day',
    monotony_level: pyRound((dynamic.monotonyLevel as number | undefined) ?? 0),
    motion_state: motion,
    estimated_min_until_rest_spot: nextRestSpotMin !== null ? pyRound(nextRestSpotMin) : null,
  }

  const newSituation = { ...worldTemplate.situation, ...situationUpdate }
  const newControlInputs = {
    ...worldTemplate.control_inputs,
    trigger_purpose: triggerPurpose,
    lifecycle_stage: lifecycleStage,
    motion_state: motion,
  }

  return { ...worldTemplate, situation: newSituation, control_inputs: newControlInputs }
}
