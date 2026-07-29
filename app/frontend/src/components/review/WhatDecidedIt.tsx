// app/frontend/src/components/review/WhatDecidedIt.tsx
/**
 * "What decided it" — the top-half review panel.
 *
 * Compares two options side by side and shows the MARGIN between them, not
 * their totals. A feature can be the largest contributor to the winner and
 * contribute nothing to the gap between it and the runner-up — the aggregate
 * "top contributor" view and the margin view can name different features
 * entirely (07-27 §7: drowsiness 32.4% of the winner's total vs. fatigue 60%
 * of the gap, with monotony pushing hard the other way and losing).
 *
 * Every parameter is a mirrored bar pair on ONE shared, always-visible scale,
 * with a lean marker (◀/▶) toward whichever side it pulls. Rows are ordered
 * by contribution to the GAP (`marginRows` already sorts this way), not by
 * size within the winner.
 */
import type { ReviewOption, MarginRow } from '../../lib/review/types'
import { scaleBound, marginRows } from '../../lib/review/reviewMath'
import { fieldName } from '../../lib/review/reviewVocabulary'
import { useLanguage } from '../../state/language'
import { t } from '../../i18n/t'

const LABELS = {
  title: { ja: '何が決め手だったか', en: 'What decided it' },
  compareLeft: { ja: '比較対象 A', en: 'Compare A' },
  compareRight: { ja: '比較対象 B', en: 'Compare B' },
  unavailableTitle: { ja: '比較できません', en: 'Comparison unavailable' },
  unavailableNotEnough: {
    ja: '比較には少なくとも 2 件の選択肢が必要です。',
    en: 'At least two options are required to compare.',
  },
  unavailableMissing: {
    ja: '比較対象の選択肢が見つかりません。',
    en: 'The selected comparison options could not be found.',
  },
  clampNote: {
    ja: '一方の選択肢はクランプ（上限処理）されているため、寄与の合計が記録されたスコアを超え、割合は一致しません。',
    en: 'One option is clamped, so its contributions sum past the reported score — the shares will not reconcile.',
  },
}

function findOption(options: ReviewOption[], id: string): ReviewOption | undefined {
  return options.find((o) => o.id === id)
}


/**
 * The recorded value, as a NUMBER only (owner review) — no "high"/"low" word.
 *
 * `drowsiness` and `fatigue` are authored on a 0-100 scale and recorded
 * divided by 100 (see the trigger package), so they read back as `66/100`
 * rather than `0.66`, which is the scale the reviewer set them on. Every other
 * feature is a derived score and is shown as-is, trailing zeros trimmed.
 */
const PERCENT_OF_100 = new Set(['drowsiness', 'fatigue'])

export function valueText(featureId: string, value: string | number): string {
  if (typeof value === 'string') return value
  if (PERCENT_OF_100.has(featureId)) return `${Math.round(value * 100)}/100`
  // 1, 0.5, 0.125 — never 1.000.
  return String(Number(value.toFixed(3)))
}

