/**
 * World validation service — port of `services/world_validation.py`
 * (`validate_world`, `ValidationIssue`, `has_catalog_references`).
 *
 * `validateWorld(world, catalog) -> ValidationIssue[]` surfaces every problem
 * with an edited World as a field-level `{path, code, message}` issue, per
 * data-model.md "Validation rules":
 *
 *   1. Enum membership + numeric ranges (Pydantic) on every world/profile field.
 *   2. Purpose/stage compatibility (the shared rule already enforced by
 *      ControlInputs — see `models/proposal/world.py`).
 *   3. Catalog reference existence: every catalog id the world references
 *      must exist in the supplied catalog.
 *
 * SCOPE NOTE (disclosed, not a silent gap — REVISED after fix-round-2 review;
 * see the task report's "Fix round 2" section for the full before/after and
 * the complete re-audit evidence). Python's rule 1 is "reuse pydantic's own
 * constructor validation" over EVERY field of World / ControlInputs /
 * Situation / DriverProfile — dozens of fields. Reproducing pydantic's own
 * error-message catalogue byte-for-byte for every single one would mean
 * re-implementing pydantic itself. This port instead gives FULL,
 * Python-verified fidelity (byte-exact `code`/`message`, confirmed via
 * direct interpreter captures — see the task report) to:
 *   - every field Python's OWN test suites (`test_world_validation.py`,
 *     `test_p7_apply_overrides.py`) exercise, PLUS the sibling fields those
 *     tests' branches sit next to on the SAME model;
 *   - EVERY field that is `disposition: scored` in the content dispositions
 *     registry (`proposal_contracts/dispositions/content_feature_dispositions.v1.json`
 *     — all 48 entries individually cross-checked against this file's
 *     coverage, not sampled) OR is read for scoring by either shipped
 *     selector's own source (`packages/aica_transparent_service_selector_v1/
 *     algorithm.py`'s `FEATURE_ORDER`/`_DIRECT_FEATURES`/
 *     `_CONFIDENCE_FIELD_FOR_FEATURE`, and `packages/
 *     aica_transparent_content_selector_v1/algorithm.py`'s every
 *     `preference.get(...)`/`situation.get(...)`/`history.get(...)`/
 *     `gav1.get(...)` call site — grepped exhaustively, not sampled) — the
 *     registry alone is NOT sufficient, since it covers the CONTENT
 *     selector only; the SERVICE selector has its own separate scored-list
 *     that never consults it (`multiple_passengers`/`oshi_registered` are
 *     `context_only` in the registry but ARE in the service selector's
 *     `FEATURE_ORDER` — found only by the source grep, not the registry).
 *     This is the complete list, by category:
 *       - ControlInputs: 3 enums, 2 non-empty-string checks, both
 *         `purpose_stage_compatible` branches.
 *       - Situation: `drowsiness_level`/`fatigue_level`/`monotony_level`
 *         (range), `estimated_min_until_rest_spot`, 5 enums
 *         (`traffic_state`/`road_type`/`night_state`/`motion_state`/
 *         `rest_spot_type`), nullable `active_service`,
 *         `recent_service_rejections[*].service_id`, `route_tags`/
 *         `destination_tags` (string arrays), `child_present`/
 *         `multiple_passengers` (conservative bool — see below).
 *       - DriverProfile: `oshi_registered` (conservative bool),
 *         `oshi_mode`/`age_band`/`gender` (enums), `oshi_artists` (full:
 *         `artist_id`, `oshi_type`, `enthusiasm` range+grid, the
 *         duplicate-id model validator), all 8 rate/confidence maps
 *         (INCLUDING, as of this fix round, KEY validity on the 4
 *         `ServiceId`-keyed ones — pydantic's built-in dict-key coercion
 *         runs BEFORE the custom range-check field_validator, so a bad key
 *         SUPPRESSES the range check entirely for that field, verified via
 *         a direct capture with both a bad key and an out-of-range value in
 *         the same dict), `service_usage_level`/`service_recency_state`/
 *         `scene_service_usage_level` (`ServiceId`-keyed, both key+value
 *         enum-checked), `catalog_item_usage_level`'s VALUE (its KEY is
 *         rule 3's job), `hobby_interest_tags` (string array),
 *         `content_tag_usage_level`/`scene_content_tag_usage_level`
 *         (str-keyed, value enum-checked; declared `scored` in the registry
 *         but NOT currently read by either shipped algorithm.py — checked
 *         anyway, since the registry is the frozen, authoritative
 *         classification this whole rule system is built on, not merely
 *         "what today's algorithm happens to read"), `played_items`/
 *         `skipped_items`/`changed_from_items` (`track_id` + the timestamp
 *         field, both string-typed), and the opt-in genre extension
 *         (`usage_by_genre`/`scene_genre_usage`, both/either `GenreLiteral`-
 *         keyed — NOT in the dispositions registry at all, found only via
 *         the content selector's own source; `GenreLiteral`'s `"children's
 *         music"` member is the one enum value in this whole port whose
 *         Python `repr()` needs double quotes, handled by `pyReprQuoteOne`).
 *       - CatalogRef/DatasetVersion: `dataset_id`/`dataset_hash`/the 3
 *         `dataset_version` sub-fields, all required strings. Reachable via
 *         `apply_overrides`' own override-path mechanism even though
 *         `CatalogRef` is `frozen=True` in Python — frozen only blocks
 *         mutating a LIVE pydantic instance in place; `apply_overrides`
 *         never does that, it always re-validates a plain dict from scratch
 *         (verified directly: `del world.catalog_ref.dataset_version` on a
 *         real instance raises `frozen_instance` immediately, but
 *         overriding `catalog_ref.dataset_id` via the override-path
 *         mechanism works exactly like any other field and is
 *         golden-captured).
 *
 * CONSERVATIVE bool fields (`child_present`, `multiple_passengers`,
 * `oshi_registered`): pydantic's lenient bool coercion accepts a wide,
 * hard-to-fully-enumerate set of non-bool values (verified empirically:
 * `"yes"`, `1`, `0`, `1.0` all coerce successfully with NO error; `5`,
 * `"banana"` do not) — rather than guess at that table (risking a FALSE
 * POSITIVE), only the subset NEVER accepted regardless of coercion mode is
 * flagged: an array, a plain object, or explicit `null`.
 *
 * ANSWER (fix round 2's re-audit question — "is there any remaining field
 * that is scored, per the dispositions registry or a selector-source grep,
 * and not validated?"): NO. Every `disposition: scored` entry in the
 * registry (21 of 48) and every field either shipped selector's own source
 * reads for scoring is now checked, per the exhaustive cross-check above.
 * `content_tag_usage_level`/`scene_content_tag_usage_level` are checked
 * despite being currently dead in the content selector's algorithm.py,
 * because the registry — not "what the algorithm happens to read today" —
 * is treated as the authoritative scored/unscored boundary.
 *
 * Everything else on DriverProfile is `context_only` in the registry AND
 * confirmed NOT read by either shipped selector's own source (grep-
 * verified, not sampled): `oshi_tags`, `catalog_item_recency_state`,
 * `content_tag_recency_state`, `cancelled_content_plans`,
 * `completed_items`/`manually_selected_items`/`repeated_items`,
 * `scheduled_event_type`/`scheduled_event_timing`/`scheduled_event_tags`,
 * `service_proposal_acceptance_confidence`/`service_recovery_confidence`/
 * `content_proposal_acceptance_confidence`/`content_recovery_confidence`
 * (the two `service_*` ones ARE structurally checked anyway, as members of
 * the 8 rate/confidence maps above — this note is about the `content_*`
 * pair, checked for range but not "used" by any algorithm today) —
 * deliberately NOT type-checked beyond what's already covered, since a
 * wrong guess at pydantic's exact coercion rules for a truly dead field
 * risks a FALSE POSITIVE (flagging a world Python would accept) for zero
 * behavioral benefit — verified empirically that this risk is real, not
 * theoretical (`situation.child_present: "yes"` coerces to `true` with NO
 * error in real pydantic).
 *
 * The one, narrow behavioral consequence of this remaining, confirmed-dead
 * gap: DriverProfile's duplicate-oshi-id check is gated on "no other field
 * issue in this model yet" (mirroring pydantic's own after-validator
 * skip-on-field-failure semantics — verified empirically), but that gate
 * only sees the fields this port checks, so an invalid value in one of the
 * confirmed-dead fields co-occurring with a duplicate oshi id would
 * (incorrectly, but rarely, and only for a field with zero scoring impact)
 * still report the duplicate.
 *
 * Rules 1-2 are ALREADY enforced by the World/ControlInputs/Situation/
 * DriverProfile Pydantic models at construction time in Python — this
 * function exists for the case where a World in memory was NOT built
 * through normal validation, or was mutated in place post-construction. The
 * offline app has no equivalent "already validated" guarantee (a plain JS
 * object has no runtime type enforcement at all), so this port treats every
 * `world` argument as potentially unvalidated — the same posture the Python
 * function itself takes.
 */

