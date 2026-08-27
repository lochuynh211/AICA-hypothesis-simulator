/**
 * nri_fatigue_score_v1 — TS port of the `python_module` package
 * `packages/nri_fatigue_score_v1/algorithm.py` (behavior-of-record, 721 LoC,
 * NRI proposal 20260630 + feature 025's two-band redesign).
 *
 * This is a TRUSTED builtin (bundled into the single-file offline app), NOT
 * the sandboxed-worker `js_module` path — see `../../../engine/algorithms/js_module.ts`
 * for that (untrusted user-uploaded) contract. Dispatched as strategy
 * `builtin_js_module` by `../../../engine/algorithms/adapter.ts`, which is
 * also responsible for applying the SAME required-context-field validation
 * and §11 `DecisionResult` normalization that
 * `app/api/aica_api/algorithms/python_module.py`'s `dispatch()` applies
 * around the package's `evaluate()` — mirroring the Python architecture:
 *   python_module.dispatch()  (validate + build py_context + normalize)
 *     -> algorithm.py's evaluate(context)     (pure algorithm)
 *   adapter.ts's dispatchBuiltinJsModule()     (validate + normalize)
 *     -> nri_fatigue_score_v1.ts's evaluate(input)   (pure algorithm, HERE)
 *
 * `evaluate()` here is therefore the pure, deterministic, synchronous port
 * of algorithm.py's `evaluate(context: dict) -> dict` ONLY — it assumes the
 * input already has the shape `python_module.dispatch()` builds as
 * `py_context`. Feature 009 (signal-tier redesign) reads from the TIERED
 * `context["signals"]` contract (`specs/009-signal-tier-redesign/contracts/
 * tiered-context.md`) instead of a flat `raw_state`:
 *   - Tier 1 (fixed, scenario constants): `isNight`, `familiarRoute`, `childPassenger`.
 *   - Tier 2 (dynamic): `isTrafficJam`, `segmentType`, `motionState`,
 *     `nextRestSpotMin`, `recoveryPhase`.
 *   - Tier 3a (simulated, latent): `drowsiness`, `fatigue` — feed `S_realtime`
 *     as RAW 0-100 values (NOT divided by 100 — that's the Hybrid package's
 *     convention, not NRI's).
 * It performs NO context validation itself (neither does algorithm.py —
 * python_module.dispatch validates BEFORE calling it).
 *
 * Implements the NRI proposal (20260630) cumulative fatigue accumulation
 * score:
 *
 *   S_total(t) = S_base(t) + S_env(t) + S_realtime(t)
 *
 * Where:
 *   S_base     = child_offset + T_drive * W_base * M_night * M_familiar
 *   S_env      = T_jam * W_jam + T_hw * W_highway + T_mono * W_monotonous
 *   S_realtime = max(0, V_sleep - theta_sleep) * W_sleep
 *              + max(0, V_fatigue - theta_fatigue) * W_fatigue
 *
 * Fire condition — TWO thresholds banding the ONE score (feature 025):
 *
 *     S_total >= threshold_fire                       -> rest_required
 *     threshold_monotony <= S_total < threshold_fire  -> monotony_prevention
 *     S_total <  threshold_monotony                   -> nothing
 *
 * `threshold_monotony` is the LOWER of the pair, so a run reaches the monotony
 * band before the rest band and escalates into it. Only ONE score exists, so
 * the package publishes a monotony THRESHOLD but no `monotony_prevention_score`
 * — a second curve would be an exact duplicate of the first.
 *
 * Post-fire filter: next rest spot ETA <= rest_spot_eta_filter_min (or no spot
 * ahead) — applied to the REST band ONLY, since refreshing content needs no
 * place to stop. Recovery suppresses both bands. There is still NO
 * suggest/recommend/urgent ladder, persistence gate, cooldown, 30-min cap, or
 * emergency override — this adds a band, not a ladder.
 *
 * `evaluate()` returns TWO categories every tick — `rest_required` and
 * `monotony_prevention` — both RETAINED in `candidates` whether fired or not
 * (§11), plus a `feature_contributions` block for EACH category (see
 * `buildFeatureContributions` below): an exact additive decomposition of
 * `s_total`, mirroring `aica_transparent_hybrid_trigger_v1.category_scores()`'s
 * `feature_contributions` shape so the review panel's `triggerOptions()`
 * (`app/frontend/src/lib/review/chains.ts`) can render either package.
 *
 * State carried across ticks (via package_runtime_state):
 *   - cumulative_jam_min: minutes spent in traffic jam (frozen while STOPPED,
 *     reset to 0 at the recoveryJustCompleted resume edge)
 *   - cumulative_highway_min: minutes spent on highway (same freeze/reset)
 *   - cumulative_monotonous_min: minutes spent on monotonous road;
 *     additionally frozen and drained by `stimulusReliefMin` while
 *     `stimulusFrozen` is true (same freeze/reset otherwise)
 *   - driving_min_since_rest: minutes driven since the last rest (frozen
 *     while STOPPED, then reset to 0 at the recoveryJustCompleted resume edge)
 *   - last_sim_time: the previous tick's simulation_time_sec (tick-duration source)
 *   - was_in_recovery: whether the previous tick was a recovery tick (reset edge fallback)
 *   - was_resuming: whether the previous tick was the `recoveryPhase == "resuming"`
 *     tick, keeping the reset a ONE-TICK event (fixbug-0806)
 *
 * Recovery-semantics refactor (2026-08-08): the served-monotony-proposal
 * relief hack ("relieve cumulative_monotonous_min when its own proposal is
 * ANSWERED") is RETIRED. Relief on the monotony channel is now the same
 * mechanism the tick engine and aica_transparent_hybrid_trigger_v1 use:
 * `cumulative_monotonous_min` additionally stops accruing on any tick the
 * engine reports `signals.dynamic.stimulusFrozen`, and is drained by
 * `signals.dynamic.stimulusReliefMin` (the same accumulator-minutes the
 * engine drained from its own `monotony_accrued_min` that tick, floored at
 * 0). This makes NRI and Hybrid react identically to the same
 * driver/content event instead of coincidentally similarly — see design §7.
 * `cumulative_jam_min`, `cumulative_highway_min` and `driving_min_since_rest`
 * are never drained; content does not un-drive a highway, clear a jam, or
 * stop the clock.
 *
 * The four cumulative accumulators (`cumulative_jam_min`,
 * `cumulative_highway_min`, `cumulative_monotonous_min`,
 * `driving_min_since_rest`) FREEZE — held at their pre-accept value, neither
 * growing nor zeroing — but ONLY while the vehicle is actually STOPPED
 * (`motionState != "MOVING"`), not for the whole `recoveryActive` window.
 * The driver is still driving, and still accumulating real exposure, during
 * the MOVING approach to the rest spot (design §6 case 2) — only the
 * STOPPED dwell freezes exposure.
 *
 * They reset to 0 at the END of the rest — the one `recoveryPhase ==
 * "resuming"` tick, where every stage is done and the engine still holds the
 * car AT the rest spot (fixbug-0806). That tick also accrues nothing, because
 * the car is parked even though the engine reports `motionState == "MOVING"`
 * on it. Previously the reset was keyed on recovery going inactive, which is
 * the FIRST TICK OF THE RESUMED DRIVE: on the route-fraction axis the whole
 * drop was then drawn past the rest spot, preceded by an upward kick from
 * that parked tick's phantom driving minute.
 *
 * Every hyperparameter is read via a STRICT `reqNum(hp, key)` lookup — NO
 * `hp.get(key, <hardcoded default>)` fallback, mirroring algorithm.py's
 * direct `hp["key"]` dict indexing exactly (including the NEW
 * `threshold_monotony` key): `context["hyperparameters"]` is guaranteed fully
 * resolved (manifest defaults (+) overrides, every declared key present) by
 * the adapter (FR-009); a missing key here is a real configuration bug and
 * MUST surface as an error -> algorithm_error, never a silently-wrong default.
 *
 * Every threshold/coefficient/ordering below is preserved EXACTLY from
 * algorithm.py — this is the parity boundary (see
 * `../../../engine/__fixtures__/parity/nri_fatigue_score_v1.json` and
 * `nri_tick_by_tick.json`, both captured from a full run of the real Python
 * package, and `tests/nri_port.test.ts`, which replays the first threading
 * the evolving `next_package_runtime_state` exactly as `run_manager.tick`
 * does).
 *
 * Divergence hazards checked against algorithm.py (721 LoC) while porting:
 *   - Python `round()`: NOT used anywhere in algorithm.py (only f-string
 *     `:.0f` / `:.1f` format specs in the explanation/band strings below,
 *     ported with `pyFixed()` (see `./mathUtils` — NOT `.toFixed(...)`, which
 *     rounds ties away from zero instead of half-to-even; divergence hazard
 *     7), verified byte-for-byte against the goldens).
 *   - `sorted()` on tuples: not used — no sorting anywhere in this package.
 *   - `//` / `%` floor semantics: not used — no integer division/modulo.
 *   - Dict iteration order feeding ordered output: the `_rows()` / `rows()`
 *     list order below is preserved EXACTLY (9 rows, fixed order); the two
 *     `feature_contributions` blocks get INDEPENDENT row arrays (mirroring
 *     algorithm.py's comment that `_rows()` is called twice so a caller
 *     mutating one block's `row.band` can never alias the other's).
 *   - Float -> string formatting: the explanation/band template strings are
 *     verified against the captured golden JSON (parsed, not text-diffed).
 *
 * Only the exported function identifier (`evaluate`) and local helper names
 * are camelCased; every DecisionResult key, ordinal/state/reason STRING
 * VALUE, and package_runtime_state key is preserved byte-for-byte because it
 * crosses the parity boundary.
 */

