/**
 * App — htmlapp shell root (PROTECTED, htmlapp-owned; never synced).
 *
 * Owner's requirement (feature 026 slice C5 Task 4), verbatim: "we dont need
 * trigger screen and proposal anymore, but we dont want to change the
 * structure of the code, so just keep the tab structure, but we just export
 * and show combine screen only."
 *
 * So this mirrors the docker app's `App.tsx` shape exactly — the same
 * `AppMode` / `AppModeProvider` / `useAppMode` context (`state/appMode.tsx`,
 * now synced verbatim for the first time by this task; see that file's own
 * module doc and `scripts/sync-from-app.mjs`'s EXCLUDE-block comment for
 * why it was excluded through Task 3/3b and is not any more), the same
 * tab-bar-over-body layout (`AppModeToggle` + `AppBody` switching on
 * `appMode`) — but restricts which modes are ENABLED via `ENABLED_MODES`
 * below, rather than deleting the other two.
 *
 * Only `'merged'` (Combined) is enabled: `AppModeToggle` renders a button
 * only for a mode present in `ENABLED_MODES`, so with one entry it renders
 * exactly one tab, and `AppModeProvider`'s `initialMode` boots straight into
 * it. No code path anywhere calls `setAppMode('trigger' | 'proposal')`, so
 * there is no button, keyboard path, or state transition that reaches a
 * disabled mode — no mode-switch dead-end.
 *
 * The Trigger branch (`AppShell`) is kept, unreachable, in `AppBody` below —
 * "do not delete the Trigger ... components" — it still typechecks and is
 * still exercised by its own test suite; it is simply never mounted because
 * `ENABLED_MODES` never offers a way to select it.
 *
 * The Proposal branch has no htmlapp component left to keep a live mount
 * path for: `ProposalShell.tsx` and the standalone Proposal screen's other
 * own-surface siblings were never synced into htmlapp to begin with (feature
 * 026 slice C5 Task 3 excludes 15 `components/proposal/*` files — Combined
 * reuses only their inner `panels/sections/*`, not the shell). `appMode.tsx`
 * is unmodified (still the 3-way `'trigger' | 'proposal' | 'merged'` union,
 * per "do not alter appMode.tsx"), so `AppBody`'s switch below still has a
 * `'proposal'` arm for exhaustiveness; it renders nothing because nothing in
 * htmlapp can mount it and — same as `'trigger'` — no button ever selects it.
 */
import { useEffect, useState } from 'react'
import { getHealth, HealthStatus } from './api/client'
import { RunStoreProvider } from './state/runStore'
import { AppModeProvider, useAppMode, type AppMode } from './state/appMode'
import { MergedCoordinatorProvider } from './state/mergedCoordinator'
import { RunLanguageBridge } from './state/languageBridges'
import { LanguageProvider, useLanguage } from './state/language'
import AppShell from './components/layout/AppShell'
import MergedShell from './components/merged/MergedShell'
import GlobalLanguageToggle from './components/layout/GlobalLanguageToggle'
import { t } from './i18n/t'

type State =
  | { phase: 'loading' }
  | { phase: 'ok'; data: HealthStatus }
  | { phase: 'error' }

/**
 * The only modes this export enables. Single source of truth for both the
 * tab bar (which buttons exist) and the boot mode below (`initialMode`).
 * Changing which screens ship is a one-line edit here, never a restructure
 * of `AppModeToggle`/`AppBody`/`appMode.tsx`.
 */
const ENABLED_MODES: AppMode[] = ['merged']

const APP_MODE_LABELS = {
  trigger: { ja: '発火判定', en: 'Firing decision' },
  proposal: { ja: '提案', en: 'Proposal' },
  merged: { ja: '統合', en: 'Combined' },
}

/**
 * Header tab bar — the docker app's `AppModeToggle` shape (same three
 * `<button>` blocks, same `buttonStyle`/`aria-current` treatment), gated so
 * only a button for a mode in `ENABLED_MODES` renders. `data-testid`s are
 * htmlapp-only additions (the docker app's toggle has none) so
 * `tests/shell_modes.test.tsx` can assert on the tab bar without also
 * matching buttons deep inside `MergedShell`'s own nav.
 */
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
      data-testid="app-mode-toggle"
      style={{
        display: 'flex',
        gap: '4px',
        padding: '4px 16px',
        background: '#0f0f1e',
        borderBottom: '1px solid #2a2a4a',
      }}
    >
      {ENABLED_MODES.includes('trigger') && (
        <button
          data-testid="app-mode-trigger"
          onClick={() => setAppMode('trigger')}
          aria-current={appMode === 'trigger' ? 'page' : undefined}
          style={buttonStyle(appMode === 'trigger')}
        >
          {t(APP_MODE_LABELS.trigger, lang)}
        </button>
      )}
      {ENABLED_MODES.includes('proposal') && (
        <button
          data-testid="app-mode-proposal"
          onClick={() => setAppMode('proposal')}
          aria-current={appMode === 'proposal' ? 'page' : undefined}
          style={buttonStyle(appMode === 'proposal')}
        >
          {t(APP_MODE_LABELS.proposal, lang)}
        </button>
      )}
      {ENABLED_MODES.includes('merged') && (
        <button
          data-testid="app-mode-merged"
          onClick={() => setAppMode('merged')}
          aria-current={appMode === 'merged' ? 'page' : undefined}
          style={buttonStyle(appMode === 'merged')}
        >
          {t(APP_MODE_LABELS.merged, lang)}
        </button>
      )}
      <GlobalLanguageToggle />
    </nav>
  )
}

/**
 * Renders the shell for the current `appMode` — same three-way switch shape
 * as the docker app's `AppBody`. 'trigger' and 'merged' mount their real
 * shells (kept byte-for-shape identical to upstream's wiring, including the
 * `MergedCoordinatorProvider` wrapped directly around `MergedShell` even
 * though `MergedShell` also provides its own scoped one internally — that
 * double-provider is upstream's own existing shape, not something
 * introduced here; the inner one simply shadows the outer). 'proposal'
 * renders nothing (see the module doc above) and is unreachable regardless.
 */
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
  } else if (appMode === 'merged') {
    body = (
      <MergedCoordinatorProvider>
        <MergedShell />
      </MergedCoordinatorProvider>
    )
  } else {
    body = null
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
