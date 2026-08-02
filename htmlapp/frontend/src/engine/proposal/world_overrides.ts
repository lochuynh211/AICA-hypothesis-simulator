/**
 * World override-application helper — port of the SURVIVING pure part of
 * `services/world_clone_store.py`: `apply_overrides` + `InvalidOverrideError`.
 *
 * PORT-SCOPE NOTE (per the task brief — confirming the reading is correct):
 * `world_clone_store.py`'s module docstring says it originally hosted the
 * user-facing "clone a base seed and change ONE variable" CRUD
 * (`WorldCloneStore`), which has SINCE BEEN REMOVED from the Python source —
 * only the pure `apply_overrides` helper it was built on top of remains,
 * shared with the P7 recompute endpoint. Reading the current file confirms
 * this: there is no `WorldCloneStore` class left, no persistence, no
 * filesystem access — the whole module IS `InvalidOverrideError` +
 * `apply_overrides` + four small private path-traversal helpers. There is
 * nothing else in that module to port; this file is the complete port.
 *
 * Given a base world plus zero or more `FieldOverride`s, `applyOverrides`:
 *   1. applies each override at its dotted/bracketed `path` onto a deep copy
 *      of the base world,
 *   2. re-validates the result as a complete World (structural — enum/range/
 *      purpose-stage — reusing `world_validation.ts#structuralIssues`, the
 *      exact same underlying check Python's `World.model_validate()` performs
 *      and that `world_validation.py#_structural_issues` ALSO wraps — the two
 *      Python call sites share pydantic's one model validator; this port
 *      shares one TS function for the same reason),
 *   3. re-validates catalog references via `world_validation.ts#validateWorld`
 *      whenever a `catalog` is supplied. If `catalog` is omitted/null AND the
 *      resulting world actually references the catalog in any way
 *      (`hasCatalogReferences`), this is a validation error
 *      (`unresolvable_catalog`) rather than a silent skip.
 *   4. computes a deterministic `diff`: exactly the overridden path(s) with
 *      their before/after values (read back from the base/result dumps —
 *      never a recursive whole-object diff).
 *
 * An EMPTY `overrides` array is allowed and returns `baseWorld` UNCHANGED
 * (the same object reference, matching Python's `return base_world, []`)
 * with an empty diff array.
 *
 * DELIBERATE PORT-BOUNDARY DECISION (see task report for the full
 * reasoning): Python's `apply_overrides` accepts `list[FieldOverride | dict]`
 * and, for a plain dict, first runs it through `FieldOverride.model_validate()`
 * — whose OWN field validator rejects an empty `path` with a raw pydantic
 * `ValidationError` (NOT an `InvalidOverrideError`) before `_split_path` is
 * ever reached. In practice this makes `_split_path`'s own empty-path guard
 * unreachable through Python's real caller (`routers/proposal.py` always
 * passes pre-parsed `FieldOverride` instances, never raw dicts — verified by
 * grep). TypeScript has no equivalent "already-validated instance vs. raw
 * dict" distinction — every override arriving here is just a plain
 * `{path, value}` object, and this port has no separate pre-validation layer
 * upstream of this function. This port therefore makes `splitPath`'s own
 * empty-path check the ONE place an empty path is rejected (always via
 * `InvalidOverrideError`, code `empty_path`) — same net behavior (reject
 * empty paths), different, simpler mechanism appropriate for a boundary
 * TypeScript does not otherwise have.
 */

import {
  structuralIssues,
  validateWorld,
  hasCatalogReferences,
  type ValidationIssue,
  type SongDoc,
} from './world_validation'

export type FieldOverride = { path: string; value: unknown }
export type FieldDiff = { path: string; before: unknown; after: unknown }
export type WorldDoc = Record<string, unknown>

/**
 * Raised for a malformed/unknown override path, a value that produces a
 * structurally invalid world, or an override that leaves a dangling catalog
 * reference. Carries `.issues` so callers can render field-level detail —
 * mirrors Python's `InvalidOverrideError`.
 */
export class InvalidOverrideError extends Error {
  readonly issues: ValidationIssue[]
  constructor(issues: ValidationIssue[]) {
    super(issues.map((i) => i.message).join('; ') || 'Invalid override.')
    this.name = 'InvalidOverrideError'
    this.issues = issues
  }
}

function issue(path: string, code: string, message: string): ValidationIssue {
  return { path, code, message }
}