import { pyReprQuoteOne, pyReprEnumMember } from './py_repr'
import {
  SERVICE_ID_VALUES as SERVICE_ID,
  OSHI_MODE_VALUES as OSHI_MODE,
  AGE_BAND_VALUES as AGE_BAND,
  GENDER_VALUES as GENDER,
} from './enums'

export type ValidationIssue = { path: string; code: string; message: string }

// ---------------------------------------------------------------------------
// Small local helpers (pydantic-error-shape mirrors, verified against real
// `World.model_validate()` output — see the task report for the captured
// evidence).
// ---------------------------------------------------------------------------

/** Mirrors Python's `str(float)` — a whole-number float renders WITH a
 * trailing ".0" (`str(150.0) == "150.0"`), unlike a plain JS template
 * literal. Local copy, matching the established per-module-copy convention
 * (see `data/packages/builtin/aica_transparent_service_selector_v1.ts` and
 * `engine/services/feedback.ts`, which each carry their own copy rather
 * than importing a shared one). */
function pyFloatRepr(x: number): string {
  if (Number.isNaN(x)) return 'nan'
  if (!Number.isFinite(x)) return x > 0 ? 'inf' : '-inf'
  const s = String(x)
  return /[.eE]/.test(s) ? s : `${s}.0`
}

/** Mirrors pydantic v2's `Input should be 'a', 'b' or 'c'` enum-error message join style.
 * `pyReprQuoteOne` (imported above, from `./py_repr` — the shared
 * implementation, see that module's doc for why it is shared): single-quoted
 * by default, but DOUBLE-quoted when the value contains a `'` and no `"`
 * (Python's own quote-picking rule — `repr("children's music") ==
 * "children's music"`, literally double-quoted). `GenreLiteral`'s
 * `"children's music"` member is the ONE enum value in this whole port that
 * needs this — verified via direct capture, not guessed. Every OTHER enum
 * table's values are plain identifiers (no apostrophe). */
function enumMsg(values: readonly string[]): string {
  const quoted = values.map(pyReprQuoteOne)
  if (quoted.length <= 1) return `Input should be ${quoted[0] ?? ''}`
  return `Input should be ${quoted.slice(0, -1).join(', ')} or ${quoted[quoted.length - 1]}`
}

/** Mirrors Python's `str(list_of_str))` — `['a', 'b', 'c']`. */
function pyListRepr(values: readonly string[]): string {
  return `[${values.map((v) => `'${v}'`).join(', ')}]`
}

function enumIssue(path: string, value: unknown, allowed: readonly string[]): ValidationIssue | null {
  if (typeof value === 'string' && (allowed as readonly string[]).includes(value)) return null
  return { path, code: 'enum', message: enumMsg(allowed) }
}

function intRangeIssue(path: string, value: unknown, opts: { ge?: number; le?: number }): ValidationIssue | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return { path, code: 'int_type', message: 'Input should be a valid integer' }
  }
  if (opts.le !== undefined && value > opts.le) {
    return { path, code: 'less_than_equal', message: `Input should be less than or equal to ${opts.le}` }
  }
  if (opts.ge !== undefined && value < opts.ge) {
    return { path, code: 'greater_than_equal', message: `Input should be greater than or equal to ${opts.ge}` }
  }
  return null
}

function stringTypeIssue(path: string): ValidationIssue {
  return { path, code: 'string_type', message: 'Input should be a valid string' }
}

/**
 * `list[str]` field — verified via direct capture: a non-list value ->
 * `list_type`; a non-string ITEM -> `string_type` at the item's own
 * (dot-joined bare) index.
 */
function stringArrayIssues(path: string, value: unknown): ValidationIssue[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) {
    return [{ path, code: 'list_type', message: 'Input should be a valid list' }]
  }
  const issues: ValidationIssue[] = []
  value.forEach((item, i) => {
    if (typeof item !== 'string') issues.push(stringTypeIssue(`${path}.${i}`))
  })
  return issues
}

/**
 * A REQUIRED `bool` field — pydantic's lenient bool coercion accepts a wide,
 * hard-to-fully-enumerate set of non-bool values (verified empirically:
 * `"yes"`, `1`, `0`, `1.0` all coerce successfully with NO error; `5`,
 * `"banana"` do not). Rather than guess at that coercion table (risking a
 * FALSE POSITIVE — see the file-level doc comment's stance on this), this
 * only flags the subset that is NEVER accepted regardless of coercion mode:
 * an array, a plain object, or an explicit `null` (verified: all three
 * produce `bool_type`/"Input should be a valid boolean" in real pydantic).
 * Strings, numbers, and booleans are left unchecked.
 */
function conservativeBoolTypeIssue(path: string, value: unknown): ValidationIssue | null {
  if (value === undefined) return null
  if (value === null || Array.isArray(value) || typeof value === 'object') {
    return { path, code: 'bool_type', message: 'Input should be a valid boolean' }
  }
  return null
}