export default function WhatDecidedIt({
  options,
  leftId,
  rightId,
  onChangeLeft,
  onChangeRight,
}: {
  options: ReviewOption[]
  leftId: string
  rightId: string
  onChangeLeft: (id: string) => void
  onChangeRight: (id: string) => void
}): JSX.Element {
  const { lang } = useLanguage()

  const leftOption = leftId ? findOption(options, leftId) : undefined
  const rightOption = rightId ? findOption(options, rightId) : undefined

  // Step 1: unavailable guard — never render an axis without two resolvable options.
  if (options.length < 2 || !leftOption || !rightOption) {
    const reason =
      options.length < 2
        ? t(LABELS.unavailableNotEnough, lang)
        : t(LABELS.unavailableMissing, lang)
    return (
      <div data-testid="comparison-unavailable" style={{ padding: '12px', color: '#64748b', fontSize: '0.86em' }}>
        <p style={{ fontWeight: 700, margin: '0 0 4px' }}>{t(LABELS.unavailableTitle, lang)}</p>
        <p style={{ margin: 0 }}>{reason}</p>
      </div>
    )
  }

  // Only features that actually contributed to one side or the other. A row
  // that is zero on BOTH tells the reviewer nothing and pushes the ones that
  // matter off the screen.
  const CONTRIBUTION_EPSILON = 1e-9
  const rows: MarginRow[] = marginRows(leftOption, rightOption)
    .filter(
      (r) =>
        Math.abs(r.left) > CONTRIBUTION_EPSILON || Math.abs(r.right) > CONTRIBUTION_EPSILON,
    )
    // Ordered by A's own contribution, high → low: A is the decision under
    // review, so its ranking is the one the reviewer is reading down.
    .sort((a, b) => b.left - a.left)
  const bound = scaleBound(rows.flatMap((r) => [r.left, r.right]))

  // Step 4 (domain grouping) was REMOVED (owner review): the same group names
  // do not mean the same thing for a trigger, a service and a content item, so
  // one shared percentage split invited a comparison across stages that the
  // numbers do not support. `domainGroup`/`groupLabel` stay in
  // `reviewVocabulary` — the per-feature phrasing below still uses them.

  const clamped = leftOption.clamped || rightOption.clamped

  const barTrackStyle: React.CSSProperties = {
    position: 'relative', height: '10px', background: '#f1f5f9', borderRadius: '5px', flex: 1, overflow: 'hidden',
  }
  const barFillStyle = (magnitude: number, side: 'left' | 'right'): React.CSSProperties => {
    const pct = Math.min(100, (Math.abs(magnitude) / bound) * 100)
    return {
      position: 'absolute',
      top: 0, bottom: 0,
      [side === 'left' ? 'right' : 'left']: '50%',
      width: `${pct / 2}%`,
      background: side === 'left' ? '#2563eb' : '#dc2626',
      borderRadius: '2px',
    }
  }

  return (
    <div data-testid="what-decided-it" className="review-card">
      <p className="review-card-h">{t(LABELS.title, lang)}</p>

      <div style={{ display: 'flex', gap: '8px', marginBottom: '4px' }}>
        <div style={{ flex: 1 }}>
          <label htmlFor="what-decided-it-compare-left" style={{ display: 'block', fontSize: '0.74em', color: '#475569', marginBottom: '2px' }}>
            {t(LABELS.compareLeft, lang)}
          </label>
          <select
            id="what-decided-it-compare-left"
            data-testid="compare-left"
            value={leftId}
            onChange={(e) => onChangeLeft(e.target.value)}
            style={{ width: '100%', fontSize: '0.84em', padding: '4px' }}
          >
            {options.map((o) => (
              <option key={o.id} value={o.id}>{t(o.label, lang)}</option>
            ))}
          </select>
        </div>
        <div style={{ flex: 1 }}>
          <label htmlFor="what-decided-it-compare-right" style={{ display: 'block', fontSize: '0.74em', color: '#475569', marginBottom: '2px' }}>
            {t(LABELS.compareRight, lang)}
          </label>
          <select
            id="what-decided-it-compare-right"
            data-testid="compare-right"
            value={rightId}
            onChange={(e) => onChangeRight(e.target.value)}
            style={{ width: '100%', fontSize: '0.84em', padding: '4px' }}
          >
            {options.map((o) => (
              <option key={o.id} value={o.id}>{t(o.label, lang)}</option>
            ))}
          </select>
        </div>
      </div>

      {clamped && (
        <p data-testid="clamp-note" style={{ fontSize: '0.76em', color: '#b45309', background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: '6px', padding: '6px 8px', margin: '0 0 12px' }}>
          {t(LABELS.clampNote, lang)}
        </p>
      )}

      <div>
        {rows.map((row) => {
          // Anchor on the LEFT option's row: the left picker is the decision
          // under review, so the raw value that matters is the one that fed
          // the winning/reviewed chain. Fall back to the right option's row
          // only when the feature is absent from the left option entirely —
          // silently, since a fallback here is not itself a finding.
          const anchorRow =
            leftOption.rows.find((r) => r.featureId === row.featureId) ??
            rightOption.rows.find((r) => r.featureId === row.featureId)
          const lean = row.lean === 'left' ? '◀' : row.lean === 'right' ? '▶' : '—'

          return (
            <div
              key={row.featureId}
              data-testid="margin-row"
              style={{ padding: '6px 0', borderBottom: '1px solid #f1f5f9' }}
            >
              <div data-testid={`margin-row-${row.featureId}`} style={{ display: 'flex', alignItems: 'baseline', gap: '6px', marginBottom: '3px' }}>
                <span style={{ fontSize: '0.84em', color: '#1e293b' }}>{t(fieldName(row.featureId), lang)}</span>
                <span data-testid={`margin-anchor-${row.featureId}`} style={{ fontSize: '0.76em', color: '#475569', fontFamily: 'ui-monospace, monospace' }}>
                  {anchorRow ? valueText(row.featureId, anchorRow.value) : '—'}
                </span>
                <span data-testid={`margin-lean-${row.featureId}`} style={{ fontSize: '0.8em', fontWeight: 700, color: row.lean === 'left' ? '#2563eb' : row.lean === 'right' ? '#dc2626' : '#94a3b8' }}>
                  {lean}
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <span style={{ fontSize: '0.7em', color: '#94a3b8', width: '48px', textAlign: 'right' }}>
                  {row.left.toFixed(3)}
                </span>
                <div style={barTrackStyle}>
                  <div style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, width: '1px', background: '#cbd5e1' }} />
                  <div data-testid={`margin-bar-left-${row.featureId}`} style={barFillStyle(row.left, 'left')} />
                  <div data-testid={`margin-bar-right-${row.featureId}`} style={barFillStyle(row.right, 'right')} />
                </div>
                <span style={{ fontSize: '0.7em', color: '#94a3b8', width: '48px' }}>
                  {row.right.toFixed(3)}
                </span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
