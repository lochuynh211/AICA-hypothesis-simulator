/**
 * proposalStore — isolated Context + useReducer store for the Proposal
 * Simulator (P1 T004).
 *
 * Same pattern as `runStore.ts` (Context + useReducer, a Provider + a
 * `use*Store` hook) but deliberately ISOLATED: this module must not import
 * `runStore` or any trigger state. `uiLanguage` defaults to `'ja'` — the
 * Proposal screen's JA-default convention (design decision D6) — distinct
 * from the trigger store's `'en'` default.
 *
 * This is a P1-T004 skeleton: state/actions grow as later tasks (World /
 * Service / Content panels, run creation, etc.) land. Keep additions here
 * isolated from trigger types and trigger stores.
 */
import React, { createContext, useContext, useReducer } from 'react'

// ── State ────────────────────────────────────────────────────────────────

export type ProposalStoreState = {
  /** The language shown in the Proposal UI. Session-only. Default 'ja'. */
  uiLanguage: 'ja' | 'en'
}

const initialState: ProposalStoreState = {
  uiLanguage: 'ja',
}

// ── Actions ──────────────────────────────────────────────────────────────

export type ProposalStoreAction =
  /** Switch the Proposal UI language. Session-only. */
  { type: 'SET_LANGUAGE'; lang: 'ja' | 'en' }

// ── Reducer ──────────────────────────────────────────────────────────────

export function proposalReducer(
  state: ProposalStoreState,
  action: ProposalStoreAction,
): ProposalStoreState {
  switch (action.type) {
    case 'SET_LANGUAGE':
      return { ...state, uiLanguage: action.lang }
    default:
      return state
  }
}

// ── Context ──────────────────────────────────────────────────────────────

type ProposalStoreContextValue = {
  state: ProposalStoreState
  dispatch: React.Dispatch<ProposalStoreAction>
}

const ProposalStoreContext = createContext<ProposalStoreContextValue | null>(null)

// ── Provider ─────────────────────────────────────────────────────────────

export function ProposalStoreProvider({
  children,
  initialLanguage,
}: {
  children: React.ReactNode
  /** Optional override for the initial UI language. Defaults to 'ja'. */
  initialLanguage?: 'ja' | 'en'
}) {
  const [state, dispatch] = useReducer(
    proposalReducer,
    initialLanguage ? { ...initialState, uiLanguage: initialLanguage } : initialState,
  )
  const value: ProposalStoreContextValue = { state, dispatch }
  return React.createElement(ProposalStoreContext.Provider, { value }, children)
}

// ── Hook ─────────────────────────────────────────────────────────────────

export function useProposalStore(): ProposalStoreContextValue {
  const ctx = useContext(ProposalStoreContext)
  if (!ctx) {
    throw new Error('useProposalStore must be used within a ProposalStoreProvider')
  }
  return ctx
}
