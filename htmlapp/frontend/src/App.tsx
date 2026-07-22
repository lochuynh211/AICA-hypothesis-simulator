/**
 * App — htmlapp trigger-only root (protected from sync-from-app.mjs).
 *
 * Wraps the entire app in a single global LanguageProvider so that
 * GlobalLanguageToggle (synced from app/frontend) has a context to read/write.
 * A lightweight inline bridge (RunLanguageBridge) mirrors global language
 * changes into the trigger runStore's uiLanguage, replacing the excluded
 * state/languageBridges.tsx (which depends on proposalStore).
 *
 * Proposal / Combined surfaces are not mounted here — this is the
 * trigger-only htmlapp surface.
 */
import { useEffect, useState } from 'react'
import { getHealth, HealthStatus } from './api/client'
import { RunStoreProvider, useRunStore } from './state/runStore'
import { LanguageProvider, useLanguage } from './state/language'
import AppShell from './components/layout/AppShell'
import GlobalLanguageToggle from './components/layout/GlobalLanguageToggle'

type State =
  | { phase: 'loading' }
  | { phase: 'ok'; data: HealthStatus }
  | { phase: 'error' }

/** Mirrors the global LanguageProvider into the trigger runStore.
 *  Inline equivalent of RunLanguageBridge from languageBridges.tsx (which is
 *  excluded because it also bridges into proposalStore). */
function RunLanguageBridge({ children }: { children: React.ReactNode }) {
  const { lang } = useLanguage()
  const { state, dispatch } = useRunStore()
  useEffect(() => {
    if (state.uiLanguage !== lang) dispatch({ type: 'SET_LANGUAGE', lang })
  }, [lang, state.uiLanguage, dispatch])
  return <>{children}</>
}

/** Minimal top bar that houses the GlobalLanguageToggle. Sits above AppShell
 *  (the trigger shell), replacing the LanguageToggle that used to live inside
 *  the trigger AppShell's header before the global-language-provider refactor.
 *  Must be inside RunStoreProvider so AppShell's useRunStore() calls succeed. */
function TopBar() {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'flex-end',
        padding: '4px 16px',
        background: '#0f0f1e',
        borderBottom: '1px solid #2a2a4a',
        flexShrink: 0,
      }}
    >
      <GlobalLanguageToggle />
    </div>
  )
}

function AppBody({ healthStatus }: { healthStatus?: string }) {
  const { lang } = useLanguage()
  return (
    <RunStoreProvider initialLanguage={lang}>
      <RunLanguageBridge>
        <>
          <TopBar />
          <AppShell healthStatus={healthStatus} />
        </>
      </RunLanguageBridge>
    </RunStoreProvider>
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
      <AppBody healthStatus={healthStatus} />
    </LanguageProvider>
  )
}
