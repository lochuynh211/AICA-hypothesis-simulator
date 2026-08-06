/**
 * MergedShell — Combined Simulator shell (reshaped to a 20:45:35 review
 * layout, task-17-brief). The Live/Runs toggle this shell used to have
 * (Slice-2c Task 6) was removed: the shell now renders only the live
 * 3-panel body.
 *
 * Left = experience-case picker/card + the reused setup panel. Centre =
 * `MergedCenterPanel` (playback/map, then the checkpoint rail, decision band
 * and the service/content proposal cards — see that file for why the
 * proposal cards are rendered as SIBLINGS of the animated playback subtree,
 * not descendants of it). Right = `ReviewColumn`, mounted exactly once (it
 * owns `WhatDecidedIt`'s hardcoded element ids).
 *
 * `MergedLogPanel` is no longer part of this layout, and is genuinely
 * unreachable from the UI now.
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
import { useEffect, useMemo, useRef, useState } from 'react'
import MergedSetupPanel from './MergedSetupPanel'
import MergedCenterPanel from './MergedCenterPanel'
import ExperienceCasePicker from '../review/ExperienceCasePicker'
import ExperienceCaseCard from '../review/ExperienceCaseCard'
import ReviewColumn from '../review/ReviewColumn'
import { caseFlagCounts } from '../review/DecisionAssessment'
import { useCaseSelection } from './useCaseSelection'
import { resolveCase } from '../../lib/review/caseResolver'
import { RunStoreProvider } from '../../state/runStore'
import { ProposalStoreProvider, useProposalStore } from '../../state/proposalStore'
import { useSongNames } from '../proposal/useSongNames'
import { ReviewStoreProvider, useReviewStore } from '../../state/reviewStore'
import { MergedCoordinatorProvider, useMergedCoordinator } from '../../state/mergedCoordinator'
import { RunLanguageBridge, ProposalLanguageBridge } from '../../state/languageBridges'
import { useLanguage } from '../../state/language'

/** The case the Combined screen opens on — the first visible UC demo case.
 *  (C-01…C-06 are hidden from the picker now, so opening on one would display
 *  a case the picker cannot show; see caseCatalog.ts's VISIBLE_CASE_ORDER.) */
const DEFAULT_CASE_ID = 'case-uc01-01-oshikatsu-c'

/**
 * The live 3-panel body — a separate component (rather than inline JSX in
 * `MergedShell`) because it needs the scoped `mergedCoordinator`/
 * `useCaseSelection` hooks, which only work below their Providers.
 */
function MergedLiveBody(): JSX.Element {
  const coordinator = useMergedCoordinator()
  const { state: reviewState } = useReviewStore()
  const {
    selectedCaseId, selectedCase, caseError, handleSelectCase,
  } = useCaseSelection()

  // Editing the setup no longer CLEARS the case — with no null entry in the
  // picker there is nowhere to clear to, and a null selection would make the
  // picker display a case that had not been applied. Instead the case stays
  // selected and is marked modified, so an edited setup is never silently
  // presented as the case exactly as authored.
  const [caseModified, setCaseModified] = useState(false)
  const selectCase = async (caseId: string) => {
    setCaseModified(false)
    await handleSelectCase(caseId)
  }
  const caseSetup = useMemo(() => (selectedCase ? resolveCase(selectedCase) : null), [selectedCase])

  // A case is ALWAYS selected (owner review): the picker no longer offers a
  // null entry, so DEFAULT_CASE_ID is applied on first mount. Without this the
  // store would still start at null and the picker would display the default
  // case while nothing had been applied — the exact mismatch the empty option
  // used to paper over.
  const bootstrapped = useRef(false)
  useEffect(() => {
    if (bootstrapped.current || selectedCaseId) return
    bootstrapped.current = true
    void selectCase(DEFAULT_CASE_ID)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCaseId])
  // Derived, not stored — `judgments` is the single source of truth (task-14
  // brief) and this is a pure roll-up of it, recomputed whenever a judgement
  // changes so the chip never goes stale relative to what was actually judged.
  const flagCounts = useMemo(() => caseFlagCounts(reviewState.judgments), [reviewState.judgments])
  // Resolved once here and handed to the review column, so the content plan and
  // the comparison name songs from the SAME dataset.
  const { state: proposalState } = useProposalStore()
  const songNames = useSongNames(proposalState.world?.catalog_ref?.dataset_id)

  return (
    <div className="merged-shell" data-testid="merged-shell">
      <div className="left-panel">
        <ExperienceCasePicker
          selectedCaseId={selectedCaseId}
          flagCounts={flagCounts}
          onSelect={(caseId) => void selectCase(caseId)}
        />
        {caseError && (
          <p role="alert" style={{ fontSize: '0.78em', color: '#dc2626', margin: '0 0 8px' }}>
            {caseError}
          </p>
        )}
        {selectedCase && <ExperienceCaseCard testCase={selectedCase} />}
        <MergedSetupPanel
          caseSetup={caseSetup}
          selectedCase={selectedCase}
          caseModified={caseModified}
          onCaseDrift={() => setCaseModified(true)}

        />
      </div>
      <div className="center-panel">
        <MergedCenterPanel />
      </div>
      <div className="right-panel">
        <ReviewColumn
          result={coordinator.state.quickviewResult}
          mergedRunId={coordinator.state.mergedRunId}
          songNames={songNames}
          caseModified={caseModified}
          explanationProvider={proposalState.explanationProvider}
        />
      </div>
    </div>
  )
}

export default function MergedShell(): JSX.Element {
  const { lang } = useLanguage()

  return (
    <div style={{ height: '100%', minHeight: 0 }}>
      {/* The whole 3-panel shell mounts SCOPED run/proposal/review stores +
          its own MergedCoordinatorProvider (owner layout, feature 020 +
          task-17-brief), so `MergedShell` is mountable standalone (see
          `tests/merged_review_layout.test.tsx`) without relying on
          `App.tsx`'s outer provider. */}
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
    </div>
  )
}
