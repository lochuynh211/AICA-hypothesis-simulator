/**
 * ProposalShell (P1 T029, Runs screen wired in T036) — the Proposal
 * Simulator's own shell.
 *
 * Sub-nav [ Screen | Runs ]: "Screen" renders the 3-panel ProposalScreen;
 * "Runs" renders `ProposalRunsScreen` (list / reopen / delete persisted
 * proposal runs, T032-T036).
 *
 * The top-level [ Trigger | Proposal | Combined ] appMode toggle AND the
 * single global JA/EN language toggle both live in App.tsx's top bar — this
 * shell no longer hosts its own language toggle. It reads the language from
 * `proposalStore.uiLanguage`, which the App-level bridge mirrors from the
 * global `LanguageProvider`.
 */
import { useState } from 'react'
import { t } from '../../i18n/t'
import { useProposalStore } from '../../state/proposalStore'
import ProposalScreen from './ProposalScreen'
import ProposalRunsScreen from './ProposalRunsScreen'

type SubView = 'screen' | 'runs'

const LABELS = {
  screen: { ja: '画面', en: 'Screen' },
  runs: { ja: '実行履歴', en: 'Runs' },
}

export default function ProposalShell({ autoInit = false }: { autoInit?: boolean }) {
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
      </header>

      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
        {subView === 'screen' ? <ProposalScreen autoInit={autoInit} /> : <ProposalRunsScreen />}
      </div>
    </div>
  )
}
