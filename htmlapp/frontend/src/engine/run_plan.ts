/**
 * Run plan service — draft registry + plan creation/regeneration.
 *
 * Ported from `app/api/aica_api/services/run_plan.py` (behavior-of-record).
 *
 * Design (mirrors the Python module docstring):
 *   - In-memory draft registry keyed by plan_id (a module-level `Map`, mirroring
 *     the Python module-global dict).
 *   - createDraft(...) validates edits, builds a draft EventPlan, and returns
 *     `{draft, package, scenario}`. When there are validation errors, the
 *     draft is returned (for the caller's error-response body) but NOT stored
 *     in the registry.
 *   - regenerateDraft(planId, patch) -> updated draft (same plan_id).
 *   - getDraftEntry(planId) -> `{draft, package, scenario}` | null.
 *   - plan_id is supplied by the caller; not generated here.
 *   - Draft-plan generation is pure given (route_facts, presets) — deterministic.
 *
 * ROUTE FACTS (S3.4): the Python `create_draft`/`_build_draft` accept
 * `route_facts: RouteFacts | None = None` and, when None, derive it locally
 * via `analyze_route(scenario)` (services/route_analysis.py). That module was
 * ported in S7.2 (`./services/route_analysis`). `createDraft`'s `routeFacts`
 * input is therefore OPTIONAL here too: when omitted (or `null`), `buildDraft`
 * calls `analyzeRoute(scenario)` fresh, exactly mirroring `_build_draft`'s
 * `if route_facts is None: route_facts = analyze_route(scenario)`. Error-path
 * drafts (validation failures / build exceptions) mirror Python's fallback to
 * `analyze_route(scenario)` using the ORIGINAL (pre-profile-override) scenario,
 * exactly as `create_draft`'s two `except`/error branches do.
 *
 * `regenerateDraft` mirrors `regenerate_draft`: for a "maps" draft the frozen
 * `route_facts` is preserved from the registered draft (never re-derived,
 * so a selected Maps route survives a regenerate); for a "local" draft
 * `route_facts` is `null`, so each regenerate calls `analyzeRoute(scenario)`
 * FRESH from the registered (effective) scenario — matching Python exactly
 * and resolving a documented S3.3 aliasing carry (a single shared RouteFacts
 * object had been reused across regenerates instead of being re-derived).
 *
 * Only the exported function identifiers (createDraft, regenerateDraft,
 * getDraftEntry, clearDraftRegistry) are camelCased. All RunPlanDraft object
 * keys are preserved byte-for-byte from the Python (snake_case) because they
 * cross the parity boundary.
 */

import type {
  DisplayRoute,
  HyperparameterDef,
  PackageManifest,
  ParameterDef,
  RouteFacts,
  ValidationError,
} from '../api/types'
import type { EventPlan, ScenarioDefM2 } from './event_plan'
import { buildEventPlan, defaultEventPlan } from './event_plan'
import { analyzeRoute } from './services/route_analysis'

// ---------------------------------------------------------------------------
// Public types (mirror aica_api.models.run.RunPlanDraft — absent from api/types.ts)
// ---------------------------------------------------------------------------

export type RunPlanDraft = {
  plan_id: string
  package_id: string
  scenario_id: string
  route_facts: RouteFacts
  effective_setup: Record<string, unknown>
  draft_event_plan: EventPlan
  validation_errors: ValidationError[]
  route_source: 'maps' | 'local'
  display_route: DisplayRoute | null
  profile_overrides: Record<string, unknown> | null
}

export type DraftEntry = {
  draft: RunPlanDraft
  package: PackageManifest
  scenario: ScenarioDefM2
}

/**
 * PackageManifest.algorithm fields consumed here (`tick_seconds`, `error_mode`)
 * that are genuinely absent from the synced `../api/types.ts` PackageManifest
 * (its `algorithm` type is `{type, entrypoint}` only). Bundled package JSON
 * always carries both (Python AlgorithmDef defaults: `tick_seconds=None`,
 * `error_mode="blocking"`).
 */
export type PackageManifestM2 = Omit<PackageManifest, 'algorithm'> & {
  algorithm: PackageManifest['algorithm'] & { tick_seconds?: number | null; error_mode?: string }
}

export type CreateDraftArgs = {
  planId: string
  package: PackageManifestM2
  scenario: ScenarioDefM2
  presets: Record<string, unknown>
  parameters: Record<string, unknown>
  hyperparameters: Record<string, unknown>
  runMode?: string
  /**
   * M4 — pre-computed facts from a maps selection. `undefined`/`null` (the
   * default) means "derive locally" — `buildDraft` calls `analyzeRoute(scenario)`
   * fresh, mirroring Python's `_build_draft`. See module docstring.
   */
  routeFacts?: RouteFacts | null
  routeSource?: 'maps' | 'local'
  displayRoute?: DisplayRoute | null
  profiles?: Record<string, unknown> | null
  initialState?: Record<string, unknown> | null
  contextOverrides?: Record<string, unknown> | null
}