/** Mirrors Python's `str.__repr__` for a plain identifier-like string (single-quoted). */
function pyReprStr(s: string): string {
  return `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
}

type PathToken = string | number

/** Mirrors Python's `{token!r}` — an int token reprs bare, a string token quoted. */
function pyReprToken(token: PathToken): string {
  return typeof token === 'number' ? String(token) : pyReprStr(token)
}

function deepCopy<T>(value: T): T {
  if (Array.isArray(value)) return value.map((v) => deepCopy(v)) as unknown as T
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = deepCopy(v)
    return out as unknown as T
  }
  return value
}

// ---------------------------------------------------------------------------
// Dotted/bracketed path traversal — "situation.drowsiness_level",
// "driver_profile.played_items[0].track_id", etc. Mirrors `_split_path`,
// `_get_at_path`, `_set_at_path`.
// ---------------------------------------------------------------------------

const PATH_SEGMENT_RE = /^([^[\]]+)((?:\[\d+\])*)$/
const BRACKET_INDEX_RE = /\[(\d+)\]/g

/** Split a dotted/bracketed override path into dict keys / list indices. */
function splitPath(path: string): PathToken[] {
  if (!path) {
    throw new InvalidOverrideError([issue('', 'empty_path', 'Override path must not be empty.')])
  }
  const tokens: PathToken[] = []
  for (const segment of path.split('.')) {
    const match = PATH_SEGMENT_RE.exec(segment)
    if (!match || !match[1]) {
      throw new InvalidOverrideError([
        issue(path, 'malformed_path', `Malformed override path segment: ${pyReprStr(segment)}.`),
      ])
    }
    const [, key, brackets] = match
    tokens.push(key)
    for (const m of brackets.matchAll(BRACKET_INDEX_RE)) tokens.push(Number(m[1]))
  }
  return tokens
}

/** Single-step index into `node` by `token` (dict key or list/string index),
 * mirroring Python's generic `node[token]` plus its `except (KeyError,
 * IndexError, TypeError)` catch-all — one shape, regardless of container kind. */
function tryIndex(node: unknown, token: PathToken): { ok: true; value: unknown } | { ok: false } {
  if (typeof token === 'number') {
    if (Array.isArray(node) && token >= 0 && token < node.length) return { ok: true, value: node[token] }
    if (typeof node === 'string' && token >= 0 && token < node.length) return { ok: true, value: node[token] }
    return { ok: false }
  }
  if (node !== null && typeof node === 'object' && !Array.isArray(node) && Object.prototype.hasOwnProperty.call(node, token)) {
    return { ok: true, value: (node as Record<string, unknown>)[token] }
  }
  return { ok: false }
}

function getAtPath(data: unknown, tokens: PathToken[], fullPath: string): unknown {
  let node = data
  for (const token of tokens) {
    const next = tryIndex(node, token)
    if (!next.ok) {
      throw new InvalidOverrideError([
        issue(fullPath, 'unknown_override_path', `Unknown override path: ${pyReprStr(fullPath)} (no such field ${pyReprToken(token)}).`),
      ])
    }
    node = next.value
  }
  return node
}

function setAtPath(data: unknown, tokens: PathToken[], value: unknown, fullPath: string): void {
  const node = tokens.length > 1 ? getAtPath(data, tokens.slice(0, -1), fullPath) : data
  const last = tokens[tokens.length - 1]
  if (typeof last === 'number') {
    if (!Array.isArray(node) || !(last >= 0 && last < node.length)) {
      throw new InvalidOverrideError([
        issue(fullPath, 'unknown_override_path', `Unknown override path: ${pyReprStr(fullPath)} (list index ${last} out of range).`),
      ])
    }
    ;(node as unknown[])[last] = value
  } else {
    if (node === null || typeof node !== 'object' || Array.isArray(node)) {
      throw new InvalidOverrideError([
        issue(fullPath, 'unknown_override_path', `Unknown override path: ${pyReprStr(fullPath)} (not an object at ${pyReprStr(last)}).`),
      ])
    }
    ;(node as Record<string, unknown>)[last] = value
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Apply `overrides` onto `baseWorld` and return `(world, diffs)`.
 *
 * Pure, no persistence, no side effects. An EMPTY `overrides` array is
 * allowed: it returns `baseWorld` unchanged (same reference) with an empty
 * diff, never throwing.
 *
 * Each override is applied at its dotted/bracketed path onto a deep copy of
 * `baseWorld`, the result is re-validated as a complete World, and (when
 * `catalog` is supplied, or the resulting world has catalog references and
 * none was supplied) checked for dangling catalog references.
 *
 * @throws InvalidOverrideError malformed/unknown path, a value that makes
 *   the resulting world structurally invalid, or a dangling/unresolvable
 *   catalog reference. Carries `.issues`.
 */
export function applyOverrides(
  baseWorld: WorldDoc,
  overrides: FieldOverride[],
  options?: { catalog?: SongDoc[] | null },
): { world: WorldDoc; diffs: FieldDiff[] } {
  if (overrides.length === 0) {
    return { world: baseWorld, diffs: [] }
  }

  const baseDict = deepCopy(baseWorld)
  const clonedDict = deepCopy(baseDict)

  const diffs: FieldDiff[] = []
  for (const override of overrides) {
    const tokens = splitPath(override.path)
    const before = getAtPath(baseDict, tokens, override.path)
    setAtPath(clonedDict, tokens, override.value, override.path)
    const after = getAtPath(clonedDict, tokens, override.path)
    diffs.push({ path: override.path, before, after })
  }

  const structural = structuralIssues(clonedDict)
  if (structural.length > 0) {
    throw new InvalidOverrideError(structural)
  }

  const catalog = options?.catalog
  if (catalog !== undefined && catalog !== null) {
    const issues = validateWorld(clonedDict, catalog)
    if (issues.length > 0) throw new InvalidOverrideError(issues)
  } else if (hasCatalogReferences(clonedDict)) {
    // An unresolvable/missing catalog for a world that DOES reference the
    // catalog is a validation error, never a silent skip.
    const datasetId = (clonedDict.control_inputs as Record<string, unknown> | undefined)?.dataset_id
    throw new InvalidOverrideError([
      issue(
        'control_inputs.dataset_id',
        'unresolvable_catalog',
        `Cannot validate catalog references for dataset ${pyReprStr(String(datasetId))}: no catalog was ` +
          'supplied (unknown/quarantined dataset), but the world contains catalog references that would ' +
          'need checking.',
      ),
    ])
  }

  return { world: clonedDict, diffs }
}
