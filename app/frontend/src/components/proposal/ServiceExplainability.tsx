/**
 * ServiceExplainability (P5 Unit D, T024) — the §14 explainability
 * enrichment for a ranked service candidate: the situation/preference/
 * history subtotals, the strongest supporting/opposing feature, the §6.4
 * and an expandable
 * per-feature table (feature name · raw value → evidence(e)·response
 * coefficient(a) = response value(r) × weight(w) = contribution(k) +
 * provenance — column headers are spelled-out words, never the bare
 * formula letters, and no row ever shows the raw feature id or a raw
 * categorical/boolean value).
 *
 * GRACEFUL FALLBACK (contracts/service_output_extension.md "Panel ③ render
 * contract"): when a candidate carries none of the optional §14 fields
 * (`mock_service_selector_v1`'s output — Panel ③'s pre-existing
 * `ReasonBreakdown` already renders that lean case), this component renders
 * NOTHING — no empty section headers, no crash. It only activates once the
 * REAL transparent package's evidence is present.
 *
 * FR-023 guard: every label here is phrased as a *weight/priority* readout
 * ("safety priority preserved/not guaranteed", "safety-relevant weight
 * share") — never as an acceptance/recovery probability or a safety
 * certification (see `proposal_service_panel.test.tsx`'s
 * "no forbidden phrasing" assertion).
 */
import { useState } from 'react'
import type { UiLanguage } from '../../i18n/t'
import { t } from '../../i18n/t'
import type { RankedCandidate } from '../../api/proposalClient'
import { booleanLabel, fieldName, isKnownOption, nodeLabel, optionLabel } from '../../lib/review/reviewVocabulary'

const LABELS = {
  subtotalsTitle: { ja: '内訳（状況・好み・過去実績）', en: 'Subtotals (situation · preference · history)' },
  strongestSupport: { ja: '最も支持する特徴量', en: 'Strongest support' },
  strongestOppose: { ja: '最も反対する特徴量', en: 'Strongest opposition' },
  none: { ja: 'なし', en: 'None' },
  tableSummary: { ja: '特徴量トレース（全項目）', en: 'Feature trace (all rows)' },
  colFeature: { ja: '特徴量', en: 'Feature' },
  colRaw: { ja: '元値', en: 'Raw' },
  colE: { ja: '証拠', en: 'Evidence' },
  colA: { ja: '応答係数', en: 'Response coefficient' },
  colR: { ja: '応答値', en: 'Response value' },
  colW: { ja: '重み', en: 'Weight' },
  colK: { ja: '寄与', en: 'Contribution' },
}

function fmt(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—'
  return n.toFixed(3)
}

/** A per-feature "raw value" cell — some rows carry a categorical value
 * (`night`/`congested`, or an actual boolean for the `child_present`-style
 * features), never a formatted number. Both must render as words: never the
 * enum literal, never the English `true`/`false` a JS boolean stringifies to. */
function fmtRaw(featureId: string, raw: unknown, lang: UiLanguage): string {
  if (raw === null || raw === undefined || raw === '') return '—'
  if (typeof raw === 'boolean') return t(booleanLabel(raw), lang)
  if (typeof raw === 'string' && isKnownOption(featureId, raw)) return t(optionLabel(featureId, raw), lang)
  return String(raw)
}

export type ServiceExplainabilityProps = {
  candidate: RankedCandidate
  lang: UiLanguage
}

/** Does this candidate carry ANY of the P5 §14 optional extension fields? */
export function hasExplainability(candidate: RankedCandidate): boolean {
  if (candidate.situation_fit != null || candidate.preference_fit != null || candidate.history_fit != null) {
    return true
  }
  if (candidate.strongest_support != null || candidate.strongest_oppose != null) return true
  return candidate.feature_contributions.some((fc) => fc.normalized_evidence != null || fc.status != null)
}

/** Does this candidate carry the rich §14 per-feature trace (evidence detail)? */
export function hasFeatureTrace(candidate: RankedCandidate): boolean {
  return candidate.feature_contributions.some((fc) => fc.normalized_evidence != null)
}