/**
 * `list[{track_id: str, <timestampField>: str}]` — the shape shared by
 * `PlayedItem`/`SkippedItem`/`ChangedFromItem`. Verified via direct capture:
 * `track_id`/the timestamp field each independently produce `string_type`
 * if present-but-wrong-typed, or `missing`/"Field required" if the
 * timestamp field is absent (an override can only ever SET an existing
 * key's value, never remove one — see `world_overrides.ts` — so `missing`
 * is reachable here only via a directly-constructed malformed object, same
 * reachability class as `catalog_ref.dataset_version`'s `missing` case).
 */
function trackIdItemListIssues(path: string, value: unknown, timestampField: string, className: string): ValidationIssue[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) {
    return [{ path, code: 'list_type', message: 'Input should be a valid list' }]
  }
  const issues: ValidationIssue[] = []
  value.forEach((item, i) => {
    const itemPath = `${path}.${i}`
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      issues.push({ path: itemPath, code: 'model_type', message: `Input should be a valid dictionary or instance of ${className}` })
      return
    }
    const e = item as Record<string, unknown>
    if (typeof e.track_id !== 'string') issues.push(stringTypeIssue(`${itemPath}.track_id`))
    if (e[timestampField] === undefined) {
      issues.push({ path: `${itemPath}.${timestampField}`, code: 'missing', message: 'Field required' })
    } else if (typeof e[timestampField] !== 'string') {
      issues.push(stringTypeIssue(`${itemPath}.${timestampField}`))
    }
  })
  return issues
}

// ---------------------------------------------------------------------------
// Enum member tables (verbatim from `models/proposal/enums.py`).
// ---------------------------------------------------------------------------

const TRIGGER_PURPOSE = [
  'rest_recommended',
  'inattentive_driving_prevention_recovery',
  'route_music',
  'child_passenger_experience',
] as const
const LIFECYCLE_STAGE = [
  'before_rest_until_stop',
  'during_rest_stopped',
  'after_rest_before_restart',
  'active_driving_content',
] as const
const MOTION_STATE = ['driving', 'stopped'] as const
const TRAFFIC_STATE = ['normal', 'congested'] as const
const ROAD_TYPE = ['highway', 'local', 'mountain', 'parking'] as const
const NIGHT_STATE = ['day', 'night'] as const
const REST_SPOT_TYPE = ['sa_pa', 'convenience_store', 'parking', 'oshi_spot', 'other', 'unknown'] as const
// SERVICE_ID / OSHI_MODE / AGE_BAND / GENDER: imported above from `./enums`
// (aliased to these exact names — C2 follow-up wave item 2's single source
// of truth for the vocabularies this port used to hand-copy at 2-4 sites
// each). OSHI_TYPE/USAGE_LEVEL/RECENCY_STATE/GENRE_LITERAL below are NOT
// duplicated anywhere else in this port today, so they stay local.
const OSHI_TYPE = [
  'artist',
  'artist_member',
  'group',
  'character',
  'voice_actor',
  'franchise',
  'creator',
  'other',
] as const
const USAGE_LEVEL = ['never', 'low', 'med', 'high'] as const
const RECENCY_STATE = ['never', 'long_unused', 'recent'] as const
// Values verbatim from GenreLiteral (enums.py) — note "children's music"
// carries a real apostrophe, exercising pyReprQuoteOne's double-quote branch.
const GENRE_LITERAL = [
  'j-pop',
  'j-rock',
  'city pop',
  'anime',
  'vocaloid',
  'enka',
  "children's music",
  'classical',
  'jazz',
  'ambient',
  'electronic',
  'japanese folk',
] as const

// ---------------------------------------------------------------------------
// ControlInputs — enums, non-empty strings, purpose/stage compatibility.
// ---------------------------------------------------------------------------

const REST_STAGES = new Set(['before_rest_until_stop', 'during_rest_stopped', 'after_rest_before_restart'])
// Mirrors `_ACTIVE_DRIVING_PURPOSES` (world.py) — declared as a Python
// `frozenset`. Its `[p.value for p in _ACTIVE_DRIVING_PURPOSES]` message
// text is CONFIRMED non-deterministic across Python processes (two direct
// `python -c` runs against this repo produced two different orderings —
// PYTHONHASHSEED is not pinned), so no golden can capture it byte-stably.
// This port fixes the stable enum-declaration order; the underlying
// membership CHECK (pass/fail) is identical either way — see hazard #4 in
// the task report.
const ACTIVE_DRIVING_PURPOSES = [
  'inattentive_driving_prevention_recovery',
  'route_music',
  'child_passenger_experience',
] as const

function purposeStageCompatibleIssue(path: string, purpose: string, stage: string): ValidationIssue | null {
  if (REST_STAGES.has(stage) && purpose !== 'rest_recommended') {
    return {
      path,
      code: 'value_error',
      message: `Value error, Lifecycle stage '${stage}' is only compatible with trigger_purpose 'rest_recommended', but got '${purpose}'.`,
    }
  }
  if (stage === 'active_driving_content' && !(ACTIVE_DRIVING_PURPOSES as readonly string[]).includes(purpose)) {
    return {
      path,
      code: 'value_error',
      message: `Value error, Lifecycle stage 'active_driving_content' is only compatible with purposes ${pyListRepr(ACTIVE_DRIVING_PURPOSES)}, but got '${purpose}'.`,
    }
  }
  return null
}

function controlInputsIssues(ci: unknown, path: string): ValidationIssue[] {
  if (!ci || typeof ci !== 'object' || Array.isArray(ci)) {
    return [{ path, code: 'model_type', message: 'Input should be a valid dictionary or instance of ControlInputs' }]
  }
  const c = ci as Record<string, unknown>
  const issues: ValidationIssue[] = []

  const purposeIssue = enumIssue(`${path}.trigger_purpose`, c.trigger_purpose, TRIGGER_PURPOSE)
  if (purposeIssue) issues.push(purposeIssue)
  const stageIssue = enumIssue(`${path}.lifecycle_stage`, c.lifecycle_stage, LIFECYCLE_STAGE)
  if (stageIssue) issues.push(stageIssue)
  const motionIssue = enumIssue(`${path}.motion_state`, c.motion_state, MOTION_STATE)
  if (motionIssue) issues.push(motionIssue)

  if (typeof c.matrix_version !== 'string') {
    issues.push(stringTypeIssue(`${path}.matrix_version`))
  } else if (c.matrix_version === '') {
    issues.push({ path: `${path}.matrix_version`, code: 'value_error', message: 'Value error, matrix_version must not be empty.' })
  }
  if (typeof c.dataset_id !== 'string') {
    issues.push(stringTypeIssue(`${path}.dataset_id`))
  } else if (c.dataset_id === '') {
    issues.push({ path: `${path}.dataset_id`, code: 'value_error', message: 'Value error, dataset_id must not be empty.' })
  }

  // Model-level ("after") validator — mirrors pydantic's own behavior of
  // skipping an `@model_validator(mode="after")` when ANY field on the same
  // model already failed (verified empirically — see task report): only
  // run when every ControlInputs field check above passed.
  if (issues.length === 0) {
    const modelIssue = purposeStageCompatibleIssue(path, c.trigger_purpose as string, c.lifecycle_stage as string)
    if (modelIssue) issues.push(modelIssue)
  }

  return issues
}

