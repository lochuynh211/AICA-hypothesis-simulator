/**
 * PurposeStageServiceMatrix — TS port of
 * `app/api/aica_api/models/proposal/matrix.py` (193 LOC; feature 026,
 * htmlapp Combined export, slice C4a Task 1).
 *
 * Loader/resolver over the frozen versioned artifact
 * `proposal_contracts/matrix/purpose_stage_matrix.v1.json` (the 6 spec §7.5
 * rows). A run freezes the matrix version at start.
 *
 * NO FILESYSTEM HERE (see the task report's Step 1 for the full mapping):
 * Python's `PurposeStageServiceMatrix.load(path)` opens+`json.load`s a file
 * at a `Path` computed by `routers/proposal.py`'s `_matrix_path()`. htmlapp
 * has no filesystem — the identical committed JSON is already parsed once
 * into the generated data payload (`../../data/registry.ts#getMatrix`,
 * returning `unknown`). `loadMatrix` below takes that already-parsed value
 * directly; `_matrix_path()` itself has no TS equivalent (its only job was
 * producing a `Path` for `.load()` to open) and is not ported as a
 * separate function — see `./orchestrator/context_base.ts#getMatrix` for
 * the composed "read the real payload + validate" call later orchestrator
 * tasks use, mirroring Python's `PurposeStageServiceMatrix.load(_matrix_path())`
 * call sites as ONE function instead of two.
 *
 * ISOLATED from trigger models — mirrors the Python module's own isolation
 * note: this module imports only from `./enums` and `./journey` (both
 * proposal-domain-only), never a trigger-side type.
 *
 * The `during_rest_stopped` row carries an explanatory `_note` key in the
 * frozen JSON (rest actions at that stage are journey-engine-owned and have
 * no `ServiceId` members — the row legitimately resolves to an empty list).
 * `loadMatrix` tolerates and discards unknown row keys, mirroring pydantic's
 * default `extra="ignore"` behavior on `MatrixRow`.
 *
 * ── Validation scope (full parity, not scoped down) ────────────────────────
 * Unlike `world_validation.ts` (which had to scope down from pydantic's full
 * field catalogue — dozens of fields — to a documented subset),
 * `MatrixRow`/`PurposeStageServiceMatrix` together have only 5 fields total,
 * so this port validates ALL of them: `trigger_purpose`/`lifecycle_stage`
 * enum membership, `allowed_service_ids` as an array of valid `ServiceId`s,
 * the row-level purpose/stage compatibility model_validator, the
 * exactly-6-rows model_validator, and the post-rest-row-lists-exactly-5
 * model_validator. NOT ported: structural/type errors on the top-level
 * `matrix_version`/`rows` fields themselves (e.g. `rows` not being an
 * array at all) — Python's own test suite
 * (`app/api/tests/proposal/test_matrix_resolver.py`) never exercises those
 * either, and the one real caller is a single frozen, generation-time-
 * validated artifact, never arbitrary/untrusted input.
 *
 * ── Hazard pass (see task-1-report.md for the full per-site table) ────────
 * - Hazard 1 (banker's rounding): no `round()` in matrix.py — N/A.
 * - Hazard 2 (`sorted()`/`.sort()`): `validate_post_rest_row`'s error
 *   message uses `sorted(s.value for s in ...)` on both sides — DETERMINISTIC
 *   (alphabetical), reproduced with a plain `.sort()` below.
 * - Hazard 3 (`//`/`%` floor division): none — N/A.
 * - Hazard 4 (dict/insertion order): `MatrixRow.purpose_stage_compatible`'s
 *   `active_driving_content`-incompatible branch embeds
 *   `[p.value for p in _ACTIVE_DRIVING_PURPOSES]` — `_ACTIVE_DRIVING_PURPOSES`
 *   is a Python `frozenset`, whose iteration order is HASH-SEED-DEPENDENT
 *   (confirmed non-deterministic across processes — the exact same finding
 *   already documented for `world_validation.ts`'s identical rule, which
 *   duplicates this same frozenset for `ControlInputs`). This port fixes a
 *   STABLE declaration order (`ACTIVE_DRIVING_PURPOSES` below); the
 *   membership CHECK (does the branch fire) is identical either way, only
 *   the LISTED order in that one message differs from any single Python
 *   run — not captured byte-exact in the golden for this reason (see
 *   report). `resolve()`'s row-scan preserves the frozen JSON's own row
 *   order (a `list`, not a `dict`/`set`) via a plain `for...of` — no
 *   ordering hazard there.
 * - Hazard 5 (bare `str(float)`/f-string float interpolation): no float
 *   fields anywhere in this module — N/A.
 * - Hazard 6 (`neumaierSum`): no `sum()` over floats — N/A.
 * - Hazard 7 (`pyFixed`/`:.Nf`): no format-spec float formatting — N/A.
 * - Hazard 8 (`isinstance(x, (int, float))` accepting `bool`): zero
 *   `isinstance` calls anywhere in matrix.py (verified — the full 193 LOC
 *   was read) — N/A, no site to audit.
 */
