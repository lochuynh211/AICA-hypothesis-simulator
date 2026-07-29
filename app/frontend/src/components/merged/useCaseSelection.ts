/**
 * useCaseSelection — resolves an experience test case (`resolveCase` →
 * `caseDispatches`) into the scoped run/proposal stores.
 *
 * Extracted out of `MergedShell`'s JSX (task-17 review, Finding 2) so the
 * async race below can be tested without mounting the whole shell.
 *
 * RACE GUARD (task-17 review, Finding 1): the case's profile/preset reference
 * is resolved before the `proposal` dispatches (LOAD_PROFILE needs the resolved
 * DriverProfile object; `caseDispatches` only knows the profile reference id). Without
 * a guard, selecting case A then case B before A's fetch resolves would land
 * A's SET_SERVICE_PACKAGE/SET_CONTENT_PACKAGE/LOAD_PROFILE dispatches AFTER
 * B's — the proposal store ends up on A's packages/profile while
 * reviewStore/runStore both already say B. `selectionRef` is bumped on every
 * call; the async continuation bails (no dispatch, no `caseError`) the
 * moment it discovers a newer selection has started since — a stale result
 * must never win over a newer one, whether it succeeds or fails.
 */
import { useRef, useState } from 'react'
import { useRunStore, type RunStoreAction } from '../../state/runStore'
import { useProposalStore, type ProposalStoreAction } from '../../state/proposalStore'
import { useReviewStore } from '../../state/reviewStore'
import { useLanguage } from '../../state/language'
import { t } from '../../i18n/t'
import { getCase } from '../../lib/review/caseCatalog'
import type { CombinedTestCase } from '../../lib/review/caseCatalog'
import { resolveCase, caseDispatches } from '../../lib/review/caseResolver'
import { getPreset, getProfile } from '../../api/proposalClient'
import type { DriverProfile } from '../../api/proposalClient'

const LABELS = {
  caseLoadFailed: {
    ja: 'テストケースのドライバープロファイルを読み込めませんでした。',
    en: 'Could not load the test case’s driver profile.',
  },
}

export type CaseSelection = {
  selectedCaseId: string | null
  selectedCase: CombinedTestCase | null
  caseError: string | null
  handleSelectCase: (caseId: string) => Promise<void>
  /** Drop back to "no test case", leaving the current setup untouched. */
  clearCase: () => void
}

async function resolveDriverProfile(profileRef: string): Promise<DriverProfile> {
  if (profileRef.startsWith('profile-')) {
    return (await getProfile(profileRef)).profile
  }
  return (await getPreset(profileRef)).world.driver_profile
}

export function useCaseSelection(): CaseSelection {
  const { lang } = useLanguage()
  const runStore = useRunStore()
  const proposalStore = useProposalStore()
  const reviewStore = useReviewStore()

  const [caseError, setCaseError] = useState<string | null>(null)
  // Bumped on every `handleSelectCase` call — see the race-guard note above.
  const selectionRef = useRef(0)

  const selectedCaseId = reviewStore.state.selectedCaseId
  const selectedCase = selectedCaseId ? getCase(selectedCaseId) : null

  /** Clearing shares `selectionRef` with `handleSelectCase`: bumping it here
   *  stops an in-flight case load from landing its proposal dispatches after
   *  the reviewer has already dropped back to "no test case". */
  function clearCase(): void {
    selectionRef.current++
    setCaseError(null)
    reviewStore.dispatch({ type: 'SELECT_CASE', caseId: null })
  }

  async function handleSelectCase(caseId: string): Promise<void> {
    if (!caseId) { clearCase(); return }
    const mySelection = ++selectionRef.current
    setCaseError(null)
    reviewStore.dispatch({ type: 'SELECT_CASE', caseId })
    const testCase = getCase(caseId)
    if (!testCase) return

    const setup = resolveCase(testCase)
    const { run, proposal } = caseDispatches(setup)

    // Dispatch order matters — SELECT_SCENARIO (inside `run`) clears
    // contextOverrides/tick/initial signals/seed, so every pin must follow
    // it. `caseDispatches` already orders `run` correctly; dispatch it
    // as-is. These are synchronous (no await between them), so they can
    // never interleave with another call's `run` dispatches.
    for (const action of run) {
      runStore.dispatch(action as unknown as RunStoreAction)
    }

    // `caseDispatches` emits LOAD_PROFILE with only `profileId` — the real
    // reducer needs `{ profileId, profile }` carrying the resolved
    // DriverProfile. Fetch it here and attach it before dispatching.
    let profile: DriverProfile | null = null
    let fetchFailed = false
    try {
      profile = await resolveDriverProfile(setup.profileRef)
    } catch {
      fetchFailed = true
    }

    // A newer selection started while this fetch was in flight — its result
    // (success or failure) must win. Applying this stale one now — whether
    // dispatching its proposal actions or surfacing ITS error — would
    // silently mismatch the proposal store (or the visible error) against
    // what reviewStore/runStore already show for the newer selection.
    if (selectionRef.current !== mySelection) return

    if (fetchFailed) {
      // No half-applied setup: bail before dispatching ANY proposal action
      // (not just LOAD_PROFILE) rather than leaving the store on a mix of
      // this case's packages/situation fields with no matching profile.
      setCaseError(t(LABELS.caseLoadFailed, lang))
      return
    }

    for (const action of proposal) {
      if (action.type === 'LOAD_PROFILE') {
        if (!profile) continue
        proposalStore.dispatch({ type: 'LOAD_PROFILE', profileId: action.profileId as string, profile })
        continue
      }
      proposalStore.dispatch(action as unknown as ProposalStoreAction)
    }
  }

  return {
    selectedCaseId, selectedCase, caseError,
    handleSelectCase, clearCase,
  }
}