export default function ServiceExplainability({ candidate, lang }: ServiceExplainabilityProps) {
  const [traceExpanded, setTraceExpanded] = useState(false)

  if (!hasExplainability(candidate)) return null

  const hasSubtotals =
    candidate.situation_fit != null || candidate.preference_fit != null || candidate.history_fit != null
  const showFeatureTrace = hasFeatureTrace(candidate)

  const TOP_N = 5
  const sortedContribs = [...candidate.feature_contributions].sort(
    (a, b) => Math.abs(b.contribution) - Math.abs(a.contribution),
  )
  const visibleContribs = traceExpanded ? sortedContribs : sortedContribs.slice(0, TOP_N)
  const hiddenCount = sortedContribs.length - visibleContribs.length

  return (
    <div data-testid="service-explainability" style={{ borderTop: '1px solid #e5e7eb', padding: '8px 10px' }}>
      {hasSubtotals && (
        <div data-testid="service-subtotals" style={{ marginBottom: '8px' }}>
          <div style={miniLabelStyle}>{t(LABELS.subtotalsTitle, lang)}</div>
          <div style={{ display: 'flex', gap: '10px', fontSize: '0.8em', fontFamily: 'monospace' }}>
            <span>
              {t(nodeLabel('Situation'), lang)}: {fmt(candidate.situation_fit)}
            </span>
            <span>
              {t(nodeLabel('Preference'), lang)}: {fmt(candidate.preference_fit)}
            </span>
            <span>
              {t(nodeLabel('History'), lang)}: {fmt(candidate.history_fit)}
            </span>
          </div>
          <div style={{ marginTop: '4px', fontSize: '0.78em', color: '#4b5563' }}>
            <b>{t(LABELS.strongestSupport, lang)}:</b>{' '}
            <span data-testid="strongest-support">
              {candidate.strongest_support
                ? `${t(fieldName(candidate.strongest_support.feature_id), lang)} (+${fmt(candidate.strongest_support.contribution)})`
                : t(LABELS.none, lang)}
            </span>{' '}
            <b>{t(LABELS.strongestOppose, lang)}:</b>{' '}
            <span data-testid="strongest-oppose">
              {candidate.strongest_oppose
                ? `${t(fieldName(candidate.strongest_oppose.feature_id), lang)} (${fmt(candidate.strongest_oppose.contribution)})`
                : t(LABELS.none, lang)}
            </span>
          </div>
        </div>
      )}

      {showFeatureTrace && (
        <details data-testid="service-explainability-table">
          <summary style={{ cursor: 'pointer', fontSize: '0.8em', fontWeight: 700, color: '#1d4ed8' }}>
            {t(LABELS.tableSummary, lang)} <span>({candidate.feature_contributions.length})</span>
          </summary>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '0.76em' }}>
              <thead>
                <tr>
                  {[
                    LABELS.colFeature,
                    LABELS.colRaw,
                    LABELS.colE,
                    LABELS.colA,
                    LABELS.colR,
                    LABELS.colW,
                    LABELS.colK,
                  ].map((label, idx) => (
                    <th key={idx} style={thStyle}>
                      {t(label, lang)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visibleContribs.map((fc) => {
                  const muted = fc.status === 'missing' || fc.status === 'neutral'
                  return (
                    <tr
                      key={fc.feature_id}
                      data-testid={`explain-row-${fc.feature_id}`}
                      style={muted ? mutedRowStyle : undefined}
                    >
                      <td style={tdStyle}>{t(fieldName(fc.feature_id), lang)}</td>
                      <td style={tdStyleMono}>{fmtRaw(fc.feature_id, fc.raw_value ?? fc.feature_value, lang)}</td>
                      <td style={tdStyleMono}>{fmt(fc.normalized_evidence)}</td>
                      <td style={tdStyleMono}>{fmt(fc.response_coefficient)}</td>
                      <td style={tdStyleMono}>{fmt(fc.normalized_feature_response)}</td>
                      <td style={tdStyleMono}>{fmt(fc.effective_weight ?? fc.weight)}</td>
                      <td style={tdStyleMono}>{fmt(fc.contribution)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {(hiddenCount > 0 || traceExpanded) && (
            <button
              type="button"
              data-testid="trace-show-more"
              onClick={() => setTraceExpanded((v) => !v)}
              style={{
                margin: '6px 0',
                fontSize: '0.76em',
                color: '#1d4ed8',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                padding: 0,
              }}
            >
              {traceExpanded
                ? t({ ja: '折りたたむ', en: 'Show fewer' }, lang)
                : t({ ja: `他 ${hiddenCount} 件を表示`, en: `Show ${hiddenCount} more` }, lang)}
            </button>
          )}
        </details>
      )}
    </div>
  )
}

const miniLabelStyle: React.CSSProperties = {
  fontSize: '0.68em',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  fontWeight: 800,
  color: '#6b7280',
  marginBottom: '3px',
}

const thStyle: React.CSSProperties = {
  textAlign: 'right',
  padding: '3px 6px',
  borderBottom: '1px solid #e5e7eb',
}

const tdStyle: React.CSSProperties = {
  padding: '3px 6px',
  borderBottom: '1px solid #f1f5f9',
}

const tdStyleMono: React.CSSProperties = {
  padding: '3px 6px',
  textAlign: 'right',
  borderBottom: '1px solid #f1f5f9',
  fontFamily: 'monospace',
}

const mutedRowStyle: React.CSSProperties = {
  filter: 'blur(1.5px)',
  opacity: 0.45,
  pointerEvents: 'none',
}
