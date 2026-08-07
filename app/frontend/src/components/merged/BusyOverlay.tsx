/**
 * BusyOverlay (fixbug-0806) — a translucent, input-swallowing blocker over the
 * whole `.merged-shell` while a `quickview()` recompute is in flight
 * (`coordinator.state.quickviewPending`). It prevents any setup field or
 * left-panel dropdown from changing mid-recompute, which is what caused
 * overlapping quickview requests to resolve out of order.
 *
 * Rendered as a direct child of the `.merged-shell` div (which is
 * `position: relative`), so it is absolutely positioned within the 3-column
 * grid and covers all of it. It does NOT need to cover open Edit popups: while
 * a popup is open the recompute is SUPPRESSED (MergedSetupPanel), so the
 * overlay only appears after a popup has closed.
 */
import { useMergedCoordinator } from '../../state/mergedCoordinator'
import { useLanguage } from '../../state/language'
import { t } from '../../i18n/t'

const LABELS = {
  recomputing: { ja: '再計算中…', en: 'Recomputing…' },
}

export default function BusyOverlay(): JSX.Element | null {
  const { state } = useMergedCoordinator()
  const { lang } = useLanguage()
  if (!state.quickviewPending) return null
  return (
    <div className="merged-busy-overlay" data-testid="merged-busy-overlay" aria-hidden={false}>
      <div className="merged-busy-overlay__box" role="status" aria-live="polite">
        <span className="merged-busy-overlay__spinner" />
        <span>{t(LABELS.recomputing, lang)}</span>
      </div>
    </div>
  )
}