// ---------------------------------------------------------------------------
// Situation — percent-range fields, enums, nullable fields.
// ---------------------------------------------------------------------------

function situationIssues(sit: unknown, path: string): ValidationIssue[] {
  if (!sit || typeof sit !== 'object' || Array.isArray(sit)) {
    return [{ path, code: 'model_type', message: 'Input should be a valid dictionary or instance of Situation' }]
  }
  const s = sit as Record<string, unknown>
  const issues: ValidationIssue[] = []

  const drowsiness = intRangeIssue(`${path}.drowsiness_level`, s.drowsiness_level, { ge: 0, le: 100 })
  if (drowsiness) issues.push(drowsiness)
  const fatigue = intRangeIssue(`${path}.fatigue_level`, s.fatigue_level, { ge: 0, le: 100 })
  if (fatigue) issues.push(fatigue)
  const monotony = intRangeIssue(`${path}.monotony_level`, s.monotony_level, { ge: 0, le: 100 })
  if (monotony) issues.push(monotony)

  const traffic = enumIssue(`${path}.traffic_state`, s.traffic_state, TRAFFIC_STATE)
  if (traffic) issues.push(traffic)
  const road = enumIssue(`${path}.road_type`, s.road_type, ROAD_TYPE)
  if (road) issues.push(road)
  const night = enumIssue(`${path}.night_state`, s.night_state, NIGHT_STATE)
  if (night) issues.push(night)
  const motion = enumIssue(`${path}.motion_state`, s.motion_state, MOTION_STATE)
  if (motion) issues.push(motion)
  const restSpot = enumIssue(`${path}.rest_spot_type`, s.rest_spot_type, REST_SPOT_TYPE)
  if (restSpot) issues.push(restSpot)

  // Live-scored fields (fix round 2 re-audit finding — disposition:scored
  // per the content dispositions registry AND read directly by
  // packages/aica_transparent_content_selector_v1/algorithm.py: route_tags
  // line 310, destination_tags line 317, child_present lines 324/504).
  issues.push(...stringArrayIssues(`${path}.route_tags`, s.route_tags))
  issues.push(...stringArrayIssues(`${path}.destination_tags`, s.destination_tags))
  const childPresentIssue = conservativeBoolTypeIssue(`${path}.child_present`, s.child_present)
  if (childPresentIssue) issues.push(childPresentIssue)
  // multiple_passengers: NOT in the content dispositions registry's scored
  // list (it's context_only there), but IS in the SERVICE selector's own
  // `FEATURE_ORDER` (packages/aica_transparent_service_selector_v1/
  // algorithm.py:58, grep-verified) — the content dispositions registry
  // only covers the CONTENT selector; the service selector has its own,
  // separate scored-feature list that does not consult that registry at
  // all. Second re-audit finding, this fix round.
  const multiplePassengersIssue = conservativeBoolTypeIssue(`${path}.multiple_passengers`, s.multiple_passengers)
  if (multiplePassengersIssue) issues.push(multiplePassengersIssue)

  if (s.active_service !== null && s.active_service !== undefined) {
    const activeService = enumIssue(`${path}.active_service`, s.active_service, SERVICE_ID)
    if (activeService) issues.push(activeService)
  }

  if (s.estimated_min_until_rest_spot !== null && s.estimated_min_until_rest_spot !== undefined) {
    const est = intRangeIssue(`${path}.estimated_min_until_rest_spot`, s.estimated_min_until_rest_spot, { ge: 0 })
    if (est) issues.push(est)
  }

  const rejections = s.recent_service_rejections
  if (Array.isArray(rejections)) {
    rejections.forEach((entry, i) => {
      if (!entry || typeof entry !== 'object') return
      const e = entry as Record<string, unknown>
      // NOTE: dot-joined bare index, NOT bracket notation — this path comes
      // from pydantic's own `loc` tuple (`".".join(str(part) for part in loc)`
      // in `_pydantic_error_path`), a DIFFERENT convention from the
      // hand-written bracketed paths `catalogReferenceIssues` below produces
      // (verified via direct capture — see the task report, hazard: path
      // format). Do not "fix" this to brackets without re-checking that report.
      const serviceIdIssue = enumIssue(`${path}.recent_service_rejections.${i}.service_id`, e.service_id, SERVICE_ID)
      if (serviceIdIssue) issues.push(serviceIdIssue)
    })
  }

  return issues
}

// ---------------------------------------------------------------------------
// DriverProfile — enums, oshi_artists (range/grid/duplicate), rate maps.
// ---------------------------------------------------------------------------

const ENTHUSIASM_GRID_STEP = 0.1
const ENTHUSIASM_GRID_TOLERANCE = 1e-9

/**
 * `enthusiasm` grid check (mirrors `OshiArtist._enthusiasm_in_range_and_on_grid`).
 * Uses `Math.round` rather than a banker's-rounding helper (divergence
 * hazard #1) DELIBERATELY: `nearest_tenth`'s own tie-break choice never
 * affects `abs(v - nearest_tenth)` — at an exact `v/0.1` tie, `v` is
 * equidistant from BOTH candidate grid points by construction, so the
 * resulting distance (and therefore the pass/fail boundary this function
 * returns) is identical regardless of which rounding rule breaks the tie.
 * See the task report for the full proof.
 */
