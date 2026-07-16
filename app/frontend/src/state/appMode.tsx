/**
 * appMode — top-level application-mode context (P1 T003).
 *
 * A sibling switch above the existing trigger `viewMode` (see `runStore.ts`):
 * `'trigger'` renders the existing, unmodified Trigger Simulator shell;
 * `'proposal'` renders the standalone Proposal Simulator shell (a later task —
 * P1 T003 only wires the switch + a placeholder).
 *
 * Deliberately ISOLATED from `runStore` — this context holds nothing but the
 * mode flag itself. It must not import `runStore` or any proposal store.
 */
import React, { createContext, useContext, useState } from 'react'

export type AppMode = 'trigger' | 'proposal'

export type AppModeContextValue = {
  appMode: AppMode
  setAppMode: (mode: AppMode) => void
}

const AppModeContext = createContext<AppModeContextValue | null>(null)

export function AppModeProvider({
  children,
  initialMode = 'trigger',
}: {
  children: React.ReactNode
  /** Optional override for the initial app mode. Defaults to 'trigger'. */
  initialMode?: AppMode
}) {
  const [appMode, setAppMode] = useState<AppMode>(initialMode)
  const value: AppModeContextValue = { appMode, setAppMode }
  return React.createElement(AppModeContext.Provider, { value }, children)
}

export function useAppMode(): AppModeContextValue {
  const ctx = useContext(AppModeContext)
  if (!ctx) {
    throw new Error('useAppMode must be used within an AppModeProvider')
  }
  return ctx
}