import { pyReprQuoteOne } from './py_repr'
import { SERVICE_ID_VALUES, SERVICE_ID_SET, type ServiceId } from './enums'
import type { LifecycleStage } from './journey'

// ---------------------------------------------------------------------------
// Enum member tables (verbatim from `models/proposal/enums.py`, mirroring
// the local-per-module-copy convention already established for
// TRIGGER_PURPOSE/LIFECYCLE_STAGE in `world_validation.ts` — no existing
// exported FULL 4-member TriggerPurpose/LifecycleStage union covers what
// this module needs; `LifecycleStage` itself IS reused from `./journey.ts`,
// the module that already owns it, per "reuse, do not rewrite").
// ---------------------------------------------------------------------------

export type TriggerPurpose =
  | 'rest_recommended'
  | 'inattentive_driving_prevention_recovery'
  | 'route_music'
  | 'child_passenger_experience'

const TRIGGER_PURPOSE_VALUES: readonly TriggerPurpose[] = [
  'rest_recommended',
  'inattentive_driving_prevention_recovery',
  'route_music',
  'child_passenger_experience',
]

const LIFECYCLE_STAGE_VALUES: readonly LifecycleStage[] = [
  'before_rest_until_stop',
  'during_rest_stopped',
  'after_rest_before_restart',
  'active_driving_content',
]

// ---------------------------------------------------------------------------
// Compatibility rules — same rule as SelectorInput / ProposalOpportunity
// (Python duplicates this exact frozenset pair in world.py, opportunity.py,
// AND matrix.py — three independent module-local copies; this port mirrors
// that real structural duplication with a third local TS copy rather than
// centralizing, matching what the Python source actually does).
// ---------------------------------------------------------------------------

const REST_STAGES: ReadonlySet<LifecycleStage> = new Set([
  'before_rest_until_stop',
  'during_rest_stopped',
  'after_rest_before_restart',
])

const ACTIVE_DRIVING_PURPOSES: readonly TriggerPurpose[] = [
  'inattentive_driving_prevention_recovery',
  'route_music',
  'child_passenger_experience',
]

// The post-rest row must list exactly these 5 services (data-model.md).
const POST_REST_EXPECTED_SERVICES: readonly ServiceId[] = [
  'live_viewing',
  'stretch_video',
  'full_karaoke',
  'oshi_reexperience',
  'call_response_stopped',
]

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** Raised by `resolveMatrix()` for an incompatible or unknown
 * `(trigger_purpose, lifecycle_stage)` pair — i.e. no matrix row matches.
 * Mirrors Python's `MatrixResolutionError(Exception)`. */
export class MatrixResolutionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MatrixResolutionError'
  }
}

/** Raised by `loadMatrix()` when the input fails one of `MatrixRow`'s or
 * `PurposeStageServiceMatrix`'s pydantic-mirrored checks. Mirrors Python's
 * `pydantic.ValidationError` for this module specifically — NOT a byte-exact
 * reproduction of pydantic's multi-line formatted error block (nothing in
 * this port's call sites depends on that formatting; see the task report). */
export class MatrixValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MatrixValidationError'
  }
}

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

/** One row of the purpose/stage/allowed-services matrix. `allowed_service_ids`
 * may legitimately be empty (the `during_rest_stopped` row). */
export type MatrixRow = {
  trigger_purpose: TriggerPurpose
  lifecycle_stage: LifecycleStage
  allowed_service_ids: ServiceId[]
}