export type RegenerateDraftPatch = {
  presets: Record<string, unknown>
  parameters: Record<string, unknown>
  hyperparameters: Record<string, unknown>
}

// ---------------------------------------------------------------------------
// In-memory registry
// ---------------------------------------------------------------------------

/** Keyed by plan_id: {draft, package, scenario}. Mirrors Python's module-global dict. */
const draftRegistry = new Map<string, DraftEntry>()

/** Clear the in-memory draft registry. Used for test isolation only. */
export function clearDraftRegistry(): void {
  draftRegistry.clear()
}

/** Return the stored draft entry for a plan_id, or null if unknown. */
export function getDraftEntry(planId: string): DraftEntry | null {
  return draftRegistry.get(planId) ?? null
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/** Validate a single parameter value against its definition. */
function validateParameter(key: string, value: unknown, defn: ParameterDef): ValidationError[] {
  const errors: ValidationError[] = []
  if (defn.kind === 'band') {
    const allowed = defn.band_values ?? []
    if (!allowed.includes(value as string)) {
      errors.push({
        field: key,
        message: `Value ${pyRepr(value)} is not in allowed values ${pyReprList(allowed)} for parameter ${pyRepr(key)}.`,
      })
    }
  } else if (defn.kind === 'bool') {
    if (typeof value !== 'boolean') {
      errors.push({
        field: key,
        message: `Expected a boolean value for parameter ${pyRepr(key)}, got ${jsTypeName(value)}.`,
      })
    }
  }
  return errors
}

/** Validate a single hyperparameter value against its definition. */
function validateHyperparameter(key: string, value: unknown, defn: HyperparameterDef): ValidationError[] {
  const errors: ValidationError[] = []
  if (defn.kind === 'band') {
    const allowed = defn.band_values ?? []
    if (!allowed.includes(value as string)) {
      errors.push({
        field: key,
        message: `Value ${pyRepr(value)} is not in allowed values ${pyReprList(allowed)} for hyperparameter ${pyRepr(key)}.`,
      })
    }
  } else if (defn.kind === 'bool') {
    if (typeof value !== 'boolean') {
      errors.push({
        field: key,
        message: `Expected a boolean value for hyperparameter ${pyRepr(key)}, got ${jsTypeName(value)}.`,
      })
    }
  } else if (defn.kind === 'numeric') {
    if (typeof value !== 'number') {
      errors.push({
        field: key,
        message: `Expected a numeric value for hyperparameter ${pyRepr(key)}, got ${jsTypeName(value)}.`,
      })
    } else {
      const fval = value
      if (defn.min !== undefined && defn.min !== null && fval < defn.min) {
        errors.push({
          field: key,
          message: `Value ${fval} is below the minimum ${defn.min} for hyperparameter ${pyRepr(key)}.`,
        })
      }
      if (defn.max !== undefined && defn.max !== null && fval > defn.max) {
        errors.push({
          field: key,
          message: `Value ${fval} is above the maximum ${defn.max} for hyperparameter ${pyRepr(key)}.`,
        })
      }
      if (defn.step !== undefined && defn.step !== null && defn.step > 0) {
        const base = defn.min !== undefined && defn.min !== null ? defn.min : 0.0
        const remainder = Math.abs((fval - base) % defn.step)
        if (remainder > 1e-9 && Math.abs(remainder - defn.step) > 1e-9) {
          errors.push({
            field: key,
            message: `Value ${fval} is not aligned to step ${defn.step} for hyperparameter ${pyRepr(key)}.`,
          })
        }
      }
    }
  }
  return errors
}

/**
 * Validate all edited parameters and hyperparameters.
 * Only the keys present in the overrides dicts are validated (the rest use
 * defaults from the package definition, which are always valid).
 */
function validateEdits(
  pkg: PackageManifestM2,
  parameters: Record<string, unknown>,
  hyperparameters: Record<string, unknown>,
): ValidationError[] {
  const errors: ValidationError[] = []

  const paramDefs = new Map(pkg.parameters.map((p) => [p.key, p]))
  for (const [key, value] of Object.entries(parameters)) {
    const defn = paramDefs.get(key)
    if (!defn) {
      errors.push({ field: key, message: `Unknown parameter ${pyRepr(key)} for package ${pyRepr(pkg.id)}.` })
    } else {
      errors.push(...validateParameter(key, value, defn))
    }
  }

  const hpDefs = new Map(pkg.hyperparameters.map((hp) => [hp.key, hp]))
  for (const [key, value] of Object.entries(hyperparameters)) {
    const defn = hpDefs.get(key)
    if (!defn) {
      errors.push({ field: key, message: `Unknown hyperparameter ${pyRepr(key)} for package ${pyRepr(pkg.id)}.` })
    } else {
      errors.push(...validateHyperparameter(key, value, defn))
    }
  }

  return errors
}

// ---------------------------------------------------------------------------
// Draft creation helpers
// ---------------------------------------------------------------------------

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/**
 * Normalize a PackageManifest to match Python's Pydantic serialization behavior,
 * specifically: HyperparameterDef always serializes band_values (even when null).
 * Without this, the JS output omits band_values for numeric/bool hyperparameters,
 * causing a key-count mismatch against the Python fixture output.
 */
function normalizePackageForOutput(pkg: PackageManifestM2): PackageManifestM2 {
  const normalizedHps = (pkg.hyperparameters ?? []).map((hp) => {
    if (!('band_values' in hp)) {
      return { ...hp, band_values: null }
    }
    return hp
  })
  return { ...pkg, hyperparameters: normalizedHps }
}

/**
 * Normalize a scenario to match Python's Pydantic ScenarioDef serialization:
 *   - Adds `rest_drowsiness_ceiling: 100.0` when the field is absent (feature 020 default).
 *   - Strips `_comment` keys (internal annotation in JSON files, not a model field).
 *   - Normalizes `event_presets` to add `rest_spot_eta_near_before: null` and
 *     `rest_spot_eta_schedule: null` when absent (Python EventPreset defaults).
 *
 * This ensures JS `createDraft` output matches the Python fixture output shape.
 */
function normalizeScenarioForOutput(scenario: ScenarioDefM2): ScenarioDefM2 {
  const raw = scenario as unknown as Record<string, unknown>
  // Build a copy without _comment but with rest_drowsiness_ceiling added if missing
  const result: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(raw)) {
    if (k === '_comment') continue
    result[k] = v
  }
  if (!('rest_drowsiness_ceiling' in result)) {
    result['rest_drowsiness_ceiling'] = 100.0
  }
  // Normalize driver_signal_params.recovery_model entries (feature 020 ActivityRecovery defaults)
  if (isPlainObject(result['driver_signal_params'])) {
    result['driver_signal_params'] = normalizeDriverSignalParams(result['driver_signal_params'])
  }
  // Normalize event_presets to include Python EventPreset optional fields with defaults
  if (isPlainObject(result['event_presets'])) {
    const ep = result['event_presets'] as Record<string, unknown>
    const normalizedEp: Record<string, unknown> = { ...ep }
    if (!('rest_spot_eta_near_before' in normalizedEp)) {
      normalizedEp['rest_spot_eta_near_before'] = null
    }
    if (!('rest_spot_eta_schedule' in normalizedEp)) {
      normalizedEp['rest_spot_eta_schedule'] = null
    }
    result['event_presets'] = normalizedEp
  }
  // Normalize recovery_options entries to include Python RecoveryOption/RecoveryStage defaults
  if (Array.isArray(result['recovery_options'])) {
    result['recovery_options'] = (result['recovery_options'] as unknown[]).map((opt) => {
      if (!isPlainObject(opt)) return opt
      const normalizedOpt: Record<string, unknown> = { ...opt }
      if (!('postpone' in normalizedOpt)) normalizedOpt['postpone'] = false
      // Normalize stages to include Python RecoveryStage defaults
      if (Array.isArray(normalizedOpt['stages'])) {
        normalizedOpt['stages'] = (normalizedOpt['stages'] as unknown[]).map((stage) => {
          if (!isPlainObject(stage)) return stage
          const s: Record<string, unknown> = { ...stage }
          if (!('ticks' in s)) s['ticks'] = null
          if (!('grants_moving_recovery' in s)) s['grants_moving_recovery'] = false
          return s
        })
      }
      return normalizedOpt
    })
  }
  return result as unknown as ScenarioDefM2
}