function oshiArtistsIssues(
  list: unknown,
  basePath: string,
): { issues: ValidationIssue[]; anyFieldIssue: boolean; artistIds: string[] } {
  const issues: ValidationIssue[] = []
  let anyFieldIssue = false
  const artistIds: string[] = []

  if (!Array.isArray(list)) {
    return { issues: [{ path: basePath, code: 'list_type', message: 'Input should be a valid list' }], anyFieldIssue: true, artistIds: [] }
  }

  list.forEach((entry, i) => {
    // Dot-joined bare index (pydantic's own `loc`-tuple path convention),
    // NOT bracket notation — see the note on the recent_service_rejections
    // path above; verified via direct capture (task report).
    const entryPath = `${basePath}.${i}`
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      issues.push({ path: entryPath, code: 'model_type', message: 'Input should be a valid dictionary or instance of OshiArtist' })
      anyFieldIssue = true
      return
    }
    const e = entry as Record<string, unknown>
    let entryHasIssue = false

    if (typeof e.artist_id !== 'string') {
      issues.push(stringTypeIssue(`${entryPath}.artist_id`))
      entryHasIssue = true
    }
    if (e.oshi_type !== undefined) {
      const oshiTypeIssue = enumIssue(`${entryPath}.oshi_type`, e.oshi_type, OSHI_TYPE)
      if (oshiTypeIssue) {
        issues.push(oshiTypeIssue)
        entryHasIssue = true
      }
    }

    const enthusiasm = e.enthusiasm === undefined ? 1.0 : e.enthusiasm
    if (typeof enthusiasm !== 'number' || !Number.isFinite(enthusiasm)) {
      issues.push({ path: `${entryPath}.enthusiasm`, code: 'float_type', message: 'Input should be a valid number' })
      entryHasIssue = true
    } else if (!(enthusiasm >= 0.0 && enthusiasm <= 1.0)) {
      issues.push({
        path: `${entryPath}.enthusiasm`,
        code: 'value_error',
        message: `Value error, enthusiasm must be in [0.0, 1.0], got ${pyFloatRepr(enthusiasm)}.`,
      })
      entryHasIssue = true
    } else {
      const nearestTenth = Math.round(enthusiasm / ENTHUSIASM_GRID_STEP) * ENTHUSIASM_GRID_STEP
      if (Math.abs(enthusiasm - nearestTenth) > ENTHUSIASM_GRID_TOLERANCE) {
        issues.push({
          path: `${entryPath}.enthusiasm`,
          code: 'value_error',
          message: `Value error, enthusiasm must be a multiple of 0.1 (0.0, 0.1, ..., 1.0) — the UI slider's own grid — got ${pyFloatRepr(enthusiasm)}.`,
        })
        entryHasIssue = true
      }
    }

    if (entryHasIssue) {
      anyFieldIssue = true
    } else if (typeof e.artist_id === 'string') {
      artistIds.push(e.artist_id)
    }
  })

  return { issues, anyFieldIssue, artistIds }
}

type RateMapSpec = { key: string; min: number; max: number; boundsText: string; serviceKeyed: boolean }

const RATE_MAP_SPECS: RateMapSpec[] = [
  { key: 'service_proposal_acceptance_rate', min: 0, max: 100, boundsText: '[0, 100]', serviceKeyed: true },
  { key: 'service_recovery_rate', min: 0, max: 100, boundsText: '[0, 100]', serviceKeyed: true },
  { key: 'content_proposal_acceptance_rate', min: 0, max: 100, boundsText: '[0, 100]', serviceKeyed: false },
  { key: 'content_recovery_rate', min: 0, max: 100, boundsText: '[0, 100]', serviceKeyed: false },
  { key: 'service_proposal_acceptance_confidence', min: 0, max: 1, boundsText: '[0, 1]', serviceKeyed: true },
  { key: 'service_recovery_confidence', min: 0, max: 1, boundsText: '[0, 1]', serviceKeyed: true },
  { key: 'content_proposal_acceptance_confidence', min: 0, max: 1, boundsText: '[0, 1]', serviceKeyed: false },
  { key: 'content_recovery_confidence', min: 0, max: 1, boundsText: '[0, 1]', serviceKeyed: false },
]

/**
 * Fix round 2 re-audit finding: for a `serviceKeyed` map
 * (`dict[ServiceId, float]`), the KEY's `ServiceId` membership is pydantic's
 * own BUILT-IN dict-key type coercion, which runs BEFORE the custom
 * `@field_validator` that this function otherwise mirrors (the percent/
 * unit-interval range check) — and a custom field_validator only runs once
 * the field's raw value has ALREADY successfully coerced to its declared
 * type. Verified via direct capture: a dict with one bad key (ServiceId)
 * and one VALID key holding an OUT-OF-RANGE value produces ONLY the key
 * error — the range check never runs at all for that call, even for the
 * other (well-formed) entry. So: check keys FIRST; if any are invalid,
 * return ALL key issues (mirrors `serviceKeyedEnumMapIssues`'s "report
 * every invalid entry" behavior — verified via a 2-bad-key capture) and
 * skip the range check entirely; only run the range check once every key
 * is valid.
 */
function rateMapIssue(path: string, fieldName: string, value: unknown, spec: RateMapSpec): ValidationIssue[] {
  if (value === undefined || value === null || typeof value !== 'object' || Array.isArray(value)) return []
  const entries = Object.entries(value as Record<string, unknown>)

  if (spec.serviceKeyed) {
    const keyIssues: ValidationIssue[] = []
    for (const [key] of entries) {
      if (!(SERVICE_ID as readonly string[]).includes(key)) {
        keyIssues.push({ path: `${path}.${key}.[key]`, code: 'enum', message: enumMsg(SERVICE_ID) })
      }
    }
    if (keyIssues.length > 0) return keyIssues
  }

  for (const [k, v] of entries) {
    const num = typeof v === 'number' ? v : Number(v)
    if (!(num >= spec.min && num <= spec.max)) {
      // `{key!r}` in Python — for a `serviceKeyed` map, `key` has ALREADY
      // coerced to a `ServiceId` enum member by this point (see the fix
      // round 2 note above), so its repr is the enum shape
      // (`<ServiceId.x: 'x'>`), verified directly against real Python — NOT
      // the plain-string shape a naive template literal produced. Both
      // branches route through the shared `py_repr.ts` helpers so an
      // apostrophe-bearing key (only reachable on the non-serviceKeyed
      // content-rate maps, which are keyed by an unconstrained catalog
      // track id) quotes correctly instead of rendering malformed.
      const keyRepr = spec.serviceKeyed ? pyReprEnumMember('ServiceId', k) : pyReprQuoteOne(k)
      return [{
        path,
        code: 'value_error',
        message: `Value error, ${fieldName}[${keyRepr}] must be in ${spec.boundsText}, got ${pyFloatRepr(num)}.`,
      }]
    }
  }
  return []
}

/**
 * `dict[K, Enum]` field where BOTH the key and value are enum-constrained —
 * mirrors pydantic's BUILT-IN dict-type validation (NOT a custom
 * `field_validator`, unlike the rate/confidence maps above), which has two
 * consequences verified via direct capture:
 *   1. it validates BOTH the key (must be a real enum member) and the value
 *      (must be a real enum member) for EVERY entry, and
 *   2. it reports ALL invalid entries, not just the first — confirmed via a
 *      2-bad-entry capture (`{music_playlist: 'bogus1', quiz: 'bogus2'}`
 *      produced 2 separate issues, in insertion order).
 * A bad KEY's `loc` ends with a literal `"[key]"` segment (pydantic's own
 * marker for "this error is about the dict key, not the value") — e.g.
 * `driver_profile.service_usage_level.not_a_service.[key]` — verified via
 * direct capture, not guessed; do not "clean up" this literal string.
 * Generalized (fix round 2) from a `ServiceId`-only version to also cover
 * `usage_by_genre: dict[GenreLiteral, UsageLevel]` (the genre extension's
 * own live-scored field) — verified via a SEPARATE direct capture, not
 * assumed identical to the ServiceId case.
 */