import type { Candidate, DecisionResult, FireControl, Proposal } from '../../../api/types'
import type { PackageManifest } from '../../../api/types'
import { getPackageManifest } from '../../registry'
import { pyFixed } from './mathUtils'

/**
 * Bundled package manifest — read from the generated data payload (not a
 * hand-copied JSON import; this file is SOURCE, the manifest is DATA). A
 * function, not a const: the registry is installed during boot, after this
 * module evaluates. Unused within this file (see the doc comment above on
 * why `hyperparameters` is trusted as fully-resolved) — kept as a
 * convenience export mirroring `manifest.algorithm.entrypoint`-style
 * lookups elsewhere.
 */
export function manifest(): PackageManifest {
  const m = getPackageManifest('nri_fatigue_score_v1')
  if (!m) throw new Error("nri_fatigue_score_v1: manifest not found in the registry")
  return m
}

// ---------------------------------------------------------------------------
// Input shape — mirrors python_module.dispatch()'s tiered `py_context` dict
// (feature 009), which is exactly what algorithm.py's `evaluate(context)`
// receives. Same shape as `../index.ts`'s `BuiltinPyContext`.
// ---------------------------------------------------------------------------

export type NriEvaluateInput = {
  simulation_time_sec: number
  signals: Record<string, unknown>
  feature_groups: Record<string, unknown>
  parameters: Record<string, unknown>
  hyperparameters: Record<string, unknown>
  proposal_history: Record<string, unknown>
  user_action_history: unknown[]
  package_runtime_state: Record<string, unknown>
  recovery_active?: boolean
  // The orchestration-supplied committed-state-continuation forecast block
  // (mirror of python_module's `context["nri_forecast"]`; forwarded by
  // adapter.ts's dispatchBuiltinJsModule only when present). Shape mirrors
  // engine/nri_forecast.ts's NriForecastBlock — read here with `.get(...) or {}`
  // style defaults, so it stays a loose Record.
  nri_forecast?: Record<string, unknown>
}

/** The stateful accumulator carried in package_runtime_state across ticks. */
export type NriRuntimeState = {
  cumulative_jam_min: number
  cumulative_highway_min: number
  cumulative_monotonous_min: number
  driving_min_since_rest: number
  last_sim_time: number
  was_in_recovery: boolean
  was_resuming: boolean
}

export type EvaluateOutput = DecisionResult

// ---------------------------------------------------------------------------
// feature_contributions shapes — see `_build_feature_contributions` in
// algorithm.py. Not part of the shared (synced) `DecisionResult` type in
// `../../../api/types.ts` (out of scope to edit — same known compromise as
// the `explanation` cast below), so `evaluate()` returns an object that is
// STRUCTURALLY wider than `DecisionResult` and relies on TypeScript not
// excess-property-checking a variable (as opposed to a literal) on return.
// ---------------------------------------------------------------------------

type ContributionRow = {
  feature_id: string
  value: number
  band: string | null
  weight: number
  contribution: number
}

type Gate = {
  gate_id: string
  evaluated_inputs: Record<string, unknown>
  // Optional: the ordinary rest/monotony gates carry a numeric threshold, but
  // the §14.2 forecast gates (built by `forecastRestGates`, mirroring
  // algorithm.py's `_gate`) deliberately omit it — they report only
  // gate_id/evaluated_inputs/passed/effect.
  threshold?: number
  passed: boolean
  effect: 'allow' | 'suppress'
}

type FeatureContributionBlock = {
  score: number
  clamped: boolean
  rows: ContributionRow[]
  gates: Gate[]
}

type FeatureContributions = {
  rest_required: FeatureContributionBlock
  monotony_prevention: FeatureContributionBlock
}

// The "no rest spot ahead" sentinel published by `dynamic.nextRestSpotMin`.
// Historically this VALUE PASSED the rest-ETA gate (>= 9999.0 was folded into
// the "allow" branch alongside "<= filter"), so having no spot ahead FIRED a
// rest proposal — exactly backwards. It now correctly FAILS actionability
// (see the shared actionability computation in `evaluate`).
const NO_REST_SENTINEL = 9999.0

// ---------------------------------------------------------------------------
// Small helpers — dict.get()-with-default semantics + strict hp indexing.
// ---------------------------------------------------------------------------

/**
 * Mirror Python's `str(x)` for the raw (unformatted) interpolations in the
 * §14.3 forecast explanation — algorithm.py drops these forecast values into
 * an f-string with NO format spec, so `None` prints as `"None"` and a float
 * prints via `repr` (integer-valued floats keep a trailing `.0`, e.g.
 * `str(42.0) == "42.0"`). Plain JS `${x}` would print `null`/`undefined` and
 * drop the `.0`, diverging at the parity boundary. Non-integer values fall
 * through to JS's shortest round-trip `String(x)`, which matches Python's
 * `repr` for the value ranges the forecast block produces.
 */
function pyNum(x: unknown): string {
  if (x === null || x === undefined) return 'None'
  if (typeof x === 'number') {
    if (!Number.isFinite(x)) return x > 0 ? 'inf' : (x < 0 ? '-inf' : 'nan')
    if (Number.isInteger(x)) return `${x}.0`
    return String(x)
  }
  return String(x)
}

/** Mirrors Python's `dict.get(key, default)`: only the ABSENT key falls back. */
function dget(obj: Record<string, unknown> | undefined | null, key: string, dflt: unknown): unknown {
  if (obj && Object.prototype.hasOwnProperty.call(obj, key)) return obj[key]
  return dflt
}

/**
 * Mirrors Python's direct `hp["key"]` indexing (no `.get` default): raises
 * if the key is absent, since a missing declared hyperparameter is a real
 * configuration bug that must surface as `algorithm_error`, never silently
 * fall back to a hardcoded default.
 */
