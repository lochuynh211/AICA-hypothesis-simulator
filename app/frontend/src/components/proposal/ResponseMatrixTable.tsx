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
import type { UiLanguage } from '../../i18n/t'
import { t } from '../../i18n/t'
import { mtxTableStyle, mtxThStyle, mtxTdStyle, mtxRowLabelStyle, mtxCornerStyle, mtxInputStyle } from './matrixStyles'
import { fieldName, isKnownOption, optionLabel, serviceLabel } from '../../lib/review/reviewVocabulary'

type Cell = { coefficient?: number; provenance?: string; source_reference?: string }
type Profiles = Record<string, Record<string, Cell>>

export type ResponseMatrixTableProps = {
  /** `{ service: { rowKey: { coefficient, provenance?, ... } } }`. */
  value: Profiles
  /** Receives the FULL updated profiles object (caller stores it as a param override). */
  onChange: (next: Profiles) => void
  /** Label for the top-left corner cell, e.g. "feature ＼ service". */
  cornerLabel?: string
  /** Optional — defaults to English so an un-migrated caller keeps compiling;
   * a caller that owns a `lang` from `useLanguage()`/the store should pass it
   * through so the service/feature headers switch with the rest of the UI. */
  lang?: UiLanguage
}

/** `road_response_profiles` rows are ROAD-TYPE context values (`highway`,
 * `mountain_road`, ...), not feature ids — try the feature-id table first
 * (covers `service_response_profiles`' rows), then the road_type value
 * vocabulary, before falling back to "unnamed". */
function rowLabel(row: string, lang: UiLanguage): string {
  if (isKnownOption('road_type', row)) return t(optionLabel('road_type', row), lang)
  return t(fieldName(row), lang)
}

/** Provenance is a closed enum recorded per response cell — the citation text
 * next to it (`source_reference`, e.g. "Slide 67 driver row") is free-form
 * per-cell manifest data, out of this frontend component's reach to rewrite;
 * only the enum word itself is translated here. */
const PROVENANCE_LABELS: Record<string, { ja: string; en: string }> = {
  cdc_su_explicit: { ja: '仕様書に明記', en: 'Explicit in the specification' },
  cdc_su_direct_candidate_feature: { ja: '仕様書の候補特徴量から算出', en: "From the specification's candidate feature" },
  neutral_source_silent: { ja: '中立（出典なし）', en: 'Neutral, no supporting source' },
  post_rest_hypothesis: { ja: '休憩後の想定に基づく仮説値', en: 'Hypothesis based on post-rest assumptions' },
  normalized_context_hypothesis: { ja: '状況の正規化に基づく仮説値', en: 'Hypothesis based on normalized context' },
}

function provenanceLabel(provenance: string, lang: UiLanguage): string {
  const known = PROVENANCE_LABELS[provenance]
  return known ? t(known, lang) : t({ ja: '出典不明', en: 'Unknown source' }, lang)
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

// The default is the APP's default language, not English. A caller that
// forgets the prop then degrades to the language the rest of the screen is
// already in, rather than dropping English headers into a Japanese panel —
// which is exactly the bug that reached the Combined screen's setup popups.
export default function ResponseMatrixTable({ value, onChange, cornerLabel = '', lang = 'ja' }: ResponseMatrixTableProps) {
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
                {t(serviceLabel(s), lang)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row}>
              <th scope="row" style={mtxRowLabelStyle}>
                {rowLabel(row, lang)}
              </th>
              {services.map((s) => {
                const cell = value[s]?.[row] ?? {}
                const title = cell.provenance
                  ? [provenanceLabel(cell.provenance, lang), cell.source_reference].filter(Boolean).join(' — ')
                  : ''
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
