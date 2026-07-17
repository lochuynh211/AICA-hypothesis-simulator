/**
 * ModeToggle (P7 T031/T035, US3/US5) — the interactive/quick_check run-mode
 * selector shown in Panel ② before a run is created (FR-011).
 *
 * DISPLAY-ONLY: this only updates `proposalStore.state.mode` (a local mirror
 * of what will be sent on `createRun`); the backend is what actually decides
 * whether/how quick-check auto-advances a run — this component never fakes
 * that behavior itself. Once a run exists, its mode is frozen (FR-011) —
 * `ServiceProposalPanel` reads `state.mode` only for the not-yet-created
 * case (see its own `runLog.mode` for an existing run's true frozen mode).
 */
import { t, type BilingualLabel } from '../../i18n/t'
import { useProposalStore } from '../../state/proposalStore'
import type { ProposalRunMode } from '../../api/proposalClient'

const LABELS = {
  title: { ja: 'モード', en: 'Mode' },
  interactive: { ja: 'インタラクティブ', en: 'Interactive' },
  quickCheck: { ja: 'クイックチェック', en: 'Quick check' },
  frozenNote: {
    ja: 'このランのモードは作成時に確定済みです。',
    en: 'This run’s mode is frozen from creation.',
  },
}

const OPTIONS: { mode: ProposalRunMode; label: BilingualLabel }[] = [
  { mode: 'interactive', label: LABELS.interactive },
  { mode: 'quick_check', label: LABELS.quickCheck },
]

export default function ModeToggle() {
  const { state, dispatch } = useProposalStore()
  const { uiLanguage: lang, mode, runLog } = state
  // FR-011: mode is chosen before create-run and frozen for the run
  // thereafter — once a run exists, show/disable against its own frozen
  // `runLog.mode` rather than letting further edits imply they'd retroactively
  // change the current run (they'd only affect the NEXT created run).
  const frozen = runLog != null
  const effectiveMode = frozen ? (runLog?.mode ?? mode) : mode

  return (
    <div data-testid="mode-toggle">
      <div style={sectionLabelStyle}>{t(LABELS.title, lang)}</div>
      <div style={{ display: 'flex', gap: '12px' }}>
        {OPTIONS.map((option) => (
          <label key={option.mode} style={optionLabelStyle}>
            <input
              type="radio"
              name="proposal-mode-toggle"
              data-testid={`mode-toggle-${option.mode}`}
              checked={effectiveMode === option.mode}
              disabled={frozen}
              onChange={() => dispatch({ type: 'MODE_SET', mode: option.mode })}
            />
            {t(option.label, lang)}
          </label>
        ))}
      </div>
      {frozen && <p style={frozenNoteStyle}>{t(LABELS.frozenNote, lang)}</p>}
    </div>
  )
}

// ── Shared inline styles ─────────────────────────────────────────────────────

const sectionLabelStyle: React.CSSProperties = {
  fontSize: '0.68em',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  fontWeight: 800,
  color: '#6b7280',
  margin: '16px 0 6px',
}

const optionLabelStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '4px',
  fontSize: '0.82em',
  color: '#4b5563',
  cursor: 'pointer',
}

const frozenNoteStyle: React.CSSProperties = {
  margin: '4px 0 0',
  fontSize: '0.74em',
  color: '#6b7280',
}