function reqNum(hp: Record<string, unknown>, key: string): number {
  if (!hp || !Object.prototype.hasOwnProperty.call(hp, key)) {
    throw new Error(`nri_fatigue_score_v1: missing required hyperparameter '${key}'`)
  }
  return Number(hp[key])
}

// ---------------------------------------------------------------------------
// Score computation
// ---------------------------------------------------------------------------

function computeBaseScore(
  continuousDrivingMin: number,
  childPassenger: boolean,
  isNight: boolean,
  familiarRoute: boolean,
  hp: Record<string, unknown>,
): number {
  const wBase = reqNum(hp, 'w_base')
  const wChild = reqNum(hp, 'w_child')
  const mNight = isNight ? reqNum(hp, 'm_night') : 1.0
  const mFamiliar = familiarRoute ? reqNum(hp, 'm_familiar') : 1.0

  const childOffset = childPassenger ? wChild : 0.0
  const timeDamage = continuousDrivingMin * wBase * mNight * mFamiliar

  return childOffset + timeDamage
}

function computeEnvScore(
  cumulativeJamMin: number,
  cumulativeHighwayMin: number,
  cumulativeMonotonousMin: number,
  hp: Record<string, unknown>,
): number {
  const wJam = reqNum(hp, 'w_jam')
  const wHighway = reqNum(hp, 'w_highway')
  const wMonotonous = reqNum(hp, 'w_monotonous')

  return (
    cumulativeJamMin * wJam
    + cumulativeHighwayMin * wHighway
    + cumulativeMonotonousMin * wMonotonous
  )
}

function computeRealtimeScore(
  drowsinessLevel: number,
  fatigueLevel: number,
  hp: Record<string, unknown>,
): number {
  const thetaSleep = reqNum(hp, 'theta_sleep')
  const wSleep = reqNum(hp, 'w_sleep')
  const thetaFatigue = reqNum(hp, 'theta_fatigue')
  const wFatigue = reqNum(hp, 'w_fatigue')

  const sleepPenalty = Math.max(0.0, drowsinessLevel - thetaSleep) * wSleep
  const fatiguePenalty = Math.max(0.0, fatigueLevel - thetaFatigue) * wFatigue

  return sleepPenalty + fatiguePenalty
}

// ---------------------------------------------------------------------------
// Feature contributions — EXACT additive decomposition of s_total
// ---------------------------------------------------------------------------
//
// NRI is a pure additive sum (S_total = S_base + S_env + S_realtime, each of
// those itself a sum of terms — see the module docstring), so unlike the
// Hybrid's clamped/smoothed score this decomposition is not an approximation:
// the rows below sum to s_total exactly (mod float summation order). Shape
// mirrors `aica_transparent_hybrid_trigger_v1.category_scores()`'s
// `feature_contributions` block so the review panel's `triggerOptions()`
// (app/frontend/src/lib/review/chains.ts) can render either package.

type BuildFeatureContributionsArgs = {
  drivingMinSinceRest: number
  isNight: boolean
  familiarRoute: boolean
  childPassenger: boolean
  cumulativeJamMin: number
  cumulativeHighwayMin: number
  cumulativeMonotonousMin: number
  drowsinessLevel: number
  fatigueLevel: number
  sTotal: number
  recovered: boolean
  nextRestMin: number
  restEtaFilter: number
  thresholdFire: number
  spotActionable: boolean
  spotReason: string | null
  hp: Record<string, unknown>
}

/**
 * Build the `feature_contributions` block for both trigger categories.
 *
 * The S_base time-damage term `T * w_base * m_night * m_familiar` (T =
 * driving_min_since_rest) is split into THREE additive rows instead of one
 * opaque "driving time" row, so a reviewer can see the night/familiar-route
 * AMPLIFICATION separately from the raw accumulated minutes:
 *
 *     continuous_driving_min        = T * w_base
 *     night_amplification           = T * w_base * (m_night - 1)
 *     familiar_route_amplification  = T * w_base * m_night * (m_familiar - 1)
 *
 * Each amplification row reports the MULTIPLIER as its `value` (1.0 when the
 * corresponding flag is off), so `contribution` is exactly 0.0 — not merely
 * small — whenever that amplifier is inactive.
 *
 * `rest_required` and `monotony_prevention` get the SAME rows and the SAME
 * score: NRI publishes one score banded by two thresholds (see the module
 * docstring), so a second, differently-weighted decomposition would
 * misrepresent the model as having two independent curves. The two blocks
 * hold independent row-array/objects (not shared references) purely so a
 * caller mutating one (e.g. filling in `band`) can never accidentally alter
 * the other — `buildRows()` is called TWICE below, once per block.
 */
function buildFeatureContributions(args: BuildFeatureContributionsArgs): FeatureContributions {
  const {
    drivingMinSinceRest, isNight, familiarRoute, childPassenger,
    cumulativeJamMin, cumulativeHighwayMin, cumulativeMonotonousMin,
    drowsinessLevel, fatigueLevel, sTotal, recovered, nextRestMin,
    restEtaFilter, thresholdFire, spotActionable, spotReason, hp,
  } = args

  const wBase = reqNum(hp, 'w_base')
  const wChild = reqNum(hp, 'w_child')
  const wJam = reqNum(hp, 'w_jam')
  const wHighway = reqNum(hp, 'w_highway')
  const wMonotonous = reqNum(hp, 'w_monotonous')
  const wSleep = reqNum(hp, 'w_sleep')
  const wFatigue = reqNum(hp, 'w_fatigue')
  const thetaSleep = reqNum(hp, 'theta_sleep')
  const thetaFatigue = reqNum(hp, 'theta_fatigue')

  const mNight = isNight ? reqNum(hp, 'm_night') : 1.0
  const mFamiliar = familiarRoute ? reqNum(hp, 'm_familiar') : 1.0
  const tDrive = drivingMinSinceRest

  function row(featureId: string, value: number, weight: number, contribution: number): ContributionRow {
    return {
      feature_id: featureId,
      value,
      band: null, // filled in by evaluate() from features_ordinal
      weight,
      contribution,
    }
  }

  function buildRows(): ContributionRow[] {
    return [
      row('continuous_driving_min', tDrive, wBase, tDrive * wBase),
      row(
        'night_amplification', mNight, wBase,
        tDrive * wBase * (mNight - 1.0),
      ),
      row(
        'familiar_route_amplification', mFamiliar, wBase,
        tDrive * wBase * mNight * (mFamiliar - 1.0),
      ),
      row(
        'child_passenger', childPassenger ? 1.0 : 0.0, wChild,
        childPassenger ? wChild : 0.0,
      ),
      row('traffic_jam', cumulativeJamMin, wJam, cumulativeJamMin * wJam),
      row(
        'long_highway', cumulativeHighwayMin, wHighway,
        cumulativeHighwayMin * wHighway,
      ),
      row(
        'monotony', cumulativeMonotonousMin, wMonotonous,
        cumulativeMonotonousMin * wMonotonous,
      ),
      row(
        'drowsiness', drowsinessLevel, wSleep,
        Math.max(0.0, drowsinessLevel - thetaSleep) * wSleep,
      ),
      row(
        'fatigue', fatigueLevel, wFatigue,
        Math.max(0.0, fatigueLevel - thetaFatigue) * wFatigue,
      ),
    ]
  }

  const gateRecovery: Gate = {
    gate_id: 'recovery_suppression',
    evaluated_inputs: {},
    threshold: 0.0,
    passed: !recovered,
    effect: !recovered ? 'allow' : 'suppress',
  }

  const gateEta: Gate = {
    gate_id: 'rest_spot_eta_filter_min',
    evaluated_inputs: { nextRestSpotMin: nextRestMin, reason: spotReason },
    threshold: restEtaFilter,
    passed: spotActionable,
    effect: spotActionable ? 'allow' : 'suppress',
  }

  const belowFire = sTotal < thresholdFire
  const gateSuperseded: Gate = {
    gate_id: 'superseded_by_rest_required',
    evaluated_inputs: { s_total: sTotal },
    threshold: thresholdFire,
    passed: belowFire,
    effect: belowFire ? 'allow' : 'suppress',
  }

  return {
    rest_required: {
      score: sTotal,
      clamped: false, // NRI never clamps; rows sum exactly to s_total
      rows: buildRows(),
      gates: [gateRecovery, gateEta],
    },
    monotony_prevention: {
      score: sTotal,
      clamped: false,
      rows: buildRows(),
      gates: [gateRecovery, gateSuperseded],
    },
  }
}