function keyedEnumMapIssues(
  path: string,
  value: unknown,
  keyAllowed: readonly string[],
  valueAllowed: readonly string[],
): ValidationIssue[] {
  if (value === undefined || value === null || typeof value !== 'object' || Array.isArray(value)) return []
  const issues: ValidationIssue[] = []
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    if (!keyAllowed.includes(key)) {
      issues.push({ path: `${path}.${key}.[key]`, code: 'enum', message: enumMsg(keyAllowed) })
    }
    if (typeof v !== 'string' || !valueAllowed.includes(v)) {
      issues.push({ path: `${path}.${key}`, code: 'enum', message: enumMsg(valueAllowed) })
    }
  }
  return issues
}

function serviceKeyedEnumMapIssues(path: string, value: unknown, allowedValues: readonly string[]): ValidationIssue[] {
  return keyedEnumMapIssues(path, value, SERVICE_ID, allowedValues)
}

/**
 * `scene_service_usage_level: dict[str, dict[ServiceId, UsageLevel]]` — the
 * OUTER key (a scene id) is a plain unconstrained `str`, no enum check; each
 * OUTER value must itself be an object (else `dict_type`), and its entries
 * are checked exactly like `serviceKeyedEnumMapIssues` above (verified via
 * direct capture over 2 scenes — insertion order preserved across BOTH the
 * outer scene loop and the inner per-scene entries).
 */
function sceneServiceUsageLevelIssues(path: string, value: unknown): ValidationIssue[] {
  if (value === undefined || value === null || typeof value !== 'object' || Array.isArray(value)) return []
  const issues: ValidationIssue[] = []
  for (const [sceneId, inner] of Object.entries(value as Record<string, unknown>)) {
    if (inner === null || typeof inner !== 'object' || Array.isArray(inner)) {
      issues.push({ path: `${path}.${sceneId}`, code: 'dict_type', message: 'Input should be a valid dictionary' })
      continue
    }
    issues.push(...serviceKeyedEnumMapIssues(`${path}.${sceneId}`, inner, USAGE_LEVEL))
  }
  return issues
}

/**
 * `dict[str, Enum]` field, KEY unconstrained (a track id, not an enum) —
 * only the VALUE is enum-checked. Distinct from `serviceKeyedEnumMapIssues`
 * above (which also validates the key against `ServiceId` and can emit the
 * `.[key]` marker) precisely because `catalog_item_usage_level`'s Python
 * type is `dict[str, UsageLevel]`, not `dict[ServiceId, UsageLevel]` — the
 * key here is a plain string (the field is `str`-keyed at the pydantic
 * level; a track id's EXISTENCE in the catalog is a separate, higher-level
 * check — rule 3, `catalogReferenceIssues` below — not a rule-1 concern).
 * Reports ALL invalid entries, matching pydantic's built-in dict-value
 * validation (same as `serviceKeyedEnumMapIssues`) — verified via a
 * 2-bad-entry direct capture. When the SAME key is both an enum-invalid
 * value AND an unknown catalog reference, Python emits BOTH issues
 * independently (different codes, different path SHAPES — this one
 * dot-joined, rule 3's own bracketed) — verified via a direct
 * `validate_world()` capture, not assumed from the structural-only case.
 */
function stringKeyedEnumMapIssues(path: string, value: unknown, allowedValues: readonly string[]): ValidationIssue[] {
  if (value === undefined || value === null || typeof value !== 'object' || Array.isArray(value)) return []
  const issues: ValidationIssue[] = []
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v !== 'string' || !(allowedValues as readonly string[]).includes(v)) {
      issues.push({ path: `${path}.${key}`, code: 'enum', message: enumMsg(allowedValues) })
    }
  }
  return issues
}

/**
 * `scene_content_tag_usage_level: dict[str, dict[str, UsageLevel]]` — the
 * content-tag sibling of `sceneServiceUsageLevelIssues` above: BOTH the
 * outer (scene id) and inner (content tag) keys are unconstrained strings,
 * only the innermost VALUE is enum-checked — delegates to
 * `stringKeyedEnumMapIssues`, not `serviceKeyedEnumMapIssues` (no
 * `ServiceId` constraint anywhere in this field, unlike
 * `scene_service_usage_level`). Verified via direct capture.
 */
function sceneContentTagUsageLevelIssues(path: string, value: unknown): ValidationIssue[] {
  if (value === undefined || value === null || typeof value !== 'object' || Array.isArray(value)) return []
  const issues: ValidationIssue[] = []
  for (const [sceneId, inner] of Object.entries(value as Record<string, unknown>)) {
    if (inner === null || typeof inner !== 'object' || Array.isArray(inner)) {
      issues.push({ path: `${path}.${sceneId}`, code: 'dict_type', message: 'Input should be a valid dictionary' })
      continue
    }
    issues.push(...stringKeyedEnumMapIssues(`${path}.${sceneId}`, inner, USAGE_LEVEL))
  }
  return issues
}

/**
 * `scene_genre_usage: dict[str, dict[GenreLiteral, UsageLevel]] | None` —
 * the genre extension's scene-keyed sibling of `usage_by_genre`. Outer key
 * (scene id) unconstrained; inner is `keyedEnumMapIssues` against
 * `GENRE_LITERAL`/`USAGE_LEVEL` (both key AND value enum-checked, unlike
 * `sceneContentTagUsageLevelIssues`'s string-keyed inner).
 */
function sceneGenreUsageIssues(path: string, value: unknown): ValidationIssue[] {
  if (value === undefined || value === null || typeof value !== 'object' || Array.isArray(value)) return []
  const issues: ValidationIssue[] = []
  for (const [sceneId, inner] of Object.entries(value as Record<string, unknown>)) {
    if (inner === null || typeof inner !== 'object' || Array.isArray(inner)) {
      issues.push({ path: `${path}.${sceneId}`, code: 'dict_type', message: 'Input should be a valid dictionary' })
      continue
    }
    issues.push(...keyedEnumMapIssues(`${path}.${sceneId}`, inner, GENRE_LITERAL, USAGE_LEVEL))
  }
  return issues
}

