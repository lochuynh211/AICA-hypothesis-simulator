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
 * `MergedLogPanel` is no longer part of this layout, and — despite an
 * earlier version of this comment claiming otherwise — neither
 * `MergedRunsScreen` nor `MergedReplayViewer` imports it either: the log is
 * genuinely unreachable from the UI now. The design doc was corrected; this
 * comment previously was not.
 *
 * Selecting an experience test case (`ExperienceCasePicker`) is handled by
 * `useCaseSelection()` (extracted so its async race — selecting case A then
 * case B before A's driver-profile fetch resolves — can be tested without
 * mounting the whole shell; see `useCaseSelection.ts` and
 * `tests/use_case_selection.test.tsx`). The resolved case setup — including
 * the route preset / painted mountain-jam ranges, which are panel-local
 * state on `MergedSetupPanel` rather than store state — is now handed down
 * as the `caseSetup` prop (Task 18); `resolveCase(selectedCase)` is memoized
 * on `selectedCase` (a stable reference per case id from the bundled
 * catalog) so the panel's wiring effect only re-fires on an actual case
 * change, not every render.
 */
import { useMemo, useState } from 'react'
import MergedSetupPanel from './MergedSetupPanel'
import MergedCenterPanel from './MergedCenterPanel'
import MergedRunsScreen from './MergedRunsScreen'
import ExperienceCasePicker from '../review/ExperienceCasePicker'
import ExperienceCaseCard from '../review/ExperienceCaseCard'
import CaseDetailsModal from '../review/CaseDetailsModal'
import ReviewColumn from '../review/ReviewColumn'
import { caseFlagCounts } from '../review/DecisionAssessment'
import { useCaseSelection } from './useCaseSelection'
import { resolveCase } from '../../lib/review/caseResolver'
import { RunStoreProvider } from '../../state/runStore'
import { ProposalStoreProvider } from '../../state/proposalStore'
import { ReviewStoreProvider, useReviewStore } from '../../state/reviewStore'
import { MergedCoordinatorProvider, useMergedCoordinator } from '../../state/mergedCoordinator'
import { RunLanguageBridge, ProposalLanguageBridge } from '../../state/languageBridges'
import { useLanguage } from '../../state/language'
import { t } from '../../i18n/t'

type MergedView = 'live' | 'runs'

const LABELS = {
  live: { ja: 'ライブ', en: 'Live' },
  runs: { ja: '実行履歴', en: 'Runs' },
}

/**
 * The live 3-panel body — a separate component (rather than inline JSX in
 * `MergedShell`) because it needs the scoped `mergedCoordinator`/
 * `useCaseSelection` hooks, which only work below their Providers.
 */
function MergedLiveBody(): JSX.Element {
  const coordinator = useMergedCoordinator()
  const { state: reviewState } = useReviewStore()
  const { selectedCaseId, selectedCase, detailsOpen, setDetailsOpen, caseError, handleSelectCase } = useCaseSelection()
  const caseSetup = useMemo(() => (selectedCase ? resolveCase(selectedCase) : null), [selectedCase])
  // Derived, not stored — `judgments` is the single source of truth (task-14
  // brief) and this is a pure roll-up of it, recomputed whenever a judgement
  // changes so the chip never goes stale relative to what was actually judged.
  const flagCounts = useMemo(() => caseFlagCounts(reviewState.judgments), [reviewState.judgments])

  return (
    <div className="merged-shell" data-testid="merged-shell">
      <div className="left-panel">
        <ExperienceCasePicker
          selectedCaseId={selectedCaseId}
          flagCounts={flagCounts}
          onSelect={(caseId) => void handleSelectCase(caseId)}
        />
        {caseError && (
          <p role="alert" style={{ fontSize: '0.78em', color: '#dc2626', margin: '0 0 8px' }}>
            {caseError}
          </p>
        )}
        {selectedCase && <ExperienceCaseCard testCase={selectedCase} onOpenDetails={() => setDetailsOpen(true)} />}
        <MergedSetupPanel
          caseSetup={caseSetup}
          selectedCase={selectedCase}
          // Reset routes through the SAME guarded selection path the case
          // picker uses (task-18 review Finding 2) — re-selecting the
          // already-selected case id is a safe, idempotent no-op on the
          // review/run-store side, and shares `selectionRef` with any case
          // switch a reviewer makes while Reset's own fetch is in flight.
          onResetToCase={() => (selectedCaseId ? handleSelectCase(selectedCaseId) : undefined)}
        />
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
