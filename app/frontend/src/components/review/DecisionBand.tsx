// app/frontend/src/components/review/DecisionBand.tsx
/**
 * DecisionBand — names the decision point currently under review: its
 * category label and the time it occurred, so a reviewer scanning the centre
 * column always knows which fire the proposal cards below belong to.
 *
 * Renders nothing when there is no active checkpoint (no run yet, or the rail
 * is empty) — `CheckpointRail`'s own empty state already explains that case,
 * so this component has nothing to add.
 */
import type { Checkpoint } from '../../lib/review/checkpoints'
import { useLanguage } from '../../state/language'
import { t } from '../../i18n/t'

const LABELS = {
  reviewing: { ja: 'レビュー対象の決定', en: 'Reviewing this decision' },
}

function formatTimeLabel(timeMin: number, lang: 'ja' | 'en'): string {
  const rounded = Math.round(timeMin)
  return lang === 'ja' ? `${rounded}分時点` : `at ${rounded} min`
}

export default function DecisionBand({ checkpoint }: { checkpoint: Checkpoint | null }): JSX.Element | null {
  const { lang } = useLanguage()
  if (!checkpoint) return null

  return (
    <div
      data-testid="decision-band"
      style={{
        display: 'flex',
        alignItems: 'baseline',
        gap: '8px',
        padding: '6px 10px',
        background: '#eff6ff',
        border: '1px solid #bfdbfe',
        borderRadius: '7px',
        fontSize: '0.82em',
      }}
    >
      <span style={{ fontWeight: 700, color: '#1e293b' }}>{t(LABELS.reviewing, lang)}:</span>
      <span data-testid="decision-band-label" style={{ color: '#1d4ed8', fontWeight: 700 }}>
        {t(checkpoint.label, lang)}
      </span>
      <span style={{ color: '#64748b' }}>{formatTimeLabel(checkpoint.timeMin, lang)}</span>
    </div>
  )
}