function driverProfileIssues(dp: unknown, path: string): ValidationIssue[] {
  if (!dp || typeof dp !== 'object' || Array.isArray(dp)) {
    return [{ path, code: 'model_type', message: 'Input should be a valid dictionary or instance of DriverProfile' }]
  }
  const p = dp as Record<string, unknown>
  const issues: ValidationIssue[] = []

  // oshi_registered: like multiple_passengers, in the service selector's own
  // FEATURE_ORDER (algorithm.py:59) but NOT `disposition: scored` in the
  // content registry (it's context_only there) — selector-source-only
  // finding, this fix round's re-audit.
  const oshiRegisteredIssue = conservativeBoolTypeIssue(`${path}.oshi_registered`, p.oshi_registered)
  if (oshiRegisteredIssue) issues.push(oshiRegisteredIssue)
  const oshiModeIssue = enumIssue(`${path}.oshi_mode`, p.oshi_mode, OSHI_MODE)
  if (oshiModeIssue) issues.push(oshiModeIssue)
  const ageBandIssue = enumIssue(`${path}.age_band`, p.age_band, AGE_BAND)
  if (ageBandIssue) issues.push(ageBandIssue)
  const genderIssue = enumIssue(`${path}.gender`, p.gender, GENDER)
  if (genderIssue) issues.push(genderIssue)

  const oshiArtists = oshiArtistsIssues(p.oshi_artists ?? [], `${path}.oshi_artists`)
  issues.push(...oshiArtists.issues)

  for (const spec of RATE_MAP_SPECS) {
    issues.push(...rateMapIssue(`${path}.${spec.key}`, spec.key, p[spec.key], spec))
  }

  // Live-scored fields (fix round 1 finding — see file-level doc comment):
  // read directly by the service selector's resolve_direct_evidence.
  issues.push(...serviceKeyedEnumMapIssues(`${path}.service_usage_level`, p.service_usage_level, USAGE_LEVEL))
  issues.push(...serviceKeyedEnumMapIssues(`${path}.service_recency_state`, p.service_recency_state, RECENCY_STATE))
  issues.push(...sceneServiceUsageLevelIssues(`${path}.scene_service_usage_level`, p.scene_service_usage_level))
  // catalog_item_usage_level: disposition:scored for the content selector
  // (packages/aica_transparent_content_selector_v1/algorithm.py:396, grep-
  // verified) — fix round 2 finding. Only the VALUE is checked here; the
  // KEY's existence in the catalog is rule 3's job (catalogReferenceIssues).
  issues.push(...stringKeyedEnumMapIssues(`${path}.catalog_item_usage_level`, p.catalog_item_usage_level, USAGE_LEVEL))

  // Remaining live-scored fields, found by a full re-audit against EVERY
  // `disposition: scored` entry in the content dispositions registry (not
  // just a source grep) — fix round 2's re-audit finding, per the file-level
  // doc comment. All read directly by
  // packages/aica_transparent_content_selector_v1/algorithm.py: hobby_interest_tags
  // (line 328), content_tag_usage_level/scene_content_tag_usage_level are
  // declared `scored` in the registry but NOT currently read by that file
  // (grep-verified — dead in today's algorithm despite the registry's own
  // classification; checked anyway, since the registry classification is
  // the frozen, authoritative design intent this whole rule system is built
  // on, not merely "what the current algorithm happens to read"),
  // played_items/skipped_items/changed_from_items (lines 400/404/407, plus
  // 436/457 for the item-shape helpers).
  issues.push(...stringArrayIssues(`${path}.hobby_interest_tags`, p.hobby_interest_tags))
  issues.push(...stringKeyedEnumMapIssues(`${path}.content_tag_usage_level`, p.content_tag_usage_level, USAGE_LEVEL))
  issues.push(...sceneContentTagUsageLevelIssues(`${path}.scene_content_tag_usage_level`, p.scene_content_tag_usage_level))
  issues.push(...trackIdItemListIssues(`${path}.played_items`, p.played_items, 'last_played_at', 'PlayedItem'))
  issues.push(...trackIdItemListIssues(`${path}.skipped_items`, p.skipped_items, 'skipped_at', 'SkippedItem'))
  issues.push(...trackIdItemListIssues(`${path}.changed_from_items`, p.changed_from_items, 'changed_at', 'ChangedFromItem'))

  // Genre extension (opt-in, genre_affinity_v1_enabled) — read for scoring
  // by packages/aica_transparent_content_selector_v1/algorithm.py's
  // genre-gated leaves (lines 335/340, grep-verified) whenever the
  // extension is on. NOT in the content dispositions registry at all
  // (confirmed: absent from all 48 entries) — found via selector-source
  // grep only, the other half of "per the registry OR a selector-source
  // grep". Both fields are nullable (`| None = None`); `keyedEnumMapIssues`/
  // `sceneGenreUsageIssues` already treat null/undefined as valid (no check).
  issues.push(...keyedEnumMapIssues(`${path}.usage_by_genre`, p.usage_by_genre, GENRE_LITERAL, USAGE_LEVEL))
  issues.push(...sceneGenreUsageIssues(`${path}.scene_genre_usage`, p.scene_genre_usage))

  // Model-level ("after") validator — same skip-on-field-failure gating as
  // ControlInputs' purpose_stage_compatible above (verified empirically for
  // this exact model too — see task report). NOTE: this gate only sees the
  // fields THIS port checks (see the file-level scope note) — an invalid
  // value in one of the deliberately-unchecked fields could, in Python,
  // block this check from running; this port would not know to block it.
  if (issues.length === 0 && !oshiArtists.anyFieldIssue) {
    const seen = new Set<string>()
    for (const id of oshiArtists.artistIds) {
      if (seen.has(id)) {
        issues.push({
          path,
          code: 'value_error',
          message: `Value error, Duplicate oshi artist_id '${id}' in oshi_artists — each registered oshi artist must appear at most once.`,
        })
        break
      }
      seen.add(id)
    }
  }

  return issues
}

// ---------------------------------------------------------------------------
// CatalogRef / DatasetVersion (fix round 1 finding — required sub-fields
// present and of the right type; `CatalogRef` itself is `frozen=True` in
// Python, which is irrelevant here since `apply_overrides`/`_structural_issues`
// both always re-validate a plain DICT, never a live pydantic instance — see
// the file-level doc comment).
// ---------------------------------------------------------------------------

function datasetVersionIssues(dv: unknown, path: string): ValidationIssue[] {
  if (dv === undefined) {
    return [{ path, code: 'missing', message: 'Field required' }]
  }
  if (dv === null || typeof dv !== 'object' || Array.isArray(dv)) {
    return [{ path, code: 'model_type', message: 'Input should be a valid dictionary or instance of DatasetVersion' }]
  }
  const d = dv as Record<string, unknown>
  const issues: ValidationIssue[] = []
  for (const field of ['schema_version', 'spotify_track_reference_version', 'spotify_audio_features_reference_version']) {
    if (typeof d[field] !== 'string') issues.push(stringTypeIssue(`${path}.${field}`))
  }
  return issues
}

function catalogRefIssues(cr: unknown, path: string): ValidationIssue[] {
  if (cr === undefined) {
    return [{ path, code: 'missing', message: 'Field required' }]
  }
  if (cr === null || typeof cr !== 'object' || Array.isArray(cr)) {
    return [{ path, code: 'model_type', message: 'Input should be a valid dictionary or instance of CatalogRef' }]
  }
  const c = cr as Record<string, unknown>
  const issues: ValidationIssue[] = []
  if (typeof c.dataset_id !== 'string') issues.push(stringTypeIssue(`${path}.dataset_id`))
  if (typeof c.dataset_hash !== 'string') issues.push(stringTypeIssue(`${path}.dataset_hash`))
  issues.push(...datasetVersionIssues(c.dataset_version, `${path}.dataset_version`))
  return issues
}

// ---------------------------------------------------------------------------
// Rule 1 + 2 combined — structural issues over the whole World.
// ---------------------------------------------------------------------------

/**
 * Re-validate `world`'s own shape — mirrors `_structural_issues` (which
 * re-validates a dumped World through `World.model_validate()` in Python).
 * See the file-level doc comment for the exact, disclosed field-coverage
 * boundary.
 */
