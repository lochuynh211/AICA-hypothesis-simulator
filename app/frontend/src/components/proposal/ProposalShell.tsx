/**
 * ProposalShell (P1 T029) — the Proposal Simulator's own shell.
 *
 * Sub-nav [ Screen | Runs ]: "Screen" renders the 3-panel ProposalScreen;
 * "Runs" is a placeholder for now (the real ProposalRunsScreen is a later
 * task, per tasks.md T036). Also hosts a JA/EN language toggle (T030) that
 * dispatches SET_LANGUAGE on the isolated `proposalStore` — distinct from
 * the trigger app's own `LanguageToggle` (which dispatches to `runStore`).
 *
 * The top-level [ Trigger | Proposal ] appMode toggle lives in App.tsx
 * (already wired) — this shell does not duplicate it.
 */
import { useState } from 'react'
import { t } from '../../i18n/t'
import { useProposalStore } from '../../state/proposalStore'
import ProposalScreen from './ProposalScreen'

type SubView = 'screen' | 'runs'

const LABELS = {
  screen: { ja: '画面', en: 'Screen' },
  runs: { ja: '実行履歴', en: 'Runs' },
  runsPlaceholder: {
    ja: '提案の実行履歴（一覧・再表示・削除）はこれから実装されます。',
    en: 'Proposal run history (list / reopen / delete) is not implemented yet.',
  },
  mockBadge: { ja: 'モックデータ（P1土台）', en: 'MOCK DATA (P1 foundation)' },
}

function ProposalLanguageToggle() {
  const { state, dispatch } = useProposalStore()
  const { uiLanguage } = state

  const btnStyle = (active: boolean): React.CSSProperties => ({
    padding: '3px 10px',
    fontSize: '0.8em',
    fontWeight: active ? 700 : 400,
    background: active ? '#2563eb' : 'transparent',
    color: active ? '#fff' : '#94a3b8',
    border: active ? '1px solid #1d4ed8' : '1px solid transparent',
    borderRadius: '4px',
    cursor: 'pointer',
  })

  return (
    <div style={{ display: 'flex', gap: '2px', marginLeft: 'auto' }}>
      <button
        data-testid="proposal-lang-toggle-ja"
        aria-pressed={uiLanguage === 'ja'}
        onClick={() => dispatch({ type: 'SET_LANGUAGE', lang: 'ja' })}
        style={btnStyle(uiLanguage === 'ja')}
      >
        日本語
      </button>
      <button
        data-testid="proposal-lang-toggle-en"
        aria-pressed={uiLanguage === 'en'}
        onClick={() => dispatch({ type: 'SET_LANGUAGE', lang: 'en' })}
        style={btnStyle(uiLanguage === 'en')}
      >
        EN
      </button>
    </div>
  )
}

export default function ProposalShell() {
  const { state } = useProposalStore()
  const { uiLanguage: lang } = state
  const [subView, setSubView] = useState<SubView>('screen')

  const navBtnStyle = (active: boolean): React.CSSProperties => ({
    padding: '4px 14px',
    fontSize: '0.82em',
    fontWeight: active ? 700 : 400,
    background: active ? '#7c3aed' : 'transparent',
    color: active ? '#fff' : '#94a3b8',
    border: active ? '1px solid #6d28d9' : '1px solid transparent',
    borderRadius: '4px',
    cursor: 'pointer',
  })

  return (
    <div data-testid="proposal-shell" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '6px 16px',
          background: '#1a1a2e',
          borderBottom: '1px solid #2a2a4a',
          flexShrink: 0,
        }}
      >
        <nav style={{ display: 'flex', gap: '4px' }}>
          <button
            data-testid="proposal-subnav-screen"
            aria-current={subView === 'screen' ? 'page' : undefined}
            onClick={() => setSubView('screen')}
            style={navBtnStyle(subView === 'screen')}
          >
            {t(LABELS.screen, lang)}
          </button>
          <button
            data-testid="proposal-subnav-runs"
            aria-current={subView === 'runs' ? 'page' : undefined}
            onClick={() => setSubView('runs')}
            style={navBtnStyle(subView === 'runs')}
          >
            {t(LABELS.runs, lang)}
          </button>
        </nav>
        <span
          style={{
            fontSize: '0.66em',
            fontWeight: 800,
            letterSpacing: '0.05em',
            background: '#fffbeb',
            color: '#b45309',
            border: '1px solid #fcd34d',
            borderRadius: '999px',
            padding: '2px 9px',
          }}
        >
          {t(LABELS.mockBadge, lang)}
        </span>
        <ProposalLanguageToggle />
      </header>

      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
        {subView === 'screen' ? (
          <ProposalScreen />
        ) : (
          <div data-testid="proposal-runs-placeholder" style={{ padding: '20px', color: '#6b7280' }}>
            {t(LABELS.runsPlaceholder, lang)}
          </div>
        )}
      </div>
    </div>
  )
}