/**
 * Recursively merge *override* onto *base*. For each key in *override*: if
 * the value is a plain object and the matching key in *base* is also a plain
 * object, recurse; otherwise the override value replaces the base value.
 * Neither *base* nor *override* is mutated.
 */
function deepMerge(base: Record<string, unknown>, override: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = { ...base }
  for (const [key, val] of Object.entries(override)) {
    if (key in result && isPlainObject(result[key]) && isPlainObject(val)) {
      result[key] = deepMerge(result[key] as Record<string, unknown>, val as Record<string, unknown>)
    } else {
      result[key] = val
    }
  }
  return result
}

// ---------------------------------------------------------------------------
// Profile-model constraints (ported from app/api/aica_api/models/profile.py)
// ---------------------------------------------------------------------------
//
// A small declarative schema + validator standing in for Pydantic's
// model_validate. ACCEPTED DIVERGENCE (documented, mirrors S3.3's pyRepr
// validation-message approximation): error MESSAGE strings are NOT
// byte-identical to Pydantic's wording — only the FIELD PATHS
// ("profiles.<driver|vehicle|speed>.<loc>", loc joined with "." exactly like
// Pydantic's `e["loc"]`) and the accept/reject DECISION are required to match.
//
// Constraints ported (see models/profile.py):
//   - required vs optional fields (Pydantic fields without a default are
//     required; `rolling_window_seconds` has default=300 so it is optional)
//   - `extra="forbid"` on every sub-model (unknown keys rejected)
//   - numeric type checks (float/int) and `list[str]` for `enabled_on`
//   - `_nonneg` field_validator: rate/level/recovery fields must be >= 0
//   - `_threshold_in_range` field_validator: threshold fields in [0, 100]
//
// NOT ported (documented gap): Pydantic's exact coercion rules for numeric
// strings (e.g. "5" -> 5.0) and its precise int/float boundary messaging.
// This engine treats only `typeof value === 'number'` as numeric input,
// which is the only shape a JSON-driven UI ever produces here.

