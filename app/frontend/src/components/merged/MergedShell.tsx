/**
 * MergedShell — Combined Simulator shell (020 Task 6, Live/Runs toggle added
 * Slice-2c Task 6; reshaped to a 20:45:35 review layout, task-17-brief).
 *
 * Left = experience-case picker/card + the reused setup panel. Centre =
 * `MergedCenterPanel` (playback/map, then the checkpoint rail, decision band
 * and the service/content proposal cards — see that file for why the
 * proposal cards are rendered as SIBLINGS of the animated playback subtree,
 * not descendants of it). Right = `ReviewColumn`, mounted exactly once (it
 * owns `WhatDecidedIt`'s hardcoded element ids).
 *
 * `MergedLogPanel` is no longer part of this layout — the log stays on
 * `MergedRunsScreen`/`MergedReplayViewer`, which still import it directly.
 *
 * Selecting an experience test case (`ExperienceCasePicker`) resolves it
 * (`resolveCase`) into the scoped `runStore`/`proposalStore` via
 * `caseDispatches`' plain action list, fetching the case's driver profile
 * (`getPreset(profileRef)`) and attaching the resolved `DriverProfile` object
 * to the `LOAD_PROFILE` dispatch — `caseDispatches` itself only knows the
 * preset id, not the object the real reducer needs (a deliberate seam so it
 * stays testable without mounting React). The route preset / painted
 * mountain-jam ranges `resolveCase` also returns are panel-local state on
 * `MergedSetupPanel`, which doesn't accept them as props yet (Task 18 adds
 * that) — so case selection today seeds the two stores only; the route stays
 * whatever the panel's own defaults loaded.
 */
import { useState } from 'react'
import MergedSetupPanel from './MergedSetupPanel'
import MergedCenterPanel from './MergedCenterPanel'
import MergedRunsScreen from './MergedRunsScreen'
import ExperienceCasePicker from '../review/ExperienceCasePicker'
import ExperienceCaseCard from '../review/ExperienceCaseCard'
import CaseDetailsModal from '../review/CaseDetailsModal'
import ReviewColumn from '../review/ReviewColumn'
import { RunStoreProvider, useRunStore, type RunStoreAction } from '../../state/runStore'
import { ProposalStoreProvider, useProposalStore, type ProposalStoreAction } from '../../state/proposalStore'
import { ReviewStoreProvider, useReviewStore } from '../../state/reviewStore'
import { MergedCoordinatorProvider, useMergedCoordinator } from '../../state/mergedCoordinator'
import { RunLanguageBridge, ProposalLanguageBridge } from '../../state/languageBridges'
import { useLanguage } from '../../state/language'
import { t } from '../../i18n/t'
import { getCase } from '../../lib/review/caseCatalog'
import { resolveCase, caseDispatches } from '../../lib/review/caseResolver'
import { getPreset } from '../../api/proposalClient'
import type { DriverProfile } from '../../api/proposalClient'

type MergedView = 'live' | 'runs'

const LABELS = {
  live: { ja: 'ライブ', en: 'Live' },
  runs: { ja: '実行履歴', en: 'Runs' },
  caseLoadFailed: {
    ja: 'テストケースのドライバープロファイルを読み込めませんでした。',
    en: 'Could not load the test case’s driver profile.',
  },
}

/**
 * The live 3-panel body — a separate component (rather than inline JSX in
 * `MergedShell`) because it needs the scoped `runStore`/`proposalStore`/
 * `reviewStore`/`mergedCoordinator` hooks, which only work below their
 * Providers.
 */
function MergedLiveBody(): JSX.Element {
  const { lang } = useLanguage()
  const runStore = useRunStore()
  const proposalStore = useProposalStore()
  const reviewStore = useReviewStore()
  const coordinator = useMergedCoordinator()

  const [detailsOpen, setDetailsOpen] = useState(false)
  const [caseError, setCaseError] = useState<string | null>(null)

  const selectedCaseId = reviewStore.state.selectedCaseId
  const selectedCase = selectedCaseId ? getCase(selectedCaseId) : null

  async function handleSelectCase(caseId: string): Promise<void> {
    setCaseError(null)
    reviewStore.dispatch({ type: 'SELECT_CASE', caseId })
    const testCase = getCase(caseId)
    if (!testCase) return

    const setup = resolveCase(testCase)
    const { run, proposal } = caseDispatches(setup)

    // Dispatch order matters — SELECT_SCENARIO (inside `run`) clears
    // contextOverrides/tick/initial signals/seed, so every pin must follow
    // it. `caseDispatches` already orders `run` correctly; dispatch it
    // as-is.
    for (const action of run) {
      runStore.dispatch(action as unknown as RunStoreAction)
    }

    // `caseDispatches` emits LOAD_PROFILE with only `profileId` — the real
    // reducer needs `{ profileId, profile }` carrying the resolved
    // DriverProfile. Fetch it here and attach it before dispatching.
    let profile: DriverProfile | null = null
    try {
      const preset = await getPreset(setup.profileRef)
      profile = preset.world.driver_profile
    } catch {
      setCaseError(t(LABELS.caseLoadFailed, lang))
    }

    for (const action of proposal) {
      if (action.type === 'LOAD_PROFILE') {
        if (!profile) continue // Keep whatever profile was already loaded rather than dispatching a broken action.
        proposalStore.dispatch({ type: 'LOAD_PROFILE', profileId: action.profileId as string, profile })
        continue
      }
      proposalStore.dispatch(action as unknown as ProposalStoreAction)
    }
  }

  return (
    <div className="merged-shell" data-testid="merged-shell">
      <div className="left-panel">
        <ExperienceCasePicker
          selectedCaseId={selectedCaseId}
          flagCounts={{}}
          onSelect={(caseId) => void handleSelectCase(caseId)}
        />
        {caseError && (
          <p role="alert" style={{ fontSize: '0.78em', color: '#dc2626', margin: '0 0 8px' }}>
            {caseError}
          </p>
        )}
        {selectedCase && <ExperienceCaseCard testCase={selectedCase} onOpenDetails={() => setDetailsOpen(true)} />}
        <MergedSetupPanel />
        <CaseDetailsModal open={detailsOpen} testCase={selectedCase} onClose={() => setDetailsOpen(false)} />
      </div>
      <div className="center-panel">
        <MergedCenterPanel />
      </div>
      <div className="right-panel">
        <ReviewColumn result={coordinator.state.quickviewResult} mergedRunId={coordinator.state.mergedRunId} />
      </div>
    </div>
  )
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
          // The whole 3-panel shell mounts SCOPED run/proposal/review stores +
          // its own MergedCoordinatorProvider (owner layout, feature 020 +
          // task-17-brief), so `MergedShell` is mountable standalone (see
          // `tests/merged_review_layout.test.tsx`) without relying on
          // `App.tsx`'s outer provider.
          <RunStoreProvider initialLanguage={lang}>
            <ProposalStoreProvider initialLanguage={lang}>
              <ReviewStoreProvider>
                <MergedCoordinatorProvider>
                  <RunLanguageBridge>
                    <ProposalLanguageBridge>
                      <MergedLiveBody />
                    </ProposalLanguageBridge>
                  </RunLanguageBridge>
                </MergedCoordinatorProvider>
              </ReviewStoreProvider>
            </ProposalStoreProvider>
          </RunStoreProvider>
        ) : (
          <MergedRunsScreen />
        )}
      </div>
    </div>
  )
}
