/**
 * language — top-level UI-language context (single source of truth).
 *
 * ONE global language state spanning all three shells (Trigger / Proposal /
 * Combined). Mounted above `AppModeProvider` in `App.tsx`, so switching the
 * language in the header follows you across every screen.
 *
 * Deliberately ISOLATED from `runStore` and `proposalStore` — this context
 * holds nothing but the language flag. Those two stores keep their own
 * `uiLanguage` field for backward-compat (47 components read it), but it is a
 * MIRROR: a small bridge seeds each store from here and dispatches
 * SET_LANGUAGE whenever this value changes, so this provider is the only
 * writable source. The Combined shell has no store and reads `useLanguage()`
 * directly.
 *
 * Session-only: switching language does NOT persist across page loads.
 */
import React, { createContext, useContext, useState } from 'react'
import type { UiLanguage } from '../i18n/t'

export type LanguageContextValue = {
  lang: UiLanguage
  setLang: (lang: UiLanguage) => void
}

/**
 * Default context value used when a component is rendered OUTSIDE a
 * `LanguageProvider`. The whole app is always wrapped by one (see `App.tsx`,
 * default `'ja'`), so this fallback only applies to standalone/isolated mounts
 * — chiefly unit tests that render a single component without the provider.
 * It defaults to `'en'` to match the two stores' own `uiLanguage` default, so
 * an un-wrapped component renders the same language it always has; `setLang`
 * is a no-op there (there is no provider state to update). This mirrors the
 * "context with a sensible default" React pattern rather than throwing, which
 * keeps low-level shared components (ErrorNotice, MotionBadge, …) usable in
 * isolation.
 */
const DEFAULT_LANGUAGE_CONTEXT: LanguageContextValue = { lang: 'en', setLang: () => {} }

const LanguageContext = createContext<LanguageContextValue>(DEFAULT_LANGUAGE_CONTEXT)

export function LanguageProvider({
  children,
  initialLanguage = 'ja',
}: {
  children: React.ReactNode
  /** Optional override for the initial UI language. Defaults to 'ja'. */
  initialLanguage?: UiLanguage
}) {
  const [lang, setLang] = useState<UiLanguage>(initialLanguage)
  const value: LanguageContextValue = { lang, setLang }
  return React.createElement(LanguageContext.Provider, { value }, children)
}

export function useLanguage(): LanguageContextValue {
  return useContext(LanguageContext)
}