type ProfileFieldSchema =
  | { kind: 'number'; nonneg?: boolean; range?: [number, number] }
  | { kind: 'int' }
  | { kind: 'string' }
  | { kind: 'stringArray' }
  | { kind: 'object'; fields: Record<string, { schema: ProfileFieldSchema; required: boolean }> }
  | { kind: 'record'; value: ProfileFieldSchema }

/** A sub-model whose every declared field is a required, non-negative number. */
function nonnegRateModel(fields: string[]): ProfileFieldSchema {
  return {
    kind: 'object',
    fields: Object.fromEntries(
      fields.map((f) => [f, { schema: { kind: 'number', nonneg: true } as ProfileFieldSchema, required: true }]),
    ),
  }
}

// Feature 009: DriverSignalParams replaces DriverModelProfile (attention_model
// retired; recovery_model is now a map of activity → ActivityRecovery).
const DRIVER_SIGNAL_PARAMS_SCHEMA: ProfileFieldSchema = {
  kind: 'object',
  fields: {
    id: { schema: { kind: 'string' }, required: true },
    drowsiness_model: {
      schema: nonnegRateModel(['base_growth_per_min', 'night_add_per_min', 'monotony_add_per_min', 'traffic_jam_add_per_min']),
      required: true,
    },
    fatigue_model: {
      schema: nonnegRateModel([
        'base_growth_per_min',
        'continuous_driving_add_per_min_after_60_min',
        'mountain_road_add_per_min',
        'traffic_jam_add_per_min',
      ]),
      required: true,
    },
    recovery_model: {
      schema: {
        kind: 'record',
        value: nonnegRateModel(['drowsiness', 'fatigue']),
      },
      required: true,
    },
  },
}

// Feature 009: seeded-Poisson anomaly-signal generator params (Tier 3b).
const ANOMALY_SIGNAL_PARAMS_SCHEMA: ProfileFieldSchema = {
  kind: 'object',
  fields: {
    lambda_base: { schema: { kind: 'number', nonneg: true }, required: true },
    lambda_gain: { schema: { kind: 'number', nonneg: true }, required: true },
    theta: { schema: { kind: 'number', nonneg: true }, required: true },
    window_min: { schema: { kind: 'number', nonneg: true }, required: true },
  },
}

const SPEED_PROFILE_SCHEMA: ProfileFieldSchema = {
  kind: 'object',
  fields: Object.fromEntries(
    ['normal_road_kph', 'highway_kph', 'mountain_road_kph', 'sightseeing_road_kph', 'traffic_jam_kph'].map((f) => [
      f,
      { schema: { kind: 'int' } as ProfileFieldSchema, required: true },
    ]),
  ),
}

function profileFieldError(profileType: string, loc: (string | number)[], message: string): ValidationError {
  return { field: `profiles.${profileType}.${loc.join('.')}`, message }
}

