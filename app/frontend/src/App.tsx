import { useEffect, useState } from 'react'
import { getHealth, HealthStatus } from './api/client'
import { RunStoreProvider } from './state/runStore'
import { AppModeProvider, useAppMode } from './state/appMode'
import { ProposalStoreProvider } from './state/proposalStore'
import { MergedCoordinatorProvider } from './state/mergedCoordinator'
import { LanguageProvider, useLanguage } from './state/language'
import { RunLanguageBridge, ProposalLanguageBridge } from './state/languageBridges'
import AppShell from './components/layout/AppShell'
import ProposalShell from './components/proposal/ProposalShell'
import MergedShell from './components/merged/MergedShell'
import GlobalLanguageToggle from './components/layout/GlobalLanguageToggle'
import { t } from './i18n/t'

type State =
  | { phase: 'loading' }
  | { phase: 'ok'; data: HealthStatus }
  | { phase: 'error' }

const APP_MODE_LABELS = {
  trigger: { ja: 'トリガー', en: 'Trigger' },
  proposal: { ja: '提案', en: 'Proposal' },
  merged: { ja: '統合', en: 'Combined' },
}

/** Header toggle — switches the top-level appMode between the Trigger,
 *  Proposal and Combined simulators. Additive: does not alter AppShell's
 *  own header/nav.
 *
 *  Bilingual via the shared `t()` helper. Reads the single global
 *  `LanguageProvider` (the one source of truth), so it follows the header
 *  JA/EN toggle like every other screen. */
export function AppModeToggle() {
  const { appMode, setAppMode } = useAppMode()
  const { lang } = useLanguage()
  const buttonStyle = (active: boolean): React.CSSProperties => ({
    padding: '4px 14px',
    fontSize: '0.82em',
    fontWeight: active ? 700 : 400,
    background: active ? '#2563eb' : 'transparent',
    color: active ? '#fff' : '#94a3b8',
    border: active ? '1px solid #1d4ed8' : '1px solid transparent',
    borderRadius: '4px',
    cursor: 'pointer',
  })
  return (
    <nav
      style={{
        display: 'flex',
        gap: '4px',
        padding: '4px 16px',
        background: '#0f0f1e',
        borderBottom: '1px solid #2a2a4a',
      }}
    >
      <button
        onClick={() => setAppMode('trigger')}
        aria-current={appMode === 'trigger' ? 'page' : undefined}
        style={buttonStyle(appMode === 'trigger')}
      >
        {t(APP_MODE_LABELS.trigger, lang)}
      </button>
      <button
        onClick={() => setAppMode('proposal')}
        aria-current={appMode === 'proposal' ? 'page' : undefined}
        style={buttonStyle(appMode === 'proposal')}
      >
        {t(APP_MODE_LABELS.proposal, lang)}
      </button>
      <button
        onClick={() => setAppMode('merged')}
        aria-current={appMode === 'merged' ? 'page' : undefined}
        style={buttonStyle(appMode === 'merged')}
      >
        {t(APP_MODE_LABELS.merged, lang)}
      </button>
      <GlobalLanguageToggle />
    </nav>
  )
}

/** Renders the shell for the current appMode. 'trigger' renders the existing,
 *  unmodified Trigger Simulator (RunStoreProvider + AppShell); 'proposal'
 *  renders the standalone Proposal Simulator (ProposalStoreProvider + the
 *  real 3-panel ProposalShell, P1 T029) — isolated from the trigger's
 *  RunStoreProvider/AppShell; 'merged' renders the Combined Simulator (020)
 *  shell — `MergedShell` (Task 6), a 20:60:20 3-panel layout with stub
 *  panels for now, wrapped in `MergedCoordinatorProvider` (Task 7) — the
 *  isolated store that owns the merged tick loop and mounts both the
 *  trigger and proposal concerns for it. The real (non-stub) panels land in
 *  later 020 tasks. */
function AppBody({ healthStatus }: { healthStatus?: string }) {
  const { appMode } = useAppMode()
  const { lang } = useLanguage()
  let body: React.ReactNode
  if (appMode === 'trigger') {
    body = (
      <RunStoreProvider initialLanguage={lang}>
        <RunLanguageBridge>
          <AppShell healthStatus={healthStatus} />
        </RunLanguageBridge>
      </RunStoreProvider>
    )
  } else if (appMode === 'proposal') {
    body = (
      <ProposalStoreProvider initialLanguage={lang}>
        <ProposalLanguageBridge>
          <ProposalShell autoInit />
        </ProposalLanguageBridge>
      </ProposalStoreProvider>
    )
  } else {
    body = (
      <MergedCoordinatorProvider>
        <MergedShell />
      </MergedCoordinatorProvider>
    )
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
      <AppModeToggle />
      <div style={{ flex: 1, minHeight: 0 }}>{body}</div>
    </div>
  )
}

export default function App() {
  const [state, setState] = useState<State>({ phase: 'loading' })

  useEffect(() => {
    getHealth()
      .then((data) => setState({ phase: 'ok', data }))
      .catch(() => setState({ phase: 'error' }))
  }, [])

  if (state.phase === 'loading') {
    return <p>Checking backend…</p>
  }

  if (state.phase === 'error') {
    return <p>Backend unavailable</p>
  }

  const healthStatus = `Backend: ${state.data.status} — ${state.data.service}`

  return (
    <LanguageProvider initialLanguage="ja">
      <AppModeProvider initialMode="merged">
        <AppBody healthStatus={healthStatus} />
      </AppModeProvider>
    </LanguageProvider>
  )
}
