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
import { domainGroup, groupLabel, phrase, bandWord } from '../../lib/review/reviewVocabulary'
import type { DomainGroup } from '../../lib/review/reviewVocabulary'
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
  because: { ja: 'が選ばれた主な決め手は', en: 'was chosen mainly because of' },
  becauseEnd: { ja: 'でした。', en: '' },
  despite: {
    ja: 'は逆方向に働きましたが、及びませんでした。',
    en: 'despite',
  },
  scaleBoundPrefix: { ja: '目盛りの上限', en: 'Scale bound' },
  clampNote: {
    ja: '一方の選択肢はクランプ（上限処理）されているため、寄与の合計が記録されたスコアを超え、割合は一致しません。',
    en: 'One option is clamped, so its contributions sum past the reported score — the shares will not reconcile.',
  },
  groupShare: { ja: '寄与割合', en: 'share of contribution' },
}

const DOMAIN_ORDER: DomainGroup[] = [
  'driver_state', 'road_environment', 'preferences_history', 'content_properties', 'other',
]

function findOption(options: ReviewOption[], id: string): ReviewOption | undefined {
  return options.find((o) => o.id === id)
}

/** value · bandWord(band, value) for a numeric row; the string itself for a categorical one. */
function anchorText(
  value: string | number,
  band: string | null,
  lang: 'ja' | 'en',
): string {
  if (typeof value !== 'number') return value
  return `${value} · ${t(bandWord(band, value), lang)}`
}