/** Recursively validate `value` against `schema`, pushing errors with `profiles.<type>.<loc>` field paths. */
function validateProfileSchema(
  value: unknown,
  schema: ProfileFieldSchema,
  loc: (string | number)[],
  profileType: string,
  errors: ValidationError[],
): void {
  if (schema.kind === 'object') {
    if (!isPlainObject(value)) {
      errors.push(profileFieldError(profileType, loc, 'Input should be a valid object'))
      return
    }
    for (const [key, spec] of Object.entries(schema.fields)) {
      if (!(key in value)) {
        if (spec.required) {
          errors.push(profileFieldError(profileType, [...loc, key], 'Field required'))
        }
        continue
      }
      validateProfileSchema(value[key], spec.schema, [...loc, key], profileType, errors)
    }
    for (const key of Object.keys(value)) {
      if (!(key in schema.fields)) {
        errors.push(profileFieldError(profileType, [...loc, key], 'Extra inputs are not permitted'))
      }
    }
    return
  }

  if (schema.kind === 'record') {
    if (!isPlainObject(value)) {
      errors.push(profileFieldError(profileType, loc, 'Input should be a valid object'))
      return
    }
    for (const [key, v] of Object.entries(value)) {
      validateProfileSchema(v, schema.value, [...loc, key], profileType, errors)
    }
    return
  }

  if (schema.kind === 'number') {
    if (typeof value !== 'number' || Number.isNaN(value)) {
      errors.push(profileFieldError(profileType, loc, 'Input should be a valid number'))
      return
    }
    if (schema.nonneg && value < 0) {
      errors.push(profileFieldError(profileType, loc, `rate must be >= 0, got ${value}`))
    }
    if (schema.range && (value < schema.range[0] || value > schema.range[1])) {
      errors.push(profileFieldError(profileType, loc, `threshold must be in [${schema.range[0]}, ${schema.range[1]}], got ${value}`))
    }
    return
  }

  if (schema.kind === 'int') {
    if (typeof value !== 'number' || Number.isNaN(value) || !Number.isInteger(value)) {
      errors.push(profileFieldError(profileType, loc, 'Input should be a valid integer'))
    }
    return
  }

  if (schema.kind === 'string') {
    if (typeof value !== 'string') {
      errors.push(profileFieldError(profileType, loc, 'Input should be a valid string'))
    }
    return
  }

  if (schema.kind === 'stringArray') {
    if (!Array.isArray(value) || !value.every((v) => typeof v === 'string')) {
      errors.push(profileFieldError(profileType, loc, 'Input should be a valid list of strings'))
    }
  }
}

/**
 * Deep-merge profile override dicts onto scenario profiles and validate.
 *
 * Ported from Python `_apply_profile_overrides`: for each of driver/vehicle/
 * speed present in *profiles*, deep-merge onto the scenario's existing
 * profile, then validate the merged whole against the ported profile-model
 * constraints. If ANY of the three validations produced errors, the
 * ORIGINAL scenario is returned unmodified together with ALL collected
 * errors (even successfully-merged sub-objects are discarded) — exactly
 * Python's `if errors: return scenario, errors` before the update is applied.
 */
function applyProfileOverrides(
  scenario: ScenarioDefM2,
  profiles: Record<string, unknown>,
): [ScenarioDefM2, ValidationError[]] {
  const errors: ValidationError[] = []
  const updates: Record<string, unknown> = {}

  const scenAny = scenario as unknown as Record<string, unknown>

  const driverOverride = profiles['driver']
  if (isPlainObject(driverOverride)) {
    const base = isPlainObject(scenAny['driver_signal_params']) ? (scenAny['driver_signal_params'] as Record<string, unknown>) : {}
    const merged = deepMerge(base, driverOverride)
    validateProfileSchema(merged, DRIVER_SIGNAL_PARAMS_SCHEMA, [], 'driver', errors)
    updates['driver_signal_params'] = merged
  }

  // Feature 009: anomaly-signal params override (Tier 3b).
  const anomalyOverride = profiles['anomaly']
  if (isPlainObject(anomalyOverride)) {
    const base = isPlainObject(scenAny['anomaly_signal_params']) ? (scenAny['anomaly_signal_params'] as Record<string, unknown>) : {}
    const merged = deepMerge(base, anomalyOverride)
    validateProfileSchema(merged, ANOMALY_SIGNAL_PARAMS_SCHEMA, [], 'anomaly', errors)
    updates['anomaly_signal_params'] = merged
  }

  // Feature 009: the vehicle behavior model was retired — reject explicitly.
  if (isPlainObject(profiles['vehicle'])) {
    errors.push({
      field: 'profiles.vehicle',
      message: 'vehicle profile overrides are no longer supported — the vehicle behavior model was retired in feature 009 (signal-tier redesign).',
    })
  }

  const speedOverride = profiles['speed']
  if (isPlainObject(speedOverride)) {
    const base = isPlainObject(scenario.speed_profile) ? scenario.speed_profile : {}
    const merged = deepMerge(base, speedOverride)
    validateProfileSchema(merged, SPEED_PROFILE_SCHEMA, [], 'speed', errors)
    updates['speed_profile'] = merged
  }

  if (errors.length > 0) {
    return [scenario, errors]
  }

  if (Object.keys(updates).length > 0) {
    return [{ ...scenario, ...updates } as ScenarioDefM2, []]
  }
  return [scenario, []]
}