/** The frozen purpose/stage/allowed-services matrix (data-model.md). */
export type PurposeStageServiceMatrix = {
  matrix_version: string
  rows: MatrixRow[]
}

// ---------------------------------------------------------------------------
// Small Python-mirroring formatters (per-module-local copies, matching the
// established convention — see `world_validation.ts`'s own `enumMsg`/
// `pyListRepr`, which are private/unexported there too).
// ---------------------------------------------------------------------------

/** Mirrors pydantic v2's `Input should be 'a', 'b' or 'c'` enum-error join style. */
function enumMsg(values: readonly string[]): string {
  const quoted = values.map(pyReprQuoteOne)
  if (quoted.length <= 1) return `Input should be ${quoted[0] ?? ''}`
  return `Input should be ${quoted.slice(0, -1).join(', ')} or ${quoted[quoted.length - 1]}`
}

/** Mirrors Python's `str(sorted(list_of_str))` — `['a', 'b', 'c']`. */
function pySortedListRepr(values: readonly string[]): string {
  return `[${[...values].sort().map((v) => `'${v}'`).join(', ')}]`
}

/** Mirrors Python's `str(list_of_str)` verbatim (declaration order, NOT
 * sorted) — only used for the frozenset-order-hazard branch; see the
 * module doc's hazard-4 note for why this can never be byte-parity-checked
 * against a live Python process. */
function pyListRepr(values: readonly string[]): string {
  return `[${values.map((v) => `'${v}'`).join(', ')}]`
}

// ---------------------------------------------------------------------------
// MatrixRow — field validation + purpose_stage_compatible
// ---------------------------------------------------------------------------

/** Mirrors `MatrixRow.purpose_stage_compatible` (matrix.py:88-107). Only
 * called once all 3 of a row's own fields have already validated — mirrors
 * pydantic's `@model_validator(mode="after")`, which only runs once every
 * field validator on the SAME model has already passed. */
function checkRowCompatibility(row: MatrixRow): void {
  const { trigger_purpose: purpose, lifecycle_stage: stage } = row

  if (REST_STAGES.has(stage) && purpose !== 'rest_recommended') {
    throw new MatrixValidationError(
      `Lifecycle stage '${stage}' is only compatible with trigger_purpose 'rest_recommended', but got '${purpose}'.`,
    )
  }
  if (stage === 'active_driving_content' && !ACTIVE_DRIVING_PURPOSES.includes(purpose)) {
    // Hazard 4 — see module doc: Python's `_ACTIVE_DRIVING_PURPOSES` is a
    // frozenset, so the LISTED order in the real Python message is
    // hash-seed-dependent. This uses the fixed declaration order instead.
    throw new MatrixValidationError(
      `Lifecycle stage 'active_driving_content' is only compatible with purposes ${pyListRepr(ACTIVE_DRIVING_PURPOSES)}, but got '${purpose}'.`,
    )
  }
}

/** Mirrors `MatrixRow`'s own field-level pydantic validation (matrix.py:75-86):
 * `trigger_purpose`/`lifecycle_stage` enum membership, `allowed_service_ids`
 * as a `list[ServiceId]`. Unknown extra keys (e.g. `_note`) are tolerated and
 * discarded — mirrors pydantic's default `extra="ignore"`. */
function buildRow(raw: unknown, index: number): MatrixRow {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new MatrixValidationError(
      `rows.${index}: Input should be a valid dictionary or instance of MatrixRow`,
    )
  }
  const r = raw as Record<string, unknown>

  if (typeof r.trigger_purpose !== 'string' || !TRIGGER_PURPOSE_VALUES.includes(r.trigger_purpose as TriggerPurpose)) {
    throw new MatrixValidationError(`rows.${index}.trigger_purpose: ${enumMsg(TRIGGER_PURPOSE_VALUES)}`)
  }
  if (typeof r.lifecycle_stage !== 'string' || !LIFECYCLE_STAGE_VALUES.includes(r.lifecycle_stage as LifecycleStage)) {
    throw new MatrixValidationError(`rows.${index}.lifecycle_stage: ${enumMsg(LIFECYCLE_STAGE_VALUES)}`)
  }
  if (!Array.isArray(r.allowed_service_ids)) {
    throw new MatrixValidationError(`rows.${index}.allowed_service_ids: Input should be a valid list`)
  }
  r.allowed_service_ids.forEach((sid, i) => {
    if (typeof sid !== 'string' || !SERVICE_ID_SET.has(sid)) {
      throw new MatrixValidationError(`rows.${index}.allowed_service_ids.${i}: ${enumMsg(SERVICE_ID_VALUES)}`)
    }
  })

  const row: MatrixRow = {
    trigger_purpose: r.trigger_purpose as TriggerPurpose,
    lifecycle_stage: r.lifecycle_stage as LifecycleStage,
    allowed_service_ids: [...(r.allowed_service_ids as ServiceId[])],
  }
  checkRowCompatibility(row)
  return row
}

