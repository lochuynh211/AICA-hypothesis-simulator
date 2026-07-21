/**
 * MergedShell — Combined Simulator shell (020 Task 6, Live/Runs toggle added
 * Slice-2c Task 6).
 *
 * 20:60:20 three-panel layout (`.merged-shell`, styled in app.css) reusing
 * the existing `.left-panel`/`.center-panel`/`.right-panel` classes from the
 * Trigger Simulator's `.app-shell` — `MergedSetupPanel` / `MergedCenterPanel`
 * / `MergedLogPanel`, driving the LIVE `mergedCoordinator` tick loop.
 *
 * A small screen-level "Live / Runs" toggle (mirrors `RunsScreen`'s
 * screen-level read-only discipline, one level below the top `AppModeToggle`
 * in `App.tsx`) swaps that live 3-panel body out for the read-only
 * `MergedRunsScreen` — list persisted merged runs, reopen one into
 * `MergedReplayViewer`. The `.merged-shell` grid + its three panel children
 * stay structurally IDENTICAL to before (same className/testid, same direct
 * children) when `view === 'live'`, so existing tests/CSS are unaffected.
 */
import { useState } from 'react'
import MergedSetupPanel from './MergedSetupPanel'
import MergedCenterPanel from './MergedCenterPanel'
import MergedLogPanel from './MergedLogPanel'
import MergedProposalPanel from './MergedProposalPanel'
import MergedRunsScreen from './MergedRunsScreen'
import { RunStoreProvider } from '../../state/runStore'
import { ProposalStoreProvider } from '../../state/proposalStore'
import { RunLanguageBridge, ProposalLanguageBridge } from '../../state/languageBridges'
import { useLanguage } from '../../state/language'
import { t } from '../../i18n/t'

type MergedView = 'live' | 'runs'

const LABELS = {
  live: { ja: 'ライブ', en: 'Live' },
  runs: { ja: '実行履歴', en: 'Runs' },
}

export default function MergedShell(): JSX.Element {
  const [view, setView] = useState<MergedView>('live')
  const { lang } = useLanguage()

  const tabStyle = (active: boolean): React.CSSProperties => ({
    padding: '3px 12px',
    fontSize: '0.78em',
    fontWeight: active ? 700 : 400,
    background: active ? '#2563eb' : 'transparent',
    color: active ? '#fff' : '#94a3b8',
    border: active ? '1px solid #1d4ed8' : '1px solid transparent',
    borderRadius: '4px',
    cursor: 'pointer',
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <nav
        data-testid="merged-view-toggle"
        style={{
          display: 'flex',
          gap: '4px',
          padding: '4px 12px',
          background: '#0f0f1e',
          borderBottom: '1px solid #2a2a4a',
          flex: '0 0 auto',
        }}
      >
        <button
          type="button"
          data-testid="merged-view-live"
          aria-current={view === 'live' ? 'page' : undefined}
          onClick={() => setView('live')}
          style={tabStyle(view === 'live')}
        >
          {t(LABELS.live, lang)}
        </button>
        <button
          type="button"
          data-testid="merged-view-runs"
          aria-current={view === 'runs' ? 'page' : undefined}
          onClick={() => setView('runs')}
          style={tabStyle(view === 'runs')}
        >
          {t(LABELS.runs, lang)}
        </button>
      </nav>

      <div style={{ flex: 1, minHeight: 0 }}>
        {view === 'live' ? (
          // The whole 3-panel shell mounts SCOPED run/proposal stores (owner
          // layout, feature 020): the setup panel (left) reuses the Trigger +
          // Proposal setup editors verbatim and seeds these stores; the CENTER's
          // <MapSurface/> reads the same scoped route/Maps key. Confirmed safe
          // (both stores are plain Context + useReducer, no module singletons).
          // 20:50:30 — left = setup + log, center = quickview/animation/map,
          // right = service (top) + content (bottom) proposals.
          <RunStoreProvider initialLanguage={lang}>
            <ProposalStoreProvider initialLanguage={lang}>
              <RunLanguageBridge>
              <ProposalLanguageBridge>
              <div className="merged-shell" data-testid="merged-shell">
                <div className="left-panel">
                  <div className="merged-left-setup">
                    <MergedSetupPanel />
                  </div>
                  <div className="merged-left-log">
                    <MergedLogPanel />
                  </div>
                </div>
                <div className="center-panel">
                  <MergedCenterPanel />
                </div>
                <div className="right-panel">
                  <MergedProposalPanel />
                </div>
              </div>
              </ProposalLanguageBridge>
              </RunLanguageBridge>
            </ProposalStoreProvider>
          </RunStoreProvider>
        ) : (
          <MergedRunsScreen />
        )}
      </div>
    </div>
  )
}