/** Merge package defaults with user overrides. */
function mergeDefaults(
  pkg: PackageManifestM2,
  parameters: Record<string, unknown>,
  hyperparameters: Record<string, unknown>,
): [Record<string, unknown>, Record<string, unknown>] {
  const effectiveParams: Record<string, unknown> = {}
  for (const p of pkg.parameters) effectiveParams[p.key] = p.default
  Object.assign(effectiveParams, parameters)

  const effectiveHps: Record<string, unknown> = {}
  for (const hp of pkg.hyperparameters) effectiveHps[hp.key] = hp.default
  Object.assign(effectiveHps, hyperparameters)

  return [effectiveParams, effectiveHps]
}

/**
 * Normalize an ActivityRecovery entry to include all feature 020 fields
 * with their Python defaults, matching Pydantic's serialization behavior.
 * Python's ActivityRecovery always serializes all 6 fields (including those
 * that default to 0.0 / null), so we must fill in missing fields here.
 */
function normalizeActivityRecovery(raw: Record<string, unknown>): Record<string, unknown> {
  return {
    drowsiness: raw['drowsiness'] ?? 0.0,
    fatigue: raw['fatigue'] ?? 0.0,
    drowsiness_per_min: raw['drowsiness_per_min'] ?? 0.0,
    fatigue_per_min: raw['fatigue_per_min'] ?? 0.0,
    cap_drowsiness: raw['cap_drowsiness'] ?? null,
    cap_fatigue: raw['cap_fatigue'] ?? null,
  }
}

/**
 * Normalize a driver_signal_params dict so that every recovery_model entry
 * includes all feature 020 ActivityRecovery fields (matching Python Pydantic
 * serialization which always emits all fields with their defaults).
 */
function normalizeDriverSignalParams(dsp: unknown): unknown {
  if (!isPlainObject(dsp)) return dsp
  const rm = (dsp as Record<string, unknown>)['recovery_model']
  if (!isPlainObject(rm)) return dsp
  const normalizedRm: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(rm as Record<string, unknown>)) {
    normalizedRm[k] = isPlainObject(v) ? normalizeActivityRecovery(v as Record<string, unknown>) : v
  }
  return { ...(dsp as Record<string, unknown>), recovery_model: normalizedRm }
}

/** Build the effective_setup dict for the draft response. */
function buildEffectiveSetup(
  pkg: PackageManifestM2,
  scenario: ScenarioDefM2,
  effectiveParams: Record<string, unknown>,
  effectiveHps: Record<string, unknown>,
  runMode: string,
): Record<string, unknown> {
  const rawDsp = (scenario as unknown as Record<string, unknown>)['driver_signal_params'] ?? null
  return {
    package_id: pkg.id,
    package_version: pkg.version,
    scenario_id: scenario.id,
    scenario_version: scenario.version,
    run_mode: runMode,
    parameters: effectiveParams,
    hyperparameters: effectiveHps,
    // Feature 009: driver_profile carries driver_signal_params (name kept for
    // compat); vehicle_profile retired (always null); anomaly_signal_params new.
    // Feature 020: normalize recovery_model entries to include all ActivityRecovery
    // fields with Python defaults, matching Pydantic serialization behavior.
    driver_profile: rawDsp != null ? normalizeDriverSignalParams(rawDsp) : null,
    vehicle_profile: null,
    anomaly_signal_params: (scenario as unknown as Record<string, unknown>)['anomaly_signal_params'] ?? null,
    speed_profile: scenario.speed_profile ?? null,
  }
}

type BuildDraftArgs = {
  planId: string
  package: PackageManifestM2
  scenario: ScenarioDefM2
  presets: Record<string, unknown>
  parameters: Record<string, unknown>
  hyperparameters: Record<string, unknown>
  runMode: string
  /** `null`/`undefined` -> derive locally via `analyzeRoute(scenario)` (mirrors Python `_build_draft`). */
  routeFacts: RouteFacts | null
  routeSource: 'maps' | 'local'
  displayRoute: DisplayRoute | null
  profileOverrides: Record<string, unknown> | null
}

/**
 * Pure draft construction — deterministic given (routeFacts, presets).
 * Does NOT check parameter/hyperparameter validation — call validateEdits first.
 */
