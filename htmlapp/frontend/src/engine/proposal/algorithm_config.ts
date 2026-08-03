/**
 * Pure algorithm-config deep-merge — port of `services/algorithm_config.py`
 * (`merge_algorithm_config`, `_deep_merge_into`; feature 018 — Proposal
 * Preset Test-Cases).
 *
 * Deep-merges a preset's per-selector `algorithm_config_overrides` sub-dict
 * (`content` or `service` — `models/proposal/preset.py::AlgorithmConfigOverrides`)
 * over a package's already-resolved `hyperparameters`/`parameters` dict, at
 * dispatch time only — mirrors the Python module's own docstring: overrides
 * never mutate a package's own committed manifest; the merge operates on a
 * fresh copy every call.
 *
 * Deliberately pure (no IO, no clock/random) — trivially unit-testable and
 * safe to call on every dispatch, exactly like the Python original.
 */

export type JsonRecord = Record<string, unknown>

/**
 * Return a deep copy of `defaults` with `overrides` deep-merged over it.
 *
 * `defaults` is NEVER mutated — a fresh deep copy is always returned, even
 * when `overrides` is `null`/`undefined`/`{}` (isolation: repeated calls
 * against the same `defaults` never accumulate state across dispatches).
 * Nested dict-vs-dict pairs merge key-by-key, recursively; any non-dict
 * override value (including an array/scalar) REPLACES the corresponding
 * default value wholesale — only dict-vs-dict pairs recurse. Mirrors
 * Python's `isinstance(value, dict)` check: a JS array is never treated as a
 * mergeable dict, matching Python (a `list` is not a `dict`).
 */
export function mergeAlgorithmConfig(
  defaults: JsonRecord,
  overrides: JsonRecord | null | undefined,
): JsonRecord {
  const merged = deepCopy(defaults)
  if (!overrides || Object.keys(overrides).length === 0) return merged
  deepMergeInto(merged, overrides)
  return merged
}

/** Recursively merge `overrides` into `target` IN PLACE — mirrors `_deep_merge_into`. */
function deepMergeInto(target: JsonRecord, overrides: JsonRecord): void {
  for (const [key, value] of Object.entries(overrides)) {
    const existing = target[key]
    if (isPlainObject(value) && isPlainObject(existing)) {
      deepMergeInto(existing, value)
    } else {
      target[key] = deepCopy(value)
    }
  }
}

function isPlainObject(value: unknown): value is JsonRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** JSON-safe deep copy — mirrors Python's `copy.deepcopy` over the JSON-only
 * dict/list/scalar values this module ever operates on (hyperparameters /
 * parameters config, never a class instance). */
function deepCopy<T>(value: T): T {
  if (Array.isArray(value)) return value.map((v) => deepCopy(v)) as unknown as T
  if (isPlainObject(value)) {
    const out: JsonRecord = {}
    for (const [k, v] of Object.entries(value)) out[k] = deepCopy(v)
    return out as unknown as T
  }
  return value
}