// ---------------------------------------------------------------------------
// Forecast-based early-rest gate list (Task 5; spec §14.2) — REPLACES
// `feature_contributions["rest_required"]["gates"]` (the plain
// `[gateRecovery, gateEta]` pair above) whenever the orchestration supplied an
// evaluated `nri_forecast` block, so a reviewer inspecting evidence sees every
// input the forecast path actually consulted, not just the two-gate summary
// that describes the ordinary path alone. The 11-gate ORDER below is the
// spec's — do not reorder. Mirrors algorithm.py's `_forecast_rest_gates`.
// ---------------------------------------------------------------------------

/** Mirror of algorithm.py's `_gate` — no `threshold` key (unlike the ordinary
 * rest/monotony gates), only gate_id/evaluated_inputs/passed/effect. */
function gate(
  gid: string,
  passed: boolean,
  inputs: Record<string, unknown>,
): Gate {
  return {
    gate_id: gid,
    evaluated_inputs: inputs,
    passed,
    effect: passed ? 'allow' : 'suppress',
  }
}

/** Read a numeric-or-null field the way Python's `.get(...)` returns it: a
 * missing/null value stays null, otherwise a number. */
function numOrNull(obj: Record<string, unknown>, key: string): number | null {
  const v = obj[key]
  if (v === null || v === undefined) return null
  return Number(v)
}

type ForecastGatesArgs = {
  orderValid: boolean
  sTotal: number
  tForecast: number
  tFire: number
  ff: Record<string, unknown>
  frs: Record<string, unknown>
  crs: Record<string, unknown>
  fs: Record<string, unknown>
  recovered: boolean
  etaFilter: number
}

function forecastRestGates(args: ForecastGatesArgs): Gate[] {
  const { orderValid, sTotal, tForecast, tFire, ff, frs, crs, fs, recovered, etaFilter } = args
  const frsEtaFromFire = numOrNull(frs, 'eta_from_fire_min')
  const frsEtaToDest = numOrNull(frs, 'eta_to_destination_min')
  const crsEtaFromCurrent = numOrNull(crs, 'eta_from_current_min')
  const crsEtaToDest = numOrNull(crs, 'eta_to_destination_min')
  return [
    gate('forecast_threshold_order', orderValid, { t_forecast: tForecast }),
    gate('forecast_current_score', tForecast < sTotal && sTotal < tFire, { s_total: sTotal }),
    gate('forecast_future_fire', Boolean(ff['found']), { s_total: ff['s_total'] ?? null }),
    gate(
      'forecast_committed_intervention', true,
      { content_active: fs['content_active'] ?? null, service_id: fs['service_id'] ?? null },
    ),
    gate(
      'forecast_future_rest_spot', Boolean(frs['exists']),
      { position_km: frs['position_km'] ?? null },
    ),
    gate(
      'forecast_future_rest_spot_eta',
      frsEtaFromFire !== null && frsEtaFromFire <= etaFilter,
      { eta_from_fire_min: frsEtaFromFire, limit: etaFilter },
    ),
    gate(
      'forecast_destination_edge',
      frsEtaToDest !== null && frsEtaToDest >= 10.0,
      { eta_to_destination_min: frsEtaToDest },
    ),
    gate(
      'forecast_current_rest_spot',
      Boolean(crs['exists']) && crsEtaFromCurrent !== null,
      { nextRestSpotMin: crsEtaFromCurrent },
    ),
    gate(
      'forecast_current_rest_spot_eta',
      crsEtaFromCurrent !== null && crsEtaFromCurrent <= etaFilter,
      { eta_from_current_min: crsEtaFromCurrent, limit: etaFilter },
    ),
    gate(
      'forecast_current_rest_spot_destination_edge',
      crsEtaToDest !== null && crsEtaToDest >= 10.0,
      { eta_to_destination_min: crsEtaToDest },
    ),
    gate('recovery_suppression', !recovered, {}),
  ]
}

// ---------------------------------------------------------------------------
// State labels — two thresholds banding ONE score (no suggest/recommend/
// urgent ladder). REST_RECOVERY while resting, REST_FIRE at/above
// threshold_fire, else REST_NORMAL; MONOTONY_FIRE only INSIDE the band, so
// the two labels never both read "fire" on the same tick.
// ---------------------------------------------------------------------------

function stateLabel(
  score: number, recovered: boolean, thresholdFire: number, earlyFire = false,
): string {
  if (recovered) return 'REST_RECOVERY'
  if (earlyFire) return 'REST_FORECAST_FIRE'
  if (score >= thresholdFire) return 'REST_FIRE'
  return 'REST_NORMAL'
}

function monotonyStateLabel(
  score: number, recovered: boolean, thresholdMonotony: number, thresholdFire: number,
): string {
  if (recovered) return 'MONOTONY_RECOVERY'
  if (score >= thresholdMonotony && score < thresholdFire) return 'MONOTONY_FIRE'
  return 'MONOTONY_NORMAL'
}

// ---------------------------------------------------------------------------
// Localized proposals
// ---------------------------------------------------------------------------

const PROPOSALS: Record<string, { ja: string; en: string }> = {
  gentle: {
    ja: '疲労スコアが基準値を超えました。近くの休憩施設でのご休憩をお勧めします。',
    en: 'Fatigue score has exceeded the threshold. We suggest resting at a nearby facility.',
  },
  clear: {
    ja: '疲労が蓄積しています。早めの休憩をお勧めします。',
    en: 'Fatigue is accumulating. We recommend resting soon.',
  },
  strong: {
    ja: '安全のため、直ちに休憩を取ってください。',
    en: 'For your safety, please take a rest immediately.',
  },
}

const MONOTONY_PROPOSAL: { ja: string; en: string } = {
  ja: '単調な走行が続いています。気分転換をお勧めします。',
  en: 'Monotonous driving detected. Consider a short break or refreshing content.',
}

const FORECAST_REST_PROPOSAL: { ja: string; en: string } = {
  ja: (
    'このまま走ると、休憩が必要になる時に近くの休憩場所を使えない見込みです。'
    + '前方の休憩場所で早めに休むことをおすすめします。'
  ),
  en: (
    'At the current trend, no nearby rest facility is expected to be actionable '
    + 'when a rest becomes necessary. We suggest resting at the available facility '
    + 'ahead before continuing.'
  ),
}

function buildProposal(strengthLabel: string): Proposal {
  const message = PROPOSALS[strengthLabel] ?? PROPOSALS['gentle']
  return {
    id: 'rest_required_proposal',
    message,
    options: ['accept_rest', 'postpone', 'decline'],
  }
}

/**
 * The forecast-based early-rest proposal (Task 5; manifest
 * `forecast_rest_required_proposal`). Mirrors algorithm.py's
 * `_build_forecast_proposal`: same structure as `buildProposal`, keeps
 * `accept_rest` among the options (this IS a rest proposal, just an early one),
 * and its copy must NOT claim the fire threshold (100) was already crossed —
 * only that the CURRENT spot is being offered (§12.1). The JA/EN copy is the
 * manifest's declared text kept verbatim so the two never drift.
 */
function buildForecastProposal(): Proposal {
  return {
    id: 'forecast_rest_required_proposal',
    message: FORECAST_REST_PROPOSAL,
    options: ['accept_rest', 'postpone', 'decline'],
  }
}

