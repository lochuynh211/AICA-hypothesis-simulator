/**
 * ServiceExplainability (P5 Unit D, T024) — the §14 explainability
 * enrichment for a ranked service candidate: the situation/preference/
 * history subtotals, the strongest supporting/opposing feature, the §6.4
 * dominance readout (status + safety_share %), and an expandable
 * per-feature table (`feature_id · raw_value → e·a = r × w = k` +
 * provenance).
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
import type { UiLanguage } from '../../i18n/t'
import { t } from '../../i18n/t'
import type { RankedCandidate } from '../../api/proposalClient'

const LABELS = {
  subtotalsTitle: { ja: '内訳（状況・嗜好・履歴）', en: 'Subtotals (situation · preference · history)' },
  situation: { ja: '状況', en: 'Situation' },
  preference: { ja: '嗜好', en: 'Preference' },
  history: { ja: '履歴', en: 'History' },
  strongestSupport: { ja: '最も支持する特徴量', en: 'Strongest support' },
  strongestOppose: { ja: '最も反対する特徴量', en: 'Strongest opposition' },
  none: { ja: 'なし', en: 'None' },
  dominanceTitle: { ja: '安全優先度チェック', en: 'Safety-priority check' },
  dominancePreserved: { ja: '安全優先が確保されています', en: 'Safety priority preserved' },
  dominanceNotGuaranteed: { ja: '安全優先を確保できていません（設定要確認）', en: 'Safety priority NOT guaranteed — review configuration' },
  safetyShare: { ja: '安全関連特徴量の配分', en: 'Safety-relevant weight share' },
  requiredGap: { ja: '必要な差（この配分での目安）', en: 'Required gap (for this weight share)' },
  safetyShareWarning: { ja: '配分が下限を下回っています', en: 'Below the safety-share warning floor' },
  tableSummary: { ja: '特徴量トレース（全項目）', en: 'Feature trace (all rows)' },
  colFeature: { ja: '特徴量', en: 'Feature' },
  colRaw: { ja: '元値', en: 'Raw' },
  colE: { ja: 'e（証拠）', en: 'e (evidence)' },
  colA: { ja: 'a（応答係数）', en: 'a (response)' },
  colR: { ja: 'r=e·a', en: 'r=e·a' },
  colW: { ja: 'w（重み）', en: 'w (weight)' },
  colK: { ja: 'k=r×w', en: 'k=r×w' },
  colProvenance: { ja: '根拠', en: 'Provenance' },
  colStatus: { ja: '状態', en: 'Status' },
}

function fmt(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—'
  return n.toFixed(3)
}

function fmtPercent(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—'
  return `${(n * 100).toFixed(1)}%`
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
  if (candidate.dominance != null) return true
  if (candidate.strongest_support != null || candidate.strongest_oppose != null) return true
  return candidate.feature_contributions.some((fc) => fc.normalized_evidence != null || fc.status != null)
}

/** Does this candidate carry the rich §14 per-feature trace (evidence detail)? */
export function hasFeatureTrace(candidate: RankedCandidate): boolean {
  return candidate.feature_contributions.some((fc) => fc.normalized_evidence != null)
}

export default function ServiceExplainability({ candidate, lang }: ServiceExplainabilityProps) {
  if (!hasExplainability(candidate)) return null

  const hasSubtotals =
    candidate.situation_fit != null || candidate.preference_fit != null || candidate.history_fit != null
  const dominance = candidate.dominance
  const showFeatureTrace = hasFeatureTrace(candidate)

  return (
    <div data-testid="service-explainability" style={{ borderTop: '1px solid #e5e7eb', padding: '8px 10px' }}>
      {hasSubtotals && (
        <div data-testid="service-subtotals" style={{ marginBottom: '8px' }}>
          <div style={miniLabelStyle}>{t(LABELS.subtotalsTitle, lang)}</div>
          <div style={{ display: 'flex', gap: '10px', fontSize: '0.8em', fontFamily: 'monospace' }}>
            <span>
              {t(LABELS.situation, lang)}: {fmt(candidate.situation_fit)}
            </span>
            <span>
              {t(LABELS.preference, lang)}: {fmt(candidate.preference_fit)}
            </span>
            <span>
              {t(LABELS.history, lang)}: {fmt(candidate.history_fit)}
            </span>
          </div>
          <div style={{ marginTop: '4px', fontSize: '0.78em', color: '#4b5563' }}>
            <b>{t(LABELS.strongestSupport, lang)}:</b>{' '}
            <span data-testid="strongest-support">
              {candidate.strongest_support
                ? `${candidate.strongest_support.feature_id} (+${fmt(candidate.strongest_support.contribution)})`
                : t(LABELS.none, lang)}
            </span>{' '}
            <b>{t(LABELS.strongestOppose, lang)}:</b>{' '}
            <span data-testid="strongest-oppose">
              {candidate.strongest_oppose
                ? `${candidate.strongest_oppose.feature_id} (${fmt(candidate.strongest_oppose.contribution)})`
                : t(LABELS.none, lang)}
            </span>
          </div>
        </div>
      )}

      {dominance && (
        <div
          data-testid="service-dominance"
          style={{
            marginBottom: '8px',
            padding: '6px 9px',
            borderRadius: '7px',
            fontSize: '0.8em',
            background: dominance.status === 'default_dominance_preserved' ? '#ecfdf5' : '#fffbeb',
            border: `1px solid ${dominance.status === 'default_dominance_preserved' ? '#a7f3d0' : '#fcd34d'}`,
          }}
        >
          <div style={{ fontWeight: 700 }}>{t(LABELS.dominanceTitle, lang)}</div>
          <div data-testid="dominance-status">
            {dominance.status === 'default_dominance_preserved'
              ? t(LABELS.dominancePreserved, lang)
              : t(LABELS.dominanceNotGuaranteed, lang)}
          </div>
          <div style={{ fontFamily: 'monospace' }}>
            {t(LABELS.safetyShare, lang)}: <span data-testid="safety-share">{fmtPercent(dominance.safety_share)}</span>
            {dominance.status !== 'default_dominance_preserved' && (
              <>
                {' · '}
                {t(LABELS.requiredGap, lang)}: {fmt(dominance.required_gap)}
              </>
            )}
          </div>
          {dominance.safety_share_warning && (
            <div style={{ color: '#b45309', fontWeight: 700 }}>{t(LABELS.safetyShareWarning, lang)}</div>
          )}
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
                    LABELS.colProvenance,
                    LABELS.colStatus,
                  ].map((label, idx) => (
                    <th key={idx} style={thStyle}>
                      {t(label, lang)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {candidate.feature_contributions.map((fc) => (
                  <tr key={fc.feature_id} data-testid={`explain-row-${fc.feature_id}`}>
                    <td style={tdStyle}>{fc.feature_id}</td>
                    <td style={tdStyleMono}>{fc.raw_value ?? fc.feature_value}</td>
                    <td style={tdStyleMono}>{fmt(fc.normalized_evidence)}</td>
                    <td style={tdStyleMono}>{fmt(fc.response_coefficient)}</td>
                    <td style={tdStyleMono}>{fmt(fc.normalized_feature_response)}</td>
                    <td style={tdStyleMono}>{fmt(fc.effective_weight ?? fc.weight)}</td>
                    <td style={tdStyleMono}>{fmt(fc.contribution)}</td>
                    <td style={tdStyle}>{fc.response_provenance ?? '—'}</td>
                    <td style={tdStyle}>{fc.status ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
