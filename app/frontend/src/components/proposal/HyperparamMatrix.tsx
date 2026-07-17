/**
 * HyperparamMatrix (P1 T025) — a reusable editable control that renders a
 * package hyperparameter's shape (from `ProposalPackageManifest.hyperparameters`)
 * as an editable form control:
 *
 *   - `numeric` / `enum` / `string` -> a single control (number input / select / text input)
 *   - `matrix` / `table` / `map`    -> a scroll-x table of inputs, recursing into
 *      nested objects (real manifests nest arbitrarily deep — e.g.
 *      `response_matrix.driving_services.music_playlist.drowsiness`)
 *
 * Editing has no effect on the mock selectors' fixed results (D8) — this
 * control exists so the reviewer can see and tune the real algorithm surface
 * against the real manifest shape.
 *
 * Controlled component: `value` is the current override (or `undefined` to
 * fall back to `def.default`); `onChange` receives the FULL new value for
 * this hyperparameter (the caller is responsible for storing it under
 * `hyperparameters[def.key]`).
 */
import type { UiLanguage } from '../../i18n/t'
import { t } from '../../i18n/t'
import type { HyperparameterDef } from '../../api/proposalClient'

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }

function isPlainObject(v: unknown): v is Record<string, JsonValue> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** An object all of whose own values are primitives (renders as one row of inputs). */
function isFlatObject(v: Record<string, JsonValue>): boolean {
  return Object.values(v).every((x) => !isPlainObject(x) && !Array.isArray(x))
}

/** Immutably set a value at `path` (array of keys) within `root`. */
function setAtPath(root: JsonValue, path: string[], leafValue: JsonValue): JsonValue {
  if (path.length === 0) return leafValue
  const [head, ...rest] = path
  const base = isPlainObject(root) ? root : {}
  return { ...base, [head]: setAtPath(base[head] ?? {}, rest, leafValue) }
}

function coercePrimitive(raw: string, original: JsonValue): JsonValue {
  if (typeof original === 'number') {
    const n = Number(raw)
    return Number.isNaN(n) ? raw : n
  }
  return raw
}

type Props = {
  def: HyperparameterDef
  value: unknown
  onChange: (next: unknown) => void
  lang: UiLanguage
  /** When true, suppress the internal label element (caller renders its own, e.g. a subslab header). */
  hideLabel?: boolean
}

export default function HyperparamMatrix({ def, value, onChange, lang, hideLabel = false }: Props) {
  const effective = value !== undefined ? value : def.default
  const inputId = `hpm-${def.key}`
  const labelText = t(def.label, lang)

  if (def.kind === 'numeric') {
    const min = def.min as number | undefined
    const max = def.max as number | undefined
    const step = def.step as number | undefined
    return (
      <div className="hpm-field" style={{ padding: '4px 0' }}>
        {!hideLabel && (
          <label htmlFor={inputId} style={{ display: 'block', fontSize: '0.8em', color: '#4b5563' }}>
            {labelText}
          </label>
        )}
        <input
          id={inputId}
          type="number"
          value={Number(effective)}
          min={min}
          max={max}
          step={step}
          aria-label={hideLabel ? labelText : undefined}
          onChange={(e) => onChange(Number(e.target.value))}
        />
      </div>
    )
  }

  if (def.kind === 'enum') {
    // `values` may be strings (e.g. `directional_hypothesis`) OR booleans
    // (e.g. `confidence_shrinkage_v1`, P5 T032) -- a bare
    // `onChange(e.target.value)` would always hand back a STRING
    // ("true"/"false"), silently turning an off-by-default boolean
    // hyperparameter truthy no matter what the reviewer picked. Match the
    // selected option's string form back to its ORIGINAL typed value from
    // `options` so booleans round-trip as booleans.
    const options = (def.values as (string | boolean)[] | undefined) ?? []
    return (
      <div className="hpm-field" style={{ padding: '4px 0' }}>
        {!hideLabel && (
          <label htmlFor={inputId} style={{ display: 'block', fontSize: '0.8em', color: '#4b5563' }}>
            {labelText}
          </label>
        )}
        <select
          id={inputId}
          value={String(effective)}
          aria-label={hideLabel ? labelText : undefined}
          onChange={(e) => {
            const raw = e.target.value
            const match = options.find((opt) => String(opt) === raw)
            onChange(match !== undefined ? match : raw)
          }}
        >
          {options.map((opt) => (
            <option key={String(opt)} value={String(opt)}>
              {String(opt)}
            </option>
          ))}
        </select>
      </div>
    )
  }

  if (def.kind === 'string') {
    return (
      <div className="hpm-field" style={{ padding: '4px 0' }}>
        {!hideLabel && (
          <label htmlFor={inputId} style={{ display: 'block', fontSize: '0.8em', color: '#4b5563' }}>
            {labelText}
          </label>
        )}
        <input
          id={inputId}
          type="text"
          value={String(effective)}
          aria-label={hideLabel ? labelText : undefined}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
    )
  }

  // matrix / table / map — a scroll-x table of inputs, recursing as needed.
  return (
    <div className="hpm-matrix" style={{ padding: '4px 0' }}>
      {!hideLabel && (
        <div style={{ fontSize: '0.8em', fontWeight: 700, color: '#4b5563', marginBottom: '4px' }}>{labelText}</div>
      )}
      <div style={{ overflowX: 'auto' }}>
        <MatrixNode
          value={(effective ?? {}) as JsonValue}
          path={[]}
          onEdit={(path, leaf) => onChange(setAtPath((effective ?? {}) as JsonValue, path, leaf))}
        />
      </div>
    </div>
  )
}

function MatrixNode({
  value,
  path,
  onEdit,
}: {
  value: JsonValue
  path: string[]
  onEdit: (path: string[], leafValue: JsonValue) => void
}) {
  if (Array.isArray(value)) {
    // Read-only vocabulary/list values (e.g. genre_affinity_maps.vocabulary) —
    // editing a free-form list isn't a single-cell operation, so display only.
    return <div style={{ fontSize: '0.78em', color: '#6b7280' }}>{value.map((v) => String(v)).join(', ')}</div>
  }

  if (isPlainObject(value)) {
    if (isFlatObject(value)) {
      const keys = Object.keys(value)
      return (
        <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '0.76em' }}>
          <thead>
            <tr>
              {keys.map((k) => (
                <th key={k} style={{ border: '1px solid #e5e7eb', padding: '3px 6px', background: '#f1f5f9' }}>
                  {k}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              {keys.map((k) => (
                <td key={k} style={{ border: '1px solid #e5e7eb', padding: '3px 6px', textAlign: 'center' }}>
                  <input
                    style={{ width: '56px', textAlign: 'center' }}
                    value={String(value[k])}
                    onChange={(e) => onEdit([...path, k], coercePrimitive(e.target.value, value[k]))}
                  />
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      )
    }

    // Nested (non-flat) object — recurse per key with a labeled sub-block.
    return (
      <>
        {Object.entries(value).map(([k, v]) => (
          <div key={k} style={{ margin: '4px 0' }}>
            <div style={{ fontSize: '0.7em', textTransform: 'uppercase', color: '#6b7280', fontWeight: 700 }}>{k}</div>
            <MatrixNode value={v} path={[...path, k]} onEdit={onEdit} />
          </div>
        ))}
      </>
    )
  }

  // Bare primitive leaf at this path (rare at non-root depth).
  return (
    <input
      style={{ width: '56px', textAlign: 'center' }}
      value={String(value)}
      onChange={(e) => onEdit(path, coercePrimitive(e.target.value, value))}
    />
  )
}
