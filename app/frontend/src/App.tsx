import { useEffect, useState } from 'react'
import { getHealth, HealthStatus } from './api/client'
import { RunStoreProvider } from './state/runStore'
import { AppModeProvider, useAppMode } from './state/appMode'
import { ProposalStoreProvider } from './state/proposalStore'
import AppShell from './components/layout/AppShell'
import ProposalShell from './components/proposal/ProposalShell'
import { t, type UiLanguage } from './i18n/t'

type State =
  | { phase: 'loading' }
  | { phase: 'ok'; data: HealthStatus }
  | { phase: 'error' }

const APP_MODE_LABELS = {
  trigger: { ja: 'トリガー', en: 'Trigger' },
  proposal: { ja: '提案', en: 'Proposal' },
}

/** Header toggle — switches the top-level appMode between the Trigger
 *  Simulator and the (placeholder, for now) Proposal Simulator. Additive:
 *  does not alter AppShell's own header/nav.
 *
 *  Bilingual via the shared `t()` helper. This toggle renders ABOVE both
 *  the trigger `runStore` and the proposal `proposalStore` (it decides
 *  which one even mounts), so it cannot read either store's `uiLanguage`
 *  without breaking their provider isolation — `lang` defaults to `'en'`
 *  (the trigger shell's own default) as the "sensible shared default";
 *  callers with a language available may pass it explicitly. */
export function AppModeToggle({ lang = 'en' }: { lang?: UiLanguage } = {}) {
  const { appMode, setAppMode } = useAppMode()
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
    </nav>
  )
}

/** Renders the shell for the current appMode. 'trigger' renders the existing,
 *  unmodified Trigger Simulator (RunStoreProvider + AppShell); 'proposal'
 *  renders the standalone Proposal Simulator (ProposalStoreProvider + the
 *  real 3-panel ProposalShell, P1 T029) — isolated from the trigger's
 *  RunStoreProvider/AppShell. */
function AppBody({ healthStatus }: { healthStatus?: string }) {
  const { appMode } = useAppMode()
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
      <AppModeToggle />
      <div style={{ flex: 1, minHeight: 0 }}>
        {appMode === 'trigger' ? (
          <RunStoreProvider>
            <AppShell healthStatus={healthStatus} />
          </RunStoreProvider>
        ) : (
          <ProposalStoreProvider>
            <ProposalShell autoInit />
          </ProposalStoreProvider>
        )}
      </div>
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
    <AppModeProvider initialMode="proposal">
      <AppBody healthStatus={healthStatus} />
    </AppModeProvider>
  )
}