/**
 * The monotony-band proposal.
 *
 * Deliberately NOT offering `accept_rest`: this band sits BELOW the rest
 * threshold, so it is a nudge toward refreshing content, not an instruction
 * to go and stop somewhere. Its options mirror the Hybrid's monotony
 * proposal so both algorithms are actionable under the same
 * `scenario.allowed_actions`.
 */
function buildMonotonyProposal(): Proposal {
  return {
    id: 'monotony_prevention_proposal',
    message: MONOTONY_PROPOSAL,
    options: ['acknowledge', 'decline'],
  }
}

// ---------------------------------------------------------------------------
// Public API — the algorithm.py evaluate() port.
// ---------------------------------------------------------------------------

/**
 * Evaluate the NRI fatigue accumulation score for one tick.
 *
 * Pure & deterministic: no Date.now, no Math.random, no I/O. Given the same
 * `input` (including the SAME `package_runtime_state`), always returns the
 * same `DecisionResult` (with the SAME `next_package_runtime_state`).
 */
export function evaluate(input: NriEvaluateInput): EvaluateOutput {
  const hp = input.hyperparameters ?? {}
  const signals = (input.signals ?? {}) as Record<string, unknown>
  const fixed = (signals['fixed'] ?? {}) as Record<string, unknown>
  const dynamic = (signals['dynamic'] ?? {}) as Record<string, unknown>
  const simulated = (signals['simulated'] ?? {}) as Record<string, unknown>
  const featureGroups = (input.feature_groups ?? {}) as Record<string, unknown>
  const ordinal = (featureGroups['ordinal'] ?? {}) as Record<string, unknown>
  const prevState = (input.package_runtime_state ?? {}) as Record<string, unknown>
  const simTime = Number(input.simulation_time_sec ?? 0.0)

  // ── Extract Tier-1 fixed signals (scenario constants) ───────────────────
  const childPassenger = Boolean(dget(fixed, 'childPassenger', false))
  const familiarRoute = Boolean(dget(fixed, 'familiarRoute', false))
  const isNight = Boolean(dget(fixed, 'isNight', false))

  // ── Extract Tier-2 dynamic signals ───────────────────────────────────────
  const isTrafficJam = Boolean(dget(dynamic, 'isTrafficJam', false))
  const segmentType = String(dget(dynamic, 'segmentType', 'normal_road'))
  const nextRestMin = Number(dget(dynamic, 'nextRestSpotMin', 9999.0))
  const motionState = String(dget(dynamic, 'motionState', 'MOVING'))

  // ── Extract Tier-3a simulated signals (now live — feed S_realtime) ──────
  const drowsinessLevel = Number(dget(simulated, 'drowsiness', 0.0))
  const fatigueLevel = Number(dget(simulated, 'fatigue', 0.0))

  // ── Hyperparameters — TWO thresholds banding one score + the ETA filter ──
  // `threshold_monotony` is the LOWER of the pair: one S_total, banded into a
  // rest band (>= threshold_fire) and a monotony band ([monotony, fire)).
  const thresholdFire = reqNum(hp, 'threshold_fire')
  const thresholdMonotony = reqNum(hp, 'threshold_monotony')
  const restEtaFilter = reqNum(hp, 'rest_spot_eta_filter_min')

  // ── Current rest-spot actionability (shared rule; design §10, §11.2, §18) ──
  // Prefer the orchestration-computed forecast block (it knows the spot's
  // ETA-to-destination); fall back to the native nextRestSpotMin gate when no
  // block is present at all. The old ">= 9999 means fire" exception is GONE in
  // both. Read `current_rest_spot` whenever the block is present — the scaffold
  // (evaluated=false), the full pass-2 block, and runForecast's own error block
  // all populate it with the real, destination-edge-aware value.
  const forecast = (input.nri_forecast ?? {}) as Record<string, unknown>
  const crsBlock = forecast['current_rest_spot'] as Record<string, unknown> | null | undefined
  let spotActionable: boolean
  let spotReason: string | null
  if (crsBlock !== null && crsBlock !== undefined) {
    spotActionable = Boolean(crsBlock['actionable'])
    spotReason = (crsBlock['unactionable_reason'] as string | null) ?? null
  } else {
    spotActionable = nextRestMin !== NO_REST_SENTINEL && nextRestMin <= restEtaFilter
    spotReason = spotActionable
      ? null
      : (nextRestMin >= NO_REST_SENTINEL ? 'no_spot_ahead' : 'rest_spot_eta_over_limit')
  }

  // ── Forecast-based early-rest eligibility, precursors (Task 5; §7, §11) ──
  // `hp["threshold_forecast_rest"]` bands the ordinary rest threshold: strictly
  // between it and `threshold_fire` is the "early" zone. `orderValid` combines
  // the STATIC hp ordering with the forecast service's own `threshold_order_valid`
  // verdict — either one being wrong disables the forecast path without touching
  // the ordinary rest/monotony bands. The forecast-block sub-dicts are pulled
  // once here (independent of sTotal/recovered) and reused below for both the
  // `earlyFire` decision and the §14.1/§14.2 evidence. The full `earlyFire`
  // boolean additionally needs `sTotal` and `recovered`, neither computed yet —
  // finalized right after `sTotal` exists, further below.
  const thresholdForecast = reqNum(hp, 'threshold_forecast_rest')
  const forecastEvaluated = Boolean(forecast['evaluated'])
  const orderValid = (
    thresholdMonotony < thresholdForecast && thresholdForecast < thresholdFire
    && Boolean(dget(forecast, 'threshold_order_valid', true))
  )
  const ff = (forecast['future_fire'] ?? {}) as Record<string, unknown>
  const frs = (forecast['forecast_rest_spot'] ?? {}) as Record<string, unknown>
  const crs2 = (forecast['current_rest_spot'] ?? {}) as Record<string, unknown>
  const fs = (forecast['forecast_start'] ?? {}) as Record<string, unknown>
  const futureFireFound = Boolean(ff['found'])
  const futureUnactionable = Boolean(forecast['forecast_future_rest_unactionable'])

  // ── Recovery detection (early — needed before accumulation) ─────────────
  // Detect recovery from dynamic.recoveryPhase (set by tick engine when a
  // recovery sequence is active). No framework-level flag needed.
  const recoveryPhase = dget(dynamic, 'recoveryPhase', null)
  const recoveryActive = recoveryPhase !== null && recoveryPhase !== undefined
  const wasInRecovery = Boolean(dget(prevState, 'was_in_recovery', false))

  // The rest ENDS on the "resuming" tick, AT the rest spot (fixbug-0806).
  //
  // The tick engine gives every finished recovery exactly one
  // `recoveryPhase === "resuming"` tick: all stages are done, the engine
  // still HOLDS the car at the spot, and recovery deactivates on the
  // FOLLOWING tick — the first tick of the resumed drive, at a route
  // position PAST the spot.
  //
  // Keying the reset on `!recoveryActive` therefore zeroed the accumulators
  // one tick late, and since the chart's x-axis is route fraction, NRI's
  // whole post-rest drop was drawn on the road AFTER the rest spot instead of
  // at it: the reviewer saw the score sag slightly at the spot (only
  // S_realtime, as drowsiness/fatigue recover) and then fall off a cliff
  // while the driver was already driving away. Worse, that in-between tick
  // ACCRUED a fresh driving minute while the car was parked, so the score
  // ticked UP at the spot first.
  //
  // "resuming" is the honest edge: the driver has rested, and has not moved.
  // `wasResuming` keeps it a ONE-TICK event — without it the old condition
  // would fire again on the next tick and zero the first real minute of the
  // resumed drive. The `wasInRecovery && !recoveryActive` clause is kept as a
  // fallback for a recovery that ends without a resuming tick (e.g. a run
  // that completes mid-recovery).
  const resuming = recoveryPhase === 'resuming'
  const wasResuming = Boolean(dget(prevState, 'was_resuming', false))
  const recoveryJustCompleted = resuming || (wasInRecovery && !recoveryActive && !wasResuming)

  // Suppress all firing while recovery is active (unconditional — the score
  // stays high due to cumulative accumulators, so we cannot rely on
  // lastProposalResult which gets overwritten if a new proposal fires).
  const recovered = recoveryActive

  // ── Retrieve cumulative state from previous tick ─────────────────────────
  let prevJamMin = Number(dget(prevState, 'cumulative_jam_min', 0.0))
  let prevHighwayMin = Number(dget(prevState, 'cumulative_highway_min', 0.0))
  let prevMonoMin = Number(dget(prevState, 'cumulative_monotonous_min', 0.0))
  let prevDrivingMin = Number(dget(prevState, 'driving_min_since_rest', 0.0))

  // ── Reset accumulators after recovery completes ──────────────────────────
  // LOAD-BEARING: the accumulation step below FREEZES the four accumulators
  // while the vehicle is actually STOPPED (not for the whole recoveryActive
  // window — see below) rather than zeroing them, so `prevState` on the
  // resume tick (recoveryJustCompleted=true) still holds the pre-accept
  // accumulated total. This is the ONLY place that resets it to 0 — drop
  // this block and the score would never fall after a completed recovery.
  if (recoveryJustCompleted) {
    prevJamMin = 0.0
    prevHighwayMin = 0.0
    prevMonoMin = 0.0
    prevDrivingMin = 0.0
  }

  // ── Determine tick duration from simulation time ─────────────────────────
  const prevSimTime = Number(dget(prevState, 'last_sim_time', 0.0))
  let tickDurationMin = prevSimTime > 0 ? (simTime - prevSimTime) / 60.0 : 1.0
  if (tickDurationMin <= 0) tickDurationMin = 1.0

  // ── Only accumulate time while actually MOVING ───────────────────────────
  // Recovery-semantics refactor. Two corrections to the accrual gate:
  //
  //   1. Only the STOPPED dwell freezes exposure. The MOVING approach to the
  //      rest spot used to freeze too (via the old `accrue = isMoving &&
  //      !recoveryActive`), so the score sat flat while the driver was
  //      genuinely still driving and still accumulating risk (design §6
  //      case 2). The driver is driving until the wheels stop — `accrue` is
  //      now gated on `isMoving` alone; during the STOPPED dwell `isMoving`
  //      is already false, which is what freezes it (the same reason it
  //      always did).
  //   2. `cumulativeMonotonousMin` additionally stops accruing, and is
  //      drained, on any tick the engine reports `stimulusFrozen` —
  //      mirroring the engine exactly, which is what makes NRI and Hybrid
  //      structurally identical here (design §7, P5) instead of
  //      coincidentally similar. `stimulusReliefMin` is the SAME
  //      accumulator-minutes the engine drained from its own
  //      `monotony_accrued_min` this tick (0.0 when nothing is playing); NRI
  //      applies the identical number rather than re-deriving its own drain
  //      rate. `cumulativeJamMin`/`cumulativeHighwayMin` are never drained —
  //      content does not un-drive a highway or clear a jam.
  //   3. The "resuming" tick accrues NOTHING (fixbug-0806). The engine
  //      reports `motionState == "MOVING"` on it while holding the car at the
  //      rest spot, so the plain `isMoving` gate charged the driver a full
  //      tick of driving exposure for a minute they spent parked — a visible
  //      upward kick in the score at the very spot the rest was taken.
  const isMoving = motionState === 'MOVING'
  const stimulusFrozen = Boolean(dget(dynamic, 'stimulusFrozen', false))
  const stimulusReliefMin = Number(dget(dynamic, 'stimulusReliefMin', 0.0))
  const accrue = isMoving && !resuming
  const accrueMonotonous = accrue && !stimulusFrozen

  const cumulativeJamMin = prevJamMin + (isTrafficJam && accrue ? tickDurationMin : 0.0)
  const cumulativeHighwayMin = prevHighwayMin + (segmentType === 'highway' && accrue ? tickDurationMin : 0.0)
  const isMonotonous = segmentType === 'highway' || segmentType === 'normal_road'
  let cumulativeMonotonousMin = prevMonoMin + (isMonotonous && accrueMonotonous ? tickDurationMin : 0.0)
  cumulativeMonotonousMin = Math.max(0.0, cumulativeMonotonousMin - stimulusReliefMin)
  const drivingMinSinceRest = prevDrivingMin + (accrue ? tickDurationMin : 0.0)

  // ── Compute scores ────────────────────────────────────────────────────────
  const sBase = computeBaseScore(drivingMinSinceRest, childPassenger, isNight, familiarRoute, hp)
  const sEnv = computeEnvScore(cumulativeJamMin, cumulativeHighwayMin, cumulativeMonotonousMin, hp)
  const sRealtime = computeRealtimeScore(drowsinessLevel, fatigueLevel, hp)
  const sTotal = sBase + sEnv + sRealtime

  // ── Finalize the forecast early-fire decision (needs sTotal + recovered,
  // both now available) ────────────────────────────────────────────────────
  // Strict on BOTH sides (§7): the current score must be above the early
  // threshold and still below the safety threshold. At/above threshold_fire the
  // ordinary rest path (below) already fires on its own — this path exists for
  // the band strictly BELOW threshold_fire, and its copy must never claim that
  // threshold was already crossed (§12.1).
  const earlyFire = (
    orderValid
    && forecastEvaluated
    && (thresholdForecast < sTotal && sTotal < thresholdFire)
    && !recovered
    && futureFireFound
    && futureUnactionable
    && spotActionable // current spot actionable (Task 3)
  )

  // ── Feature contributions (exact decomposition of s_total) ──────────────
  // Built here — after s_total but before the fire-control gates below reuse
  // the same recovered/next_rest_min/rest_eta_filter/threshold_fire inputs
  // to describe the SAME gates the fire-control block evaluates, so the
  // review panel's gate list matches what actually decided the tick.
  const featureContributions = buildFeatureContributions({
    drivingMinSinceRest,
    isNight,
    familiarRoute,
    childPassenger,
    cumulativeJamMin,
    cumulativeHighwayMin,
    cumulativeMonotonousMin,
    drowsinessLevel,
    fatigueLevel,
    sTotal,
    recovered,
    nextRestMin,
    restEtaFilter,
    thresholdFire,
    spotActionable,
    spotReason,
    hp,
  })

  // When the orchestration supplied an evaluated forecast block, the
  // rest_required gate list is REPLACED by the full §14.2 11-gate forecast list
  // — evidence should show every input the forecast path consulted, not just
  // the two-gate ordinary summary. Preserves gate ORDER exactly.
  if (forecastEvaluated) {
    featureContributions.rest_required.gates = forecastRestGates({
      orderValid, sTotal, tForecast: thresholdForecast, tFire: thresholdFire,
      ff, frs, crs: crs2, fs, recovered, etaFilter: restEtaFilter,
    })
  }

  // ── State labels ──────────────────────────────────────────────────────────
  const label = stateLabel(sTotal, recovered, thresholdFire, earlyFire)
  const monotonyLabel = monotonyStateLabel(sTotal, recovered, thresholdMonotony, thresholdFire)

  // ── Fire-control — TWO thresholds banding ONE score, then the post-fire
  // ETA filter on the REST band only.
  //
  //     S_total >= threshold_fire                       -> rest_required
  //     threshold_monotony <= S_total < threshold_fire  -> monotony_prevention
  //     S_total <  threshold_monotony                   -> nothing
  //
  // Order within the rest band is unchanged: recovery suppression (never
  // propose while resting) -> below fire threshold (no candidate) -> ETA
  // filter -> fire. Still no persistence gate, cooldown, 30-min cap, or
  // emergency override — this adds a band, not a ladder.
  const exists = sTotal >= thresholdFire || earlyFire
  // Manifested-risk (drowsiness/fatigue past their theta dead-band) -> a
  // stronger message; otherwise the accumulated-fatigue message. Uses only
  // the existing theta thresholds — no extra fire-control hyperparameter. The
  // early-fire strength is FIXED at "clear" (§12.3) — it is a proactive nudge,
  // not a manifested-risk escalation, regardless of s_realtime.
  let strengthLabel: string | null
  if (earlyFire) {
    strengthLabel = 'clear'
  } else if (exists) {
    strengthLabel = sRealtime > 0.0 ? 'strong' : 'clear'
  } else {
    strengthLabel = null
  }

  let fired = false
  let suppressed = false
  const override = false
  let reason: string

  if (recovered) {
    suppressed = true
    reason = 'recovery_after_accept'
  } else if (earlyFire) {
    fired = true
    reason = 'forecast_rest_opportunity_passed'
  } else if (!exists) {
    reason = 'below_fire_threshold'
  } else if (spotActionable) {
    fired = true
    reason = 'fire_threshold_passed'
  } else {
    suppressed = true
    reason = spotReason as string // no_spot_ahead | rest_spot_eta_over_limit
  }

  // ── Monotony band ─────────────────────────────────────────────────────────
  // No ETA filter here: refreshing content needs no place to stop, so the
  // thing that suppresses a rest proposal must not suppress this one.
  const monoExists = sTotal >= thresholdMonotony
  const monoInBand = monoExists && sTotal < thresholdFire
  let monoFired = false
  let monoSuppressed = false
  let monoReason: string

  if (recovered) {
    monoSuppressed = true
    monoReason = 'recovery_after_accept'
  } else if (!monoExists) {
    monoReason = 'below_monotony_threshold'
  } else if (earlyFire) {
    // The forecast early-rest proposal owns the tick — say so rather than
    // letting monotony fire alongside/instead of it.
    monoSuppressed = true
    monoReason = 'superseded_by_forecast_rest'
  } else if (!monoInBand) {
    // The score cleared this threshold too, but the higher-priority rest band
    // owns the tick. Say so, rather than reporting it as below threshold.
    monoSuppressed = true
    monoReason = 'superseded_by_rest_required'
  } else {
    monoFired = true
    monoReason = 'monotony_threshold_passed'
  }

  // ── Build candidates (both RETAINED, fired or not — §11) ─────────────────
  const candidates: Candidate[] = [
    {
      category: 'rest_required',
      exists,
      score: sTotal,
      state: label,
      strength: strengthLabel,
      fire_control: { fired, suppressed, override, reason },
    },
    {
      category: 'monotony_prevention',
      exists: monoExists,
      score: sTotal,
      state: monotonyLabel,
      strength: monoInBand ? 'gentle' : null,
      fire_control: { fired: monoFired, suppressed: monoSuppressed, override: false, reason: monoReason },
    },
  ]

  // ── Result type + the overall fire_control mirror ────────────────────────
  // Rest outranks monotony (trigger_categories priority 1 vs 2), and the
  // bands are disjoint anyway, so at most one of them ever fires.
  let resultType: string
  let selectedCategory: string | null
  let overallFc: FireControl

  if (fired) {
    resultType = 'REST_PROPOSAL'
    selectedCategory = 'rest_required'
    overallFc = { fired: true, suppressed: false, override, reason }
  } else if (monoFired) {
    resultType = 'MONOTONY_PROPOSAL'
    selectedCategory = 'monotony_prevention'
    overallFc = { fired: true, suppressed: false, override: false, reason: monoReason }
  } else if (suppressed || monoSuppressed) {
    resultType = 'SUPPRESSED'
    selectedCategory = null
    // Report the REST suppression when there is one — it is the
    // higher-priority category and the more consequential thing to have
    // withheld.
    overallFc = suppressed
      ? { fired: false, suppressed: true, override: false, reason }
      : { fired: false, suppressed: true, override: false, reason: monoReason }
  } else {
    resultType = 'NO_PROPOSAL'
    selectedCategory = null
    overallFc = { fired: false, suppressed: false, override: false, reason }
  }

  // ── Proposal + explanation ─────────────────────────────────────────────────
  let proposal: Proposal | null = null
  if (earlyFire) {
    proposal = buildForecastProposal()
  } else if (fired && strengthLabel) {
    proposal = buildProposal(strengthLabel)
  } else if (monoFired) {
    proposal = buildMonotonyProposal()
  }

  const reasonInputs = [
    'continuous_driving_min', 'drowsiness', 'fatigue',
    'traffic_jam', 'highway', 'monotonous_road',
  ]

  // Name WHICH band the score landed in — with two thresholds on one score,
  // "fired / not fired" alone no longer says what happened.
  let bandJa: string
  let bandEn: string
  if (fired) {
    bandJa = `休憩しきい値(${pyFixed(thresholdFire, 0)})超で発火`
    bandEn = `fired: at/above the rest threshold (${pyFixed(thresholdFire, 0)})`
  } else if (monoFired) {
    bandJa = `単調性帯(${pyFixed(thresholdMonotony, 0)}〜${pyFixed(thresholdFire, 0)})で発火`
    bandEn = `fired: inside the monotony band (${pyFixed(thresholdMonotony, 0)}–${pyFixed(thresholdFire, 0)})`
  } else {
    bandJa = '未発火'
    bandEn = 'not fired'
  }

  let explanation: { ja: string; en: string }[]
  if (earlyFire) {
    // Early-rest specific copy (§14.3). It must NOT claim the safety threshold
    // was already crossed (§12.1) — the score sits strictly BELOW it — so the
    // fire threshold's numeric value is deliberately omitted here (it would
    // read as "100" and misstate the situation); we name it qualitatively
    // ("the safety threshold") instead. The raw forecast values are
    // interpolated with `pyNum` (mirroring algorithm.py's un-formatted
    // f-string, so `None`/`.0` render as Python would).
    const reasonWord = (forecast['forecast_rest_unactionable_reason'] as string | null) ?? null
    explanation = [
      {
        ja: (
          `総合疲労スコア=${pyFixed(sTotal, 1)}点 `
          + `(基礎=${pyFixed(sBase, 1)}+環境=${pyFixed(sEnv, 1)}+実時間=${pyFixed(sRealtime, 1)})。`
          + `早期閾値${pyFixed(thresholdForecast, 0)}超・安全閾値未満。`
          + `予測: 約${pyNum(ff['elapsed_min'])}分/${pyNum(ff['distance_km'])}kmで安全閾値に到達見込み、`
          + `その時の休憩地は利用困難(${pyNum(reasonWord)})。`
          + `現在の休憩地までETA=${pyNum(crs2['eta_from_current_min'])}分、`
          + `到着後の目的地までETA=${pyNum(crs2['eta_to_destination_min'])}分。前方で早めの休憩を提案。`
        ),
        en: (
          `Total fatigue score=${pyFixed(sTotal, 1)} `
          + `(base=${pyFixed(sBase, 1)}+env=${pyFixed(sEnv, 1)}+realtime=${pyFixed(sRealtime, 1)}). `
          + `Above early threshold ${pyFixed(thresholdForecast, 0)}, below the safety threshold. `
          + `Forecast: safety threshold reached in ~${pyNum(ff['elapsed_min'])} min / `
          + `${pyNum(ff['distance_km'])} km, where the rest spot would be unusable (${pyNum(reasonWord)}). `
          + `Current rest spot ETA=${pyNum(crs2['eta_from_current_min'])} min, `
          + `destination ETA after it=${pyNum(crs2['eta_to_destination_min'])} min. `
          + `Proposing an early rest ahead.`
        ),
      },
    ]
  } else {
    explanation = [
      {
        ja: (
          `総合疲労スコア=${pyFixed(sTotal, 1)}点 `
          + `(基礎=${pyFixed(sBase, 1)} + 環境=${pyFixed(sEnv, 1)} + リアルタイム=${pyFixed(sRealtime, 1)})。`
          + `${bandJa}、状態=${label}／${monotonyLabel}。`
        ),
        en: (
          `Total fatigue score=${pyFixed(sTotal, 1)}pts `
          + `(base=${pyFixed(sBase, 1)} + env=${pyFixed(sEnv, 1)} + realtime=${pyFixed(sRealtime, 1)}). `
          + `${bandEn}, state=${label} / ${monotonyLabel}.`
        ),
      },
    ]
  }

  // ── Next runtime state ────────────────────────────────────────────────────
  const nextRuntimeState: NriRuntimeState = {
    cumulative_jam_min: cumulativeJamMin,
    cumulative_highway_min: cumulativeHighwayMin,
    cumulative_monotonous_min: cumulativeMonotonousMin,
    driving_min_since_rest: drivingMinSinceRest,
    last_sim_time: simTime,
    was_in_recovery: recoveryActive,
    // Keeps the reset a one-tick event (see `recoveryJustCompleted`).
    was_resuming: resuming,
  }

  // ── Features ordinal (for trace display) ──────────────────────────────────
  const featuresOrdinal: Record<string, string> = {}
  for (const [k, v] of Object.entries(ordinal)) {
    featuresOrdinal[k] = String(v)
  }

  // Attach the ordinal band word each row's raw value falls in, so the
  // review panel can lead with the value a reviewer already understands.
  // `ordinal` is keyed independently of the row feature_ids above (e.g. the
  // split-out `night_amplification` / `familiar_route_amplification` rows
  // have no ordinal entry of their own) — a miss stays null rather than
  // guessing (mirrors aica_transparent_hybrid_trigger_v1.evaluate()).
  for (const block of Object.values(featureContributions)) {
    for (const row of block.rows) {
      row.band = (featuresOrdinal[row.feature_id] as string | undefined) ?? null
    }
  }

  // ── Normalized score (0-1 range for UI compatibility) ─────────────────────
  const maxDisplay = Math.max(thresholdFire * 1.5, 150.0)
  const normalizedScore = maxDisplay > 0 ? Math.min(1.0, sTotal / maxDisplay) : 0.0
  // The §11 `score`/`rest_required_score` is NORMALIZED to 0-1; the timeline
  // plots that curve and its threshold line on the same axis. `threshold_fire`
  // is on the RAW s_total scale (e.g. 80), so we also expose it normalized by
  // the same divisor — otherwise the UI's y-domain stretches to ~80 and the
  // 0-1 curve collapses to a flat line at the bottom (mirrors the hybrid's
  // already-0-1 `threshold_suggest`).
  const normalizedThreshold = maxDisplay > 0 ? Math.min(1.0, thresholdFire / maxDisplay) : 0.0
  // Same divisor for the monotony rule — otherwise the timeline would draw it
  // at its RAW value (~55) on a 0-1 axis. Note there is deliberately no
  // `monotony_prevention_score`: NRI has ONE score, so a second curve would
  // just be a duplicate of the first drawn on top of it. Two thresholds, one
  // score.
  const normalizedMonotonyThreshold = maxDisplay > 0 ? Math.min(1.0, thresholdMonotony / maxDisplay) : 0.0

  const result = {
    result_type: resultType,
    trigger_candidate: fired || monoFired,
    selected_category: selectedCategory,
    score: normalizedScore,
    features: featuresOrdinal,
    scores: {
      s_total: sTotal,
      s_base: sBase,
      s_env: sEnv,
      s_realtime: sRealtime,
      rest_required_score: normalizedScore,
    },
    feature_contributions: featureContributions,
    states: {
      rest: label,
      monotony: monotonyLabel,
    },
    criteria: {
      threshold_fire: thresholdFire,
      threshold_monotony: thresholdMonotony,
      // thresholds on the SAME 0-1 scale as rest_required_score (for the
      // timeline threshold lines); the two above stay raw (s_total scale).
      rest_required_threshold: normalizedThreshold,
      monotony_suggest_threshold: normalizedMonotonyThreshold,
      rest_spot_eta_filter_min: restEtaFilter,
      // ── Forecast early-rest evidence (Task 5; spec §14.1) ──────────────
      // Mirrors every input the forecast path consulted so the review panel
      // can audit the early-fire decision. All values are pulled from the
      // orchestration-supplied `nri_forecast` block; when no forecast block was
      // supplied these are the empty-dict `.get()` defaults (null / order-check
      // on hp alone).
      threshold_forecast_rest: thresholdForecast,
      forecast_threshold_order_valid: orderValid,
      forecast_mode: (forecast['forecast_mode'] as unknown) ?? null,
      forecast_start_content_active: (fs['content_active'] as unknown) ?? null,
      forecast_start_service_id: (fs['service_id'] as unknown) ?? null,
      forecast_start_content_remaining_min: (fs['content_remaining_min'] as unknown) ?? null,
      forecast_fire_found: futureFireFound,
      forecast_fire_s_total: (ff['s_total'] as unknown) ?? null,
      forecast_fire_eta_from_now_min: (
        ff['elapsed_min'] === null || ff['elapsed_min'] === undefined
          ? null
          : Number(ff['elapsed_min']) - simTime / 60.0
      ),
      forecast_fire_distance_km: (ff['distance_km'] as unknown) ?? null,
      forecast_rest_spot_exists: (frs['exists'] as unknown) ?? null,
      forecast_rest_spot_eta_from_fire_min: (frs['eta_from_fire_min'] as unknown) ?? null,
      forecast_rest_spot_eta_to_destination_min: (frs['eta_to_destination_min'] as unknown) ?? null,
      forecast_rest_spot_actionable: (frs['actionable'] as unknown) ?? null,
      forecast_future_rest_unactionable: futureUnactionable,
      forecast_rest_unactionable_reason: (forecast['forecast_rest_unactionable_reason'] as unknown) ?? null,
      current_rest_spot_exists: (crs2['exists'] as unknown) ?? null,
      current_rest_spot_eta_min: (crs2['eta_from_current_min'] as unknown) ?? null,
      current_rest_spot_eta_to_destination_min: (crs2['eta_to_destination_min'] as unknown) ?? null,
      current_rest_spot_actionable: (crs2['actionable'] as unknown) ?? null,
      current_rest_spot_unactionable_reason: (crs2['unactionable_reason'] as unknown) ?? null,
      // The synced `DecisionResult['criteria']` is narrowed to
      // `Record<string, number>` (thresholds only) in api/types.ts — kept
      // byte-identical to app/frontend, out of scope to widen. The forecast
      // evidence above is intentionally mixed number/boolean/string/null
      // (mirroring algorithm.py's dict), so cast here the SAME way this file's
      // `explanation` field does; downstream consumers read criteria loosely.
    } as unknown as Record<string, number>,
    candidates,
    fire_control: overallFc,
    proposal,
    reason_inputs: reasonInputs,
    // DecisionResult['explanation'] is typed as plain `string` in the synced
    // `../../../api/types.ts` (an M1-era narrowing never widened for M2/M3
    // hybrid explanations) — out of scope to edit (synced file). algorithm.py
    // returns a list[LocalizedText] here (matching the Python model's actual
    // `ExplanationType = str | LocalizedText | list[...]`), and downstream
    // consumers (e.g. DecisionTracePanel.tsx) already tolerate a non-string
    // value at runtime (`typeof dr.explanation === 'string' ? ... : ...`).
    explanation: explanation as unknown as string,
    next_package_runtime_state: nextRuntimeState as unknown as Record<string, unknown>,
  }

  return result
}
