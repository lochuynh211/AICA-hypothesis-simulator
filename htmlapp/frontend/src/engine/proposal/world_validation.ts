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
 * SCOPE NOTE (disclosed, not a silent gap): Python's rule 1 is "reuse
 * pydantic's own constructor validation" over EVERY field of World /
 * ControlInputs / Situation / DriverProfile — dozens of fields. Reproducing
 * pydantic's own error-message catalogue byte-for-byte for every single one
 * would mean re-implementing pydantic itself. This port instead gives FULL,
 * Python-verified fidelity (byte-exact `code`/`message`, confirmed via a
 * direct interpreter capture — see the task report) to exactly the fields
 * Python's OWN test suite (`test_world_validation.py`,
 * `test_p7_apply_overrides.py`) exercises, plus the fields those tests'
 * sibling branches sit next to on the SAME model (so a model's "does any
 * field fail?" gate — see below — stays accurate for the fields checked):
 *   - ControlInputs: all 3 enums, both non-empty-string checks, both
 *     `purpose_stage_compatible` branches.
 *   - Situation: the 3 percent-range fields, `estimated_min_until_rest_spot`,
 *     the 5 enums (`traffic_state`/`road_type`/`night_state`/`motion_state`/
 *     `rest_spot_type`), nullable `active_service`, and
 *     `recent_service_rejections[*].service_id`.
 *   - DriverProfile: `oshi_mode`/`age_band`/`gender`, `oshi_artists` (full:
 *     `artist_id`, `oshi_type`, `enthusiasm` range+grid, the duplicate-id
 *     model validator), and all 8 rate/confidence maps.
 * Everything else on DriverProfile (the ~15 remaining fields: scheduled-event
 * fields, the usage/recency maps, the plain history-item lists, the genre
 * extension) and all of CatalogRef/DatasetVersion are deliberately NOT
 * checked here — Python's own test suite never exercises them via
 * `validate_world` either, and a wrong guess at pydantic's exact coercion
 * rules (e.g. `child_present: "yes"` — verified to coerce to `true` with NO
 * error) risks a FALSE POSITIVE (flagging a world Python would accept),
 * which is worse than an honest gap. See the task report's "Concerns for
 * the reviewer" for the one, narrow behavioral consequence: DriverProfile's
 * duplicate-oshi-id check is gated on "no other field issue in this model
 * yet" (mirroring pydantic's own after-validator skip-on-field-failure
 * semantics — verified empirically), but that gate only sees the fields
 * this port actually checks, so an invalid UNCHECKED field co-occurring
 * with a duplicate oshi id would (incorrectly, but rarely) still report the
 * duplicate.
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

/** Mirrors pydantic v2's `Input should be 'a', 'b' or 'c'` enum-error message join style. */
function enumMsg(values: readonly string[]): string {
  const quoted = values.map((v) => `'${v}'`)
  if (quoted.length <= 1) return `Input should be ${quoted[0] ?? ''}`
  return `Input should be ${quoted.slice(0, -1).join(', ')} or ${quoted[quoted.length - 1]}`
}

/** Mirrors Python's `str(list_of_str))` — `['a', 'b', 'c']`. */
function pyListRepr(values: readonly string[]): string {
  return `[${values.map((v) => `'${v}'`).join(', ')}]`
}

/** Mirrors Python's `str.__repr__` for a plain string (single-quoted) — used
 * for `{key!r}` in the catalog-reference map-key path (`field['key']`).
 * NOT `JSON.stringify` (double-quoted) — verified via direct capture. */
function pyReprStr(s: string): string {
  return `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
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
const SERVICE_ID = [
  'music_playlist',
  'humming_karaoke',
  'call_response_driving',
  'quiz',
  'ranking_creation',
  'radio_style',
  'conversation_audio',
  'live_viewing',
  'stretch_video',
  'full_karaoke',
  'call_response_stopped',
  'oshi_reexperience',
  'relaxation_multisensory',
  'linked_video_recommendation',
] as const
const OSHI_MODE = ['on', 'off'] as const
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
const AGE_BAND = ['teens', '20s', '30s', '40s', '50s', '60plus'] as const
const GENDER = ['male', 'female', 'non_binary', 'unspecified'] as const

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

function rateMapIssue(path: string, fieldName: string, value: unknown, spec: RateMapSpec): ValidationIssue | null {
  if (value === undefined || value === null || typeof value !== 'object' || Array.isArray(value)) return null
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const num = typeof v === 'number' ? v : Number(v)
    if (!(num >= spec.min && num <= spec.max)) {
      const keyRepr = spec.serviceKeyed ? `<ServiceId.${k}: '${k}'>` : `'${k}'`
      return {
        path,
        code: 'value_error',
        message: `Value error, ${fieldName}[${keyRepr}] must be in ${spec.boundsText}, got ${pyFloatRepr(num)}.`,
      }
    }
  }
  return null
}

function driverProfileIssues(dp: unknown, path: string): ValidationIssue[] {
  if (!dp || typeof dp !== 'object' || Array.isArray(dp)) {
    return [{ path, code: 'model_type', message: 'Input should be a valid dictionary or instance of DriverProfile' }]
  }
  const p = dp as Record<string, unknown>
  const issues: ValidationIssue[] = []

  const oshiModeIssue = enumIssue(`${path}.oshi_mode`, p.oshi_mode, OSHI_MODE)
  if (oshiModeIssue) issues.push(oshiModeIssue)
  const ageBandIssue = enumIssue(`${path}.age_band`, p.age_band, AGE_BAND)
  if (ageBandIssue) issues.push(ageBandIssue)
  const genderIssue = enumIssue(`${path}.gender`, p.gender, GENDER)
  if (genderIssue) issues.push(genderIssue)

  const oshiArtists = oshiArtistsIssues(p.oshi_artists ?? [], `${path}.oshi_artists`)
  issues.push(...oshiArtists.issues)

  for (const spec of RATE_MAP_SPECS) {
    const issue = rateMapIssue(`${path}.${spec.key}`, spec.key, p[spec.key], spec)
    if (issue) issues.push(issue)
  }

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
      if (typeof trackId === 'string' && !trackIds.has(trackId)) {
        issues.push(unknownReferenceIssue(`driver_profile.${listField}[${idx}].track_id`, 'track'))
      }
    })
  }

  for (const mapField of TRACK_ID_MAP_FIELDS) {
    const map = profile[mapField]
    if (!map || typeof map !== 'object' || Array.isArray(map)) continue
    for (const key of Object.keys(map as Record<string, unknown>)) {
      if (!trackIds.has(key)) {
        issues.push(unknownReferenceIssue(`driver_profile.${mapField}[${pyReprStr(key)}]`, 'track'))
      }
    }
  }

  const oshiArtists = profile.oshi_artists
  if (Array.isArray(oshiArtists)) {
    oshiArtists.forEach((artist, idx) => {
      const artistId = (artist as Record<string, unknown> | null)?.artist_id
      if (typeof artistId === 'string' && !artistIds.has(artistId)) {
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
