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
import {
  mtxTableStyle,
  mtxThStyle,
  mtxTdStyle,
  mtxRowLabelStyle,
  mtxCornerStyle,
  mtxInputStyle,
  nestedBlockStyle,
  nestedLabelStyle,
} from './matrixStyles'
import {
  fieldName,
  isKnownService,
  NODE_LABELS,
  nodeLabel,
  optionLabel,
  PURPOSE_LABELS,
  purposeLabel,
  serviceLabel,
} from '../../lib/review/reviewVocabulary'

const LABELS = {
  empty: { ja: '（空）', en: '(empty)' },
}

/**
 * Best-effort translation for a raw manifest/JSON key rendered as a matrix
 * row/column/section header. This renderer is generic over EVERY
 * hyperparameter shape, so the same raw key can be a proposal category
 * (`purpose_multipliers`), a service id, a judgement-axis node
 * (`Situation`/`driver_state`), or a feature id, depending on which
 * hyperparameter is being edited — tries each shared vocabulary in turn and
 * falls back to `fieldName()`'s own "unnamed" wording, never the raw key.
 */
function labelForKey(key: string, lang: UiLanguage): string {
  if (Object.prototype.hasOwnProperty.call(PURPOSE_LABELS, key)) return t(purposeLabel(key), lang)
  if (isKnownService(key)) return t(serviceLabel(key), lang)
  if (Object.prototype.hasOwnProperty.call(NODE_LABELS, key)) return t(nodeLabel(key), lang)
  return t(fieldName(key), lang)
}

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }

function isPlainObject(v: unknown): v is Record<string, JsonValue> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** An object all of whose own values are primitives (renders as one row of inputs). */
function isFlatObject(v: Record<string, JsonValue>): boolean {
  return Object.values(v).every((x) => !isPlainObject(x) && !Array.isArray(x))
}

/** An object whose every value is a NON-EMPTY flat object sharing the SAME key
 * set — a regular 2-D matrix (e.g. `purpose_multipliers`: subgroup × purpose).
 * Rendered as a single pivot table (rows = outer keys, columns = inner keys) so
 * the real data reads like the design mockup — nothing is flattened away, the
 * layout just matches the data's actual rectangular shape. */
function isPivotable(v: Record<string, JsonValue>): boolean {
  const rows = Object.values(v)
  if (rows.length === 0) return false
  if (!rows.every((r) => isPlainObject(r) && Object.keys(r).length > 0)) return false
  let total = 0
  let primitive = 0
  for (const r of rows) {
    for (const x of Object.values(r as Record<string, JsonValue>)) {
      total += 1
      if (!isPlainObject(x) && !Array.isArray(x)) primitive += 1
    }
  }
  return total > 0 && primitive / total >= 0.6
}

/** Union of inner keys across all rows, in first-seen order (the pivot columns). */
function pivotColumns(v: Record<string, JsonValue>): string[] {
  const seen = new Set<string>()
  const cols: string[] = []
  for (const r of Object.values(v)) {
    for (const k of Object.keys(r as Record<string, JsonValue>)) {
      if (!seen.has(k)) {
        seen.add(k)
        cols.push(k)
      }
    }
  }
  return cols
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
              {t(optionLabel(def.key, opt), lang)}
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
          lang={lang}
          onEdit={(path, leaf) => onChange(setAtPath((effective ?? {}) as JsonValue, path, leaf))}
        />
      </div>
    </div>
  )
}

function MatrixNode({
  value,
  path,
  lang,
  onEdit,
}: {
  value: JsonValue
  path: string[]
  lang: UiLanguage
  onEdit: (path: string[], leafValue: JsonValue) => void
}) {
  if (Array.isArray(value)) {
    // Read-only vocabulary/list values (e.g. genre_affinity_maps.vocabulary) —
    // editing a free-form list isn't a single-cell operation, so display only.
    return <div style={{ fontSize: '0.78em', color: '#6b7280' }}>{value.map((v) => String(v)).join(', ')}</div>
  }

  if (isPlainObject(value)) {
    const keys = Object.keys(value)
    if (keys.length === 0) {
      return <div style={{ fontSize: '0.78em', color: '#9ca3af', fontStyle: 'italic' }}>{t(LABELS.empty, lang)}</div>
    }

    // Regular 2-D matrix — a single pivot table: rows = outer keys (left label
    // column), columns = the UNION of inner keys. Handles ragged matrices
    // (trait × audio) and mostly-primitive ones (context × α/β/directional).
    // A missing cell shows a muted "·"; a rare nested cell shows compact text.
    if (isPivotable(value)) {
      const colKeys = pivotColumns(value)
      return (
        <table style={mtxTableStyle}>
          <thead>
            <tr>
              <th style={mtxCornerStyle} aria-hidden />
              {colKeys.map((c) => (
                <th key={c} style={mtxThStyle}>
                  {labelForKey(c, lang)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {keys.map((r) => {
              const row = value[r] as Record<string, JsonValue>
              return (
                <tr key={r}>
                  <th scope="row" style={mtxRowLabelStyle}>
                    {labelForKey(r, lang)}
                  </th>
                  {colKeys.map((c) => {
                    const cell = row[c]
                    if (cell === undefined) {
                      return (
                        <td key={c} style={{ ...mtxTdStyle, color: '#cbd5e1' }}>
                          ·
                        </td>
                      )
                    }
                    if (isPlainObject(cell) || Array.isArray(cell)) {
                      // Rare nested cell (e.g. context_response road α) — compact read-only text.
                      return (
                        <td key={c} style={{ ...mtxTdStyle, fontSize: '0.9em', color: '#6b7280' }}>
                          {Object.values(cell as Record<string, JsonValue>).map(String).join('/')}
                        </td>
                      )
                    }
                    return (
                      <td key={c} style={mtxTdStyle}>
                        <input
                          style={mtxInputStyle}
                          value={String(cell)}
                          onChange={(e) => onEdit([...path, r, c], coercePrimitive(e.target.value, cell))}
                        />
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      )
    }

    // Flat object (single row of scalars, e.g. category_weights) — a header row
    // of keys above one row of editable inputs.
    if (isFlatObject(value)) {
      return (
        <table style={mtxTableStyle}>
          <thead>
            <tr>
              {keys.map((k) => (
                <th key={k} style={mtxThStyle}>
                  {labelForKey(k, lang)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              {keys.map((k) => (
                <td key={k} style={mtxTdStyle}>
                  <input
                    style={mtxInputStyle}
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

    // Irregular / deep nesting (e.g. hierarchy_weights) — recurse per key with a
    // clean indented section header. Real depth is preserved (nothing hidden).
    return (
      <>
        {keys.map((k) => (
          <div key={k} style={nestedBlockStyle}>
            <div style={nestedLabelStyle}>{labelForKey(k, lang)}</div>
            <MatrixNode value={value[k]} path={[...path, k]} lang={lang} onEdit={onEdit} />
          </div>
        ))}
      </>
    )
  }

  // Bare primitive leaf at this path (rare at non-root depth).
  return (
    <input
      style={mtxInputStyle}
      value={String(value)}
      onChange={(e) => onEdit(path, coercePrimitive(e.target.value, value))}
    />
  )
}