function buildDraft(args: BuildDraftArgs): RunPlanDraft {
  // route_facts = route_facts if route_facts is not None else analyze_route(scenario)
  const routeFacts: RouteFacts = args.routeFacts ?? analyzeRoute(args.scenario)
  // route_facts.bands = {f.key: f.band_values for f in package.features}
  routeFacts.bands = Object.fromEntries(args.package.features.map((f) => [f.key, f.band_values]))

  // tick_seconds precedence: an explicit setup-time override (already in
  // `presets`) wins; otherwise fall back to the package-declared cadence,
  // then the scenario default.
  const effectivePresets: Record<string, unknown> = { ...args.presets }
  if (!('tick_seconds' in effectivePresets) && args.package.algorithm.tick_seconds != null) {
    effectivePresets['tick_seconds'] = args.package.algorithm.tick_seconds
  }

  const eventPlan = buildEventPlan(routeFacts, args.scenario, effectivePresets)

  const [effectiveParams, effectiveHps] = mergeDefaults(args.package, args.parameters, args.hyperparameters)

  const effectiveSetup = buildEffectiveSetup(args.package, args.scenario, effectiveParams, effectiveHps, args.runMode)

  return {
    plan_id: args.planId,
    package_id: args.package.id,
    scenario_id: args.scenario.id,
    route_facts: routeFacts,
    effective_setup: effectiveSetup,
    draft_event_plan: eventPlan,
    validation_errors: [],
    route_source: args.routeSource,
    display_route: args.displayRoute,
    profile_overrides: args.profileOverrides,
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Create and register a draft run plan.
 *
 * Validates each edited parameter/hyperparameter against its definition. If
 * there are validation errors, returns the draft with errors set but does
 * NOT store it in the registry.
 */
export function createDraft(input: CreateDraftArgs): DraftEntry {
  const {
    planId,
    package: pkg,
    scenario,
    presets,
    parameters,
    hyperparameters,
    runMode = 'standard',
    routeFacts = null,
    routeSource = 'local',
    displayRoute = null,
    profiles = null,
    initialState = null,
    contextOverrides = null,
  } = input

  // Validate parameter/hyperparameter edits
  let validationErrors = validateEdits(pkg, parameters, hyperparameters)

  // Apply profile overrides (deep-merge then validate the merged whole).
  let effectiveScenario: ScenarioDefM2 = scenario
  if (profiles) {
    const [merged, profileErrors] = applyProfileOverrides(scenario, profiles)
    effectiveScenario = merged
    validationErrors = [...validationErrors, ...profileErrors]
  }

  // Apply numeric initial_state override onto the effective scenario's
  // initial_state. Merged AFTER profile overrides.
  if (initialState) {
    effectiveScenario = {
      ...effectiveScenario,
      initial_state: { ...effectiveScenario.initial_state, ...initialState },
    }
  }

  // Apply boolean context overrides (child_passenger, familiar_route).
  if (contextOverrides) {
    effectiveScenario = { ...effectiveScenario, ...contextOverrides }
  }

  if (validationErrors.length > 0) {
    // Return draft with errors but do NOT register it.
    return {
      draft: {
        plan_id: planId,
        package_id: pkg.id,
        scenario_id: scenario.id,
        // Python: route_facts if route_facts is not None else analyze_route(scenario)
        // — uses the ORIGINAL (pre-profile-override) scenario, not effectiveScenario.
        route_facts: routeFacts ?? analyzeRoute(scenario),
        effective_setup: {},
        draft_event_plan: defaultEventPlan(),
        validation_errors: validationErrors,
        route_source: 'local',
        display_route: null,
        profile_overrides: null,
      },
      package: pkg,
      scenario: effectiveScenario,
    }
  }

  // Build the draft (pure, deterministic) using the effective scenario.
  let draft: RunPlanDraft
  try {
    draft = buildDraft({
      planId,
      package: pkg,
      scenario: effectiveScenario,
      presets,
      parameters,
      hyperparameters,
      runMode,
      routeFacts,
      routeSource,
      displayRoute,
      profileOverrides: profiles ? profiles : null,
    })
  } catch (exc) {
    const planError: ValidationError[] = [
      { field: 'event_plan', message: `Failed to build event plan: ${exc instanceof Error ? exc.message : String(exc)}` },
    ]
    return {
      draft: {
        plan_id: planId,
        package_id: pkg.id,
        scenario_id: scenario.id,
        route_facts: routeFacts ?? analyzeRoute(scenario),
        effective_setup: {},
        draft_event_plan: defaultEventPlan(),
        validation_errors: planError,
        route_source: 'local',
        display_route: null,
        profile_overrides: null,
      },
      package: pkg,
      scenario: effectiveScenario,
    }
  }

  // Normalize the package and scenario for output to match Python's Pydantic
  // serialization (e.g. HyperparameterDef.band_values always present, even when
  // null; ScenarioDef adds rest_drowsiness_ceiling default and strips _comment).
  const normalizedPkg = normalizePackageForOutput(pkg)
  const normalizedScenario = normalizeScenarioForOutput(effectiveScenario)

  // Register the draft with the EFFECTIVE scenario (profile overrides frozen here).
  draftRegistry.set(planId, { draft, package: normalizedPkg, scenario: normalizedScenario })

  return { draft, package: normalizedPkg, scenario: normalizedScenario }
}

/**
 * Regenerate an existing draft with updated presets/parameters/hyperparameters.
 * Same plan_id, new draft_event_plan.
 *
 * Preserves route provenance (route_source, route_facts, display_route) from
 * the registered draft so that a regenerate does not silently flip a Maps
 * route back to local. Mirrors Python `regenerate_draft` exactly: for a
 * "maps" draft, `route_facts` is preserved (never re-derived); for a "local"
 * draft, `route_facts` is `null` so `buildDraft` calls `analyzeRoute(scenario)`
 * FRESH from the registered (effective) scenario on every regenerate — the
 * same behavior Python gets from `_build_draft`'s `if route_facts is None`
 * branch being re-entered each call.
 */
export function regenerateDraft(planId: string, patch: RegenerateDraftPatch): RunPlanDraft {
  const entry = draftRegistry.get(planId)
  if (!entry) {
    throw new Error(`Unknown plan_id ${pyRepr(planId)} — cannot regenerate.`)
  }
  const { draft: existingDraft, package: pkg, scenario } = entry

  const isMaps = existingDraft.route_source === 'maps'
  // Python: preserved_route_facts = existing_draft.route_facts if is_maps else None
  const preservedRouteFacts: RouteFacts | null = isMaps ? existingDraft.route_facts : null
  const preservedRouteSource = existingDraft.route_source
  const preservedDisplayRoute = isMaps ? existingDraft.display_route : null

  const validationErrors = validateEdits(pkg, patch.parameters, patch.hyperparameters)
  if (validationErrors.length > 0) {
    return {
      plan_id: planId,
      package_id: pkg.id,
      scenario_id: scenario.id,
      route_facts: preservedRouteFacts ?? analyzeRoute(scenario),
      effective_setup: {},
      draft_event_plan: defaultEventPlan(),
      validation_errors: validationErrors,
      route_source: preservedRouteSource,
      display_route: preservedDisplayRoute,
      profile_overrides: null,
    }
  }

  const runMode = (existingDraft.effective_setup['run_mode'] as string | undefined) ?? 'standard'

  let newDraft: RunPlanDraft
  try {
    newDraft = buildDraft({
      planId,
      package: pkg,
      scenario,
      presets: patch.presets,
      parameters: patch.parameters,
      hyperparameters: patch.hyperparameters,
      runMode,
      routeFacts: preservedRouteFacts,
      routeSource: preservedRouteSource,
      displayRoute: preservedDisplayRoute,
      profileOverrides: existingDraft.profile_overrides,
    })
  } catch (exc) {
    const planError: ValidationError[] = [
      { field: 'event_plan', message: `Failed to build event plan: ${exc instanceof Error ? exc.message : String(exc)}` },
    ]
    return {
      plan_id: planId,
      package_id: pkg.id,
      scenario_id: scenario.id,
      route_facts: preservedRouteFacts ?? analyzeRoute(scenario),
      effective_setup: {},
      draft_event_plan: defaultEventPlan(),
      validation_errors: planError,
      route_source: preservedRouteSource,
      display_route: preservedDisplayRoute,
      profile_overrides: null,
    }
  }

  draftRegistry.set(planId, { draft: newDraft, package: pkg, scenario })

  return newDraft
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/** Loose stand-in for Python's `!r` repr formatting used in validation messages. */
function pyRepr(value: unknown): string {
  if (typeof value === 'string') return `'${value}'`
  return String(value)
}

function pyReprList(values: unknown[]): string {
  return `[${values.map((v) => pyRepr(v)).join(', ')}]`
}

/** Loose stand-in for Python's `type(value).__name__` used in validation messages. */
function jsTypeName(value: unknown): string {
  if (value === null || value === undefined) return 'NoneType'
  if (typeof value === 'boolean') return 'bool'
  if (typeof value === 'number') return Number.isInteger(value) ? 'int' : 'float'
  if (typeof value === 'string') return 'str'
  if (Array.isArray(value)) return 'list'
  return 'dict'
}
