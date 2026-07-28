// app/frontend/src/components/review/CheckpointRail.tsx
/**
 * CheckpointRail — one row per reviewable decision point in the current run
 * (`deriveCheckpoints`), selecting which one `DecisionBand`/`ReviewColumn`
 * inspect.
 *
 * An EMPTY rail (no `rest_required`/`monotony_prevention` fire this run) is a
 * legitimate, informative outcome — see `deriveCheckpoints` — rendered as a
 * short explanatory line, never as an error.
 *
 * Rendered as a SIBLING of the animated playback subtree (task-17-brief) —
 * this component itself is stateless/derived, so re-rendering it on a
 * playback tick is fine; it's the proposal cards next to it that must not be
 * force-remounted by that redraw.
 */
import type { Checkpoint } from '../../lib/review/checkpoints'
import { useLanguage } from '../../state/language'
import { t } from '../../i18n/t'

const LABELS = {
  empty: {
    ja: 'この実行ではレビュー可能な決定ポイントが生成されませんでした。',
    en: 'This run produced no reviewable decision point.',
  },
}

function formatTimeLabel(timeMin: number, lang: 'ja' | 'en'): string {
  const rounded = Math.round(timeMin)
  return lang === 'ja' ? `${rounded}分時点` : `at ${rounded} min`
}

export default function CheckpointRail({
  checkpoints,
  selectedId,
  onSelect,
}: {
  checkpoints: Checkpoint[]
  selectedId: string | null
  onSelect: (checkpointId: string) => void
}): JSX.Element {
  const { lang } = useLanguage()

  if (checkpoints.length === 0) {
    return (
      <div data-testid="checkpoint-rail" style={{ padding: '4px 2px' }}>
        <p data-testid="checkpoint-rail-empty" style={{ fontSize: '0.78em', color: '#94a3b8', fontStyle: 'italic', margin: 0 }}>
          {t(LABELS.empty, lang)}
        </p>
      </div>
    )
  }

  return (
    <div data-testid="checkpoint-rail" style={{ display: 'flex', gap: '6px', overflowX: 'auto', padding: '2px' }}>
      {checkpoints.map((cp) => {
        const active = cp.id === selectedId
        return (
          <button
            key={cp.id}
            type="button"
            data-testid="checkpoint-row"
            aria-pressed={active}
            onClick={() => onSelect(cp.id)}
            style={{
              flexShrink: 0,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'flex-start',
              gap: '1px',
              fontSize: '0.78em',
              padding: '5px 10px',
              borderRadius: '7px',
              border: active ? '1px solid #2563eb' : '1px solid #e2e8f0',
              background: active ? '#eff6ff' : '#fff',
              color: '#1e293b',
              cursor: 'pointer',
              textAlign: 'left',
            }}
          >
            <span style={{ fontWeight: 700 }}>{t(cp.label, lang)}</span>
            <span style={{ color: '#94a3b8' }}>{formatTimeLabel(cp.timeMin, lang)}</span>
          </button>
        )
      })}
    </div>
  )
}
