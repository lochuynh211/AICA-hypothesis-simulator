import { useRunStore } from '../../state/runStore'
import { t } from '../../i18n/t'
import type { ReplaySource } from '../../replay/replaySource'

type Props = {
  source: ReplaySource
  currentTick: number
  onSeek: (tick: number) => void
}

export default function ReplayControls({ source, currentTick, onSeek }: Props) {
  const { state } = useRunStore()
  const { uiLanguage } = state
  const { minIndex, maxIndex, tickCount } = source

  if (tickCount === 0) {
    return (
      <div data-testid="replay-controls" style={{ padding: '8px', color: '#666', fontSize: '0.85em' }}>
        {t({ ja: '記録されたティックがありません', en: 'No recorded ticks' }, uiLanguage)}
      </div>
    )
  }

  return (
    <div
      data-testid="replay-controls"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        padding: '8px',
        background: '#1a1a1a',
        borderRadius: '4px',
        marginBottom: '8px',
      }}
    >
      <span
        style={{
          color: '#aaa',
          fontSize: '0.8em',
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          whiteSpace: 'nowrap',
        }}
      >
        {t({ ja: '再生', en: 'Replay' }, uiLanguage)}
      </span>
      <button
        onClick={() => onSeek(Math.max(minIndex, currentTick - 1))}
        disabled={currentTick <= minIndex}
        style={{
          fontSize: '0.8em',
          padding: '2px 8px',
          cursor: currentTick <= minIndex ? 'not-allowed' : 'pointer',
        }}
        aria-label={t({ ja: '前のティック', en: 'Previous tick' }, uiLanguage)}
      >
        {t({ ja: '前', en: 'Prev' }, uiLanguage)}
      </button>
      <input
        data-testid="replay-scrubber"
        type="range"
        min={minIndex}
        max={maxIndex}
        value={currentTick}
        onChange={(e) => onSeek(Number(e.target.value))}
        style={{ flex: 1 }}
        aria-label={t({ ja: 'ティック選択', en: 'Tick selector' }, uiLanguage)}
      />
      <button
        onClick={() => onSeek(Math.min(maxIndex, currentTick + 1))}
        disabled={currentTick >= maxIndex}
        style={{
          fontSize: '0.8em',
          padding: '2px 8px',
          cursor: currentTick >= maxIndex ? 'not-allowed' : 'pointer',
        }}
        aria-label={t({ ja: '次のティック', en: 'Next tick' }, uiLanguage)}
      >
        {t({ ja: '次', en: 'Next' }, uiLanguage)}
      </button>
      <span
        data-testid="replay-current-tick"
        style={{
          color: '#6af',
          fontFamily: 'monospace',
          fontSize: '0.85em',
          minWidth: '4em',
          textAlign: 'right',
          whiteSpace: 'nowrap',
        }}
      >
        tick#{currentTick}
      </span>
    </div>
  )
}