export default function WhatDecidedIt({
  options,
  leftId,
  rightId,
  onChangeLeft,
  onChangeRight,
  thresholdNote,
}: {
  options: ReviewOption[]
  leftId: string
  rightId: string
  onChangeLeft: (id: string) => void
  onChangeRight: (id: string) => void
  thresholdNote: string | null
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

  const rows: MarginRow[] = marginRows(leftOption, rightOption)
  const bound = scaleBound(rows.flatMap((r) => [r.left, r.right]))

  const winner = leftOption.score >= rightOption.score ? leftOption : rightOption
  const winnerSide: 'left' | 'right' = winner === leftOption ? 'left' : 'right'
  const topSupporting = rows.find((r) => r.lean === winnerSide)
  const topOpposing = rows.find((r) => r.lean !== winnerSide && r.lean !== 'none')

  const verdictSentence = (() => {
    const supportingPhrase = topSupporting ? t(phrase(topSupporting.featureId), lang) : ''
    const opposingPhrase = topOpposing ? t(phrase(topOpposing.featureId), lang) : ''
    if (lang === 'ja') {
      const main = `${winner.label}${t(LABELS.because, lang)}「${supportingPhrase}」${t(LABELS.becauseEnd, lang)}`
      const extra = topOpposing ? `「${opposingPhrase}」${t(LABELS.despite, lang)}` : ''
      return `${main}${extra}`
    }
    const main = `${winner.label} ${t(LABELS.because, lang)} ${supportingPhrase}`
    return topOpposing ? `${main}, ${t(LABELS.despite, lang)} ${opposingPhrase}.` : `${main}.`
  })()

  // Step 4: domain grouping — bucket both options' contributions, share of total |contribution| per side.
  const groupTotals = new Map<DomainGroup, { left: number; right: number }>()
  const addTo = (side: 'left' | 'right', option: ReviewOption) => {
    for (const row of option.rows) {
      const group = domainGroup(row.featureId)
      const entry = groupTotals.get(group) ?? { left: 0, right: 0 }
      entry[side] += Math.abs(row.contribution)
      groupTotals.set(group, entry)
    }
  }
  addTo('left', leftOption)
  addTo('right', rightOption)
  const leftTotal = leftOption.rows.reduce((sum, r) => sum + Math.abs(r.contribution), 0)
  const rightTotal = rightOption.rows.reduce((sum, r) => sum + Math.abs(r.contribution), 0)
  const groupEntries = DOMAIN_ORDER.filter((g) => groupTotals.has(g)).map((g) => {
    const totals = groupTotals.get(g)!
    return {
      group: g,
      leftShare: leftTotal === 0 ? 0 : totals.left / leftTotal,
      rightShare: rightTotal === 0 ? 0 : totals.right / rightTotal,
    }
  })

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
    <div data-testid="what-decided-it" style={{ padding: '12px' }}>
      <p style={{ fontSize: '0.72em', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#94a3b8', margin: '0 0 8px' }}>
        {t(LABELS.title, lang)}
      </p>

      <div style={{ display: 'flex', gap: '8px', marginBottom: '4px' }}>
        <div style={{ flex: 1 }}>
          <label style={{ display: 'block', fontSize: '0.74em', color: '#475569', marginBottom: '2px' }}>
            {t(LABELS.compareLeft, lang)}
          </label>
          <select
            data-testid="compare-left"
            value={leftId}
            onChange={(e) => onChangeLeft(e.target.value)}
            style={{ width: '100%', fontSize: '0.84em', padding: '4px' }}
          >
            {options.map((o) => (
              <option key={o.id} value={o.id}>{o.label}</option>
            ))}
          </select>
        </div>
        <div style={{ flex: 1 }}>
          <label style={{ display: 'block', fontSize: '0.74em', color: '#475569', marginBottom: '2px' }}>
            {t(LABELS.compareRight, lang)}
          </label>
          <select
            data-testid="compare-right"
            value={rightId}
            onChange={(e) => onChangeRight(e.target.value)}
            style={{ width: '100%', fontSize: '0.84em', padding: '4px' }}
          >
            {options.map((o) => (
              <option key={o.id} value={o.id}>{o.label}</option>
            ))}
          </select>
        </div>
      </div>

      {thresholdNote != null && (
        <p data-testid="threshold-note" style={{ fontSize: '0.72em', color: '#94a3b8', margin: '0 0 10px' }}>
          {thresholdNote}
        </p>
      )}

      <p data-testid="verdict-sentence" style={{ fontSize: '0.88em', lineHeight: 1.6, color: '#1e293b', margin: '4px 0 12px' }}>
        {verdictSentence}
      </p>

      {clamped && (
        <p data-testid="clamp-note" style={{ fontSize: '0.76em', color: '#b45309', background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: '6px', padding: '6px 8px', margin: '0 0 12px' }}>
          {t(LABELS.clampNote, lang)}
        </p>
      )}

      <div style={{ marginBottom: '12px' }}>
        {groupEntries.map(({ group, leftShare, rightShare }) => (
          <div key={group} data-testid="domain-group" style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78em', color: '#334155', padding: '2px 0' }}>
            <span>{t(groupLabel(group), lang)}</span>
            <span style={{ color: '#64748b' }}>
              {Math.round(leftShare * 100)}% / {Math.round(rightShare * 100)}% {t(LABELS.groupShare, lang)}
            </span>
          </div>
        ))}
      </div>

      <p data-testid="margin-scale-bound" style={{ fontSize: '0.74em', color: '#94a3b8', margin: '0 0 6px' }}>
        {t(LABELS.scaleBoundPrefix, lang)}: ±{bound}
      </p>

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
                <span style={{ fontSize: '0.84em', color: '#1e293b' }}>{t(phrase(row.featureId), lang)}</span>
                <span data-testid="margin-feature-id" style={{ fontSize: '0.68em', color: '#cbd5e1' }}>
                  {row.featureId}
                </span>
                <span data-testid={`margin-anchor-${row.featureId}`} style={{ fontSize: '0.72em', color: '#64748b' }}>
                  {anchorRow ? anchorText(anchorRow.value, anchorRow.band, lang) : '—'}
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
                  <div style={barFillStyle(row.left, 'left')} />
                  <div style={barFillStyle(row.right, 'right')} />
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