export function structuralIssues(world: unknown): ValidationIssue[] {
  if (!world || typeof world !== 'object' || Array.isArray(world)) {
    return [{ path: 'world', code: 'model_type', message: 'Input should be a valid dictionary or instance of World' }]
  }
  const w = world as Record<string, unknown>
  return [
    ...controlInputsIssues(w.control_inputs, 'control_inputs'),
    ...situationIssues(w.situation, 'situation'),
    ...driverProfileIssues(w.driver_profile, 'driver_profile'),
    ...catalogRefIssues(w.catalog_ref, 'catalog_ref'),
  ]
}

// ---------------------------------------------------------------------------
// Rule 3 — catalog reference existence.
// ---------------------------------------------------------------------------

// driver_profile fields whose items carry a `track_id` referencing the catalog.
const TRACK_ID_LIST_FIELDS = [
  'played_items',
  'skipped_items',
  'changed_from_items',
  'completed_items',
  'manually_selected_items',
  'repeated_items',
] as const

// driver_profile fields that are maps keyed by a catalog track id.
const TRACK_ID_MAP_FIELDS = [
  'catalog_item_usage_level',
  'catalog_item_recency_state',
  'content_proposal_acceptance_rate',
  'content_recovery_rate',
  'content_proposal_acceptance_confidence',
  'content_recovery_confidence',
] as const

export type SongDoc = {
  spotify_track: {
    id: string
    artists?: Array<{ id: string }> | null
    album?: { artists?: Array<{ id: string }> | null } | null
  }
}

function catalogIds(catalog: SongDoc[]): { trackIds: Set<string>; artistIds: Set<string> } {
  const trackIds = new Set<string>()
  const artistIds = new Set<string>()
  for (const song of catalog) {
    const track = song.spotify_track
    trackIds.add(track.id)
    for (const artist of track.artists ?? []) artistIds.add(artist.id)
    for (const artist of track.album?.artists ?? []) artistIds.add(artist.id)
  }
  return { trackIds, artistIds }
}

// Bilingual noun for each ref_kind this module checks — mirrors `_REF_KIND_LABELS`.
const REF_KIND_LABELS: Record<string, { ja: string; en: string }> = {
  track: { ja: '楽曲', en: 'track' },
  artist: { ja: '推しアーティスト', en: 'favourite artist' },
}

function unknownReferenceIssue(path: string, refKind: string): ValidationIssue {
  const label = REF_KIND_LABELS[refKind] ?? { ja: '項目', en: 'item' }
  return {
    path,
    code: 'unknown_catalog_reference',
    message:
      `The registered ${label.en} isn't in this dataset's catalog. / ` +
      `登録されている${label.ja}が、このデータセットのカタログに見つかりません。`,
  }
}

function catalogReferenceIssues(world: Record<string, unknown>, catalog: SongDoc[]): ValidationIssue[] {
  const { trackIds, artistIds } = catalogIds(catalog)
  const profile = (world.driver_profile ?? {}) as Record<string, unknown>
  const issues: ValidationIssue[] = []

  for (const listField of TRACK_ID_LIST_FIELDS) {
    const items = profile[listField]
    if (!Array.isArray(items)) continue
    items.forEach((item, idx) => {
      const trackId = (item as Record<string, unknown> | null)?.track_id
      // NOTE: no `typeof trackId === 'string'` guard — mirrors Python's own
      // unconditional `item.track_id not in track_ids` (world_validation.py),
      // which fires for ANY non-matching value, including a wrong-typed one,
      // since `trackIds`/`artistIds` are plain string sets. Verified via a
      // direct capture that deliberately gives track_id the WRONG type (an
      // int, via the same direct-mutation-bypasses-validation technique used
      // throughout this fixture set): Python emits BOTH the rule-1
      // `string_type` issue AND this rule-3 `unknown_catalog_reference` issue
      // — independently, not one OR the other. An earlier version of this
      // function had the guard and silently dropped the second issue for a
      // wrong-typed track_id — caught by that same capture case, not
      // guessed; see the task report's fix-round-2 section.
      if (!trackIds.has(trackId as string) && trackId !== undefined) {
        issues.push(unknownReferenceIssue(`driver_profile.${listField}[${idx}].track_id`, 'track'))
      }
    })
  }

  for (const mapField of TRACK_ID_MAP_FIELDS) {
    const map = profile[mapField]
    if (!map || typeof map !== 'object' || Array.isArray(map)) continue
    for (const key of Object.keys(map as Record<string, unknown>)) {
      if (!trackIds.has(key)) {
        issues.push(unknownReferenceIssue(`driver_profile.${mapField}[${pyReprQuoteOne(key)}]`, 'track'))
      }
    }
  }

  const oshiArtists = profile.oshi_artists
  if (Array.isArray(oshiArtists)) {
    oshiArtists.forEach((artist, idx) => {
      const artistId = (artist as Record<string, unknown> | null)?.artist_id
      // Same fix as the track-id list check above: no `typeof === 'string'`
      // gate, mirroring Python's unconditional `artist.artist_id not in
      // artist_ids`.
      if (!artistIds.has(artistId as string) && artistId !== undefined) {
        issues.push(unknownReferenceIssue(`driver_profile.oshi_artists[${idx}].artist_id`, 'artist'))
      }
    })
  }

  return issues
}

/**
 * Return true if `world` references the catalog in ANY way: a non-empty
 * `driver_profile.oshi_artists`, or any track-id list/map field
 * (`TRACK_ID_LIST_FIELDS`/`TRACK_ID_MAP_FIELDS`) that is non-empty.
 *
 * Used by callers (e.g. `world_overrides.ts#applyOverrides`) that must
 * decide whether an unresolvable/missing catalog is safe to skip reference
 * validation against.
 */
export function hasCatalogReferences(world: unknown): boolean {
  if (!world || typeof world !== 'object') return false
  const profile = (world as Record<string, unknown>).driver_profile
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) return false
  const p = profile as Record<string, unknown>

  const oshiArtists = p.oshi_artists
  if (Array.isArray(oshiArtists) && oshiArtists.length > 0) return true
  for (const listField of TRACK_ID_LIST_FIELDS) {
    const items = p[listField]
    if (Array.isArray(items) && items.length > 0) return true
  }
  for (const mapField of TRACK_ID_MAP_FIELDS) {
    const map = p[mapField]
    if (map && typeof map === 'object' && !Array.isArray(map) && Object.keys(map).length > 0) return true
  }
  return false
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Validate `world` against its own rules plus the supplied `catalog`.
 * Returns an empty array for a fully valid world.
 */
export function validateWorld(world: unknown, catalog: SongDoc[]): ValidationIssue[] {
  const structural = structuralIssues(world)
  const catalogIssues =
    world && typeof world === 'object' ? catalogReferenceIssues(world as Record<string, unknown>, catalog) : []
  return [...structural, ...catalogIssues]
}
