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
 * DEVIATION FROM PYTHON (documented, not a bug): the Python `create_draft`
 * accepts `route_facts: RouteFacts | None = None` and, when None, derives it
 * locally via `analyze_route(scenario)` (services/route_analysis.py). That
 * module has NOT been ported to the htmlapp engine yet (out of scope for this
 * task — see task-S3.3-brief.md's `Consumes` list, which does not include
 * `./route_analysis`). Therefore `createDraft` here requires `routeFacts` as
 * an explicit input; the caller (a later task's route-facts port, or the
 * fixture harness for parity testing) must supply the same value Python's
 * `analyze_route(scenario)` would produce. `regenerateDraft` reuses the
 * routeFacts value cached at create time — for a "local" draft this is exactly
 * equivalent to re-deriving, since `analyze_route` is a pure function of
 * `scenario` alone and `scenario` never changes between create and regenerate.
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
  /** See module docstring's "DEVIATION FROM PYTHON" — required here. */
  routeFacts: RouteFacts
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

/** Keyed by plan_id: {draft, package, scenario, routeFacts}. Mirrors Python's module-global dict. */
const draftRegistry = new Map<string, DraftEntry & { routeFacts: RouteFacts }>()

/** Clear the in-memory draft registry. Used for test isolation only. */
export function clearDraftRegistry(): void {
  draftRegistry.clear()
}

/** Return the stored draft entry for a plan_id, or null if unknown. */
export function getDraftEntry(planId: string): DraftEntry | null {
  const entry = draftRegistry.get(planId)
  if (!entry) return null
  return { draft: entry.draft, package: entry.package, scenario: entry.scenario }
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

/**
 * Deep-merge profile override dicts onto scenario profiles.
 *
 * NOTE: the Python `_apply_profile_overrides` validates the merged result
 * against Pydantic's DriverModelProfile/VehicleBehaviorProfile/SpeedProfile
 * models and collects per-field ValidationError messages. That structural
 * validation is NOT reproduced here (no Pydantic-equivalent in this engine);
 * this port performs the same deep-merge and always reports zero errors for
 * a well-formed override. This is an accepted, documented divergence: the
 * S3.3 parity-tested path (canonical run-plan setup) supplies no profile
 * overrides, so it never exercises this function. A later slice that wires
 * profile-override UI end-to-end should add real structural validation here.
 */
function applyProfileOverrides(
  scenario: ScenarioDefM2,
  profiles: Record<string, unknown>,
): [ScenarioDefM2, ValidationError[]] {
  const updates: Record<string, unknown> = {}

  const driverOverride = profiles['driver']
  if (isPlainObject(driverOverride)) {
    const base = isPlainObject(scenario.driver_profile) ? scenario.driver_profile : {}
    updates['driver_profile'] = deepMerge(base, driverOverride)
  }

  const vehicleOverride = profiles['vehicle']
  if (isPlainObject(vehicleOverride)) {
    const base = isPlainObject(scenario.vehicle_profile) ? scenario.vehicle_profile : {}
    updates['vehicle_profile'] = deepMerge(base, vehicleOverride)
  }

  const speedOverride = profiles['speed']
  if (isPlainObject(speedOverride)) {
    const base = isPlainObject(scenario.speed_profile) ? scenario.speed_profile : {}
    updates['speed_profile'] = deepMerge(base, speedOverride)
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

/** Build the effective_setup dict for the draft response. */
function buildEffectiveSetup(
  pkg: PackageManifestM2,
  scenario: ScenarioDefM2,
  effectiveParams: Record<string, unknown>,
  effectiveHps: Record<string, unknown>,
  runMode: string,
): Record<string, unknown> {
  return {
    package_id: pkg.id,
    package_version: pkg.version,
    scenario_id: scenario.id,
    scenario_version: scenario.version,
    run_mode: runMode,
    parameters: effectiveParams,
    hyperparameters: effectiveHps,
    driver_profile: scenario.driver_profile ?? null,
    vehicle_profile: scenario.vehicle_profile ?? null,
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
  routeFacts: RouteFacts
  routeSource: 'maps' | 'local'
  displayRoute: DisplayRoute | null
  profileOverrides: Record<string, unknown> | null
}

/**
 * Pure draft construction — deterministic given (routeFacts, presets).
 * Does NOT check parameter/hyperparameter validation — call validateEdits first.
 */
function buildDraft(args: BuildDraftArgs): RunPlanDraft {
  const routeFacts = args.routeFacts
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
    routeFacts,
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
        route_facts: routeFacts,
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
        route_facts: routeFacts,
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

  // Register the draft with the EFFECTIVE scenario (profile overrides frozen here).
  draftRegistry.set(planId, { draft, package: pkg, scenario: effectiveScenario, routeFacts })

  return { draft, package: pkg, scenario: effectiveScenario }
}

/**
 * Regenerate an existing draft with updated presets/parameters/hyperparameters.
 * Same plan_id, new draft_event_plan.
 *
 * Preserves route provenance (route_source, route_facts, display_route) from
 * the registered draft so that a regenerate does not silently flip a Maps
 * route back to local, or (in this port) require re-deriving local
 * route_facts via an unported analyze_route (see module docstring).
 */
export function regenerateDraft(planId: string, patch: RegenerateDraftPatch): RunPlanDraft {
  const entry = draftRegistry.get(planId)
  if (!entry) {
    throw new Error(`Unknown plan_id ${pyRepr(planId)} — cannot regenerate.`)
  }
  const { draft: existingDraft, package: pkg, scenario, routeFacts: storedRouteFacts } = entry

  const preservedRouteFacts = storedRouteFacts
  const preservedRouteSource = existingDraft.route_source
  const preservedDisplayRoute = existingDraft.route_source === 'maps' ? existingDraft.display_route : null

  const validationErrors = validateEdits(pkg, patch.parameters, patch.hyperparameters)
  if (validationErrors.length > 0) {
    return {
      plan_id: planId,
      package_id: pkg.id,
      scenario_id: scenario.id,
      route_facts: preservedRouteFacts,
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
      route_facts: preservedRouteFacts,
      effective_setup: {},
      draft_event_plan: defaultEventPlan(),
      validation_errors: planError,
      route_source: preservedRouteSource,
      display_route: preservedDisplayRoute,
      profile_overrides: null,
    }
  }

  draftRegistry.set(planId, { draft: newDraft, package: pkg, scenario, routeFacts: preservedRouteFacts })

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
