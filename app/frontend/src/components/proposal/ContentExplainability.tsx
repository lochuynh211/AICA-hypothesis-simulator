/**
 * ContentExplainability — the content-side mirror of ServiceExplainability
 * for a single ordered plan item. Renders the §14 roll-up now emitted by the
 * transparent content selector: the situation / preference / history
 * subtotals, the strongest supporting / opposing feature, and an expandable
 * per-feature trace table (`feature · e · a · r=e·a · w · k=r×w`).
 *
 * The trace is ordered by |contribution| descending, shows the top 5 by
 * default with the rest behind a toggle, and blurs zero-contribution rows
 * (kept in the DOM, visually suppressed).
 *
 * GRACEFUL FALLBACK: when an item carries none of the §14 fields (LLM-shaped
 * plans, or the P1 mock content package), this renders NOTHING.
 */
import { useState } from 'react'
import type { UiLanguage } from '../../i18n/t'
import { t } from '../../i18n/t'
import type { OrderedItem } from '../../api/proposalClient'

const LABELS = {
  subtotalsTitle: { ja: '内訳（状況・嗜好・履歴）', en: 'Subtotals (situation · preference · history)' },
  situation: { ja: '状況', en: 'Situation' },
  preference: { ja: '嗜好', en: 'Preference' },
  history: { ja: '履歴', en: 'History' },
  strongestSupport: { ja: '最も支持する特徴量', en: 'Strongest support' },
  strongestOppose: { ja: '最も反対する特徴量', en: 'Strongest opposition' },
  none: { ja: 'なし', en: 'None' },
  tableSummary: { ja: '特徴量トレース', en: 'Feature trace' },
  colFeature: { ja: '特徴量', en: 'Feature' },
  colE: { ja: 'e（証拠）', en: 'e (evidence)' },
  colA: { ja: 'a（応答係数）', en: 'a (response)' },
  colR: { ja: 'r=e·a', en: 'r=e·a' },
  colW: { ja: 'w（重み）', en: 'w (weight)' },
  colK: { ja: 'k=r×w', en: 'k=r×w' },
}

function fmt(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—'
  return n.toFixed(3)
}

const TOP_N = 5

export function hasContentExplainability(item: OrderedItem): boolean {
  return (
    item.situation_fit != null ||
    item.preference_fit != null ||
    item.history_fit != null ||
    item.strongest_support != null ||
    item.strongest_oppose != null
  )
}

export default function ContentExplainability({ item, lang }: { item: OrderedItem; lang: UiLanguage }) {
  const [expanded, setExpanded] = useState(false)
  if (!hasContentExplainability(item)) return null

  const sorted = [...item.feature_contributions].sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution))
  const visible = expanded ? sorted : sorted.slice(0, TOP_N)
  const hiddenCount = sorted.length - visible.length

  return (
    <div data-testid="content-explainability" style={{ borderTop: '1px solid #e5e7eb', padding: '8px 10px' }}>
      <div data-testid="content-subtotals" style={{ marginBottom: '8px' }}>
        <div style={miniLabelStyle}>{t(LABELS.subtotalsTitle, lang)}</div>
        <div style={{ display: 'flex', gap: '10px', fontSize: '0.8em', fontFamily: 'monospace' }}>
          <span>
            {t(LABELS.situation, lang)}: {fmt(item.situation_fit)}
          </span>
          <span>
            {t(LABELS.preference, lang)}: {fmt(item.preference_fit)}
          </span>
          <span>
            {t(LABELS.history, lang)}: {fmt(item.history_fit)}
          </span>
        </div>
        <div style={{ marginTop: '4px', fontSize: '0.78em', color: '#4b5563' }}>
          <b>{t(LABELS.strongestSupport, lang)}:</b>{' '}
          <span data-testid="content-strongest-support">
            {item.strongest_support
              ? `${item.strongest_support.feature_id} (+${fmt(item.strongest_support.contribution)})`
              : t(LABELS.none, lang)}
          </span>{' '}
          <b>{t(LABELS.strongestOppose, lang)}:</b>{' '}
          <span data-testid="content-strongest-oppose">
            {item.strongest_oppose
              ? `${item.strongest_oppose.feature_id} (${fmt(item.strongest_oppose.contribution)})`
              : t(LABELS.none, lang)}
          </span>
        </div>
      </div>

      {item.feature_contributions.length > 0 && (
        <details data-testid="content-explainability-table">
          <summary style={{ cursor: 'pointer', fontSize: '0.8em', fontWeight: 700, color: '#7c3aed' }}>
            {t(LABELS.tableSummary, lang)} <span>({item.feature_contributions.length})</span>
          </summary>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '0.76em' }}>
              <thead>
                <tr>
                  {[LABELS.colFeature, LABELS.colE, LABELS.colA, LABELS.colR, LABELS.colW, LABELS.colK].map(
                    (label, idx) => (
                      <th key={idx} style={thStyle}>
                        {t(label, lang)}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {visible.map((fc) => {
                  const muted = fc.contribution === 0
                  return (
                    <tr
                      key={fc.feature_id}
                      data-testid={`content-explain-row-${fc.feature_id}`}
                      style={muted ? mutedRowStyle : undefined}
                    >
                      <td style={tdStyle}>{fc.feature_id}</td>
                      <td style={tdStyleMono}>{fmt(fc.e_i)}</td>
                      <td style={tdStyleMono}>{fmt(fc.a_i)}</td>
                      <td style={tdStyleMono}>{fmt(fc.r_i)}</td>
                      <td style={tdStyleMono}>{fmt(fc.effective_weight)}</td>
                      <td style={tdStyleMono}>{fmt(fc.contribution)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {(hiddenCount > 0 || expanded) && (
            <button
              type="button"
              data-testid="content-trace-show-more"
              onClick={() => setExpanded((v) => !v)}
              style={{
                margin: '6px 0',
                fontSize: '0.76em',
                color: '#7c3aed',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                padding: 0,
              }}
            >
              {expanded
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
