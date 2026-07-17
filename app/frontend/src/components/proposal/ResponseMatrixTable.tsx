/**
 * ResponseMatrixTable — dedicated editor for the response-coefficient
 * PARAMETERS (`service_response_profiles`, `road_response_profiles`), shaped
 * `{ service: { rowKey: { coefficient, provenance?, source_reference? } } }`.
 *
 * Renders the mockup's `response_matrix` grammar (ui-mockup.html §"② SERVICE"):
 * a pivot with rows = feature/road keys, columns = services, and an editable
 * `coefficient` in each cell. The real data is kept intact — editing a cell
 * updates ONLY that cell's `coefficient` and preserves its `provenance` /
 * `source_reference` (surfaced on hover via the cell `title`). Nothing is
 * flattened away or made read-only.
 */
import { mtxTableStyle, mtxThStyle, mtxTdStyle, mtxRowLabelStyle, mtxCornerStyle, mtxInputStyle } from './matrixStyles'

type Cell = { coefficient?: number; provenance?: string; source_reference?: string }
type Profiles = Record<string, Record<string, Cell>>

export type ResponseMatrixTableProps = {
  /** `{ service: { rowKey: { coefficient, provenance?, ... } } }`. */
  value: Profiles
  /** Receives the FULL updated profiles object (caller stores it as a param override). */
  onChange: (next: Profiles) => void
  /** Label for the top-left corner cell, e.g. "feature ＼ service". */
  cornerLabel?: string
}

/** Union of inner row keys across all services (services are uniform in the
 * real manifest, but union keeps this robust to partially-specified profiles). */
function rowKeysOf(value: Profiles): string[] {
  const seen = new Set<string>()
  const ordered: string[] = []
  for (const service of Object.keys(value)) {
    for (const rk of Object.keys(value[service] ?? {})) {
      if (!seen.has(rk)) {
        seen.add(rk)
        ordered.push(rk)
      }
    }
  }
  return ordered
}

export default function ResponseMatrixTable({ value, onChange, cornerLabel = '' }: ResponseMatrixTableProps) {
  const services = Object.keys(value)
  const rows = rowKeysOf(value)

  function editCell(service: string, row: string, raw: string) {
    const n = Number(raw)
    const prev = value[service]?.[row] ?? {}
    // Immutable update — replace ONLY this cell's coefficient, keep everything else.
    onChange({
      ...value,
      [service]: {
        ...value[service],
        [row]: { ...prev, coefficient: Number.isNaN(n) ? prev.coefficient : n },
      },
    })
  }

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={mtxTableStyle}>
        <thead>
          <tr>
            <th style={mtxCornerStyle}>{cornerLabel}</th>
            {services.map((s) => (
              <th key={s} style={mtxThStyle}>
                {s}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row}>
              <th scope="row" style={mtxRowLabelStyle}>
                {row}
              </th>
              {services.map((s) => {
                const cell = value[s]?.[row] ?? {}
                const title = [cell.provenance, cell.source_reference].filter(Boolean).join(' — ')
                return (
                  <td key={s} style={mtxTdStyle} title={title || undefined}>
                    <input
                      style={mtxInputStyle}
                      data-testid={`resp-cell-${s}-${row}`}
                      value={String(cell.coefficient ?? '')}
                      onChange={(e) => editCell(s, row, e.target.value)}
                    />
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
