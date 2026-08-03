/**
 * languageBridges — mirror the single global `LanguageProvider` into the
 * per-screen stores.
 *
 * The global `LanguageProvider` (state/language.tsx) is the ONE writable
 * source of truth for UI language. But ~40 components still read
 * `state.uiLanguage` off `runStore` / `proposalStore`. Rather than rewrite
 * them all, each store keeps `uiLanguage` as a MIRROR: seed it with
 * `initialLanguage={lang}` on the provider, then mount the matching bridge so
 * a later header toggle is dispatched through as SET_LANGUAGE.
 *
 * Used by both `App.tsx` (Trigger / Proposal shells) and `MergedShell` (the
 * Combined screen, which mounts its own scoped stores that reuse the Trigger
 * and Proposal setup editors — those editors read `state.uiLanguage`).
 */
import { useEffect } from 'react'
import { useLanguage } from './language'
import { useRunStore } from './runStore'
import { useProposalStore } from './proposalStore'

/** Mirrors the global language into the trigger `runStore`. */
export function RunLanguageBridge({ children }: { children: React.ReactNode }) {
  const { lang } = useLanguage()
  const { state, dispatch } = useRunStore()
  useEffect(() => {
    if (state.uiLanguage !== lang) dispatch({ type: 'SET_LANGUAGE', lang })
  }, [lang, state.uiLanguage, dispatch])
  return <>{children}</>
}

/** Mirrors the global language into the proposal `proposalStore`. */
export function ProposalLanguageBridge({ children }: { children: React.ReactNode }) {
  const { lang } = useLanguage()
  const { state, dispatch } = useProposalStore()
  useEffect(() => {
    if (state.uiLanguage !== lang) dispatch({ type: 'SET_LANGUAGE', lang })
  }, [lang, state.uiLanguage, dispatch])
  return <>{children}</>
}