// ---------------------------------------------------------------------------
// PurposeStageServiceMatrix — loader + model validators
// ---------------------------------------------------------------------------

/**
 * Load and validate the matrix from an already-parsed payload value.
 * Mirrors `PurposeStageServiceMatrix.load(path)` (matrix.py:163-168) fused
 * with the two `PurposeStageServiceMatrix` model_validators
 * (`validate_six_rows`, `validate_post_rest_row`, matrix.py:130-157) — there
 * is no separate "open the file" step here (see the module doc's "no
 * filesystem" note), so `.load()`'s `json.load` and pydantic's own
 * construction-time model_validators collapse into this one function.
 */
export function loadMatrix(raw: unknown): PurposeStageServiceMatrix {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new MatrixValidationError('Input should be a valid dictionary or instance of PurposeStageServiceMatrix')
  }
  const data = raw as Record<string, unknown>

  if (typeof data.matrix_version !== 'string') {
    throw new MatrixValidationError('matrix_version: Input should be a valid string')
  }
  if (!Array.isArray(data.rows)) {
    throw new MatrixValidationError('rows: Input should be a valid list')
  }

  const rows = data.rows.map((r, i) => buildRow(r, i))

  // validate_six_rows (matrix.py:130-134)
  if (rows.length !== 6) {
    throw new MatrixValidationError(`matrix must have exactly 6 rows, got ${rows.length}.`)
  }

  // validate_post_rest_row (matrix.py:136-157)
  const postRestRows = rows.filter(
    (r) => r.trigger_purpose === 'rest_recommended' && r.lifecycle_stage === 'after_rest_before_restart',
  )
  if (postRestRows.length !== 1) {
    throw new MatrixValidationError(
      `expected exactly one 'rest_recommended' / 'after_rest_before_restart' (post-rest) row, found ${postRestRows.length}.`,
    )
  }
  const actualSet = [...new Set(postRestRows[0].allowed_service_ids)].sort()
  const expectedSet = [...POST_REST_EXPECTED_SERVICES].sort()
  const sameSet = actualSet.length === expectedSet.length && actualSet.every((v, i) => v === expectedSet[i])
  if (!sameSet) {
    throw new MatrixValidationError(
      `the post-rest row must list exactly ${pySortedListRepr(POST_REST_EXPECTED_SERVICES)}, got ${pySortedListRepr(postRestRows[0].allowed_service_ids)}.`,
    )
  }

  return { matrix_version: data.matrix_version, rows }
}

/**
 * Return the allowed service ids for `(triggerPurpose, lifecycleStage)`.
 * Mirrors `resolve()` (matrix.py:174-193) — a plain list scan (the frozen
 * JSON's row order, no dict/set involved, so hazard 4 does not apply here).
 * Throws `MatrixResolutionError` if no row matches — i.e. the pair is
 * incompatible (per the compatibility rule) or simply not represented in
 * the frozen matrix.
 */
export function resolveMatrix(
  matrix: PurposeStageServiceMatrix,
  triggerPurpose: TriggerPurpose,
  lifecycleStage: LifecycleStage,
): ServiceId[] {
  for (const row of matrix.rows) {
    if (row.trigger_purpose === triggerPurpose && row.lifecycle_stage === lifecycleStage) {
      return [...row.allowed_service_ids]
    }
  }
  throw new MatrixResolutionError(
    `No matrix row for (trigger_purpose=${pyReprQuoteOne(triggerPurpose)}, lifecycle_stage=${pyReprQuoteOne(lifecycleStage)}); the pair is either incompatible or not represented in the frozen matrix.`,
  )
}
